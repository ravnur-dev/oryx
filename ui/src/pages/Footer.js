//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
import React from "react";
import Container from "react-bootstrap/Container";
import axios from "axios";
import {SrsErrorBoundary} from "../components/SrsErrorBoundary";
import {useErrorHandler} from "react-error-boundary";

export default function Footer() {
  return (
    <SrsErrorBoundary>
      <FooterImpl />
    </SrsErrorBoundary>
  );
}

function FooterImpl() {
  const [versions, setVersions] = React.useState();
  const [beian, setBeian] = React.useState();
  const handleError = useErrorHandler();

  React.useEffect(() => {
    axios.get('/terraform/v1/mgmt/versions')
      .then(res => setVersions(res.data)).catch(handleError);
  }, [handleError]);

  React.useEffect(() => {
    axios.get('/terraform/v1/mgmt/beian/query')
      .then(res => {
        setBeian(res.data.data);
        document.title = res.data.data.title || 'Oryx';
        console.log(`Beian: query ${JSON.stringify(res.data.data)}`);
      }).catch(handleError);
  }, [handleError]);

  return null;
}
