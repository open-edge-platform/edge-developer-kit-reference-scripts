#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 3 ]]; then
	printf 'Usage: %s <hmr4d_results.pt> <output-dir> <motion-stem>\n' "$0" >&2
	exit 2
fi

PREDICTION_PATH="$(realpath -- "$1")"
OUTPUT_DIR="$(realpath -m -- "$2")"
MOTION_STEM="$3"
[[ -f "$PREDICTION_PATH" ]] || { printf 'GVHMR prediction not found: %s\n' "$PREDICTION_PATH" >&2; exit 1; }
[[ "$MOTION_STEM" =~ ^[A-Za-z0-9_-]+$ ]] || { printf 'Invalid motion stem.\n' >&2; exit 2; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SCRIPT_DIR/setup/utils.sh"
GMR_HOME="$THIRD_PARTY_DIR/GMR"
mkdir -p -- "$OUTPUT_DIR"

cd "$GMR_HOME"
source .venv/bin/activate
MUJOCO_GL=egl python scripts/gvhmr_to_robot.py \
	--robot unitree_g1 \
	--gvhmr_pred_file "$PREDICTION_PATH" \
	--save_path "$OUTPUT_DIR/${MOTION_STEM}_g1.pkl" \
	--video_path "$GMR_HOME/videos/unitree_g1_${MOTION_STEM}.mp4" \
	--headless \
	--record_video

python scripts/batch_gmr_pkl_to_csv.py --folder "$OUTPUT_DIR"