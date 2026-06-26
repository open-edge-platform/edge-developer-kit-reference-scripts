#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

APP_NAME="loss-prevention"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE_DIR="$SCRIPT_DIR/src"

log() { echo "[$APP_NAME] $*"; }

if ! command -v docker >/dev/null 2>&1; then
  log "Docker is not available; nothing to stop."
  exit 0
fi

if [ ! -f "$SUITE_DIR/Makefile" ]; then
  log "Makefile not found at $SUITE_DIR/Makefile; nothing to stop."
  exit 0
fi

log "Stopping docker compose stack"
cd "$SUITE_DIR"
make down-lp