// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	// From ossrs.
	"github.com/ossrs/go-oryx-lib/errors"
	ohttp "github.com/ossrs/go-oryx-lib/http"
	"github.com/ossrs/go-oryx-lib/logger"
	// Use v8 because we use Go 1.16+, while v9 requires Go 1.18+
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"github.com/sashabaranov/go-openai"
)

// The total segments in WebVTT HLS window.
const maxWebVttSegments = 9

var transcriptWorker *TranscriptWorker

type TranscriptWorker struct {
	cancel context.CancelFunc
	wg     sync.WaitGroup

	// The global transcript task, only support one transcript task.
	task *TranscriptTask

	// Use async goroutine to process on_hls messages.
	msgs chan *SrsOnHlsMessage

	// Got message from SRS, a new TS segment file is generated.
	tsfiles chan *SrsOnHlsObject
}

func NewTranscriptWorker() *TranscriptWorker {
	v := &TranscriptWorker{
		// Message on_hls.
		msgs: make(chan *SrsOnHlsMessage, 1024),
		// TS files.
		tsfiles: make(chan *SrsOnHlsObject, 1024),
	}
	v.task = NewTranscriptTask()
	v.task.transcriptWorker = v
	return v
}

func (v *TranscriptWorker) Handle(ctx context.Context, handler *http.ServeMux) error {
	ep := "/terraform/v1/ai/transcript/query"
	logger.Tf(ctx, "Handle %v", ep)
	handler.HandleFunc(ep, func(w http.ResponseWriter, r *http.Request) {
		if err := func() error {
			var token string
			if err := ParseBody(ctx, r.Body, &struct {
				Token *string `json:"token"`
			}{
				Token: &token,
			}); err != nil {
				return errors.Wrapf(err, "parse body")
			}

			apiSecret := envApiSecret()
			if err := Authenticate(ctx, apiSecret, token, r.Header); err != nil {
				return errors.Wrapf(err, "authenticate")
			}

			config := NewTranscriptConfig()
			if err := config.Load(ctx); err != nil {
				return errors.Wrapf(err, "load config")
			}

			type QueryResponse struct {
				Config *TranscriptConfig `json:"config"`
				Task   struct {
					UUID string `json:"uuid"`
				} `json:"task"`
			}

			resp := &QueryResponse{
				Config: config,
			}
			resp.Task.UUID = v.task.UUID

			ohttp.WriteData(ctx, w, r, resp)
			logger.Tf(ctx, "transcript query ok, config=<%v>, uuid=%v, token=%vB",
				config, v.task.UUID, len(token))
			return nil
		}(); err != nil {
			ohttp.WriteError(ctx, w, r, err)
		}
	})

	ep = "/terraform/v1/ai/transcript/apply"
	logger.Tf(ctx, "Handle %v", ep)
	handler.HandleFunc(ep, func(w http.ResponseWriter, r *http.Request) {
		if err := func() error {
			var token string
			var uuid string
			var config TranscriptConfig
			if err := ParseBody(ctx, r.Body, &struct {
				Token *string `json:"token"`
				UUID  *string `json:"uuid"`
				*TranscriptConfig
			}{
				Token: &token,
				UUID:  &uuid, TranscriptConfig: &config,
			}); err != nil {
				return errors.Wrapf(err, "parse body")
			}

			apiSecret := envApiSecret()
			if err := Authenticate(ctx, apiSecret, token, r.Header); err != nil {
				return errors.Wrapf(err, "authenticate")
			}

			// Not required yet.
			if uuid != v.task.UUID {
				logger.Wf(ctx, "transcript ignore uuid mismatch, query=%v, task=%v", uuid, v.task.UUID)
			}

			if err := config.Save(ctx); err != nil {
				return errors.Wrapf(err, "save config")
			}

			if err := v.task.restart(ctx); err != nil {
				return errors.Wrapf(err, "restart task %v", config.String())
			}

			type ApplyResponse struct {
				UUID string `json:"uuid"`
			}
			ohttp.WriteData(ctx, w, r, &ApplyResponse{
				UUID: v.task.UUID,
			})
			logger.Tf(ctx, "transcript apply ok, config=<%v>, uuid=%v, token=%vB",
				config, v.task.UUID, len(token))
			return nil
		}(); err != nil {
			ohttp.WriteError(ctx, w, r, err)
		}
	})

	ep = "/terraform/v1/ai/transcript/check"
	logger.Tf(ctx, "Handle %v", ep)
	handler.HandleFunc(ep, func(w http.ResponseWriter, r *http.Request) {
		if err := func() error {
			var token string
			var transcriptConfig TranscriptConfig
			if err := ParseBody(ctx, r.Body, &struct {
				Token *string `json:"token"`
				*TranscriptConfig
			}{
				Token:            &token,
				TranscriptConfig: &transcriptConfig,
			}); err != nil {
				return errors.Wrapf(err, "parse body")
			}

			apiSecret := envApiSecret()
			if err := Authenticate(ctx, apiSecret, token, r.Header); err != nil {
				return errors.Wrapf(err, "authenticate")
			}

			// Query whisper-1 model detail.
			var config openai.ClientConfig
			config = openai.DefaultConfig(transcriptConfig.SecretKey)
			config.BaseURL = transcriptConfig.BaseURL

			ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
			defer cancel()

			client := openai.NewClientWithConfig(config)
			model, err := client.GetModel(ctx, "whisper-1")
			if err != nil {
				return errors.Wrapf(err, "query model whisper-1")
			}

			// Start a chat, to check whether the billing is expired.
			resp, err := client.CreateChatCompletion(
				ctx, openai.ChatCompletionRequest{
					Model: openai.GPT3Dot5Turbo,
					Messages: []openai.ChatCompletionMessage{
						{
							Role:    openai.ChatMessageRoleUser,
							Content: "Hello!",
						},
					},
					MaxTokens: 50,
				},
			)
			if err != nil {
				return errors.Wrapf(err, "create chat")
			}

			ohttp.WriteData(ctx, w, r, nil)
			logger.Tf(ctx, "transcript check ok, config=<%v>, model=<%v>, msg=<%v>, token=%vB",
				transcriptConfig, model.ID, resp.Choices[0].Message.Content, len(token))
			return nil
		}(); err != nil {
			ohttp.WriteError(ctx, w, r, err)
		}
	})

	ep = "/terraform/v1/ai/transcript/reset"
	logger.Tf(ctx, "Handle %v", ep)
	handler.HandleFunc(ep, func(w http.ResponseWriter, r *http.Request) {
		if err := func() error {
			var token string
			var uuid string
			if err := ParseBody(ctx, r.Body, &struct {
				Token *string `json:"token"`
				UUID  *string `json:"uuid"`
			}{
				Token: &token,
				UUID:  &uuid,
			}); err != nil {
				return errors.Wrapf(err, "parse body")
			}

			apiSecret := envApiSecret()
			if err := Authenticate(ctx, apiSecret, token, r.Header); err != nil {
				return errors.Wrapf(err, "authenticate")
			}

			if uuid != v.task.UUID {
				return errors.Errorf("invalid uuid %v", uuid)
			}

			if err := v.task.reset(ctx); err != nil {
				return errors.Wrapf(err, "restart task %v", uuid)
			}

			type ResetResponse struct {
				UUID string `json:"uuid"`
			}
			ohttp.WriteData(ctx, w, r, &ResetResponse{
				UUID: v.task.UUID,
			})
			logger.Tf(ctx, "transcript reset ok, uuid=%v, new=%v, token=%vB", uuid, v.task.UUID, len(token))
			return nil
		}(); err != nil {
			ohttp.WriteError(ctx, w, r, err)
		}
	})

	ep = "/terraform/v1/ai/transcript/live-queue"
	logger.Tf(ctx, "Handle %v", ep)
	handler.HandleFunc(ep, func(w http.ResponseWriter, r *http.Request) {
		if err := func() error {
			var token string
			if err := ParseBody(ctx, r.Body, &struct {
				Token *string `json:"token"`
			}{
				Token: &token,
			}); err != nil {
				return errors.Wrapf(err, "parse body")
			}

			apiSecret := envApiSecret()
			if err := Authenticate(ctx, apiSecret, token, r.Header); err != nil {
				return errors.Wrapf(err, "authenticate")
			}

			type Segment struct {
				TsID     string  `json:"tsid"`
				SeqNo    uint64  `json:"seqno"`
				URL      string  `json:"url"`
				Duration float64 `json:"duration"`
				Size     uint64  `json:"size"`
			}
			type LiveQueueResponse struct {
				Segments []*Segment `json:"segments"`
				Count    int        `json:"count"`
			}
			res := &LiveQueueResponse{}

			segments := v.task.liveSegments()
			for _, segment := range segments {
				res.Segments = append(res.Segments, []*Segment{&Segment{
					TsID:     segment.TsFile.TsID,
					SeqNo:    segment.TsFile.SeqNo,
					URL:      segment.TsFile.URL,
					Duration: segment.TsFile.Duration,
					Size:     segment.TsFile.Size,
				}}...)
			}

			res.Count = len(res.Segments)

			ohttp.WriteData(ctx, w, r, res)
			logger.Tf(ctx, "transcript query live ok, token=%vB", len(token))
			return nil
		}(); err != nil {
			ohttp.WriteError(ctx, w, r, err)
		}
	})

	ep = "/terraform/v1/ai/transcript/asr-queue"
	logger.Tf(ctx, "Handle %v", ep)
	handler.HandleFunc(ep, func(w http.ResponseWriter, r *http.Request) {
		if err := func() error {
			var token string
			if err := ParseBody(ctx, r.Body, &struct {
				Token *string `json:"token"`
			}{
				Token: &token,
			}); err != nil {
				return errors.Wrapf(err, "parse body")
			}

			apiSecret := envApiSecret()
			if err := Authenticate(ctx, apiSecret, token, r.Header); err != nil {
				return errors.Wrapf(err, "authenticate")
			}

			type Segment struct {
				TsID     string  `json:"tsid"`
				SeqNo    uint64  `json:"seqno"`
				URL      string  `json:"url"`
				Duration float64 `json:"duration"`
				Size     uint64  `json:"size"`
				// The source ts file.
				SourceTsID string `json:"stsid"`
				// The cost in ms to extract audio.
				ExtractAudioCost int32 `json:"eac"`
			}
			type AsrQueueResponse struct {
				Segments []*Segment `json:"segments"`
				Count    int        `json:"count"`
			}
			res := &AsrQueueResponse{}

			segments := v.task.asrSegments()
			for _, segment := range segments {
				res.Segments = append(res.Segments, []*Segment{&Segment{
					TsID:     segment.AudioFile.TsID,
					SeqNo:    segment.AudioFile.SeqNo,
					URL:      segment.AudioFile.File,
					Duration: segment.AudioFile.Duration,
					Size:     segment.AudioFile.Size,
					// The source ts file.
					SourceTsID: segment.TsFile.TsID,
					// The cost in ms to extract audio.
					ExtractAudioCost: int32(segment.CostExtractAudio.Milliseconds()),
				}}...)
			}

			res.Count = len(res.Segments)

			ohttp.WriteData(ctx, w, r, res)
			logger.Tf(ctx, "transcript query asr ok, token=%vB", len(token))
			return nil
		}(); err != nil {
			ohttp.WriteError(ctx, w, r, err)
		}
	})

	ep = "/terraform/v1/ai/transcript/hls/webvtt/"
	logger.Tf(ctx, "Handle %v", ep)
	handler.HandleFunc(ep, func(w http.ResponseWriter, r *http.Request) {
		hlsM3u8VariantHandler := func(w http.ResponseWriter, r *http.Request) error {
			// Format is webvtt/:uuid/index.m3u8
			webvttPrefix := "/terraform/v1/ai/transcript/hls/webvtt/"
			filename := r.URL.Path[len(webvttPrefix):]
			// Format is :uuid/index.m3u8
			uuid := filename[:len(filename)-len("/index.m3u8")]
			if len(uuid) == 0 {
				return errors.Errorf("invalid uuid %v from %v of %v", uuid, filename, r.URL.Path)
			}

			segments := v.task.webvttSegments()
			if len(segments) == 0 {
				return errors.Errorf("no segments for %v", uuid)
			}

			firstSegment := segments[0]
			if firstSegment.TsFile == nil {
				return errors.Errorf("no ts file for %v", uuid)
			}
			if firstSegment.TsFile.Duration == 0.0 {
				return errors.Errorf("no duration for %v %v", uuid, firstSegment.TsFile.TsID)
			}
			bitrate := int64(firstSegment.TsFile.Size) * 8 / int64(firstSegment.TsFile.Duration)
			if bitrate <= 0 {
				return errors.Errorf("invalid bitrate %v of %v %v", bitrate, uuid, firstSegment.TsFile.TsID)
			}

			contentType, m3u8Body, err := buildLiveM3u8ForVariantCC(
				ctx, bitrate, v.task.config.Language,
				fmt.Sprintf("%v%v.m3u8", webvttPrefix, uuid),
				"subtitles.m3u8",
			)
			if err != nil {
				return errors.Wrapf(err, "build transcript webvtt m3u8 of %v", uuid)
			}

			w.Header().Set("Content-Type", contentType)
			w.Write([]byte(m3u8Body))
			logger.Tf(ctx, "transcript generate m3u8 ok, uuid=%v", uuid)
			return nil
		}

		hlsM3u8Handler := func(w http.ResponseWriter, r *http.Request) error {
			// Format is /webvtt/:uuid.m3u8
			filename := r.URL.Path[len("/terraform/v1/ai/transcript/hls/webvtt/"):]
			// Format is :uuid.m3u8
			uuid := filename[:len(filename)-len(path.Ext(filename))]
			if len(uuid) == 0 {
				return errors.Errorf("invalid uuid %v from %v of %v", uuid, filename, r.URL.Path)
			}

			var tsFiles []*TsFile
			segments := v.task.webvttSegments()
			for _, segment := range segments {
				tsFiles = append(tsFiles, segment.TsFile)
			}

			contentType, m3u8Body, duration, err := buildLiveM3u8ForLocal(
				ctx, tsFiles, false, "/terraform/v1/ai/transcript/hls/webvtt/",
			)
			if err != nil {
				return errors.Wrapf(err, "build transcript webvtt m3u8 of %v", tsFiles)
			}

			w.Header().Set("Content-Type", contentType)
			w.Write([]byte(m3u8Body))
			logger.Tf(ctx, "transcript generate m3u8 ok, uuid=%v, duration=%v", uuid, duration)
			return nil
		}

		hlsTsHandler := func(w http.ResponseWriter, r *http.Request) error {
			// Format is :uuid.ts
			filename := r.URL.Path[len("/terraform/v1/ai/transcript/hls/webvtt/"):]
			fileBase := path.Base(filename)
			uuid := fileBase[:len(fileBase)-len(path.Ext(fileBase))]
			if len(uuid) == 0 {
				return errors.Errorf("invalid uuid %v from %v of %v", uuid, fileBase, r.URL.Path)
			}

			tsFilePath := path.Join("transcript", fmt.Sprintf("%v.ts", uuid))
			if _, err := os.Stat(tsFilePath); err != nil {
				return errors.Wrapf(err, "no ts file %v", tsFilePath)
			}

			if tsFile, err := os.Open(tsFilePath); err != nil {
				return errors.Wrapf(err, "open file %v", tsFilePath)
			} else {
				defer tsFile.Close()
				w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
				io.Copy(w, tsFile)
			}

			logger.Tf(ctx, "transcript server ts file ok, uuid=%v, ts=%v", uuid, tsFilePath)
			return nil
		}

		hlsM3u8SubtitleHandler := func(w http.ResponseWriter, r *http.Request) error {
			// Format is webvtt/:uuid/subtitles.m3u8
			webvttPrefix := "/terraform/v1/ai/transcript/hls/webvtt/"
			filename := r.URL.Path[len(webvttPrefix):]
			// Format is :uuid/index.m3u8
			uuid := filename[:len(filename)-len("/subtitles.m3u8")]
			if len(uuid) == 0 {
				return errors.Errorf("invalid uuid %v from %v of %v", uuid, filename, r.URL.Path)
			}

			var tsFiles []*TsFile
			segments := v.task.webvttSegments()
			for _, segment := range segments {
				vttFile := *segment.TsFile
				vttFile.Key = fmt.Sprintf("%v.vtt", vttFile.TsID)
				tsFiles = append(tsFiles, &vttFile)
			}

			contentType, m3u8Body, _, err := buildLiveM3u8ForLocal(
				ctx, tsFiles, true, "/terraform/v1/ai/transcript/hls/webvtt/",
			)
			if err != nil {
				return errors.Wrapf(err, "build transcript webvtt m3u8 of %v", tsFiles)
			}

			w.Header().Set("Content-Type", contentType)
			w.Write([]byte(m3u8Body))
			logger.Tf(ctx, "transcript generate m3u8 ok, uuid=%v", uuid)
			return nil
		}

		hlsVttHandler := func(w http.ResponseWriter, r *http.Request) error {
			// Format is :uuid.ts
			filename := r.URL.Path[len("/terraform/v1/ai/transcript/hls/webvtt/"):]
			fileBase := path.Base(filename)
			uuid := fileBase[:len(fileBase)-len(path.Ext(fileBase))]
			if len(uuid) == 0 {
				return errors.Errorf("invalid uuid %v from %v of %v", uuid, fileBase, r.URL.Path)
			}

			// Find out the segment by ts ID.
			var segment *TranscriptSegment
			for _, s := range v.task.webvttSegments() {
				if s.TsFile != nil && s.TsFile.TsID == uuid {
					segment = s
					break
				}
			}
			if segment == nil {
				return errors.Errorf("no segment for %v", uuid)
			}

			if segment.AsrText == nil {
				return errors.Errorf("no asr text for %v", uuid)
			}
			if len(segment.AsrText.Segments) == 0 {
				return errors.Errorf("no asr text segments for %v", uuid)
			}

			var vttBody strings.Builder
			vttBody.WriteString(fmt.Sprintf("WEBVTT\n\n"))
			for _, as := range segment.AsrText.Segments {
				s := segment.StreamStarttime + time.Duration(as.Start*float64(time.Second))
				e := segment.StreamStarttime + time.Duration(as.End*float64(time.Second))
				vttBody.WriteString(fmt.Sprintf("%02d:%02d:%02d.%03d --> ",
					int(s.Hours()), int(s.Minutes())%60, int(s.Seconds())%60, int(s.Milliseconds())%1000))
				vttBody.WriteString(fmt.Sprintf("%02d:%02d:%02d.%03d\n",
					int(e.Hours()), int(e.Minutes())%60, int(e.Seconds())%60, int(e.Milliseconds())%1000))
				vttBody.WriteString(fmt.Sprintf("%v\n\n", as.Text))
			}

			w.Header().Set("Content-Type", "text/vtt")
			w.Write([]byte(vttBody.String()))
			logger.Tf(ctx, "transcript server vtt file ok, uuid=%v", uuid)
			return nil
		}

		if err := func() error {
			if strings.HasSuffix(r.URL.Path, "/index.m3u8") {
				return hlsM3u8VariantHandler(w, r)
			} else if strings.HasSuffix(r.URL.Path, "/subtitles.m3u8") {
				return hlsM3u8SubtitleHandler(w, r)
			} else if strings.HasSuffix(r.URL.Path, ".m3u8") {
				return hlsM3u8Handler(w, r)
			} else if strings.HasSuffix(r.URL.Path, ".ts") {
				return hlsTsHandler(w, r)
			} else if strings.HasSuffix(r.URL.Path, ".vtt") {
				return hlsVttHandler(w, r)
			}

			return errors.Errorf("invalid handler for %v", r.URL.Path)
		}(); err != nil {
			ohttp.WriteError(ctx, w, r, err)
		}
	})


	return nil
}

