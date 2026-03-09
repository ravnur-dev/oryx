//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import {Accordion, Badge, Button, Form, Table} from "react-bootstrap";
import React from "react";
import {Token} from "../utils";
import axios from "axios";
import moment from "moment";
import {useErrorHandler} from "react-error-boundary";
import {useSrsLanguage} from "../components/LanguageSwitch";
import {useTranslation} from "react-i18next";
import {SrsEnvContext} from "../components/SrsEnvContext";

export default function ScenarioForward() {
  const [init, setInit] = React.useState();
  const [activeKey, setActiveKey] = React.useState();
  const [secrets, setSecrets] = React.useState();
  const handleError = useErrorHandler();

  React.useEffect(() => {
    axios.post('/terraform/v1/ffmpeg/forward/secret', {
    }, {
      headers: Token.loadBearerHeader(),
    }).then(res => {
      const secrets = res.data.data;
      setInit(true);
      setSecrets(secrets || {});
      console.log(`Forward: Secret query ok ${JSON.stringify(secrets)}`);
    }).catch(handleError);
  }, [handleError]);

  React.useEffect(() => {
    if (!init || !secrets) return;

    // Open the status panel if any destination is active, otherwise open the first config slot.
    const anyEnabled = Object.values(secrets).some(e => e.enabled && e.server);
    setActiveKey(anyEnabled ? '99' : '1');
  }, [init, secrets]);

  if (!activeKey) return <></>;
  return <ScenarioForwardImpl defaultActiveKey={activeKey} defaultSecrets={secrets}/>;
}

