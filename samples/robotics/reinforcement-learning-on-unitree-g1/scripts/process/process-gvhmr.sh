#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

if [[ "$#" -ne 2 ]]; then
	printf 'Usage: %s <video.mp4|video.mov> <output-dir>\n' "$0" >&2
	exit 2
fi

VIDEO_PATH="$(realpath -- "$1")"
OUTPUT_DIR="$(realpath -m -- "$2")"
[[ -f "$VIDEO_PATH" ]] || { printf 'Video not found: %s\n' "$VIDEO_PATH" >&2; exit 1; }
case "$(file -b --mime-type "$VIDEO_PATH")" in
	video/mp4|video/quicktime) ;;
	*) printf 'Expected an MP4 or MOV video: %s\n' "$VIDEO_PATH" >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/setup/utils.sh"
GVHMR_HOME="$THIRD_PARTY_DIR/GVHMR"
mkdir -p -- "$OUTPUT_DIR"

cd "$GVHMR_HOME"
# shellcheck disable=SC1091
source .venv/bin/activate
TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1 python tools/demo/demo.py \
	--video "$VIDEO_PATH" \
	--output_root "$OUTPUT_DIR"