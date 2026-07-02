#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UV_CMD="$SCRIPT_DIR/../../thirdparty/uv/uv"

REPO_URL="https://github.com/hexgrad/kokoro.git"
REPO_COMMIT="dfb907a02bba8152ca444717ca5d78747ccb4bec"
KOKORO_DIR="$SCRIPT_DIR/kokoro"

check_uv() {
    if [ -x "$UV_CMD" ]; then
        return 0
    fi
    echo "ERROR: uv not found at $UV_CMD"
    echo "Please run the workers setup script first."
    exit 1
}

clone_kokoro_repo() {
    if [[ -d "$KOKORO_DIR" && -n "$(ls -A "$KOKORO_DIR" 2>/dev/null)" ]]; then
        echo "Kokoro repo already present. Skipping clone."
        return 0
    fi
    if ! command -v git >/dev/null 2>&1; then
        echo "ERROR: git is required but not installed."
        exit 1
    fi
    echo "Cloning Kokoro repo..."
    git init "$KOKORO_DIR"
    pushd "$KOKORO_DIR" >/dev/null
    git remote add origin "$REPO_URL"
    if git fetch --depth 1 origin "$REPO_COMMIT"; then
        git checkout FETCH_HEAD
    else
        echo "Warning: could not fetch commit directly. Falling back to shallow clone."
        git fetch --depth 1 origin
        git checkout --detach FETCH_HEAD || git checkout --force
    fi
    PATCH_FILE="$SCRIPT_DIR/kokoro.patch"
    if [[ -f "$PATCH_FILE" ]]; then
        echo "Applying local patch: $PATCH_FILE"
        if git apply --whitespace=fix "$PATCH_FILE"; then
            git add -A
            git commit -m "Apply local kokoro.patch" --author="Edge AI Studio <no-reply@local>" || true
        else
            git am --signoff < "$PATCH_FILE" || { git am --abort 2>/dev/null; popd >/dev/null; exit 1; }
        fi
    fi
    for entry in .?* *; do
        [ "$entry" = "." ] && continue; [ "$entry" = ".." ] && continue; [ "$entry" = "kokoro" ] && continue
        rm -rf -- "$entry" 2>/dev/null || true
    done
    if [[ -d "kokoro" ]]; then
        shopt -s dotglob nullglob
        kokoro_entries=(kokoro/*)
        if (( ${#kokoro_entries[@]} )); then mv -f "${kokoro_entries[@]}" . || true; fi
        shopt -u dotglob nullglob
        rm -rf kokoro
    fi
    [[ -d ".git" ]] && rm -rf .git
    popd >/dev/null
    echo "Kokoro repo ready."
}

check_uv
clone_kokoro_repo

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

setup_export_venv() {
    echo "Setting up export virtual environment (.export-venv)..."
    "$UV_CMD" venv --seed --clear "$SCRIPT_DIR/.export-venv"
    "$UV_CMD" pip install \
        --python "$SCRIPT_DIR/.export-venv/bin/python" \
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
    echo "Export virtual environment ready."
}

EXPORT_PYTHON="$SCRIPT_DIR/.export-venv/bin/python"

if [[ ! -x "$EXPORT_PYTHON" ]]; then
    echo "Export virtual environment not found. Setting it up..."
    setup_export_venv
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
