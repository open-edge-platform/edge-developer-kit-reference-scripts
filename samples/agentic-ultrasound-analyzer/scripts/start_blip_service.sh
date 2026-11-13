#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# Run with bash start_blip_service.sh [BLIP CLI options].
# VENV_DIR defaults to ../venv; BLIP_SERVICE_PORT defaults to 15100.

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$ROOT_DIR"
VENV_DIR="${VENV_DIR:-$ROOT_DIR/../venv}"
PYTHON="$VENV_DIR/bin/python"
export BLIP_SERVICE_PORT="${BLIP_SERVICE_PORT:-15100}"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

if [[ ! -x "$PYTHON" ]]; then
    echo "[ERROR] No Linux virtual environment at $VENV_DIR. Run install_dependencies.sh first." >&2
    exit 1
fi

echo "Starting BLIP Embedding Microservice (default port: $BLIP_SERVICE_PORT)..."
exec "$PYTHON" -u "$ROOT_DIR/blip_service.py" --port "$BLIP_SERVICE_PORT" "$@"