function ScenarioForwardImpl({defaultActiveKey, defaultSecrets}) {
  const language = useSrsLanguage();
  const {t} = useTranslation();
  const handleError = useErrorHandler();
  const env = React.useContext(SrsEnvContext)[0];

  const [configs, setConfigs] = React.useState([]);
  const [forwards, setForwards] = React.useState();
  const [submiting, setSubmiting] = React.useState();

  // Build config list from saved destinations + empty slots up to forwardLimit.
  React.useEffect(() => {
    if (!defaultSecrets) return;

    // Load all existing saved destinations, sorted by platform key for stable ordering.
    const existing = Object.values(defaultSecrets).sort((a, b) => a.platform.localeCompare(b.platform));
    let index = 1;
    const confs = existing.map(e => ({
      ...e,
      index: String(index++),
      custom: true,
      isExisting: true,
      _uid: e.platform, // stable identity for saved entries
    }));

    // Fill remaining slots up to forwardLimit with blank user-defined destinations.
    while (confs.length < env.forwardLimit) {
      const uid = `_new_${Math.random().toString(16).slice(2, 10)}`;
      confs.push({
        platform: '',
        enabled: false,
        index: String(index++),
        server: '',
        secret: '',
        stream: '',
        custom: true,
        label: '',
        isExisting: false,
        _uid: uid,
      });
    }

    setConfigs(confs);
    console.log(`Forward: Init configs ${JSON.stringify(confs)}`);
  }, [defaultSecrets, setConfigs, env]);

  // Fetch the forwarding streams from server.
  React.useEffect(() => {
    const refreshStreams = () => {
      axios.post('/terraform/v1/ffmpeg/forward/streams', {
      }, {
        headers: Token.loadBearerHeader(),
      }).then(res => {
        setForwards(res.data.data.map((e, i) => ({
          ...e,
          start: e.start ? moment(e.start) : null,
          ready: e.ready ? moment(e.ready) : null,
          update: e.frame?.update ? moment(e.frame.update) : null,
          i,
        })));
        console.log(`Forward: Query streams ${JSON.stringify(res.data.data)}`);
      }).catch(handleError);
    };

    refreshStreams();
    const timer = setInterval(() => refreshStreams(), 10 * 1000);
    return () => clearInterval(timer);
  }, [handleError, setForwards]);

  // Update a config entry in the array, matched by stable _uid.
  const updateConfigObject = React.useCallback((conf) => {
    setConfigs(prev => prev.map(e => e._uid === conf._uid ? conf : e));
    console.log(`Forward: Update config ${JSON.stringify(conf)}`);
  }, []);

  // Save a forward config to the server.
  const updateSecrets = React.useCallback((e, conf, enabled, onSuccess) => {
    e.preventDefault();

    if (!conf.platform) return alert('Platform key is required.');
    if (!isValidPlatformKey(conf.platform)) return alert('Platform key must contain only letters, numbers, hyphens, or underscores.');
    if (!conf.server) return alert(t('plat.com.addr'));

    try {
      setSubmiting(true);

      axios.post('/terraform/v1/ffmpeg/forward/secret', {
        action: 'update',
        platform: conf.platform,
        stream: conf.stream,
        server: conf.server,
        secret: conf.secret,
        enabled: !!enabled,
        custom: true,
        label: conf.label || conf.platform,
      }, {
        headers: Token.loadBearerHeader(),
      }).then(res => {
        alert(t('plat.com.ok'));
        // Mark as existing after first successful save.
        updateConfigObject({...conf, enabled, isExisting: true, _uid: conf.platform});
        onSuccess && onSuccess();
      }).catch(handleError);
    } finally {
      new Promise(resolve => setTimeout(resolve, 3000)).then(() => setSubmiting(false));
    }
  }, [t, handleError, updateConfigObject]);

  // Delete a saved forwarding destination from the server and replace the slot with a blank entry.
  const deleteDestination = React.useCallback((e, conf) => {
    e.preventDefault();
    if (!window.confirm(`Delete destination "${conf.label || conf.platform}"? This will stop forwarding and remove it permanently.`)) return;

    axios.post('/terraform/v1/ffmpeg/forward/secret', {
      action: 'delete',
      platform: conf.platform,
    }, {
      headers: Token.loadBearerHeader(),
    }).then(res => {
      // Replace the deleted entry with a blank slot at the same position.
      const uid = `_new_${Math.random().toString(16).slice(2, 10)}`;
      setConfigs(prev => prev.map(e => e._uid === conf._uid ? {
        platform: '', enabled: false, index: conf.index,
        server: '', secret: '', stream: '', custom: true, label: '',
        isExisting: false, _uid: uid,
      } : e));
      console.log(`Forward: Deleted platform=${conf.platform}`);
    }).catch(handleError);
  }, [handleError]);

  return (
    <Accordion defaultActiveKey={[defaultActiveKey]}>
      <React.Fragment>
        {language === 'zh' ?
          <Accordion.Item eventKey="0">
            <Accordion.Header>场景介绍</Accordion.Header>
            <Accordion.Body>
              <div>
                多平台转播，将流转播给其他平台，比如YouTube、Twitch、TikTok等。
                <p></p>
              </div>
              <p>可应用的具体场景包括：</p>
              <ul>
                <li>节约上行带宽，避免客户端推多路流，服务器转播更有保障</li>
              </ul>
              <p>使用说明：</p>
              <ul>
                <li>首先使用适合你的场景推流</li>
                <li>然后设置转播的平台</li>
              </ul>
            </Accordion.Body>
          </Accordion.Item> :
          <Accordion.Item eventKey="0">
            <Accordion.Header>Introduction</Accordion.Header>
            <Accordion.Body>
              <div>
                Multi-platform simulcasting — forward your stream to any destination such as YouTube, Twitch, Facebook Live, TikTok, or a custom RTMP endpoint.
                <p></p>
              </div>
              <p>Usage instructions:</p>
              <ul>
                <li>Enter a unique platform key (e.g. <code>youtube</code>, <code>twitch</code>), the RTMP server URL, and stream key for each destination.</li>
                <li>Click <strong>Start</strong> to begin forwarding. The platform key cannot be changed after the first save.</li>
              </ul>
            </Accordion.Body>
          </Accordion.Item>}
      </React.Fragment>
      {configs.map((conf) => {
        const headerLabel = conf.label || conf.platform || `Destination #${conf.index}`;
        return (
          <Accordion.Item eventKey={conf.index} key={conf._uid}>
            <Accordion.Header>
              {headerLabel}
              {conf.enabled && <Badge bg="success" className="ms-2">Live</Badge>}
            </Accordion.Header>
            <Accordion.Body>
              <Form>
                <Form.Group className="mb-3">
                  <Form.Label>Platform Key</Form.Label>
                  <Form.Text> * Unique identifier (letters, numbers, hyphens, underscores). Cannot be changed after saving.</Form.Text>
                  <Form.Control
                    as="input"
                    placeholder="e.g. youtube, twitch, facebook-live"
                    defaultValue={conf.platform}
                    readOnly={conf.isExisting}
                    onChange={(e) => updateConfigObject({...conf, platform: e.target.value})}
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>{t('plat.com.name')}</Form.Label>
                  <Form.Text> * Display name (optional, defaults to platform key)</Form.Text>
                  <Form.Control
                    as="input"
                    placeholder="e.g. YouTube Main Channel"
                    defaultValue={conf.label}
                    onChange={(e) => updateConfigObject({...conf, label: e.target.value})}
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>{t('plat.com.source')}</Form.Label>
                  <Form.Text> * Source stream name (leave blank to use the most recent active stream)</Form.Text>
                  <Form.Control
                    as="input"
                    defaultValue={conf.stream}
                    onChange={(e) => updateConfigObject({...conf, stream: e.target.value})}
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>{t('plat.com.server')}</Form.Label>
                  <Form.Text> * RTMP ingest URL, e.g. <code>rtmp://a.rtmp.youtube.com/live2</code></Form.Text>
                  <Form.Control
                    as="input"
                    defaultValue={conf.server}
                    onChange={(e) => updateConfigObject({...conf, server: e.target.value})}
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>{t('plat.com.key')}</Form.Label>
                  <Form.Text> * Stream key / secret provided by the destination platform</Form.Text>
                  <Form.Control
                    as="input"
                    defaultValue={conf.secret}
                    onChange={(e) => updateConfigObject({...conf, secret: e.target.value})}
                  />
                </Form.Group>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={submiting}
                  onClick={(e) => updateSecrets(e, conf, !conf.enabled)}
                >
                  {conf.enabled ? t('plat.com.stop') : t('plat.com.start')}
                </Button> &nbsp;
                {conf.isExisting && (
                  <Button
                    variant="danger"
                    disabled={submiting}
                    onClick={(e) => deleteDestination(e, conf)}
                  >
                    Delete
                  </Button>
                )} &nbsp;
                <Form.Text> * {t('forward.tip')}</Form.Text>
              </Form>
            </Accordion.Body>
          </Accordion.Item>
        );
      })}
      <Accordion.Item eventKey="99">
        <Accordion.Header>{t('plat.com.status')}</Accordion.Header>
        <Accordion.Body>
          {forwards?.length ? (
            <Table striped bordered hover>
              <thead>
              <tr>
                <th>#</th>
                <th>Destination</th>
                <th>Platform Key</th>
                <th>{t('plat.com.status2')}</th>
                <th>Start</th>
                <th>Ready</th>
                <th>{t('plat.com.update')}</th>
                <th>{t('plat.com.source')}</th>
                <th>{t('plat.com.log')}</th>
              </tr>
              </thead>
              <tbody>
              {forwards?.map(file => (
                <tr key={file.platform} style={{verticalAlign: 'middle'}}>
                  <td>{file.i + 1}</td>
                  <td>{file.label || file.platform}</td>
                  <td><code>{file.platform}</code></td>
                  <td>
                    <Badge bg={file.enabled ? (file.frame ? 'success' : 'primary') : 'secondary'}>
                      {file.enabled ? (file.frame ? t('plat.com.s0') : t('plat.com.s1')) : t('plat.com.s2')}
                    </Badge>
                  </td>
                  <td>{file.start && file.start.format('YYYY-MM-DD HH:mm:ss')}</td>
                  <td>{file.ready && file.ready.format('YYYY-MM-DD HH:mm:ss')}</td>
                  <td>{file.update && file.update.format('YYYY-MM-DD HH:mm:ss')}</td>
                  <td>{file.stream}</td>
                  <td>{file.frame?.log}</td>
                </tr>
              ))}
              </tbody>
            </Table>
          ) : ''}
          {!forwards?.length ? t('forward.s3') : ''}
        </Accordion.Body>
      </Accordion.Item>
    </Accordion>
  );
}

// Mirrors the backend validation in platform/forward.go isValidPlatformKey.
function isValidPlatformKey(s) {
  return /^[a-zA-Z0-9\-_]+$/.test(s);
}