func (v *TranscriptWorker) Enabled() bool {
	return v.task.enabled()
}

func (v *TranscriptWorker) OnHlsTsMessage(ctx context.Context, msg *SrsOnHlsMessage) error {
	select {
	case <-ctx.Done():
	case v.msgs <- msg:
	}

	return nil
}

func (v *TranscriptWorker) OnHlsTsMessageImpl(ctx context.Context, msg *SrsOnHlsMessage) error {
	// Ignore if not natch the task config.
	if !v.task.match(msg) {
		return nil
	}

	// Copy the ts file to temporary cache dir.
	tsid := fmt.Sprintf("%v-org-%v", msg.SeqNo, uuid.NewString())
	tsfile := path.Join("transcript", fmt.Sprintf("%v.ts", tsid))

	// Always use execFile when params contains user inputs, see https://auth0.com/blog/preventing-command-injection-attacks-in-node-js-apps/
	// Note that should never use fs.copyFileSync(file, tsfile, fs.constants.COPYFILE_FICLONE_FORCE) which fails in macOS.
	if err := exec.CommandContext(ctx, "cp", "-f", msg.File, tsfile).Run(); err != nil {
		return errors.Wrapf(err, "copy file %v to %v", msg.File, tsfile)
	}

	// Get the file size.
	stats, err := os.Stat(msg.File)
	if err != nil {
		return errors.Wrapf(err, "stat file %v", msg.File)
	}

	// Create a local ts file object.
	tsFile := &TsFile{
		TsID:     tsid,
		URL:      msg.URL,
		SeqNo:    msg.SeqNo,
		Duration: msg.Duration,
		Size:     uint64(stats.Size()),
		File:     tsfile,
	}

	// Notify worker asynchronously.
	// TODO: FIXME: Should cleanup the temporary file when restart.
	go func() {
		select {
		case <-ctx.Done():
		case v.tsfiles <- &SrsOnHlsObject{Msg: msg, TsFile: tsFile}:
		}
	}()
	return nil
}

