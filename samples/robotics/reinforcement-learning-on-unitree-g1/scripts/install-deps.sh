#!/usr/bin/env bash
#
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

if (( EUID != 0 )) && ! command -v sudo >/dev/null 2>&1; then
    printf 'error: sudo is required to install system dependencies\n' >&2
    exit 1
fi

run_privileged() {
    if (( EUID == 0 )); then
        "$@"
    else
        sudo "$@"
    fi
}

run_privileged apt-get update
run_privileged apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    file \
    git \
    gnupg \
    libboost-all-dev \
    libeigen3-dev \
    libfmt-dev \
    libglib2.0-0t64 \
    libglfw3-dev \
    libspdlog-dev \
    libyaml-cpp-dev \
    python3-dev \
    python3-venv \
    software-properties-common \
    ffmpeg \
    wget

if ! command -v uv >/dev/null 2>&1; then
    printf 'Installing uv\n'
    wget -qO- https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
fi

# shellcheck disable=SC1091
. /etc/os-release
case "${VERSION_CODENAME:-}" in
    noble|resolute) ;;
    *)
        printf 'error: Intel oneAPI packages are not configured for Ubuntu %s\n' "${VERSION_CODENAME:-unknown}" >&2
        exit 1
        ;;
esac

if [[ "$(dpkg --print-architecture)" != amd64 ]]; then
    printf 'error: Intel OMIX packages are only configured here for amd64\n' >&2
    exit 1
fi

run_privileged mkdir -p /usr/share/keyrings
wget -qO- https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB | gpg --dearmor | run_privileged tee /usr/share/keyrings/intel-oneapi.gpg >/dev/null
printf 'deb [signed-by=/usr/share/keyrings/intel-oneapi.gpg] https://apt.repos.intel.com/oneapi all main\n' | run_privileged tee /etc/apt/sources.list.d/oneapi.list >/dev/null
run_privileged apt-get update
# Keep the oneAPI compiler/runtime aligned with PyTorch 2.13 XPU's UR 0.12 ABI.
run_privileged apt-get install -y \
    intel-oneapi-compiler-dpcpp-cpp=2026.1.1-325 \
    intel-oneapi-openmp=2026.1.1-325

if [[ "${INSTALL_DEPS_INSTALL_GPU_RUNTIME:-0}" == 1 ]]; then
    run_privileged add-apt-repository -y ppa:kobuk-team/intel-graphics
    run_privileged apt-get update
    run_privileged apt-get install -y --no-install-recommends \
        clinfo \
        intel-gsc \
        intel-metrics-discovery \
        intel-opencl-icd \
        libze-intel-gpu1 \
        libze1
fi

if [[ -f /opt/intel/oneapi/setvars.sh ]]; then
    printf '%s\n' 'source /opt/intel/oneapi/setvars.sh >/dev/null 2>&1' | run_privileged tee /etc/profile.d/intel-oneapi.sh >/dev/null
    set +u
    # shellcheck disable=SC1091
    source /opt/intel/oneapi/setvars.sh >/dev/null
    set -u
fi

command -v uv >/dev/null 2>&1 || { printf 'error: uv installation failed\n' >&2; exit 1; }
command -v sycl-ls >/dev/null 2>&1 || { printf 'error: Intel oneAPI DPC++ compiler did not install sycl-ls\n' >&2; exit 1; }

# Reference: https://github.com/open-edge-platform/edge-developer-kit-reference-scripts/
if [[ "${INSTALL_DEPS_SKIP_PLATFORM_INSTALL:-0}" != 1 ]]; then
    platform_installer_dir="$(mktemp -d)"
    trap 'rm -rf "$platform_installer_dir"' EXIT
    if ! platform_installer_script="$(wget -qLO - https://raw.githubusercontent.com/open-edge-platform/edge-developer-kit-reference-scripts/refs/heads/main/main_installer.sh)"; then
        printf 'error: failed to download the Intel platform installer\n' >&2
        exit 1
    fi
    if [[ -z "$platform_installer_script" ]]; then
        printf 'error: downloaded Intel platform installer is empty\n' >&2
        exit 1
    fi
    (
        cd "$platform_installer_dir"
        run_privileged env DEVKIT_AUTO_INSTALL=0 bash -c "$platform_installer_script" "$platform_installer_dir/main_installer.sh" --no-extras --telemetry=no
    )
fi

if [[ "${INSTALL_DEPS_SKIP_GPU_CHECK:-0}" == 1 ]]; then
    exit 0
fi

if ! sycl_devices="$(sycl-ls 2>&1)"; then
    printf 'error: SYCL runtime could not enumerate devices: %s\n' "$sycl_devices" >&2
    exit 1
fi

if ! grep -Eiq '\[(level_zero|ext_oneapi_level_zero):gpu\].*Intel' <<< "$sycl_devices"; then
    printf 'error: no Intel Level Zero GPU is visible to SYCL; check the GPU driver and device permissions\n' >&2
    printf '%s\n' "$sycl_devices" >&2
    exit 1
fi