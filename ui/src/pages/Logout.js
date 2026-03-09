//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import Container from "react-bootstrap/Container";
import React from "react";
import {useNavigate} from "react-router-dom";
import {Token} from "../utils";
import {useTranslation} from "react-i18next";
import {msalInstance} from "../msalInstance";

export default function Logout({onLogout}) {
  const navigate = useNavigate();
  const {t} = useTranslation();

  React.useEffect(() => {
    if (window.confirm(t('nav.logout2'))) {
      Token.remove();
      onLogout && onLogout();
      // Also sign out of Microsoft so the user is prompted to choose an account next time.
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) {
        msalInstance.logoutPopup({account: accounts[0], postLogoutRedirectUri: window.location.origin + '/blank.html'}).catch(() => {});
      }
    }

    navigate('/routers-login');
  }, [navigate, t, onLogout]);

  return <Container fluid>Logout</Container>;
}