func (v *TranscriptWorker) Close() error {
	if v.cancel != nil {
		v.cancel()
	}

	v.wg.Wait()
	return nil
}

func (v *TranscriptWorker) Start(ctx context.Context) error {
	wg := &v.wg

	ctx, cancel := context.WithCancel(ctx)
	v.cancel = cancel

	ctx = logger.WithContext(ctx)
	logger.Tf(ctx, "transcript start a worker")

	// Load task from redis and continue to run the task.
	if objs, err := rdb.HGetAll(ctx, SRS_TRANSCRIPT_TASK).Result(); err != nil && err != redis.Nil {
		return errors.Wrapf(err, "hgetall %v", SRS_TRANSCRIPT_TASK)
	} else if len(objs) != 1 {
		// Only support one task right now.
		if err = rdb.Del(ctx, SRS_TRANSCRIPT_TASK).Err(); err != nil && err != redis.Nil {
			return errors.Wrapf(err, "del %v", SRS_TRANSCRIPT_TASK)
		}
	} else {
		for uuid, obj := range objs {
			logger.Tf(ctx, "Load task %v object %v", uuid, obj)

			if err = json.Unmarshal([]byte(obj), v.task); err != nil {
				return errors.Wrapf(err, "unmarshal %v %v", uuid, obj)
			}

			break
		}
	}

	// Start global transcript task.
	wg.Add(1)
	go func() {
		defer wg.Done()

		task := v.task
		for ctx.Err() == nil {
			var duration time.Duration
			if err := task.Run(ctx); err != nil {
				logger.Wf(ctx, "transcript: run task %v err %+v", task.String(), err)
				duration = 10 * time.Second
			} else {
				duration = 3 * time.Second
			}

			select {
			case <-ctx.Done():
			case <-time.After(duration):
			}
		}
	}()

	// Consume all on_hls messages.
	wg.Add(1)
	go func() {
		defer wg.Done()

		for ctx.Err() == nil {
			select {
			case <-ctx.Done():
			case msg := <-v.msgs:
				if err := v.OnHlsTsMessageImpl(ctx, msg); err != nil {
					logger.Wf(ctx, "transcript: handle on hls message %v err %+v", msg.String(), err)
				}
			}
		}
	}()

	// Consume all ts files by task.
	wg.Add(1)
	go func() {
		defer wg.Done()

		task := v.task
		for ctx.Err() == nil {
			select {
			case <-ctx.Done():
			case msg := <-v.tsfiles:
				if err := task.OnTsSegment(ctx, msg); err != nil {
					logger.Wf(ctx, "transcript: task %v on hls ts message %v err %+v", task.String(), msg.String(), err)
				}
			}
		}
	}()

	// Watch for new stream.
	wg.Add(1)
	go func() {
		defer wg.Done()

		task := v.task
		for ctx.Err() == nil {
			var duration time.Duration
			if err := task.WatchNewStream(ctx); err != nil {
				logger.Wf(ctx, "transcript: task %v watch new stream err %+v", task.String(), err)
				duration = 10 * time.Second
			} else {
				duration = 200 * time.Millisecond
			}

			select {
			case <-ctx.Done():
			case <-time.After(duration):
			}
		}
	}()

	// Drive the live queue to ASR.
	wg.Add(1)
	go func() {
		defer wg.Done()

		task := v.task
		for ctx.Err() == nil {
			var duration time.Duration
			if err := task.DriveLiveQueue(ctx); err != nil {
				logger.Wf(ctx, "transcript: task %v drive live queue err %+v", task.String(), err)
				duration = 10 * time.Second
			} else {
				duration = 200 * time.Millisecond
			}

			select {
			case <-ctx.Done():
			case <-time.After(duration):
			}
		}
	}()

	// Drive the asr queue to correct queue.
	wg.Add(1)
	go func() {
		defer wg.Done()

		task := v.task
		for ctx.Err() == nil {
			var duration time.Duration
			if err := task.DriveAsrQueue(ctx); err != nil {
				logger.Wf(ctx, "transcript: task %v drive asr queue err %+v", task.String(), err)
				duration = 10 * time.Second
			} else {
				duration = 200 * time.Millisecond
			}

			select {
			case <-ctx.Done():
			case <-time.After(duration):
			}
		}
	}()

	// Drive the webvtt queue, remove old files.
	wg.Add(1)
	go func() {
		defer wg.Done()

		task := v.task
		for ctx.Err() == nil {
			var duration time.Duration
			if err := task.DriveWebVttQueue(ctx); err != nil {
				logger.Wf(ctx, "transcript: task %v drive webvtt queue err %+v", task.String(), err)
				duration = 10 * time.Second
			} else {
				duration = 200 * time.Millisecond
			}

			select {
			case <-ctx.Done():
			case <-time.After(duration):
			}
		}
	}()

	return nil
}

