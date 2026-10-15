#!/usr/bin/env bash
set -euo pipefail

# Script to start training RL motion imitation training on G1
# For now, script must be ran from $APP_HOME/unitree_rl_mjlab/
# ../docker/scripts/train.sh <motion_file_path> <max_iterations> <num_envs>

MOTION_FILE_PATH="$(realpath -- "$1")"
MAX_ITERATIONS="${2:-30001}"
NUM_ENVS="${3:-4096}"
DEVICE="${4:-xpu}"
ENV_DEVICE="${5:-xpu}"
OUTPUT_RUN_LABEL="${6:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/setup/utils.sh"
MJLAB_HOME="$THIRD_PARTY_DIR/unitree_rl_mjlab"

cd "$MJLAB_HOME" 
source .venv/bin/activate

TRAIN_ARGS=(Unitree-G1-Tracking-Sim2Real-No-Curriculum \
    --motion_file="$MOTION_FILE_PATH" \
    --agent.max-iterations="$MAX_ITERATIONS" \
    --env.scene.num-envs="$NUM_ENVS" \
    --agent.logger="tensorboard" \
    --device="$DEVICE" \
    --env-device="$ENV_DEVICE")
if [[ -n "$OUTPUT_RUN_LABEL" ]]; then
    TRAIN_ARGS+=(--agent.run-name="$OUTPUT_RUN_LABEL")
fi

python scripts/train.py "${TRAIN_ARGS[@]}"
