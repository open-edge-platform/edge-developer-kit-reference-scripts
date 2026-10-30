#!/usr/bin/env bash
#
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname -- "${BASH_SOURCE[0]}")/utils.sh"

GMR_DIR="$THIRD_PARTY_DIR/GMR"
GMR_COMMIT="bb1bbe40774794fceb2a7c579a3464a28e68c844"
GVHMR_DIR="$THIRD_PARTY_DIR/GVHMR"

clone_at_ref https://github.com/YanjieZe/GMR.git "$GMR_COMMIT" "$GMR_DIR" gmr-xpu
cd "$GMR_DIR"
apply_patch_once "$PWD" "$PATCH_DIR/GMR/00_headless_video.patch"

uv venv --python 3.10
# shellcheck disable=SC1091
source .venv/bin/activate
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/xpu
uv pip install -e .
cp -r "$GVHMR_DIR/inputs/checkpoints/body_models" "$GMR_DIR/assets/"
deactivate