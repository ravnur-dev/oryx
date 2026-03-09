# Oryx Simulcasting — Project Guide

## Project Overview

This repo is a fork of the [Oryx](https://github.com/ossrs/oryx) media encoding and streaming server. The goal is to build a **web application for managing simulcasting** (called "forward" in Oryx), backed by the Oryx platform API, with Microsoft Entra ID authentication.

## Key Directories

| Path | Purpose |
|------|---------|
| `platform/` | Go backend — core Oryx platform server |
| `platform/forward.go` | Simulcasting/forwarding logic |
| `ui/` | React frontend (Node 18) |
| `mgmt/` | Management bootstrap service |
| `Dockerfile` | Multi-stage Docker build (srs → build → runtime) |
| `releases/` | Release assets |

## Planned Features

### 1. Custom Platform Keys (Dynamic Forwarding Destinations)
- Currently `platform/forward.go` hardcodes allowed platforms: `["wx", "bilibili", "kuaishou"]`
- Platforms starting with `forwarding-` are already partially supported via `strings.Contains(userConf.Platform, "forwarding-")`
- **Change:** Allow the web app to create its own named platform keys dynamically (not limited to the three hardcoded names or the `forwarding-` prefix pattern)
- The `ForwardConfigure` struct (`forward.go:335`) and Redis key `SRS_FORWARD_CONFIG` will need to support arbitrary user-defined platform identifiers

### 2. More Than Three Forwarding Destinations
- Remove or raise the implicit limit of three forwarding destinations
- The `sync.Map` in `ForwardWorker` already supports arbitrary keys — the UI and API validation are the bottleneck

### 3. Delete Forwarding Destination
- Currently only enable/disable (update action) is supported via `/terraform/v1/ffmpeg/forward/secret`
- **Add:** A `delete` action to the API endpoint that removes a forward config from Redis (`HDEL SRS_FORWARD_CONFIG`) and stops the associated `ForwardTask`
- Stop the running FFmpeg process for the task before deleting

### 4. Microsoft Entra ID Authentication
- Add Entra (Azure AD) OIDC/OAuth2 authentication to the new simulcasting web app
- Basic user management: admin can add/remove allowed users (by UPN or object ID)
- Only authenticated, authorized users can access the simulcasting management UI
- JWT validation middleware on the Go backend or a dedicated auth layer in the web app

### 5. New Docker Image
- The simulcasting web app requires its own Docker image (or an updated version of the existing Dockerfile)
- Must include the new web app build alongside the existing Oryx platform build

## API Reference

The Oryx platform exposes a REST API used by the UI. Forwarding is managed via:

```
POST /terraform/v1/ffmpeg/forward/secret
```

Body fields: `token`, `action` (`update`), and `ForwardConfigure` fields:
- `platform` — unique platform identifier
- `server` — RTMP server URL
- `secret` — stream key
- `enabled` — bool
- `custom` — bool (custom platform flag)
- `label` — display name

## Deployment Environment

- **Host:** Microsoft Azure D2as_v5 VM (2 vCPUs, 8 GB RAM, AMD)
- **OS:** Ubuntu 24.04 LTS
- **Domain:** `simulcasting.ravnur.net`
- **Co-location:** The simulcasting web app runs on the same VM as the Oryx server
- **Redis:** The Oryx built-in Redis instance (already present on the VM) is used for both Oryx state and simulcasting user management — no separate cache needed
- **User store:** Redis keys (namespaced separately from Oryx keys, e.g. `SIMULCAST_USERS`) hold the list of authorized Entra users (UPN or object ID)

## Development Notes

- **Language:** Go (platform backend), React/TypeScript (UI)
- **State store:** Redis (`SRS_FORWARD_CONFIG` hash key for forwards; `SIMULCAST_USERS` for auth)
- **Build:** `make` at repo root; Dockerfile orchestrates multi-stage build
- **Current version:** `v5.15.20` (see `platform/version.go`)
- **Go version:** 1.16+ (uses `go-redis/v8`)

## Coding Conventions

- Follow existing Go patterns in `platform/` (context propagation, `errors.Wrapf`, `logger.Tf`)
- API handlers follow the pattern: parse body → authenticate → validate → act → respond
- Redis operations use the `rdb` global client
- New forwarding actions should be added to `allowedActions` in `forward.go`
- Keep the `ForwardConfigure.String()` method updated when adding fields

## Out of Scope

- Changes to the SRS media server itself (`/usr/local/srs/`)
- Transcoding, DVR, dubbing, or other non-forwarding features
