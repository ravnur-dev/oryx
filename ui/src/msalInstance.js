//
// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
//
// IMPORTANT — Azure App Registration setup required:
//   1. In your Entra tenant, open the App Registration for client ID 179489ef-ded5-451e-9a4d-a6a8e47d8217
//   2. Under "Authentication" → "Platform configurations", add a Single-page application (SPA) platform
//   3. Add the redirect URI: https://simulcasting.ravnur.net
//   4. Under "API permissions", ensure openid, profile, and email (Microsoft Graph delegated) are granted
//
import { PublicClientApplication } from '@azure/msal-browser';

export const msalConfig = {
  auth: {
    clientId: '179489ef-ded5-451e-9a4d-a6a8e47d8217',
    authority: 'https://login.microsoftonline.com/common',
    // Must match a redirect URI registered in the Azure App Registration.
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

// Scopes requested for the ID token. These are standard OIDC scopes — no custom API needed.
export const loginRequest = {
  scopes: ['openid', 'profile', 'email'],
};

// Singleton MSAL instance shared across the app.
export const msalInstance = new PublicClientApplication(msalConfig);
