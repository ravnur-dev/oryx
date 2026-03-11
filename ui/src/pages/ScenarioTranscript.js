import React from "react";
import {Accordion, Button, Form, Nav, Spinner, Table, Card} from "react-bootstrap";
import {useSrsLanguage} from "../components/LanguageSwitch";
import {useTranslation} from "react-i18next";
import {Token} from "../utils";
import axios from "axios";
import {useErrorHandler} from "react-error-boundary";
import {OpenAISecretSettings} from "../components/OpenAISettings";

export default function ScenarioTranscript(props) {
  const handleError = useErrorHandler();
  const [config, setConfig] = React.useState();
  const [uuid, setUuid] = React.useState();
  const [activeKey, setActiveKey] = React.useState();

  React.useEffect(() => {
    axios.post('/terraform/v1/ai/transcript/query', {
    }, {
      headers: Token.loadBearerHeader(),
    }).then(res => {
      const data = res.data.data;

      setConfig(data.config);
      setUuid(data.task.uuid);

      if (data.config.all) {
        setActiveKey(['2', '3', '4']);
      } else {
        setActiveKey(['1']);
      }

      console.log(`Transcript: Query ok, ${JSON.stringify(data)}`);
    }).catch(handleError);
  }, [handleError, setActiveKey, setConfig,  setUuid]);

  if (!activeKey) return <></>;
  return <ScenarioTranscriptImpl {...props} {...{
    activeKey, defaultEnabled: config?.all, defaultConf: config, defaultUuid: uuid,
  }}/>;
}

