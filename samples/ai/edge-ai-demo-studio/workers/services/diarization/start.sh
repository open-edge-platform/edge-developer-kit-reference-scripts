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


echo ""
echo "NOTE: This worker requires a HuggingFace token (HF_TOKEN) with an accepted"
echo "      license agreement for pyannote/speaker-diarization-community-1."
echo "      Visit https://hf.co/pyannote/speaker-diarization-community-1"
echo "      to accept the license, then set HF_TOKEN=<your_token> in your environment."
echo ""

cd "$SCRIPT_DIR"
require_uv
run_worker "$@"
