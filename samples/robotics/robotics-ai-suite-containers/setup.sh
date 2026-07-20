#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (C) 2025 Intel Corporation
#
# Clone the edge-ai-suites repository and build the selected module Docker image.

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
require_cmd git

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

readonly MODULE_VERSION="2026.1"
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

# Clone repository (idempotent)
if [[ ! -d "edge-ai-suites" ]]; then
    log_info "Cloning edge-ai-suites repository (version ${MODULE_VERSION}) ..."
    git clone https://github.com/open-edge-platform/edge-ai-suites.git \
        -b "${MODULE_VERSION}" \
        --recurse-submodules \
        edge-ai-suites
else
    log_info "edge-ai-suites directory already exists, skipping clone."
fi

select_from_menu "Select a module to build:" "${MODULE_LIST[@]}"
MODULE_NAME="${SELECTED}"

if [[ "${MODULE_NAME}" == "humanoid-imitation-learning" ]]; then
    select_from_menu "Select a sample for humanoid-imitation-learning:" "${HUMANOID_SAMPLE_LIST[@]}"
    SAMPLE_NAME="${SELECTED}"
elif [[ "${MODULE_NAME}" == "stationary-robot-vision-control" ]]; then
    log_info "Building Docker image for stationary-robot-vision-control ..."
    cd edge-ai-suites/robotics-ai-suite/robot-vision-control
    ./docker_build_rvc_img.sh jazzy
    exit 0
elif [[ "${MODULE_NAME}" == "autonomous-mobile-robot" ]]; then
    select_from_menu "Select a sample for autonomous-mobile-robot:" "${AMR_SAMPLE_LIST[@]}"
    SAMPLE_NAME="${SELECTED}"
else
    die "Unknown module selected: ${MODULE_NAME}"
fi

if [[ ! -f "dockerfiles/${MODULE_NAME}/${SAMPLE_NAME}.dockerfile" ]]; then
    die "Dockerfile for ${MODULE_NAME}:${SAMPLE_NAME} not found at dockerfiles/${MODULE_NAME}/${SAMPLE_NAME}.dockerfile"
fi

log_info "Building Docker base image for ${MODULE_NAME} ..."
docker build -t "robotics-ai-suite:${MODULE_NAME}-base" \
    -f "dockerfiles/${MODULE_NAME}/base.dockerfile" .

log_info "Building Docker image for ${MODULE_NAME}:${SAMPLE_NAME} ..."
docker build -t "robotics-ai-suite:${MODULE_NAME}-${SAMPLE_NAME}" \
    -f "dockerfiles/${MODULE_NAME}/${SAMPLE_NAME}.dockerfile" .

log_info "Build complete: robotics-ai-suite:${MODULE_NAME}-${SAMPLE_NAME}"
