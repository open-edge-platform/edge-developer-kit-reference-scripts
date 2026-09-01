#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Vertical Reference Blueprint as an Edge AI Studio worker.
#
# The studio's process handler runs this as `bash start.sh --port <port>` with
# cwd = this directory, and treats the resulting process as the service: alive
# PID + HTTP 200 from /api/health => the service is "active"; stopping the
# service kills this process group.
#
# Mirrors what the kiosk's Tauri shell does (tauri/src-tauri/src/main.rs):
# prepare a writable data dir beside the read-only bundle, then hand over to
# the standalone Next server via bundle/server/kiosk.cjs.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$HERE/bundle"
DATA="$HERE/data"
STUDIO_ROOT="$(cd "$HERE/../.." && pwd)"

PORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) shift; PORT="${1:-}" ;;
  esac
  shift
done
[ -n "$PORT" ] || { echo "public-service-kiosk: --port is required" >&2; exit 1; }
[ -d "$BUNDLE/server" ] || { echo "public-service-kiosk: bundle/server missing — was the bundle built?" >&2; exit 1; }

# Writable half of the install; nothing here is ever overwritten (config.yaml
# is the operator's to edit, the database is the terminal's own).
mkdir -p "$DATA/documents" "$DATA/face-photos"
[ -f "$DATA/config.yaml" ] || cp "$BUNDLE/config.yaml" "$DATA/config.yaml"
if [ ! -f "$DATA/db.sqlite" ] && [ -f "$BUNDLE/database/db.sqlite" ]; then
  cp "$BUNDLE/database/db.sqlite" "$DATA/db.sqlite"
  if [ -d "$BUNDLE/database/face-photos" ]; then
    cp -r "$BUNDLE/database/face-photos/." "$DATA/face-photos/" 2>/dev/null || true
  fi
fi

# Prefer the studio's bundled Node runtime, fall back to PATH.
NODE="$STUDIO_ROOT/thirdparty/node/bin/node"
command -v "$NODE" >/dev/null 2>&1 || NODE="node"

cd "$BUNDLE/server"
export NODE_ENV=production
export PORT="$PORT"
export HOSTNAME=127.0.0.1
export KIOSK_DATA_DIR="$DATA"
export DATABASE_URL="file:$DATA/db.sqlite"
export KIOSK_UPLOADS_DIR="$DATA/documents"
export KIOSK_FACE_PHOTOS_DIR="$DATA/face-photos"
exec "$NODE" kiosk.cjs
