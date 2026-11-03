#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Start the speech-to-text worker on OpenVINO Model Server (metadata.sttBackend "ovms"; ../oep is
# the other backend).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_ROOT="$SCRIPT_DIR"
while [ "$WORKERS_ROOT" != "/" ] && [ ! -f "$WORKERS_ROOT/scripts/worker-common.sh" ]; do
    WORKERS_ROOT="$(dirname "$WORKERS_ROOT")"
done
# shellcheck source=SCRIPTDIR/../../../scripts/worker-common.sh
. "$WORKERS_ROOT/scripts/worker-common.sh"

# prepare_export_env [worker args...] -- Qwen3-ASR (an optimum-intel fork on transformers 5.13)
# converts in its own pinned environment, which model_downloader.ovms picks; fetch and sync it the
# first time such a model is selected rather than in every setup.
prepare_export_env() {
    local model="" prev="" arg
    for arg in "$@"; do
        case "$prev" in --model | --stt-model-id) model="$arg" ;; esac
        case "$arg" in --model=* | --stt-model-id=*) model="${arg#*=}" ;; esac
        prev="$arg"
    done
    [ -n "$model" ] || return 0

    local line project state venv
    line="$(cd "$SCRIPT_DIR" && "$UV_CMD" run --no-sync python -m model_downloader ovms-export-env "$model")"
    [ -n "$line" ] || return 0
    read -r project state venv <<<"$line"

    # model_downloader reports a resolved path; compare against the physical one.
    if [ "$venv" != "$(cd "$WORKERS_ROOT/$project" && pwd -P)/.venv" ]; then
        # An override variable names another environment; use it as is.
        echo "$model converts with $venv (not synced here)."
        return 0
    fi
    echo "$model converts with $project; checking that environment..."
    oep_fetch "$project"
    if ! "$UV_CMD" sync --project "$WORKERS_ROOT/$project"; then
        if [ "$state" = "ready" ]; then
            echo "WARNING: could not sync $project; using the environment as it is." >&2
        else
            echo "ERROR: could not provision $project, which $model is converted with." >&2
            exit 1
        fi
    fi
}

require_ffmpeg
# Install OVMS and its conversion environment when this backend starts.
ovms_prepare
prepare_worker
prepare_export_env "$@"
run_worker "$@"
