#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
	printf 'Usage: %s <motion.csv> <output.npz>\n' "$0" >&2
	exit 2
fi

CSV_PATH="$(realpath -- "$1")"
OUTPUT_PATH="$(realpath -m -- "$2")"
[[ -f "$CSV_PATH" ]] || { printf 'CSV file not found: %s\n' "$CSV_PATH" >&2; exit 1; }
[[ "$OUTPUT_PATH" == *.npz ]] || { printf 'Output must end in .npz\n' >&2; exit 2; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$SCRIPT_DIR/setup/utils.sh"
MJLAB_HOME="$THIRD_PARTY_DIR/unitree_rl_mjlab"
MOTIONS_DIR="$MJLAB_HOME/src/assets/motions/g1"
OUTPUT_NAME="$(basename -- "$OUTPUT_PATH")"
TEMP_NAME=".${OUTPUT_NAME%.npz}.$$.tmp.npz"
TEMP_PATH="$MOTIONS_DIR/$TEMP_NAME"
mkdir -p -- "$(dirname -- "$OUTPUT_PATH")"
trap 'rm -f -- "$TEMP_PATH"' EXIT

cd "$MJLAB_HOME"
source .venv/bin/activate
python scripts/csv_to_npz.py \
	--input-file "$CSV_PATH" \
	--output-name "$TEMP_NAME" \
	--input-fps 30 \
	--output-fps 50 \
	--robot g1 \
	--device cpu

mv -- "$TEMP_PATH" "$OUTPUT_PATH"