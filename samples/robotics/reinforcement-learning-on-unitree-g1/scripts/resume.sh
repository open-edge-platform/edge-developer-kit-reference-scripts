#!/usr/bin/env bash
#
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# Script to resume G1 motion imitation RL training from a checkpoint
# For now, script must be ran from $APP_HOME/unitree_rl_mjlab/
# ../docker/scripts/resume.sh <run> <checkpoint> <max_iterations>

MOTION_FILE_PATH="$(realpath -- "$1")"
RUN="$(realpath -- "$2")"
CHECKPOINT="$(realpath -- "$3")"
MAX_ITERATIONS="${4:-30001}"
ENV_DEVICE="${5:-xpu}"
EXPERIMENT="${6:-g1_tracking}"
NUM_ENVS="${7:-4096}"
POLICY_DEVICE="${8:-$ENV_DEVICE}"
OUTPUT_RUN_LABEL="${9:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/setup/utils.sh"
MJLAB_HOME="$THIRD_PARTY_DIR/unitree_rl_mjlab"

cd "$MJLAB_HOME"
# shellcheck disable=SC1091
source .venv/bin/activate

RESUME_ARGS=(Unitree-G1-Tracking-Sim2Real-No-Curriculum \
    --agent.resume "True" \
    --motion_file "$MOTION_FILE_PATH" \
    --agent.load-run "$RUN" \
    --agent.load-checkpoint "$CHECKPOINT" \
    --agent.max-iterations "$MAX_ITERATIONS" \
    --agent.experiment-name="$EXPERIMENT" \
    --env.scene.num-envs="$NUM_ENVS" \
    --agent.logger="tensorboard" \
    --device="$POLICY_DEVICE" \
    --env-device="$ENV_DEVICE")
if [[ -n "$OUTPUT_RUN_LABEL" ]]; then
    RESUME_ARGS+=(--agent.run-name="$OUTPUT_RUN_LABEL")
fi

python scripts/train.py "${RESUME_ARGS[@]}"
