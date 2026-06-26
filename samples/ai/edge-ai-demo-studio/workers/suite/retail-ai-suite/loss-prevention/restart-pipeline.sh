#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

APP_NAME="loss-prevention"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE_DIR="$SCRIPT_DIR/src"
COMPOSE_FILE="$SUITE_DIR/src/docker-compose.yml"

log() { echo "[$APP_NAME] $*"; }

if ! command -v docker >/dev/null 2>&1; then
  log "Docker is not available."
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  log "docker-compose.yml not found at $COMPOSE_FILE — is the suite running?"
  exit 1
fi

log "Restarting lp-pipeline-runner to reopen the display window"
cd "$SUITE_DIR"
docker compose -f src/docker-compose.yml restart lp-pipeline-runner
log "lp-pipeline-runner restarted — display window should reappear on the host display"
