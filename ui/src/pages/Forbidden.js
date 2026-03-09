//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import React from 'react';
import {Container, Alert, Button} from 'react-bootstrap';
import {useNavigate} from 'react-router-dom';
import {msalInstance} from '../msalInstance';
import {Token} from '../utils';

export default function Forbidden() {
  const navigate = useNavigate();

  const handleSignOut = () => {
    Token.remove();
    // Sign out of MSAL so the user can try a different account.
    const accounts = msalInstance.getAllAccounts();
    if (accounts.length > 0) {
      msalInstance.logoutPopup({account: accounts[0], postLogoutRedirectUri: window.location.origin + '/blank.html'}).catch(() => {});
    }
    navigate('/routers-login');
  };

  return (
    <Container className="mt-5" style={{maxWidth: 560}}>
      <Alert variant="danger">
        <Alert.Heading>Access Denied</Alert.Heading>
        <p>
          Your Microsoft account is not registered as a user of this application.
          Please contact an administrator to request access.
        </p>
        <hr/>
        <div className="d-flex justify-content-end">
          <Button variant="outline-danger" onClick={handleSignOut}>
            Sign out and try a different account
          </Button>
        </div>
      </Alert>
    </Container>
  );
}
