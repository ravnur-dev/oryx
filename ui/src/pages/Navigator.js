//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import React from 'react';
import Container from "react-bootstrap/Container";
import {Navbar, Nav} from 'react-bootstrap';
import {Link, useLocation} from "react-router-dom";
import logo from '../resources/logo.svg';
import LanguageSwitch from "../components/LanguageSwitch";
import {useTranslation} from "react-i18next";
import {Token} from "../utils";

export default function Navigator({initialized, token, localChanged}) {
  const [activekey, setActiveKey] = React.useState(1);
  const [navs, setNavs] = React.useState([]);
  const location = useLocation();
  const {t} = useTranslation();

  React.useEffect(() => {
    if (!initialized) return setNavs([]);

    if (!token) {
      return setNavs([{to:'/routers-login', text: t('nav.login'), className: 'text-light'}]);
    }

    // null user means admin password login — treat as owner.
    const user = Token.loadUser();
    const isOwner = !user || user.role === 'owner';

    const r0 = `${location.pathname}${location.search}`;
    const allNavs = [
      {eventKey: '8', to: '/routers-forward', text: 'Forward'},
      {eventKey: '2', to: '/routers-scenario', text: t('nav.scenario'), ownerOnly: true},
      {eventKey: '3', to: '/routers-settings', text: t('nav.system'), ownerOnly: true},
      {eventKey: '4', to: '/routers-components', text: t('nav.component'), ownerOnly: true},
      {eventKey: '5', to: '/routers-contact', text: t('nav.contact'), ownerOnly: true},
      {eventKey: '7', to: '/routers-users', text: 'Users', ownerOnly: true},
      {eventKey: '6', to: '/routers-logout', text: t('nav.logout')},
    ];

    setNavs(allNavs.filter(e => !e.ownerOnly || isOwner).map(e => {
      if (r0.indexOf(e.to) >= 0) {
        e.className = 'text-light';
        setActiveKey(e.eventKey);
      }
      return e;
    }));
  }, [initialized, token, location, t]);

  return (<>
    <Navbar>
      <Container fluid className={{color:'#fff'}}>
        <Navbar.Brand>
          <img
            src={logo}
            width="64"
            height="30"
            className="d-inline-block align-top"
            alt="Oryx"
          />
        </Navbar.Brand>
        <Nav className='me-auto' variant="pills" activeKey={activekey}>
          {navs.map((e, index) => {
            return (
              <Nav.Link
                as={Link}
                eventKey={e.eventKey}
                to={e.to}
                key={index}
                className={e.className}
              >
                {e.text}
              </Nav.Link>
            );
          })}
        </Nav>
        <Navbar.Collapse className="justify-content-end">
          <LanguageSwitch localChanged={localChanged} />
        </Navbar.Collapse>
      </Container>
    </Navbar>
  </>);
}

