#!/usr/bin/env bash
# Deploy script for Oryx simulcasting on the Azure VM.
# Run from the repo root after pulling the latest code:
#
#   cd ~/oryx-simulcasting
#   git pull origin simulcasting
#   bash scripts/deploy.sh
#
set -euo pipefail

IMAGE=oryx
CONTAINER=oryx
DATA_DIR="$HOME/data"
ENV_FILE="$DATA_DIR/config/.env"

echo "==> Building Docker image: $IMAGE"
docker build -t "$IMAGE" .

echo "==> Stopping and removing old container (if any)"
docker stop "$CONTAINER" 2>/dev/null || true
docker rm   "$CONTAINER" 2>/dev/null || true

echo "==> Starting container"
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p 80:2022 \
  -p 443:2443 \
  -p 1935:1935 \
  -p 8080:8080 \
  --env-file "$ENV_FILE" \
  -v "$DATA_DIR:/data" \
  "$IMAGE"

echo "==> Running containers:"
docker ps --filter "name=$CONTAINER"
