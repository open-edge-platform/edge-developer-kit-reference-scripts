#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_ROOT="$SCRIPT_DIR"
while [ "$WORKERS_ROOT" != "/" ] && [ ! -f "$WORKERS_ROOT/scripts/worker-common.sh" ]; do
    WORKERS_ROOT="$(dirname "$WORKERS_ROOT")"
done
# shellcheck source=SCRIPTDIR/../../scripts/worker-common.sh
. "$WORKERS_ROOT/scripts/worker-common.sh"

if [ ! -x "$UV_CMD" ]; then
    echo "ERROR: uv not found at $UV_CMD"
    echo "Please run workers/setup.sh and workers/database/setup.sh first."
    exit 1
fi

cd "$SCRIPT_DIR"
run_worker "$@"
