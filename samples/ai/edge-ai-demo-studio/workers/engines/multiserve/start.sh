#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Launches the multiserve engine, activating the selected llama.cpp backend's environment here
# rather than inheriting it from whatever launched the app.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_ROOT="$SCRIPT_DIR"
while [ "$WORKERS_ROOT" != "/" ] && [ ! -f "$WORKERS_ROOT/scripts/worker-common.sh" ]; do
    WORKERS_ROOT="$(dirname "$WORKERS_ROOT")"
done
# Exports UV_CMD and PROJECT_ROOT (the repository root) and provides require_uv.
# shellcheck source=SCRIPTDIR/../../scripts/worker-common.sh
. "$WORKERS_ROOT/scripts/worker-common.sh"
REPO_ROOT="$PROJECT_ROOT"

# Activate the llama.cpp backend selected during setup. For SYCL this puts the runtime wheels
# (workers/.venv/lib) on LD_LIBRARY_PATH: the release links against libsycl/libmkl/libdnnl
# without shipping them.
activate_backend() {
    for backend_helper in \
        "$REPO_ROOT/scripts/bash/llamacpp_backend.sh" \
        "$REPO_ROOT/scripts/llamacpp_backend.sh"; do
        if [ -f "$backend_helper" ]; then
            # shellcheck source=../../../scripts/bash/llamacpp_backend.sh disable=SC1091
            source "$backend_helper"
            break
        fi
    done

    if ! command -v lb_load_config >/dev/null 2>&1; then
        echo "WARNING: llama.cpp backend helper not found; starting with the environment as-is."
        return 0
    fi

    lb_load_config || true

    # Tell LlamaCPPManager which build to use rather than letting it guess from what's on disk.
    export FORCE_LLAMACPP_BACKEND="$LLAMACPP_BACKEND"
    export LLAMACPP_BACKEND

    if [ "$LLAMACPP_BACKEND" != "sycl" ]; then
        echo "llama.cpp backend: $LLAMACPP_BACKEND"
        return 0
    fi

    if ! lb_activate_sycl_runtime; then
        echo "ERROR: llama.cpp backend is 'sycl' but its runtime is missing from"
        echo "       $LLAMACPP_SYCL_RUNTIME_DIR."
        echo "       Install it with: ./setup.sh --backend sycl"
        echo "       Or switch to Vulkan with: ./setup.sh --backend vulkan"
        exit 1
    fi

    # The frontend selects a GPU with GGML_VK_VISIBLE_DEVICES, which only Vulkan reads: translate it.
    if [ -n "${GGML_VK_VISIBLE_DEVICES:-}" ]; then
        export ONEAPI_DEVICE_SELECTOR="level_zero:${GGML_VK_VISIBLE_DEVICES}"
        unset GGML_VK_VISIBLE_DEVICES
    fi

    echo "llama.cpp backend: sycl ($LLAMACPP_SYCL_PRECISION), runtime $LLAMACPP_SYCL_RUNTIME_DIR"
}

cd "$SCRIPT_DIR"
require_uv
ovms_prepare
activate_backend
# Add this engine's Python dependencies to the shared workspace environment.
prepare_worker
exec "$UV_CMD" run --no-sync app-hybrid.py "$@"
