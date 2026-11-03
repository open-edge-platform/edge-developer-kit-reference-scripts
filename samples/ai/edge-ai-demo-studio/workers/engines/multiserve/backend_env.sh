#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Print the environment the selected llama.cpp backend needs as NUL-separated KEY=VALUE pairs
# (`env -0`), for callers that can't source a script but run llama.cpp binaries themselves.
# --summary prints one human-readable line instead. Diagnostics go to stderr.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

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
    echo "backend_env.sh: backend helper not found under $REPO_ROOT" >&2
    exit 1
fi

lb_load_config || true

export FORCE_LLAMACPP_BACKEND="$LLAMACPP_BACKEND"
export LLAMACPP_BACKEND

if [ "$LLAMACPP_BACKEND" = "sycl" ]; then
    if ! lb_activate_sycl_runtime; then
        echo "backend_env.sh: backend is 'sycl' but its runtime is missing from $LLAMACPP_SYCL_RUNTIME_DIR" >&2
        exit 1
    fi
fi

if [ "${1:-}" = "--summary" ]; then
    if [ "$LLAMACPP_BACKEND" = "sycl" ]; then
        echo "llama.cpp backend: sycl ($LLAMACPP_SYCL_PRECISION), runtime $LLAMACPP_SYCL_RUNTIME_DIR"
    else
        echo "llama.cpp backend: $LLAMACPP_BACKEND"
    fi
    exit 0
fi

env -0
