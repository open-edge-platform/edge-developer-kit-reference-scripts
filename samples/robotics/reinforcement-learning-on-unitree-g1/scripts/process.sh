#!/usr/bin/env bash
set -euo pipefail

# Script to process a video file for G1 motion imitation RL training
# Video -> GVHMR -> GMR -> MJLAB (csv to npz)

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <video.mp4|video.mov>" >&2
    exit 2
fi

DATA_PATH="$1"

if [ ! -e "$DATA_PATH" ]; then
    echo "[Error] Path does not exist." >&2 
    exit 1
fi

if [ -d "$DATA_PATH" ]; then
    echo "[Error] Path is a directory. Please provide a file instead." >&2
    exit 1
fi

if [ ! -f "$DATA_PATH" ]; then
    echo "[Error] Path is not a regular file." >&2
    exit 1
fi

DATA_PATH=$(realpath "$DATA_PATH")
FILE_NAME=$(basename "$DATA_PATH")
VIDEO_NAME="${FILE_NAME%.*}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/setup/utils.sh"
GVHMR_HOME="$THIRD_PARTY_DIR/GVHMR"
GMR_HOME="$THIRD_PARTY_DIR/GMR"
MJLAB_HOME="$THIRD_PARTY_DIR/unitree_rl_mjlab"

MIME_TYPE=$(file -b --mime-type "$DATA_PATH")

if [[ "$MIME_TYPE" == "video/mp4" || "$MIME_TYPE" == "video/quicktime" ]]; then
    echo "Path is a verified MP4/MOV file."
else
    echo "[Error] MIME type '$MIME_TYPE' is not allowed; expected MP4 or MOV." >&2
    exit 1
fi

echo "Processing $DATA_PATH"
"$SCRIPT_DIR/process/process-gvhmr.sh" "$DATA_PATH" "$GVHMR_HOME/outputs/${VIDEO_NAME}_result"
"$SCRIPT_DIR/process/process-gmr.sh" \
    "$GVHMR_HOME/outputs/${VIDEO_NAME}_result/${VIDEO_NAME}/hmr4d_results.pt" \
    "$GMR_HOME/outputs/${VIDEO_NAME}" \
    "$VIDEO_NAME"
"$SCRIPT_DIR/process/process-csv-to-npz.sh" \
    "$GMR_HOME/outputs/${VIDEO_NAME}/csv/${VIDEO_NAME}_g1.csv" \
    "$MJLAB_HOME/src/assets/motions/g1/${VIDEO_NAME}_g1.npz"

echo "You can now start training by running ./scripts/train.sh \"$MJLAB_HOME/src/assets/motions/g1/${VIDEO_NAME}_g1.npz\""