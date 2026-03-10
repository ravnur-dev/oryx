//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import React from "react";
import {Spinner} from 'react-bootstrap';
import axios from "axios";
import {useNavigate} from "react-router-dom";
import {Token, Tools} from '../utils';
import {SrsErrorBoundary} from "../components/SrsErrorBoundary";
import {useErrorHandler} from "react-error-boundary";
import {msalInstance, loginRequest} from "../msalInstance";
import ravnurLogo from '../resources/ravnur-logo.svg';
import patternBg from '../resources/pattern-onboard.png';

export default function Login({onLogin}) {
  return (
    <SrsErrorBoundary>
      <LoginImpl onLogin={onLogin} />
    </SrsErrorBoundary>
  );
}

function LoginImpl({onLogin}) {
  const [operating, setOperating] = React.useState(false);
  const [entraError, setEntraError] = React.useState('');
  const [btnHover, setBtnHover] = React.useState(false);
  const navigate = useNavigate();
  const handleError = useErrorHandler();

  // Verify an existing token on load — if valid, skip the login page.
  React.useEffect(() => {
    const token = Token.load();
    if (!token || !token.token) return;

    console.log(`Login: Verify, token is ${Tools.mask(token)}`);
    axios.post('/terraform/v1/mgmt/token', {...token}).then(res => {
      axios.post('/terraform/v1/mgmt/token', {}, {
        headers: Token.loadBearerHeader(),
      }).then(res => {
        console.log(`Login: Done, token is ${Tools.mask(token)}`);
        navigate('/routers-forward');
      });
    }).catch(handleError);
  }, [navigate, handleError]);

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
      if (err?.errorCode === 'user_cancelled' || err?.errorCode === 'popup_window_error') return;
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

  return (
    // Full-viewport overlay covers the global Navigator/Footer
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex',
    }}>

      {/* ── Left panel ── */}
      <div style={{
        width: '38%', minWidth: 340,
        background: '#f7f7f5',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '60px 56px',
        position: 'relative',
      }}>

        {/* Logo */}
        <img
          src={ravnurLogo}
          alt="Ravnur"
          style={{width: 36, height: 36, marginBottom: 32}}
        />

        {/* Title */}
        <h1 style={{
          fontFamily: "'Public Sans', sans-serif",
          fontWeight: 800, fontSize: 30,
          color: '#111827', lineHeight: 1.25,
          marginBottom: 16, letterSpacing: '-0.01em',
        }}>
          Ravnur Simulcast Manager
        </h1>

        {/* Subtitle */}
        <p style={{
          fontFamily: "'Public Sans', sans-serif",
          fontSize: 14, color: '#6b7280', lineHeight: 1.65,
          marginBottom: 48,
        }}>
          Reach your viewers wherever they are by sending a single stream to multiple destinations.
        </p>

        {/* Sign in button */}
        <button
          onClick={handleEntraLogin}
          disabled={operating}
          style={{
            width: '100%',
            padding: '11px 20px',
            background: '#ffffff',
            border: `1.5px solid ${btnHover ? '#b54100' : '#d1d5db'}`,
            borderRadius: 6,
            fontFamily: "'Public Sans', sans-serif",
            fontSize: 14, fontWeight: 600,
            color: '#111827',
            cursor: operating ? 'not-allowed' : 'pointer',
            opacity: operating ? 0.6 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'border-color 0.15s',
            boxShadow: btnHover && !operating ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
          }}
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
        >
          {operating ? (
            <>
              <Spinner animation="border" size="sm" style={{color: '#6b7280'}}/>
              Signing in…
            </>
          ) : (
            'Sign in with Microsoft'
          )}
        </button>

        {/* Error message */}
        {entraError && (
          <div style={{
            marginTop: 12, padding: '10px 14px',
            background: '#fef2f2', border: '1px solid #fca5a5',
            borderRadius: 6, color: '#b91c1c',
            fontFamily: "'Public Sans', sans-serif", fontSize: 13,
          }}>
            {entraError}
          </div>
        )}

        {/* Copyright */}
        <div style={{
          position: 'absolute', bottom: 24, left: 56,
          fontFamily: "'Public Sans', sans-serif",
          fontSize: 12, color: '#9ca3af',
        }}>
          © 2026 Ravnur Inc. All rights reserved.
        </div>
      </div>

      {/* ── Right panel — decorative pattern ── */}
      <div style={{
        flex: 1,
        backgroundColor: '#b54100',
        backgroundImage: `url(${patternBg})`,
        backgroundSize: '280px 280px',
        backgroundRepeat: 'repeat',
      }}/>
    </div>
  );
}