// TODO: FIXME: Use SrsAssistantProvider and SrsAssistantASR instead.
type TranscriptConfig struct {
	// Whether transcript all streams.
	All bool `json:"all"`
	// The secret key for AI service.
	SecretKey string `json:"secretKey"`
	// The base URL for AI service.
	BaseURL string `json:"baseURL"`
	// The AI organization.
	Organization string `json:"organization"`
	// The language of the stream.
	Language string `json:"lang"`
	// Whether enable WebVTT subtitle.
	EnableWebVTT bool `json:"webvttEnabled"`
}

func NewTranscriptConfig() *TranscriptConfig {
	return &TranscriptConfig{
		All: false, EnableWebVTT: true,
	}
}

func (v TranscriptConfig) String() string {
	return fmt.Sprintf("all=%v, key=%vB, organization=%v, base=%v, lang=%v, webvtt=%v",
		v.All, len(v.SecretKey), v.Organization, v.BaseURL, v.Language, v.EnableWebVTT)
}

func (v *TranscriptConfig) Load(ctx context.Context) error {
	if b, err := rdb.HGet(ctx, SRS_TRANSCRIPT_CONFIG, "global").Result(); err != nil && err != redis.Nil {
		return errors.Wrapf(err, "hget %v global", SRS_TRANSCRIPT_CONFIG)
	} else if len(b) > 0 {
		if err := json.Unmarshal([]byte(b), v); err != nil {
			return errors.Wrapf(err, "unmarshal %v", b)
		}
	}
	return nil
}

