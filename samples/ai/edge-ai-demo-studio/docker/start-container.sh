#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Container entry point. The image ships both llama.cpp builds; LLAMACPP_BACKEND
# (sycl or vulkan) in docker-compose.yml picks the one the multiserve engine runs.
# Unset, the image's build-time selection stays.

set -euo pipefail

cd /home/ubuntu

if [ -n "${LLAMACPP_BACKEND:-}" ]; then
    backend="$LLAMACPP_BACKEND"
    case "$backend" in
        sycl|vulkan) ;;
        *)
            echo "ERROR: LLAMACPP_BACKEND must be sycl or vulkan, not '$backend'." >&2
            exit 1
            ;;
    esac

    # shellcheck source=SCRIPTDIR/../scripts/bash/llamacpp_backend.sh
    . scripts/bash/llamacpp_backend.sh
    if [ ! -x "$LLAMACPP_MULTISERVE_DIR/engine/$(lb_engine_dir "$backend")/llama-server" ]; then
        echo "ERROR: this image has no llama.cpp $backend build." >&2
        exit 1
    fi
    lb_save_config "$backend"
    echo "llama.cpp backend: $backend (LLAMACPP_BACKEND)"
fi

exec ./start.sh
