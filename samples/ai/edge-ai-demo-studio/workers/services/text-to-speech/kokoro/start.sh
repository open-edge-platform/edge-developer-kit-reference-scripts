#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_ROOT="$SCRIPT_DIR"
while [ "$WORKERS_ROOT" != "/" ] && [ ! -f "$WORKERS_ROOT/scripts/worker-common.sh" ]; do
    WORKERS_ROOT="$(dirname "$WORKERS_ROOT")"
done
# shellcheck source=SCRIPTDIR/../../../scripts/worker-common.sh
. "$WORKERS_ROOT/scripts/worker-common.sh"

# Vendors hexgrad/kokoro (pinned in workers/oep-services.json, kokoro.patch applied) into ./kokoro;
# cheap when it is already there.
require_uv
oep_fetch services/text-to-speech/kokoro
oep_fetch common/downloader

# Same directory main.py uses: <app_root>/models/tts/kokoro.
MODEL_DIR="$(realpath -m "$MODELS_DIR/tts/kokoro")"
mkdir -p "$MODEL_DIR"

# Extract --source and --device values from forwarded arguments
SOURCE="huggingface"
DEVICE=""
ARGS=("$@")
for i in "${!ARGS[@]}"; do
    if [[ "${ARGS[$i]}" == "--source" && $((i + 1)) -lt ${#ARGS[@]} ]]; then
        SOURCE="${ARGS[$((i + 1))]}"
    elif [[ "${ARGS[$i]}" == --source=* ]]; then
        SOURCE="${ARGS[$i]#*=}"
    elif [[ "${ARGS[$i]}" == "--device" && $((i + 1)) -lt ${#ARGS[@]} ]]; then
        DEVICE="${ARGS[$((i + 1))]}"
    elif [[ "${ARGS[$i]}" == --device=* ]]; then
        DEVICE="${ARGS[$i]#*=}"
    fi
done

# The export tools (torch, kokoro, misaki) get their own venv beside workers/.venv, not in this
# folder: on Windows, nested this deep, spaCy's DLLs exceed the loadable path length (see start.ps1).
EXPORT_VENV="$WORKERS_ROOT/.venv-kokoro-export"
EXPORT_PYTHON="$EXPORT_VENV/bin/python"

setup_export_venv() {
    echo "Setting up export virtual environment ($EXPORT_VENV)..."
    "$UV_CMD" venv --seed --clear "$EXPORT_VENV"
    "$UV_CMD" pip install \
        --python "$EXPORT_PYTHON" \
        -q \
        "kokoro>=0.8.2" \
        "misaki[en]>=0.8.2" \
        "soundfile" \
        "psutil" \
        "modelscope" \
        "transformers==4.53.3" \
        "torch<2.9" \
        "openvino>=2025.3.0" \
        "click>=8.3.3" \
        --extra-index-url "https://download.pytorch.org/whl/cpu"
    # export.py fetches weights through the shared model-downloader package.
    "$UV_CMD" pip install \
        --python "$EXPORT_PYTHON" \
        -q \
        -e "$WORKERS_ROOT/common/downloader"
    echo "Export virtual environment ready."
}

# Export model to OpenVINO IR using the export venv (skipped automatically if already done)
NPU_FLAGS=()
if [[ "$DEVICE" == "NPU" ]]; then
    NPU_FLAGS=("--npu")
fi

prepare_export_unlocked() {
    if [[ ! -x "$EXPORT_PYTHON" ]]; then
        echo "Export virtual environment not found. Setting it up..."
        setup_export_venv
    elif ! python_has_modules "$EXPORT_PYTHON" torch openvino misaki; then
        # An earlier setup stopped during the dependency install.
        echo "Export virtual environment is incomplete. Rebuilding it..."
        setup_export_venv
    elif ! "$EXPORT_PYTHON" -c "import model_downloader" >/dev/null 2>&1; then
        # Older export venvs link model-downloader's former path; refresh just that install.
        echo "Installing the shared model-downloader package into the export environment..."
        "$UV_CMD" pip install --python "$EXPORT_PYTHON" -q -e "$WORKERS_ROOT/common/downloader"
    fi

    echo "Running model export to OpenVINO IR..."
    "$EXPORT_PYTHON" "$SCRIPT_DIR/export.py" --model_dir "$MODEL_DIR" --source "$SOURCE" "${NPU_FLAGS[@]+"${NPU_FLAGS[@]}"}"
}

# Instances started side by side share the export venv and model directory: one builds them while
# the others wait (flock is util-linux; without it the setup runs unserialised).
if command -v flock >/dev/null 2>&1; then
    (
        flock -w 3600 9 || { echo "ERROR: timed out waiting for another Kokoro instance to finish the model export" >&2; exit 1; }
        prepare_export_unlocked
    ) 9>"$MODEL_DIR/.export.lock"
else
    prepare_export_unlocked
fi

cd "$SCRIPT_DIR"
# Drop the caller's --device; DEVICE_ARGS passes it explicitly.
FILTERED_ARGS=()
skip_next=0
for arg in "${ARGS[@]}"; do
    if [[ $skip_next -eq 1 ]]; then
        skip_next=0
        continue
    fi
    if [[ "$arg" == "--device" ]]; then
        skip_next=1
        continue
    elif [[ "$arg" == --device=* ]]; then
        continue
    fi
    FILTERED_ARGS+=("$arg")
done

DEVICE_ARGS=()
if [[ -n "$DEVICE" ]]; then
    DEVICE_ARGS=("--device" "$DEVICE")
fi

prepare_worker
# An older venv may still hold unidic (dictionary never downloaded; `uv sync --inexact` keeps it),
# which fugashi prefers over unidic-lite, so the Japanese voices fail until it goes.
if compgen -G "$WORKERS_ROOT/.venv/lib/python3*/site-packages/unidic/__init__.py" >/dev/null; then
    "$UV_CMD" pip uninstall -q --python "$WORKERS_ROOT/.venv" unidic \
        || echo "Warning: could not remove the stale unidic package; Japanese voices may fail."
fi
exec "$UV_CMD" run --no-sync main.py "${DEVICE_ARGS[@]+"${DEVICE_ARGS[@]}"}" "${FILTERED_ARGS[@]+"${FILTERED_ARGS[@]}"}"
