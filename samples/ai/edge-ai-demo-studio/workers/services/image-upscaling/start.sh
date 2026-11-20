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

# SeedVR2 (presets.py, torch_xpu) runs numz's pipeline, which workers/upstream.json pins and
# this fetches into ./thirdparty/seedvr2 (cheap once there). The OpenVINO presets need nothing
# upstream, so they start without a network.
MODEL=""
ARGS=("$@")
for i in "${!ARGS[@]}"; do
    case "${ARGS[$i]}" in
        --model) MODEL="${ARGS[$((i + 1))]:-}" ;;
        --model=*) MODEL="${ARGS[$i]#--model=}" ;;
    esac
done
if [[ "$MODEL" == seedvr2* ]]; then
    upstream_fetch services/image-upscaling
fi

run_worker "$@"
