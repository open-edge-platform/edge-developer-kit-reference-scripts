#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UV_CMD="$SCRIPT_DIR/../../thirdparty/uv/uv"

# Model directory mirrors the path computed in main.py:
#   project_root = workers/text-to-speech/kokoro/../../../  =>  app root
#   model_dir    = <app_root>/models/tts/kokoro
MODEL_DIR="$(realpath -m "$SCRIPT_DIR/../../../models/tts/kokoro")"
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

EXPORT_PYTHON="$SCRIPT_DIR/.export-venv/bin/python"

if [[ ! -x "$EXPORT_PYTHON" ]]; then
    echo "ERROR: Export virtual environment not found at $SCRIPT_DIR/.export-venv"
    echo "Please run setup.sh first."
    exit 1
fi

# Export model to OpenVINO IR using the export venv (skipped automatically if already done)
NPU_FLAGS=()
if [[ "$DEVICE" == "NPU" ]]; then
    NPU_FLAGS=("--npu")
fi

echo "Running model export to OpenVINO IR..."
"$EXPORT_PYTHON" "$SCRIPT_DIR/export.py" --model_dir "$MODEL_DIR" --source "$SOURCE" "${NPU_FLAGS[@]+"${NPU_FLAGS[@]}"}" 

cd "$SCRIPT_DIR"
if [[ ! -d "$SCRIPT_DIR/.venv" ]]; then
    "$UV_CMD" venv --seed
fi

# Build a clean arg list: strip any --device/--device=... the caller passed,
# since we have already resolved the device and will pass it explicitly.
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

exec "$UV_CMD" run main.py "${DEVICE_ARGS[@]+"${DEVICE_ARGS[@]}"}" "${FILTERED_ARGS[@]+"${FILTERED_ARGS[@]}"}"
