#!/usr/bin/env bash
#
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname -- "${BASH_SOURCE[0]}")/utils.sh"

UNITREE_DIR="$THIRD_PARTY_DIR/unitree_rl_mjlab"
UNITREE_COMMIT=1425b15f73bd4095f0df53709d7c389c3eb9e790
MJLAB_TAG=v1.2.0
MJLAB_COMMIT=5af32e378dcb93c9e881ace83cc5a3f5d373fe60
MUJOCO_WARP_TAG=v3.8.1
MUJOCO_WARP_COMMIT=9edb8e09a6ea859a99232e154899ac0198910216
WARP_COMMIT=e6c3ba2d54bb048115760b5cd7a4bb2573329ae7

mkdir -p "$THIRD_PARTY_DIR"
clone_at_ref https://github.com/unitreerobotics/unitree_rl_mjlab.git "$UNITREE_COMMIT" "$UNITREE_DIR"
clone_at_ref https://github.com/mujocolab/mjlab.git "$MJLAB_COMMIT" "$THIRD_PARTY_DIR/mjlab"
clone_at_ref https://github.com/google-deepmind/mujoco_warp.git "$MUJOCO_WARP_COMMIT" "$THIRD_PARTY_DIR/mujoco_warp"
clone_at_ref https://github.com/NVIDIA/warp.git "$WARP_COMMIT" "$THIRD_PARTY_DIR/warp"

apply_patch_once "$UNITREE_DIR" "$PATCH_DIR/unitree_rl_mjlab/00_xpu_controller_new-task.patch"
apply_patch_once "$THIRD_PARTY_DIR/mjlab" "$PATCH_DIR/mjlab/00_mjlab-v1.2.0-sycl.patch"
apply_patch_once "$THIRD_PARTY_DIR/mujoco_warp" "$PATCH_DIR/mujoco_warp/00_mujoco-warp-v3.8.1-sycl.patch"

ONEAPI_SET_VARS="${ONEAPI_ROOT:-/opt/intel/oneapi}/setvars.sh"
if [[ -f "$ONEAPI_SET_VARS" ]]; then
	# shellcheck disable=SC1090
	source "$ONEAPI_SET_VARS" >/dev/null 2>&1 || true
fi
command -v icpx >/dev/null 2>&1 || die "Intel oneAPI DPC++ compiler not found; source oneAPI setvars.sh"
if [[ "${INSTALL_SKIP_GPU_CHECK:-0}" != 1 ]]; then
	if ! sycl_devices="$(sycl-ls 2>&1)"; then
		die "SYCL device discovery failed: $sycl_devices"
	fi
	grep -Eiq '\[(level_zero|ext_oneapi_level_zero):gpu\].*Intel' <<< "$sycl_devices" || die "no Intel Level Zero GPU is visible to SYCL: $sycl_devices"
fi

apply_patch_once "$THIRD_PARTY_DIR/warp" "$PATCH_DIR/warp/00_warp_sycl.patch"

cd "$UNITREE_DIR"
uv venv --python 3.12
# shellcheck disable=SC1091
source .venv/bin/activate
uv pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/xpu
uv pip install -e"$UNITREE_DIR" --no-deps
uv pip install scipy "mujoco-warp==$MUJOCO_WARP_TAG" "mjlab==$MJLAB_TAG"

# Replace with the patched source without resolving dependencies again.
uv pip install -e "$THIRD_PARTY_DIR/mjlab" --no-deps
uv pip install -e "$THIRD_PARTY_DIR/mujoco_warp" --no-deps
"$UNITREE_DIR/.venv/bin/python" "$THIRD_PARTY_DIR/warp/build_lib.py" --no-cuda
uv pip install -e "$THIRD_PARTY_DIR/warp" --no-deps
if [[ "${INSTALL_SKIP_GPU_CHECK:-0}" != 1 ]]; then
	"$UNITREE_DIR/.venv/bin/python" -c 'import torch, warp as wp; wp.init(); device = wp.get_device("sycl"); assert torch.xpu.is_available(), "Torch XPU is unavailable"; print(f"Verified Warp SYCL device: {device.name}; Torch XPU is available")'
fi