#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2025 Intel Corporation
#
# Launch a Robotics AI Suite Docker container for the selected module.

set -euo pipefail

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------

if [[ -t 1 && -t 2 ]]; then
    _CLR_RESET="\033[0m"
    _CLR_INFO="\033[0;32m"   # green
    _CLR_WARN="\033[0;33m"   # yellow
    _CLR_ERROR="\033[0;31m"  # red
else
    _CLR_RESET="" _CLR_INFO="" _CLR_WARN="" _CLR_ERROR=""
fi

log_info()  { echo -e "${_CLR_INFO}[INFO]  $*${_CLR_RESET}"; }
log_warn()  { echo -e "${_CLR_WARN}[WARN]  $*${_CLR_RESET}" >&2; }
log_error() { echo -e "${_CLR_ERROR}[ERROR] $*${_CLR_RESET}" >&2; }
die()       { log_error "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

require_cmd() {
    command -v "$1" &>/dev/null \
        || die "Required command not found: '$1'. Please install it before running this script."
}

require_cmd docker
require_cmd xhost

# ---------------------------------------------------------------------------
# Interactive selection
# ---------------------------------------------------------------------------

SELECTED=""

# select_from_menu [--default VALUE] PROMPT OPTIONS...
select_from_menu() {
    local default=""
    if [[ "${1:-}" == "--default" ]]; then
        default="$2"; shift 2
    fi
    local prompt="$1"; shift
    local -a options=("$@")
    SELECTED=""

    local i
    for (( i=1; i<=${#options[@]}; i++ )); do
        echo "${i}) ${options[$((i-1))]}"
    done

    local reply
    while true; do
        read -rp "${prompt} " reply
        if [[ -z "${reply}" && -n "${default}" ]]; then
            SELECTED="${default}"
            return
        elif [[ "${reply}" =~ ^[0-9]+$ ]] \
            && (( reply >= 1 && reply <= ${#options[@]} )); then
            SELECTED="${options[$((reply-1))]}"
            return
        else
            echo "Invalid selection. Please try again."
        fi
    done
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

readonly MODULE_LIST=(
    "autonomous-mobile-robot"
    "humanoid-imitation-learning"
    "stationary-robot-vision-control"
)
readonly AMR_SAMPLE_LIST=(
    "collaborative-visual-slam"
    "wandering-app-simulation"
)
readonly HUMANOID_SAMPLE_LIST=(
    "act-sample"
    "pi05-rtc-ov"
)

select_from_menu "Select a module to run:" "${MODULE_LIST[@]}"
MODULE_NAME="${SELECTED}"

if [[ "${MODULE_NAME}" == "humanoid-imitation-learning" ]]; then
    select_from_menu "Select a sample for humanoid-imitation-learning:" "${HUMANOID_SAMPLE_LIST[@]}"
    SAMPLE_NAME="${SELECTED}"
elif [[ "${MODULE_NAME}" == "stationary-robot-vision-control" ]]; then
    log_info "Running docker image for stationary-robot-vision-control ..."
    log_info "This module requires a physical robot to run. For more information, please check the documentation in https://docs.openedgeplatform.intel.com/2026.1/edge-ai-suites/robotics-ai-suite/rvc/index.html"
    cd edge-ai-suites/robotics-ai-suite/robot-vision-control
    ./docker_run_rvc_img.sh jazzy
    exit 0
elif [[ "${MODULE_NAME}" == "autonomous-mobile-robot" ]]; then
    select_from_menu "Select a sample for autonomous-mobile-robot:" "${AMR_SAMPLE_LIST[@]}"
    SAMPLE_NAME="${SELECTED}"
else
    die "Unknown module selected: ${MODULE_NAME}"
fi

# Check if docker image exists for the selected module
if ! docker image inspect "robotics-ai-suite:${MODULE_NAME}-${SAMPLE_NAME}" &>/dev/null; then
    die "Docker image 'robotics-ai-suite:${MODULE_NAME}-${SAMPLE_NAME}' not found. Please build the image first using the setup script."
fi

# Resolve render group ID (optional — warn if not found)
RENDER_GROUP_ARGS=()
if RENDER_GROUP_ID=$(getent group render | cut -d: -f3) && [[ -n "${RENDER_GROUP_ID}" ]]; then
    RENDER_GROUP_ARGS=("--group-add" "${RENDER_GROUP_ID}")
else
    log_warn "'render' group not found; GPU rendering may not be available."
fi

if [[ -n "${DISPLAY:-}" ]]; then
    xhost +local:docker
else
    log_warn "No DISPLAY set; skipping xhost. GUI features may not be available."
fi

log_info "Creating cache directory ..."
if [[ ! -d "/home/$USER/.cache" ]]; then
    mkdir -p "/home/$USER/.cache" || die "Failed to create cache directory at /home/$USER/.cache."
fi

log_info "Running Docker container for module: ${MODULE_NAME} ..."
docker run --rm -it \
    --device /dev/dri \
    --device /dev/accel \
    --user root \
    "${RENDER_GROUP_ARGS[@]}" \
    -e DISPLAY="${DISPLAY:-}" \
    -v /tmp/.X11-unix:/tmp/.X11-unix \
    -v /home/"$USER"/.cache:/root/.cache \
    -v /dev:/dev \
    -v ./edge-ai-suites:/app/edge-ai-suites \
    -v ./scripts/install_dependencies.sh:/app/edge-ai-suites/robotics-ai-suite/install_dependencies.sh \
    -v ./scripts/launch_sample.sh:/app/edge-ai-suites/robotics-ai-suite/launch_sample.sh \
    --workdir /app/edge-ai-suites/robotics-ai-suite \
    "robotics-ai-suite:${MODULE_NAME}-${SAMPLE_NAME}" \
    bash -c "./launch_sample.sh"
