// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
package main

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	jwt "github.com/golang-jwt/jwt/v4"
	"github.com/ossrs/go-oryx-lib/errors"
	ohttp "github.com/ossrs/go-oryx-lib/http"
	"github.com/ossrs/go-oryx-lib/logger"
)

var entraAuth *EntraAuth

// EntraAuth validates Microsoft Entra ID tokens and exchanges them for Oryx session JWTs.
type EntraAuth struct {
	jwks *jwksCache
}

func NewEntraAuth() *EntraAuth {
	return &EntraAuth{jwks: &jwksCache{}}
}

func (v *EntraAuth) Handle(ctx context.Context, handler *http.ServeMux) error {
	ep := "/terraform/v1/mgmt/auth/entra"
	logger.Tf(ctx, "Handle %v", ep)
	handler.HandleFunc(ep, func(w http.ResponseWriter, r *http.Request) {
		if err := func() error {
			var entraToken string
			if err := ParseBody(ctx, r.Body, &struct {
				EntraToken *string `json:"entraToken"`
			}{
				EntraToken: &entraToken,
			}); err != nil {
				return errors.Wrapf(err, "parse body")
			}
			if entraToken == "" {
				return errors.New("entraToken is required")
			}

			// Validate the Entra ID token and extract the email claim.
			email, err := v.validateToken(ctx, entraToken)
			if err != nil {
				return errors.Wrapf(err, "validate entra token")
			}

			// Check that the email exists in the simulcast user store.
			users, err := userManager.listUsers(ctx)
			if err != nil {
				return errors.Wrapf(err, "list users")
			}
			var matched *SimulcastUser
			for _, u := range users {
				if strings.EqualFold(u.Email, email) {
					matched = u
					break
				}
			}
			if matched == nil {
				return errors.Errorf("user %v is not authorized to access this application", email)
			}

			// Issue an Oryx-compatible session JWT so all existing API calls work unchanged.
			apiSecret := envApiSecret()
			expireAt, createAt, token, err := createToken(ctx, apiSecret)
			if err != nil {
				return errors.Wrapf(err, "create session token")
			}

			ohttp.WriteData(ctx, w, r, &struct {
				Token    string         `json:"token"`
				CreateAt string         `json:"createAt"`
				ExpireAt string         `json:"expireAt"`
				Bearer   string         `json:"bearer"`
				User     *SimulcastUser `json:"user"`
			}{
				Token:    token,
				CreateAt: createAt.Format(time.RFC3339),
				ExpireAt: expireAt.Format(time.RFC3339),
				Bearer:   apiSecret,
				User:     matched,
			})
			logger.Tf(ctx, "Entra auth ok, email=%v, role=%v", email, matched.Role)
			return nil
		}(); err != nil {
			ohttp.WriteError(ctx, w, r, err)
		}
	})
	return nil
}

// validateToken validates an Entra ID token's signature, issuer, and audience,
// and returns the user's email (preferred_username claim).
//
// Multi-tenant support: the token's own "tid" claim is used to construct the
// expected issuer and JWKS URL, so users from any Entra tenant are accepted as
// long as their email is registered in the simulcast user store.
func (v *EntraAuth) validateToken(ctx context.Context, tokenString string) (string, error) {
	clientID := envEntraClientID()
	if clientID == "" {
		return "", errors.New("ENTRA_CLIENT_ID must be configured")
	}

	// Parse without verification first to extract the "tid" (tenant ID) claim.
	// The signature is verified below using the tenant-specific JWKS.
	unverifiedParser := jwt.NewParser()
	unverified, _, err := unverifiedParser.ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return "", errors.Wrapf(err, "pre-parse token")
	}
	unverifiedClaims, ok := unverified.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid token claims structure")
	}
	tid, _ := unverifiedClaims["tid"].(string)
	if tid == "" {
		return "", errors.New("tid claim missing from token")
	}

	// Now fully verify the token using the key from the correct tenant's JWKS.
	parsed, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		kid, _ := token.Header["kid"].(string)
		return v.jwks.getKey(ctx, tid, kid)
	})
	if err != nil {
		return "", errors.Wrapf(err, "parse jwt")
	}
	if !parsed.Valid {
		return "", errors.New("token is not valid")
	}

	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid token claims")
	}

	// Validate issuer — must be this specific token's tenant v2.0 endpoint.
	expectedIssuer := fmt.Sprintf("https://login.microsoftonline.com/%v/v2.0", tid)
	if !claims.VerifyIssuer(expectedIssuer, true) {
		return "", errors.Errorf("invalid issuer: %v", claims["iss"])
	}

	// Validate audience — must be our client ID.
	if !claims.VerifyAudience(clientID, true) {
		return "", errors.Errorf("invalid audience: %v", claims["aud"])
	}

	// Extract email — Entra puts the UPN in preferred_username; fall back to email claim.
	email, _ := claims["preferred_username"].(string)
	if email == "" {
		email, _ = claims["email"].(string)
	}
	if email == "" {
		return "", errors.New("no email claim found in token (preferred_username / email)")
	}

	return strings.ToLower(strings.TrimSpace(email)), nil
}

