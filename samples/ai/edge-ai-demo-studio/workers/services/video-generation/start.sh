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

cd "$SCRIPT_DIR"
require_uv
# Every video is encoded to H.264 MP4 with it.
require_ffmpeg
run_worker "$@"
