#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UV_CMD="$SCRIPT_DIR/../thirdparty/uv/uv"

check_uv() {
    if [ -x "$UV_CMD" ]; then
        return 0
    fi
    echo "ERROR: uv not found at $UV_CMD"
    echo "Please run the workers setup script first."
    exit 1
}

echo ""
echo "NOTE: This worker requires a HuggingFace token (HF_TOKEN) with an accepted"
echo "      license agreement for pyannote/speaker-diarization-community-1."
echo "      Visit https://hf.co/pyannote/speaker-diarization-community-1"
echo "      to accept the license, then set HF_TOKEN=<your_token> in your environment."
echo ""

cd "$SCRIPT_DIR"
check_uv
exec "$UV_CMD" run main.py "$@"