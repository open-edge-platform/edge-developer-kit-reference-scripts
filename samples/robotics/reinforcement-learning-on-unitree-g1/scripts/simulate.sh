#!/usr/bin/env bash
#
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# [WIP] Script to run sim2sim for trained motion imitation RL policy on G1.
# For now, script must be ran from $APP_HOME/unitree_rl_mjlab/
# Usage: ../docker/scripts/simulate.sh <model_path> <motion_path>

MODEL_PATH="$(realpath -- "$1")"
MOTION_PATH="$(realpath -- "$2")"
APP_HOME="/app"
UNITREE_RL_MJLAB_HOME="$APP_HOME/unitree_rl_mjlab"

# # Check joystick connection
# if ! jstest /dev/input/js0; then
#     echo "Joystick not connected."
#     exit 1
# fi

if [ "$#" -lt 2 ]; then
    # Ideally, should add trial as new config to prevent reuse of dance1_subject2.
    MODEL_DEST="$UNITREE_RL_MJLAB_HOME/deploy/robots/g1/config/policy/mimic/dance1_subject2"

    cp "$MOTION_PATH" "$MODEL_DEST/params/dance1_subject2.npz"
    # TODO: replace with script below...
    cp "$MODEL_PATH" "$MODEL_DEST/exported/model.onnx"

    # source .venv/bin/activate
    # python scripts/convert.py \
    #     --model_path="$MODEL_PATH" \
    #     --export_path="$MODEL_DEST/exported/"
    # deactivate
fi

./simulate/build/unitree_mujoco & disown $! & \
./deploy/robots/g1/build/g1_ctrl --network=lo