function ScenarioTranscriptImpl({activeKey, defaultEnabled, defaultConf, defaultUuid}) {
  const language = useSrsLanguage();
  const {t} = useTranslation();
  const handleError = useErrorHandler();

  const [operating, setOperating] = React.useState(false);
  const [transcriptEnabled, setTranscriptEnabled] = React.useState(defaultEnabled);
  const [secretKey, setSecretKey] = React.useState(defaultConf.secretKey);
  const [organization, setOrganization] = React.useState(defaultConf.organization);
  const [baseURL, setBaseURL] = React.useState(defaultConf.baseURL || (language === 'zh' ? '' : 'https://api.openai.com/v1'));
  const [targetLanguage, setTargetLanguage] = React.useState(defaultConf.lang || language);
  const [webvttEnabled, setWebvttEnabled] = React.useState(defaultConf.webvttEnabled);
  const [apiType, setApiType] = React.useState(defaultConf.apiType || 'openai');
  const [apiVersion, setApiVersion] = React.useState(defaultConf.apiVersion || '2024-02-01');
  const [deploymentName, setDeploymentName] = React.useState(defaultConf.deploymentName || '');

  const [liveQueue, setLiveQueue] = React.useState();
  const [asrQueue, setAsrQueue] = React.useState();

  const [uuid, setUuid] = React.useState(defaultUuid);
  const [webvttHlsUrl, setWebvttHlsUrl] = React.useState();
  const [webvttHlsPreview, setWebvttHlsPreview] = React.useState();

  const [configItem, setConfigItem] = React.useState('provider');

  React.useEffect(() => {
    if (secretKey) return;

    axios.post('/terraform/v1/mgmt/openai/query', null, {
      headers: Token.loadBearerHeader(),
    }).then(res => {
      const data = res.data.data;
      setSecretKey(data.aiSecretKey);
      setBaseURL(data.aiBaseURL);
      setOrganization(data.aiOrganization);
      console.log(`Transcript: Query open ai ok, data=${JSON.stringify(data)}`);
    }).catch(handleError);
  }, [handleError, secretKey, setSecretKey, setBaseURL, setOrganization]);

  const changeConfigItem = React.useCallback((e, t) => {
    e.preventDefault();
    setConfigItem(t);
  }, [setConfigItem]);

  React.useEffect(() => {
    const l = window.location;
    const schema = l.protocol.replace(':', '');
    const httpPort = l.port || (l.protocol === 'http:' ? 80 : 443);

    setWebvttHlsUrl(`${l.protocol}//${l.host}/terraform/v1/ai/transcript/hls/webvtt/${uuid}/index.m3u8`);
    setWebvttHlsPreview(`/players/srs_player.html?schema=${schema}&port=${httpPort}&autostart=true&app=terraform/v1/ai/transcript/hls/webvtt/${uuid}&stream=index.m3u8`);
  }, [uuid, setWebvttHlsUrl, setWebvttHlsPreview]);

  const updateAiService = React.useCallback((enabled, success) => {
    if (!secretKey) return alert(`Invalid secret key ${secretKey}`);
    if (!baseURL) return alert(`Invalid base url ${baseURL}`);

    axios.post('/terraform/v1/ai/transcript/apply', {
      uuid, all: !!enabled, secretKey, organization, baseURL, lang: targetLanguage,
      webvttEnabled: !!webvttEnabled,
      apiType, apiVersion, deploymentName,
    }, {
      headers: Token.loadBearerHeader(),
    }).then(res => {
      alert(t('helper.setOk'));
      console.log(`Transcript: Apply config ok, uuid=${uuid}.`);
      success && success();
    }).catch(handleError);
  }, [t, handleError, secretKey, baseURL, targetLanguage, webvttEnabled, uuid, organization, apiType, apiVersion, deploymentName]);

  const resetTask = React.useCallback(() => {
    setOperating(true);

    axios.post('/terraform/v1/ai/transcript/reset', {
      uuid,
    }, {
      headers: Token.loadBearerHeader(),
    }).then(res => {
      alert(t('helper.setOk'));
      const data = res.data.data;
      setUuid(data.uuid);
      console.log(`Transcript: Reset task ${uuid} ok: ${JSON.stringify(data)}`);
    }).catch(handleError).finally(setOperating);
  }, [t, handleError, uuid, setUuid, setOperating]);

  React.useEffect(() => {
    const refreshLiveQueueTask = () => {
      axios.post('/terraform/v1/ai/transcript/live-queue', {
      }, {
        headers: Token.loadBearerHeader(),
      }).then(res => {
        const queue = res.data.data || {};
        queue.segments = queue?.segments?.map(segment => {
          return {
            ...segment,
            duration: Number(segment.duration),
            size: Number(segment.size / 1024.0 / 1024),
          };
        });
        setLiveQueue(queue);
        console.log(`Transcript: Query live queue ${JSON.stringify(queue)}`);
      }).catch(handleError);
    };

    refreshLiveQueueTask();
    const timer = setInterval(() => refreshLiveQueueTask(), 3 * 1000);
    return () => clearInterval(timer);
  }, [handleError, setLiveQueue]);

  React.useEffect(() => {
    const refreshAsrQueueTask = () => {
      axios.post('/terraform/v1/ai/transcript/asr-queue', {
      }, {
        headers: Token.loadBearerHeader(),
      }).then(res => {
        const queue = res.data.data || {};
        queue.segments = queue?.segments?.map(segment => {
          return {
            ...segment,
            duration: Number(segment.duration),
            size: Number(segment.size / 1024.0),
            eac: Number(segment.eac),
          };
        });
        setAsrQueue(queue);
        console.log(`Transcript: Query asr queue ${JSON.stringify(queue)}`);
      }).catch(handleError);
    };

    refreshAsrQueueTask();
    const timer = setInterval(() => refreshAsrQueueTask(), 3 * 1000);
    return () => clearInterval(timer);
  }, [handleError, setAsrQueue]);

  return (
    <Accordion defaultActiveKey={activeKey}>
      <React.Fragment>
        {language === 'zh' ?
          <Accordion.Item eventKey="0">
            <Accordion.Header>场景介绍</Accordion.Header>
            <Accordion.Body>
              <div>
                AI字幕使用人工智能将实时语音转换成文本，然后允许人工编辑和校正文本，并将其翻译成多种语言，
                并将修改后的多语言文本合并在视频流中，最终生成一个新的直播流。
                <p></p>
              </div>
              <p>可应用的具体场景包括：</p>
              <ul>
                <li>直播时，使用AI生成的自动字幕，让听力受限的观众，在听不到声音时，可以看视频的字幕。</li>
                <li>为不同语言的观众提供多语言字幕。直播时，由AI翻译成各种语言，从而生成多个流，每个流都有特定语言的字幕。
                  例如，如果直播源是英语的，那么会有带有英语、中文、法语等其他语言字幕的输出流。</li>
                <li>为多个直播平台提供一致的字幕体验。因为一些平台支持自动字幕，而其他平台则不支持。通过在源直播中加入自动字幕，
                  我们可以确保在各种直播平台上的一致性，确保所有平台都有一致的字幕。</li>
              </ul>
            </Accordion.Body>
          </Accordion.Item> :
          <Accordion.Item eventKey="0">
            <Accordion.Header>Introduction</Accordion.Header>
            <Accordion.Body>
              <div>
                Transcription uses AI to convert live speech into text, then delivers it as WebVTT
                subtitle tracks alongside the HLS stream.
                <p></p>
              </div>
              <p>Specific scenarios where this can be applied include:</p>
              <ul>
                <li>AI-generated automatic subtitles for live streams are provided for audiences with hearing
                  impairments, allowing them to read the subtitles even if they are unable to hear the speech.</li>
                <li>Multilingual subtitles are provided for audiences who speak different languages. The live
                  stream is translated by AI into various languages, resulting in multiple streams, each with
                  subtitles in a specific language. For example, if the source stream is in English, there will
                  be output streams with subtitles in English, Chinese, French, and other languages.</li>
                <li>Automatic subtitles are provided for multiple live stream platforms. This is because some
                  platforms offer automatic subtitles, while others do not. By incorporating automatic subtitles
                  into the source stream, we can ensure consistency across various live streaming platforms,
                  ensuring that all have subtitles.</li>
              </ul>
            </Accordion.Body>
          </Accordion.Item>
        }
      </React.Fragment>
      <Accordion.Item eventKey="1">
        <Accordion.Header>{t('transcript.service')}</Accordion.Header>
        <Accordion.Body>
          <Form>
            <Card>
              <Card.Header>
                <Nav variant="tabs" defaultActiveKey="#provider">
                  <Nav.Item>
                    <Nav.Link href="#provider" onClick={(e) => changeConfigItem(e, 'provider')}>{t('lr.room.provider')}</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link href="#asr" onClick={(e) => changeConfigItem(e, 'asr')}>{t('lr.room.asr')}</Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link href="#webvtt" onClick={(e) => changeConfigItem(e, 'webvtt')}>{t('transcript.vtt')}</Nav.Link>
                  </Nav.Item>
                </Nav>
              </Card.Header>
              {configItem === 'provider' && <Card.Body>
                <Form.Group className="mb-3">
                  <Form.Label>API Type</Form.Label>
                  <Form.Select value={apiType} onChange={(e) => setApiType(e.target.value)}>
                    <option value="openai">OpenAI (api.openai.com)</option>
                    <option value="azure">Azure AI Foundry (Azure OpenAI)</option>
                  </Form.Select>
                </Form.Group>
                <OpenAISecretSettings {...{
                  baseURL, setBaseURL, secretKey, setSecretKey,
                  organization, setOrganization,
                  apiType, apiVersion, deploymentName,
                }} />
                {apiType === 'azure' && <>
                  <Form.Group className="mb-3">
                    <Form.Label>Azure API Version</Form.Label>
                    <Form.Text> * Required for Azure. &nbsp;
                      e.g. <code>2024-02-01</code>
                    </Form.Text>
                    <Form.Control as="input" value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Whisper Deployment Name</Form.Label>
                    <Form.Text> * The name of your Azure Whisper deployment. &nbsp;
                      If empty, the model name (<code>whisper-1</code>) is used.
                    </Form.Text>
                    <Form.Control as="input" value={deploymentName} onChange={(e) => setDeploymentName(e.target.value)} />
                  </Form.Group>
                </>}
              </Card.Body>}
              {configItem === 'asr' && <Card.Body>
                <Form.Group className="mb-3">
                  <Form.Label>{t('transcript.lang')}</Form.Label>
                  <Form.Text> * {t('transcript.lang2')}. &nbsp;
                    {t('helper.eg')} <code>en, zh, fr, de, ja, ru </code>, ... &nbsp;
                    {t('helper.see')} <a href='https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes' target='_blank' rel='noreferrer'>ISO-639-1</a>.
                  </Form.Text>
                  <Form.Control as="input" defaultValue={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)} />
                </Form.Group>
              </Card.Body>}
              {configItem === 'webvtt' && <Card.Body>
                <Form.Group className="mb-3">
                  <Form.Group className="mb-3" controlId="formWebvttEnabledCheckbox">
                    <Form.Check type="checkbox" label={t('transcript.vtt2')} defaultChecked={webvttEnabled} onClick={() => setWebvttEnabled(!webvttEnabled)} />
                  </Form.Group>
                </Form.Group>
              </Card.Body>}
            </Card>
            <p></p>
            <Button ariant="primary" type="submit" onClick={(e) => {
              e.preventDefault();
              updateAiService(!transcriptEnabled, () => {
                setTranscriptEnabled(!transcriptEnabled);
              });
            }}>
              {!transcriptEnabled ? t('transcript.start') : t('transcript.stop')}
            </Button> &nbsp;
            {!transcriptEnabled && <React.Fragment>
              <Button ariant="primary" type="submit" disabled={operating} onClick={(e) => {
                e.preventDefault();
                resetTask();
              }}>
                {t('transcript.reset')}
              </Button>  &nbsp;
              {operating && <Spinner animation="border" variant="success" style={{verticalAlign: 'middle'}} />}
            </React.Fragment>}
          </Form>
        </Accordion.Body>
      </Accordion.Item>
      <Accordion.Item eventKey="2">
        <Accordion.Header>{t('transcript.live')}</Accordion.Header>
        <Accordion.Body>
          {liveQueue?.segments?.length ? (
            <Table striped bordered hover>
              <thead>
              <tr>
                <th>#</th>
                <th>Seq</th>
                <th>URL</th>
                <th>Duration</th>
                <th>Size</th>
              </tr>
              </thead>
              <tbody>
              {liveQueue?.segments?.map((segment, index) => {
                return <tr key={segment.tsid}>
                  <td>{segment.tsid}</td>
                  <td>{segment.seqno}</td>
                  <td>{segment.url}</td>
                  <td>{`${segment.duration.toFixed(1)}`}s</td>
                  <td>{`${segment.size.toFixed(1)}`}MB</td>
                </tr>;
              })}
              </tbody>
            </Table>
          ) : t('transcript.nolive')}
        </Accordion.Body>
      </Accordion.Item>
      <Accordion.Item eventKey="3">
        <Accordion.Header>{t('transcript.asr')}</Accordion.Header>
        <Accordion.Body>
          {asrQueue?.segments?.length ? (
            <Table striped bordered hover>
              <thead>
              <tr>
                <th>#</th>
                <th>URL</th>
                <th>Duration</th>
                <th title={t('transcript.eac')}>EAC</th>
                <th>Size</th>
              </tr>
              </thead>
              <tbody>
              {asrQueue?.segments?.map((segment, index) => {
                return <tr key={segment.tsid}>
                  <td>{segment.seqno}</td>
                  <td>{segment.url}</td>
                  <td>{`${segment.duration.toFixed(1)}`}s</td>
                  <td>{`${segment.eac.toFixed(1)}`}ms</td>
                  <td>{`${segment.size.toFixed(1)}`}KB</td>
                </tr>;
              })}
              </tbody>
            </Table>
          ) : t('transcript.noasr')}
        </Accordion.Body>
      </Accordion.Item>
      <Accordion.Item eventKey="4">
        <Accordion.Header>{t('transcript.ops')}</Accordion.Header>
        <Accordion.Body>
          {webvttEnabled && <>
            {t('transcript.pvtt')}: <a href={webvttHlsPreview} target='_blank' rel='noreferrer'>{webvttHlsUrl}</a><br/>
          </>}
        </Accordion.Body>
      </Accordion.Item>
    </Accordion>
  );
}
