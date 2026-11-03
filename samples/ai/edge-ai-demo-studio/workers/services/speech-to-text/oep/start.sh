#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Start the speech-to-text worker: the OEP audio-analyzer microservice, fetched at the tag
# pinned in workers/oep-services.json and run unmodified.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_ROOT="$SCRIPT_DIR"
while [ "$WORKERS_ROOT" != "/" ] && [ ! -f "$WORKERS_ROOT/scripts/worker-common.sh" ]; do
    WORKERS_ROOT="$(dirname "$WORKERS_ROOT")"
done
# shellcheck source=SCRIPTDIR/../../../scripts/worker-common.sh
. "$WORKERS_ROOT/scripts/worker-common.sh"

require_uv

# Upstream chunks and probes audio with ffmpeg/ffprobe found on PATH. Prefer
# the copy the project-root setup installs, then whatever the system has.
if [ -x "$FFMPEG_PATH" ]; then
    export PATH="$FFMPEG_DIR/bin:$PATH"
fi
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
    echo "ERROR: ffmpeg/ffprobe not found." >&2
    echo "Run the project-root setup.sh, or install them with: sudo apt-get install -y ffmpeg" >&2
    exit 1
fi

oep_fetch services/speech-to-text/oep

run_oep_worker "$@"