func (v *TranscriptConfig) Save(ctx context.Context) error {
	if b, err := json.Marshal(v); err != nil {
		return errors.Wrapf(err, "marshal conf %v", v)
	} else if err := rdb.HSet(ctx, SRS_TRANSCRIPT_CONFIG, "global", string(b)).Err(); err != nil && err != redis.Nil {
		return errors.Wrapf(err, "hset %v global %v", SRS_TRANSCRIPT_CONFIG, string(b))
	}
	return nil
}

type TranscriptAsrSegment struct {
	ID    int     `json:"id,omitempty"`
	Seek  int     `json:"seek,omitempty"`
	Start float64 `json:"start,omitempty"`
	End   float64 `json:"end,omitempty"`
	Text  string  `json:"text,omitempty"`
}

type TranscriptAsrResult struct {
	Task     string  `json:"task,omitempty"`
	Language string  `json:"language,omitempty"`
	Duration float64 `json:"duration,omitempty"`
	Text     string  `json:"text,omitempty"`
	// The segments of the text.
	Segments []TranscriptAsrSegment `json:"segments,omitempty"`
}

func (v TranscriptAsrResult) String() string {
	return fmt.Sprintf("lang=%v, dur=%v, text=%v, segments=%v",
		v.Language, v.Duration, v.Text, len(v.Segments),
	)
}

type TranscriptSegment struct {
	// The SRS callback message msg.
	Msg *SrsOnHlsMessage `json:"msg,omitempty"`
	// The original source TS file.
	TsFile *TsFile `json:"tsfile,omitempty"`
	// The extracted audio only mp4 file.
	AudioFile *TsFile `json:"audio,omitempty"`
	// The asr result, by AI service.
	AsrText *TranscriptAsrResult `json:"asr,omitempty"`
	// The starttime for live stream to adjust the webvtt timestamps.
	StreamStarttime time.Duration `json:"sst,omitempty"`

	// The cost to transcode the TS file to audio file.
	CostExtractAudio time.Duration `json:"eac,omitempty"`
	// The cost to do ASR, converting speech to text.
	CostASR time.Duration `json:"asrc,omitempty"`
}

func (v TranscriptSegment) String() string {
	var sb strings.Builder
	if v.Msg != nil {
		sb.WriteString(fmt.Sprintf("msg=%v, ", v.Msg.String()))
	}
	if v.TsFile != nil {
		sb.WriteString(fmt.Sprintf("ts=%v, ", v.TsFile.String()))
	}
	if v.AudioFile != nil {
		sb.WriteString(fmt.Sprintf("audio=%v, ", v.AudioFile.String()))
		sb.WriteString(fmt.Sprintf("eac=%v, ", v.CostExtractAudio))
	}
	if v.AsrText != nil {
		sb.WriteString(fmt.Sprintf("asr=%v, ", v.AsrText.String()))
		sb.WriteString(fmt.Sprintf("asrc=%v, ", v.CostASR))
	}
	sb.WriteString(fmt.Sprintf("sst=%v, ", v.StreamStarttime))
	return sb.String()
}

func (v *TranscriptSegment) Dispose() error {
	// Remove the original ts file.
	if v.TsFile != nil {
		if _, err := os.Stat(v.TsFile.File); err == nil {
			os.Remove(v.TsFile.File)
		}
	}

	// Remove the pure audio mp4 file.
	if v.AudioFile != nil {
		if _, err := os.Stat(v.AudioFile.File); err == nil {
			os.Remove(v.AudioFile.File)
		}
	}

	return nil
}

