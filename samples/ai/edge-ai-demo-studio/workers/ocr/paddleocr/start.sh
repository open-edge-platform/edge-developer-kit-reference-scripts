#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
UV_CMD="$WORKERS_DIR/thirdparty/uv/uv"
[ -x "$UV_CMD" ] || UV_CMD="uv"

VL_VENDOR_DIR="$SCRIPT_DIR/models/paddleocr_vl/_vendor"
VL_REPO="https://github.com/openvinotoolkit/openvino_notebooks.git"
VL_COMMIT="069417dfad03a787537588e7ce0be9cdb9acdb05"
VL_SUBDIR="notebooks/paddleocr_vl"
VL_FILES="ov_paddleocr_vl.py image_processing_paddleocr_vl.py modeling_paddleocr_vl.py"

check_uv() {
    if [ -x "$UV_CMD" ] || command -v uv >/dev/null 2>&1; then
        return 0
    fi
    echo "ERROR: uv not found."
    echo "Please run the workers setup script first."
    exit 1
}

fetch_vl_vendor() {
    local present=1
    for f in $VL_FILES; do
        [ -f "$VL_VENDOR_DIR/$f" ] || present=0
    done
    if [ "$present" -eq 1 ]; then
        echo "PaddleOCR-VL helper files already present, skipping fetch."
        return
    fi
    if ! git --version >/dev/null 2>&1; then
        echo "Error: git not found." >&2
        exit 1
    fi
    echo "Fetching PaddleOCR-VL helper files @ ${VL_COMMIT:0:10}..."
    local tmp
    tmp="$(mktemp -d)"
    git -C "$tmp" init -q
    git -C "$tmp" remote add origin "$VL_REPO"
    git -C "$tmp" config core.sparseCheckout true
    echo "$VL_SUBDIR/" > "$tmp/.git/info/sparse-checkout"
    git -C "$tmp" fetch -q --depth 1 origin "$VL_COMMIT"
    git -C "$tmp" checkout -q FETCH_HEAD
    mkdir -p "$VL_VENDOR_DIR"
    for f in $VL_FILES; do
        cp "$tmp/$VL_SUBDIR/$f" "$VL_VENDOR_DIR/$f"
    done
    rm -rf "$tmp"
    echo "Installed VL helper files to $VL_VENDOR_DIR"
}

check_uv
fetch_vl_vendor
"$UV_CMD" sync
"$UV_CMD" pip install transformers==4.56.2
cd "$SCRIPT_DIR"
exec "$UV_CMD" run main.py "$@"
