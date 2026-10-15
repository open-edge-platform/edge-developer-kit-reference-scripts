#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/setup/utils.sh"

if ! command -v uv > /dev/null 2>&1; then
	die "uv is not installed; please install it before setup (https://docs.astral.sh/uv/getting-started/installation/)."
fi

if [[ "${INSTALL_SKIP_GPU_CHECK:-0}" != 1 ]]; then
	if ! command -v sycl-ls >/dev/null 2>&1; then
		die "SYCL runtime check failed: sycl-ls is not installed; install the Intel oneAPI runtime before setup"
	fi

	if ! sycl_devices="$(sycl-ls 2>&1)"; then
		die "SYCL runtime check failed: sycl-ls could not enumerate devices: $sycl_devices"
	fi

	if ! grep -Eiq '\[(level_zero|ext_oneapi_level_zero):gpu\].*Intel' <<< "$sycl_devices"; then
		printf 'error: no Intel Level Zero GPU is visible to SYCL; check the GPU driver and device permissions\n' >&2
		printf '%s\n' "$sycl_devices" >&2
		exit 1
	fi
else
	printf 'Skipping Intel GPU discovery during image build\n'
fi

cd "$SCRIPT_DIR"
bash "$SCRIPT_DIR/setup/GVHMR.sh"
bash "$SCRIPT_DIR/setup/GMR.sh"
bash "$SCRIPT_DIR/setup/unitree_rl_mjlab.sh"