type TranscriptQueue struct {
	// The transcript segments in the queue.
	Segments []*TranscriptSegment `json:"segments,omitempty"`

	// To protect the queue.
	lock sync.Mutex
}

func NewTranscriptQueue() *TranscriptQueue {
	return &TranscriptQueue{}
}

func (v *TranscriptQueue) String() string {
	return fmt.Sprintf("segments=%v", len(v.Segments))
}

func (v *TranscriptQueue) count() int {
	v.lock.Lock()
	defer v.lock.Unlock()

	return len(v.Segments)
}

func (v *TranscriptQueue) enqueue(segment *TranscriptSegment) {
	v.lock.Lock()
	defer v.lock.Unlock()

	v.Segments = append(v.Segments, segment)
}

func (v *TranscriptQueue) first() *TranscriptSegment {
	v.lock.Lock()
	defer v.lock.Unlock()

	if len(v.Segments) == 0 {
		return nil
	}

	return v.Segments[0]
}

func (v *TranscriptQueue) dequeue(segment *TranscriptSegment) {
	v.lock.Lock()
	defer v.lock.Unlock()

	for i, s := range v.Segments {
		if s == segment {
			v.Segments = append(v.Segments[:i], v.Segments[i+1:]...)
			return
		}
	}
}

func (v *TranscriptQueue) reset(ctx context.Context) error {
	var segments []*TranscriptSegment

	func() {
		v.lock.Lock()
		defer v.lock.Unlock()

		segments = v.Segments
		v.Segments = nil
	}()

	for _, segment := range segments {
		segment.Dispose()
	}

	return nil
}

type TranscriptTask struct {
	// The ID for task.
	UUID string `json:"uuid,omitempty"`

	// The input url.
	Input string `json:"input,omitempty"`
	// The input stream object, select the active stream.
	inputStream *SrsStream

	// The live queue for the current task. HLS TS segments are copied to the transcript
	// directory, then a segment is created and added to the live queue for the transcript
	// task to process, to convert to pure audio mp4 file.
	LiveQueue *TranscriptQueue `json:"live,omitempty"`
	// The ASR (Automatic Speech Recognition) queue for the current task. When a pure audio
	// MP4 file is generated, the segment is added to the ASR queue, which then requests the
	// AI server to convert the audio from the MP4 file into text.
	AsrQueue *TranscriptQueue `json:"asr,omitempty"`
	// The webvtt queue for the current task. Holds a sliding window of ASR-completed
	// segments ready to serve as WebVTT subtitle HLS.
	WebVttQueue *TranscriptQueue `json:"webvtt,omitempty"`

	// The previous ASR (Automatic Speech Recognition) text, which serves as a prompt for
	// generating the next one. AI services may use this previous ASR text as a prompt to
	// produce more accurate and robust subsequent ASR text.
	PreviousAsrText string `json:"pat,omitempty"`

	// The signal to persistence task.
	signalPersistence chan bool
	// The signal to change the active stream for task.
	signalNewStream chan *SrsStream

	// The configure for transcript task.
	config TranscriptConfig
	// The transcript worker.
	transcriptWorker *TranscriptWorker

	// The context for current task.
	cancel context.CancelFunc

	// To protect the common fields.
	lock sync.Mutex
}

func NewTranscriptTask() *TranscriptTask {
	return &TranscriptTask{
		// Generate a UUID for task.
		UUID: uuid.NewString(),
		// The live queue for current task.
		LiveQueue: NewTranscriptQueue(),
		// The asr queue for current task.
		AsrQueue: NewTranscriptQueue(),
		// The webvtt queue for current task.
		WebVttQueue: NewTranscriptQueue(),
		// Create persistence signal.
		signalPersistence: make(chan bool, 1),
		// Create new stream signal.
		signalNewStream: make(chan *SrsStream, 1),
	}
}

func (v *TranscriptTask) String() string {
	return fmt.Sprintf("uuid=%v, live=%v, asr=%v, webvtt=%v, pat=%v, config is %v",
		v.UUID, v.LiveQueue.String(), v.AsrQueue.String(), v.WebVttQueue.String(), v.PreviousAsrText,
		v.config.String(),
	)
}

func (v *TranscriptTask) Run(ctx context.Context) error {
	ctx = logger.WithContext(ctx)
	logger.Tf(ctx, "transcript run task %v", v.String())

	pfn := func(ctx context.Context) error {
		// Load config from redis.
		if err := v.config.Load(ctx); err != nil {
			return errors.Wrapf(err, "load config")
		}

		// Ignore if not enabled.
		if !v.config.All {
			return nil
		}

		// Start transcript task.
		if err := v.doTranscript(ctx); err != nil {
			return errors.Wrapf(err, "do transcript")
		}

		return nil
	}

	for ctx.Err() == nil {
		if err := pfn(ctx); err != nil {
			logger.Wf(ctx, "ignore %v err %+v", v.String(), err)

			select {
			case <-ctx.Done():
			case <-time.After(3500 * time.Millisecond):
			}
			continue
		}

		select {
		case <-ctx.Done():
		case <-time.After(300 * time.Millisecond):
		}
	}

	return nil
}

func (v *TranscriptTask) doTranscript(ctx context.Context) error {
	// Create context for current task.
	parentCtx := ctx
	ctx, v.cancel = context.WithCancel(ctx)

	// Main loop, process signals from user or system.
	for ctx.Err() == nil {
		select {
		case <-parentCtx.Done():
		case <-ctx.Done():
		case <-v.signalPersistence:
			if err := v.saveTask(ctx); err != nil {
				return errors.Wrapf(err, "save task %v", v.String())
			}
		case input := <-v.signalNewStream:
			host := "localhost"
			inputURL := fmt.Sprintf("rtmp://%v/%v/%v", host, input.App, input.Stream)
			v.Input, v.inputStream = inputURL, input
		}
	}

	return nil
}

func (v *TranscriptTask) OnTsSegment(ctx context.Context, msg *SrsOnHlsObject) error {
	// TODO: FIXME: Cleanup the temporary files when task disabled.
	if !v.config.All {
		return nil
	}

	func() {
		// We must not update the queue, when persistence goroutine is working.
		v.lock.Lock()
		v.lock.Unlock()

		v.LiveQueue.enqueue(&TranscriptSegment{
			Msg:    msg.Msg,
			TsFile: msg.TsFile,
		})
	}()

	// Notify the main loop to persistent current task.
	v.notifyPersistence(ctx)
	return nil
}

