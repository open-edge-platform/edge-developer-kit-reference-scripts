#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

APP_NAME="loss-prevention"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SUITE_DIR="$SCRIPT_DIR/src"

log() { echo "[$APP_NAME] $*"; }

# Upstream's containers run as root on bind mounts into src/, leaving files this user can't
# overwrite or delete; chown them back with the stack's own pipeline-runner image.
reclaim_src() {
  local owner image
  owner="$(id -u):$(id -g)"
  [ "$(id -u)" != 0 ] || return 0
  [ -n "$(find "$SUITE_DIR" ! -user "$(id -u)" -print -quit 2>/dev/null)" ] || return 0

  image="intel/pipeline-runner-lp:$(cat "$SUITE_DIR/VERSION" 2>/dev/null)"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    log "WARNING: $SUITE_DIR holds files owned by another user and $image is missing —"
    log "run: sudo chown -R $owner $SUITE_DIR"
    return 0
  fi
  log "Handing files in $SUITE_DIR back to $owner"
  docker run --rm --network none --user 0:0 --entrypoint chown \
    -v "$SUITE_DIR:/src" "$image" -R "$owner" /src \
    || log "WARNING: could not chown $SUITE_DIR — run: sudo chown -R $owner $SUITE_DIR"
}

if ! command -v docker >/dev/null 2>&1; then
  log "Docker is not available; nothing to stop."
  exit 0
fi

if [ ! -f "$SUITE_DIR/Makefile" ]; then
  log "Makefile not found at $SUITE_DIR/Makefile; nothing to stop."
  exit 0
fi

# Runs even when the teardown fails.
trap reclaim_src EXIT

log "Stopping docker compose stack"
cd "$SUITE_DIR"
make down-lp
