//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import React from 'react';
import Container from "react-bootstrap/Container";
import {Navbar} from 'react-bootstrap';
import {Link} from 'react-router-dom';
import logo from '../resources/ravnur-logo.svg';

export default function Navigator() {
  return (<>
    <Navbar>
      <Container fluid>
        <Navbar.Brand as={Link} to="/routers-forward" style={{display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none'}}>
          <img
            src={logo}
            height="36"
            style={{width: 'auto'}}
            className="d-inline-block align-middle"
            alt="Ravnur"
          />
          <span style={{display: 'inline-block', verticalAlign: 'middle', lineHeight: 1.25}}>
            <span style={{display: 'block', fontWeight: 800, fontSize: 14, letterSpacing: '-0.02em', color: '#111111'}}>FORWARD</span>
            <span style={{display: 'block', fontSize: 9, color: '#6b6865', letterSpacing: '0.1em'}}>RAVNUR SIMULCAST MANAGER</span>
          </span>
        </Navbar.Brand>
      </Container>
    </Navbar>
  </>);
}
