#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

APP_NAME="image-based-video-search"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE_DIR="$SCRIPT_DIR/src"
COMPOSE_FILE="$SUITE_DIR/compose.yml"
OVERRIDE_FILE="$SCRIPT_DIR/compose.override.yml"

log() { echo "[$APP_NAME] $*"; }

if ! command -v docker >/dev/null 2>&1; then
  log "Docker is not available; nothing to stop."
  exit 0
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  log "Compose file not found at $COMPOSE_FILE; nothing to stop."
  exit 0
fi

COMPOSE_ARGS=(-f "$COMPOSE_FILE")
[ -f "$OVERRIDE_FILE" ] && COMPOSE_ARGS+=(-f "$OVERRIDE_FILE")

log "Stopping docker compose stack"
cd "$SUITE_DIR"
docker compose "${COMPOSE_ARGS[@]}" down --remove-orphans