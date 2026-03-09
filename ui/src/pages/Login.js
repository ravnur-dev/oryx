//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import React from "react";
import Container from "react-bootstrap/Container";
import {Form, Button, Spinner, Alert} from 'react-bootstrap';
import axios from "axios";
import {useNavigate} from "react-router-dom";
import {Token, Tools} from '../utils';
import {SrsErrorBoundary} from "../components/SrsErrorBoundary";
import {useErrorHandler} from "react-error-boundary";
import {useTranslation} from "react-i18next";
import {msalInstance, loginRequest} from "../msalInstance";

export default function Login({onLogin}) {
  return (
    <SrsErrorBoundary>
      <LoginImpl onLogin={onLogin} />
    </SrsErrorBoundary>
  );
}

function LoginImpl({onLogin}) {
  const [plaintext, setPlaintext] = React.useState(true);
  const [password, setPassword] = React.useState();
  const [operating, setOperating] = React.useState(false);
  const [entraError, setEntraError] = React.useState('');
  const navigate = useNavigate();
  const passwordRef = React.useRef();
  const plaintextRef = React.useRef();
  const handleError = useErrorHandler();
  const {t} = useTranslation();

  // Verify an existing token on load — if valid, skip the login page.
  React.useEffect(() => {
    const token = Token.load();
    if (!token || !token.token) return;

    console.log(`Login: Verify, token is ${Tools.mask(token)}`);

    axios.post('/terraform/v1/mgmt/token', {
      ...token,
    }).then(res => {
      axios.post('/terraform/v1/mgmt/token', {}, {
        headers: Token.loadBearerHeader(),
      }).then(res => {
        console.log(`Login: Done, token is ${Tools.mask(token)}`);
        navigate('/routers-forward');
      });
    }).catch(handleError);
  }, [navigate, handleError]);

  // Focus the password field when visible.
  React.useEffect(() => {
    plaintext ? plaintextRef.current?.focus() : passwordRef.current?.focus();
  }, [plaintext]);

  // Sign in with Microsoft Entra — popup flow.
  const handleEntraLogin = React.useCallback(async () => {
    setOperating(true);
    setEntraError('');
    try {
      const result = await msalInstance.loginPopup(loginRequest);
      const idToken = result.idToken;

      const res = await axios.post('/terraform/v1/mgmt/auth/entra', {entraToken: idToken});
      const data = res.data.data;
      console.log(`Login: Entra ok, user=${data.user?.email}, role=${data.user?.role}`);
      Token.save(data);
      onLogin && onLogin();
      navigate('/routers-forward');
    } catch (err) {
      // Cancelled popup — user closed the window, no message needed.
      if (err?.errorCode === 'user_cancelled' || err?.errorCode === 'popup_window_error') {
        return;
      }
      // Registered but not authorized in this app — show the Forbidden page.
      const msg = err?.response?.data?.message || err?.message || '';
      if (msg.includes('not authorized')) {
        navigate('/routers-forbidden');
        return;
      }
      setEntraError(msg || 'Sign-in failed. Please try again.');
    } finally {
      setOperating(false);
    }
  }, [onLogin, navigate]);

  // Original password login (kept for admin/fallback access).
  const handleLogin = React.useCallback((e) => {
    e.preventDefault();
    setOperating(true);

    axios.post('/terraform/v1/mgmt/login', {
      password,
    }).then(async (res) => {
      await new Promise(resolve => setTimeout(resolve, 600));
      const data = res.data.data;
      console.log(`Login: OK, token is ${Tools.mask(data)}`);
      Token.save(data);
      onLogin && onLogin();
      navigate('/routers-forward');
    }).catch(handleError).finally(setOperating);
  }, [password, handleError, onLogin, navigate, setOperating]);

  return (
    <>
      <Container fluid style={{maxWidth: 480, paddingTop: '3rem'}}>

        {/* Primary: Entra sign-in */}
        <div className="mb-4">
          <Button
            variant="primary"
            size="lg"
            className="w-100"
            disabled={operating}
            onClick={handleEntraLogin}
          >
            {operating
              ? <><Spinner animation="border" size="sm" className="me-2"/>Signing in…</>
              : <>Sign in with Microsoft</>
            }
          </Button>
          {entraError && (
            <Alert variant="danger" className="mt-2 mb-0">{entraError}</Alert>
          )}
        </div>

        <hr/>

        {/* Secondary: original password login */}
        <details>
          <summary className="text-muted mb-3" style={{cursor: 'pointer', userSelect: 'none'}}>
            Admin / password login
          </summary>
          <Form>
            <Form.Group className="mb-3" controlId="formBasicPassword">
              <Form.Label>{t('login.passwordLabel')}</Form.Label>
              {!plaintext && (
                <Form.Control type="password" placeholder="Password" ref={passwordRef}
                  defaultValue={password} onChange={(e) => setPassword(e.target.value)}/>
              )}
              {plaintext && (
                <Form.Control type="text" placeholder="Password" ref={plaintextRef}
                  defaultValue={password} onChange={(e) => setPassword(e.target.value)}/>
              )}
              <Form.Text className="text-muted">* {t('login.passwordTip')}</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3" controlId="formBasicCheckbox">
              <Form.Check type="checkbox" label={t('login.labelShow')}
                defaultChecked={plaintext} onClick={() => setPlaintext(!plaintext)}/>
            </Form.Group>
            <Button variant="secondary" type="submit" disabled={operating}
              onClick={(e) => handleLogin(e)}>
              {t('login.labelLogin')}
            </Button>
          </Form>
        </details>

      </Container>
    </>
  );
}