// TODO: FIXME: Should reset the stream when republish.
func (v *TranscriptTask) WatchNewStream(ctx context.Context) error {
	// If not enabled, wait.
	if !v.config.All {
		return nil
	}

	selectActiveStream := func() (*SrsStream, error) {
		streams, err := rdb.HGetAll(ctx, SRS_STREAM_ACTIVE).Result()
		if err != nil {
			return nil, errors.Wrapf(err, "hgetall %v", SRS_STREAM_ACTIVE)
		}

		var best *SrsStream
		for _, value := range streams {
			var stream SrsStream
			if err := json.Unmarshal([]byte(value), &stream); err != nil {
				return nil, errors.Wrapf(err, "unmarshal %v", value)
			}

			if best == nil {
				best = &stream
				continue
			}

			bestUpdate, err := time.Parse(time.RFC3339, best.Update)
			if err != nil {
				return nil, errors.Wrapf(err, "parse %v", best.Update)
			}

			streamUpdate, err := time.Parse(time.RFC3339, stream.Update)
			if err != nil {
				return nil, errors.Wrapf(err, "parse %v", stream.Update)
			}

			if bestUpdate.Before(streamUpdate) {
				best = &stream
			}
		}

		// Ignore if no active stream.
		if best == nil {
			return nil, nil
		}

		if v.inputStream != nil && v.inputStream.StreamURL() != best.StreamURL() {
			logger.Tf(ctx, "transcript use best=%v as input", best.StreamURL())
		}
		return best, nil
	}

	// Use an active stream as input.
	input, err := selectActiveStream()
	if err != nil {
		return errors.Wrapf(err, "select input")
	}

	// Whether stream exists and changed.
	var streamNotChanged bool
	if v.inputStream != nil && input != nil && v.inputStream.StreamURL() == input.StreamURL() {
		streamNotChanged = true
	}

	// No stream, or stream not changed, wait.
	if input == nil || streamNotChanged {
		select {
		case <-ctx.Done():
		case <-time.After(1 * time.Second):
		}
		return nil
	}
	logger.Tf(ctx, "transcript: Got new stream %v", input.String())

	// Notify the main loop to change the active stream.
	select {
	case <-ctx.Done():
	case v.signalNewStream <- input:
		logger.Tf(ctx, "transcript: Notify new stream %v", input.String())
	}

	return nil
}

func (v *TranscriptTask) DriveLiveQueue(ctx context.Context) error {
	// Ignore if not enabled.
	if !v.config.All {
		return nil
	}

	// Ignore if not enough segments.
	if v.LiveQueue.count() <= 0 {
		return nil
	}

	segment := v.LiveQueue.first()
	starttime := time.Now()

	// Remove segment if file not exists.
	if _, err := os.Stat(segment.TsFile.File); err != nil && os.IsNotExist(err) {
		func() {
			v.lock.Lock()
			defer v.lock.Unlock()
			v.LiveQueue.dequeue(segment)
		}()

		segment.Dispose()
		logger.Tf(ctx, "transcript: remove not exist ts segment %v", segment.String())
		return nil
	}

	// Wait if ASR queue is full.
	if v.AsrQueue.count() >= maxWebVttSegments+1 {
		return nil
	}

	// Transcode to audio only mp4, mono, 16000HZ, 32kbps.
	audioFile := &TsFile{
		TsID:     fmt.Sprintf("%v-audio-%v", segment.TsFile.SeqNo, uuid.NewString()),
		URL:      segment.TsFile.URL,
		SeqNo:    segment.TsFile.SeqNo,
		Duration: segment.TsFile.Duration,
	}
	audioFile.File = path.Join("transcript", fmt.Sprintf("%v.m4a", audioFile.TsID))

	args := []string{
		"-i", segment.TsFile.File,
		"-vn", "-acodec", "aac", "-ac", "1", "-ar", "16000", "-ab", "30k",
		"-y", audioFile.File,
	}
	if err := exec.CommandContext(ctx, "ffmpeg", args...).Run(); err != nil {
		return errors.Wrapf(err, "transcode %v", args)
	}

	// Update the size of audio file.
	stats, err := os.Stat(audioFile.File)
	if err != nil {
		// TODO: FIXME: Cleanup the failed file.
		return errors.Wrapf(err, "stat file %v", audioFile.File)
	}
	audioFile.Size = uint64(stats.Size())

	// Dequeue the segment from live queue and attach to asr queue.
	func() {
		v.lock.Lock()
		defer v.lock.Unlock()

		v.LiveQueue.dequeue(segment)
		segment.AudioFile = audioFile
		segment.CostExtractAudio = time.Since(starttime)
		v.AsrQueue.enqueue(segment)
	}()
	logger.Tf(ctx, "transcript: extract audio %v to %v, size=%v, cost=%v",
		segment.TsFile.File, audioFile.File, audioFile.Size, segment.CostExtractAudio)

	// Notify the main loop to persistent current task.
	v.notifyPersistence(ctx)
	return nil
}

