#!/usr/bin/env bash
set -euo pipefail

# Script to visualize a sequence of trained G1 policies in mujoco.

if (( $# < 1 )); then
    printf 'Usage: %s <cpu|xpu> [--port <port>] <checkpoint-1> <motion-1> <checkpoint-2> <motion-2> [...]\n' "$0" >&2
    exit 2
fi

DEVICE="$1"
shift
PLAYBACK_PORT=8000
if [[ "${1:-}" == "--port" ]]; then
    if (( $# < 2 )); then
        printf 'Option --port requires a value.\n' >&2
        exit 2
    fi
    PLAYBACK_PORT="$2"
    shift 2
fi

if (( $# < 4 )) || (( $# % 2 != 0 )); then
    printf 'Usage: %s <cpu|xpu> [--port <port>] <checkpoint-1> <motion-1> <checkpoint-2> <motion-2> [...]\n' "$0" >&2
    exit 2
fi

CHECKPOINTS=()
MOTIONS=()
while (( $# )); do
    CHECKPOINTS+=("$(realpath -- "$1")")
    MOTIONS+=("$(realpath -- "$2")")
    shift 2
done
if [[ "$DEVICE" != "cpu" && "$DEVICE" != "xpu" ]]; then
    printf 'Device must be cpu or xpu.\n' >&2
    exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/setup/utils.sh"
MJLAB_HOME="$THIRD_PARTY_DIR/unitree_rl_mjlab"

cd "$MJLAB_HOME"
source .venv/bin/activate

python3 scripts/play_chain.py Unitree-G1-Tracking-Sim2Real-No-Curriculum \
    --checkpoint-files "${CHECKPOINTS[@]}" \
    --motion-files "${MOTIONS[@]}" \
    --device "$DEVICE" \
    --port "$PLAYBACK_PORT" \
    --viewer viser