// tenantKeys holds the cached RSA public keys for a single Entra tenant.
type tenantKeys struct {
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

// jwksCache fetches and caches RSA public keys from Microsoft's JWKS endpoint,
// maintaining a separate cache entry per tenant ID to support multi-tenant apps.
type jwksCache struct {
	mu      sync.RWMutex
	tenants map[string]*tenantKeys
}

func (c *jwksCache) getKey(ctx context.Context, tenantID, kid string) (*rsa.PublicKey, error) {
	// Serve from cache if still fresh.
	c.mu.RLock()
	tk := c.tenants[tenantID]
	if tk != nil && time.Since(tk.fetchedAt) < 24*time.Hour {
		key, found := tk.keys[kid]
		c.mu.RUnlock()
		if found {
			return key, nil
		}
		// Key not in cache — fall through to refresh even if cache is fresh,
		// because Microsoft occasionally rotates keys ahead of the TTL.
	} else {
		c.mu.RUnlock()
	}

	// Refresh from Microsoft for this specific tenant.
	if err := c.refresh(ctx, tenantID); err != nil {
		return nil, errors.Wrapf(err, "refresh jwks")
	}

	c.mu.RLock()
	defer c.mu.RUnlock()
	tk = c.tenants[tenantID]
	if tk == nil {
		return nil, errors.Errorf("no keys loaded for tenant %v", tenantID)
	}
	key, found := tk.keys[kid]
	if !found {
		return nil, errors.Errorf("signing key id %q not found in Entra JWKS for tenant %v", kid, tenantID)
	}
	return key, nil
}

func (c *jwksCache) refresh(ctx context.Context, tenantID string) error {
	url := fmt.Sprintf("https://login.microsoftonline.com/%v/discovery/v2.0/keys", tenantID)

	resp, err := http.Get(url) // #nosec — fetching from a known Microsoft endpoint
	if err != nil {
		return errors.Wrapf(err, "get %v", url)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return errors.Wrapf(err, "read jwks response")
	}

	var jwks struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(body, &jwks); err != nil {
		return errors.Wrapf(err, "unmarshal jwks")
	}

	keys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, k := range jwks.Keys {
		if k.Kty != "RSA" {
			continue
		}
		pub, err := jwkToRSAPublicKey(k.N, k.E)
		if err != nil {
			logger.Wf(ctx, "Entra: skip invalid jwk kid=%v: %v", k.Kid, err)
			continue
		}
		keys[k.Kid] = pub
	}

	c.mu.Lock()
	if c.tenants == nil {
		c.tenants = make(map[string]*tenantKeys)
	}
	c.tenants[tenantID] = &tenantKeys{keys: keys, fetchedAt: time.Now()}
	c.mu.Unlock()

	logger.Tf(ctx, "Entra: refreshed JWKS for tenant %v, loaded %v keys", tenantID, len(keys))
	return nil
}

// jwkToRSAPublicKey builds an *rsa.PublicKey from the base64url-encoded modulus (n) and
// exponent (e) fields of a JWK entry.
func jwkToRSAPublicKey(nB64, eB64 string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, errors.Wrapf(err, "decode n")
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, errors.Wrapf(err, "decode e")
	}

	e := 0
	for _, b := range eBytes {
		e = e*256 + int(b)
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: e,
	}, nil
}