func (v *TranscriptTask) DriveAsrQueue(ctx context.Context) error {
	// Ignore if not enabled.
	if !v.config.All {
		return nil
	}

	// Ignore if not enough segments.
	if v.AsrQueue.count() <= 0 {
		return nil
	}

	segment := v.AsrQueue.first()
	starttime := time.Now()

	// Remove segment if file not exists.
	if _, err := os.Stat(segment.AudioFile.File); err != nil && os.IsNotExist(err) {
		func() {
			v.lock.Lock()
			defer v.lock.Unlock()
			v.AsrQueue.dequeue(segment)
		}()
		segment.Dispose()
		logger.Tf(ctx, "transcript: remove not exist audio segment %v", segment.String())
		return nil
	}

	// Wait if WebVTT queue is full.
	if v.WebVttQueue.count() >= maxWebVttSegments+1 {
		return nil
	}

	// Convert the audio file to text by AI.
	var config openai.ClientConfig
	config = openai.DefaultConfig(v.config.SecretKey)
	config.BaseURL = v.config.BaseURL
	config.OrgID = v.config.Organization

	// TODO: FIXME: Fast retry when failed.
	// TODO: FIXME: Use smaller timeout.
	client := openai.NewClientWithConfig(config)
	prompt := v.PreviousAsrText
	resp, err := client.CreateTranscription(
		ctx,
		openai.AudioRequest{
			Model:    openai.Whisper1,
			FilePath: segment.AudioFile.File,
			Format:   openai.AudioResponseFormatVerboseJSON,
			Language: v.config.Language,
			Prompt:   prompt,
		},
	)
	if err != nil {
		// TODO: FIXME: Cleanup the failed file.
		return errors.Wrapf(err, "transcription %v", segment.String())
	}

	// Discover the starttime of the segment.
	stdout, err := exec.CommandContext(ctx, "ffprobe",
		"-show_error", "-show_private_data", "-v", "quiet", "-find_stream_info", "-print_format", "json",
		"-show_format", "-show_streams", segment.TsFile.File,
	).Output()
	if err != nil {
		return errors.Wrapf(err, "probe %v", segment.TsFile.File)
	}

	format := struct {
		Format FFprobeFormat `json:"format"`
	}{}
	if err = json.Unmarshal([]byte(stdout), &format); err != nil {
		return errors.Wrapf(err, "parse format %v", stdout)
	}

	if stv, err := strconv.ParseFloat(format.Format.Starttime, 10); err == nil {
		segment.StreamStarttime = time.Duration(stv * float64(time.Second))
	}

	// Dequeue the segment from asr queue and attach to webvtt queue.
	func() {
		v.lock.Lock()
		defer v.lock.Unlock()
		v.AsrQueue.dequeue(segment)
	}()
	segment.AsrText = &TranscriptAsrResult{
		Task:     resp.Task,
		Language: resp.Language,
		Duration: resp.Duration,
		Text:     resp.Text,
	}
	for _, s := range resp.Segments {
		segment.AsrText.Segments = append(segment.AsrText.Segments, TranscriptAsrSegment{
			ID:    s.ID,
			Seek:  s.Seek,
			Start: s.Start,
			End:   s.End,
			Text:  s.Text,
		})
	}
	v.PreviousAsrText = resp.Text
	segment.CostASR = time.Since(starttime)
	func() {
		v.lock.Lock()
		defer v.lock.Unlock()
		v.WebVttQueue.enqueue(segment)
	}()
	logger.Tf(ctx, "transcript: asr audio=%v, prompt=%v, text=%v, cost=%v",
		segment.AudioFile.File, prompt, resp.Text, segment.CostASR)

	// Notify the main loop to persistent current task.
	v.notifyPersistence(ctx)
	return nil
}

func (v *TranscriptTask) DriveWebVttQueue(ctx context.Context) error {
	// Ignore if not enabled.
	if !v.config.All {
		return nil
	}

	// Ignore if not enough segments.
	if v.WebVttQueue.count() <= maxWebVttSegments {
		select {
		case <-ctx.Done():
		case <-time.After(1 * time.Second):
		}
		return nil
	}

	// Cleanup the old segments.
	segment := v.WebVttQueue.first()
	func() {
		v.lock.Lock()
		defer v.lock.Unlock()
		v.WebVttQueue.dequeue(segment)
	}()
	defer segment.Dispose()

	// Notify the main loop to persistent current task.
	v.notifyPersistence(ctx)
	return nil
}

// TODO: FIXME: Should restart task when stream unpublish.
func (v *TranscriptTask) restart(ctx context.Context) error {
	v.lock.Lock()
	defer v.lock.Unlock()

	if v.cancel != nil {
		v.cancel()
	}

	return nil
}

func (v *TranscriptTask) reset(ctx context.Context) error {
	if v.config.All {
		// Retry to wait for the task to apply the changed config.
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(1 * time.Second):
			if v.config.All {
				return fmt.Errorf("can not reset when running")
			}
		}
	}

	if err := func() error {
		v.lock.Lock()
		defer v.lock.Unlock()

		// Reset all queues.
		v.LiveQueue.reset(ctx)
		v.AsrQueue.reset(ctx)
		v.WebVttQueue.reset(ctx)

		// Reset all states.
		v.Input = ""
		v.PreviousAsrText = ""

		// Remove previous task from redis.
		if err := rdb.HDel(ctx, SRS_TRANSCRIPT_TASK, v.UUID).Err(); err != nil && err != redis.Nil {
			return errors.Wrapf(err, "hdel %v %v", SRS_TRANSCRIPT_TASK, v.UUID)
		}

		// Regenerate new UUID.
		v.UUID = uuid.NewString()

		return nil
	}(); err != nil {
		return errors.Wrapf(err, "reset task")
	}

	// Notify the main loop to persistent current task.
	v.notifyPersistence(ctx)

	// Wait for task to persistence and avoid to reset very fast.
	select {
	case <-ctx.Done():
	case <-time.After(1 * time.Second):
	}
	return nil
}

func (v *TranscriptTask) enabled() bool {
	v.lock.Lock()
	defer v.lock.Unlock()

	return v.config.All
}

func (v *TranscriptTask) match(msg *SrsOnHlsMessage) bool {
	v.lock.Lock()
	defer v.lock.Unlock()

	if v.inputStream == nil || !v.config.All {
		return false
	}

	if v.inputStream.App != msg.App || v.inputStream.Stream != msg.Stream {
		return false
	}

	return true
}

func (v *TranscriptTask) liveSegments() []*TranscriptSegment {
	v.lock.Lock()
	defer v.lock.Unlock()

	return v.LiveQueue.Segments[:]
}

func (v *TranscriptTask) asrSegments() []*TranscriptSegment {
	v.lock.Lock()
	defer v.lock.Unlock()

	return v.AsrQueue.Segments[:]
}

func (v *TranscriptTask) webvttSegments() []*TranscriptSegment {
	v.lock.Lock()
	defer v.lock.Unlock()

	return v.WebVttQueue.Segments[:]
}

func (v *TranscriptTask) notifyPersistence(ctx context.Context) {
	select {
	case <-ctx.Done():
	case v.signalPersistence <- true:
	default:
	}
}

func (v *TranscriptTask) saveTask(ctx context.Context) error {
	v.lock.Lock()
	defer v.lock.Unlock()

	starttime := time.Now()

	if b, err := json.Marshal(v); err != nil {
		return errors.Wrapf(err, "marshal %v", v.String())
	} else if err = rdb.HSet(ctx, SRS_TRANSCRIPT_TASK, v.UUID, string(b)).Err(); err != nil && err != redis.Nil {
		return errors.Wrapf(err, "hset %v %v %v", SRS_TRANSCRIPT_TASK, v.UUID, string(b))
	}

	logger.Tf(ctx, "transcript persistence ok, cost=%v", time.Since(starttime))

	return nil
}
