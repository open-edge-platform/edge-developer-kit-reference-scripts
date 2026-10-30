#!/usr/bin/env bash
#
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# Script to visualize trained G1 motion imitation RL policy in mujoco.
# For now, the provided paths must be relative to MJLAB_HOME. 

MOTION_FILE_PATH="$(realpath -- "$1")"
CHECKPOINT_FILE_PATH="$(realpath -- "$2")"
DEVICE="${3:-cpu}"
PLAYBACK_PORT="${4:-8000}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/setup/utils.sh"
MJLAB_HOME="$THIRD_PARTY_DIR/unitree_rl_mjlab"

cd "$MJLAB_HOME"
# shellcheck disable=SC1091
source .venv/bin/activate

python3 scripts/play.py Unitree-G1-Tracking-Sim2Real-No-Curriculum \
    --motion_file "$MOTION_FILE_PATH" \
    --checkpoint-file "$CHECKPOINT_FILE_PATH" \
    --device "$DEVICE" \
    --port "$PLAYBACK_PORT" \
    --viewer viser