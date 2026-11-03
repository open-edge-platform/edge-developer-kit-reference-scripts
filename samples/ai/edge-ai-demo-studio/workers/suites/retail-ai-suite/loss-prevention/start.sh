#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

APP_NAME="loss-prevention"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SUITE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
SETUP_SCRIPT="$SUITE_ROOT/setup.sh"
SUITE_DIR="$SCRIPT_DIR/src"
COMPOSE_FILE="$SUITE_DIR/src/docker-compose.yml"

# Device overrides
LP_DEVICE="${LP_DEVICE:-CPU}"
LP_DETECT_DEVICE=""
LP_CLASSIFY_DEVICE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)          LP_DEVICE="$2";          shift 2 ;;
    --detect-device)   LP_DETECT_DEVICE="$2";   shift 2 ;;
    --classify-device) LP_CLASSIFY_DEVICE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# When per-model devices are not set explicitly, both use LP_DEVICE.
LP_DETECT_DEVICE="${LP_DETECT_DEVICE:-$LP_DEVICE}"
LP_CLASSIFY_DEVICE="${LP_CLASSIFY_DEVICE:-$LP_DEVICE}"

log() { echo "[$APP_NAME] $*"; }

# precision_for <step type> <device>: gvadetect is INT8 on GPU/NPU, FP32 on CPU; gvaclassify is
# FP16-INT8 / FP32-INT8 (the two EfficientNet-B0 builds the model downloader fetches).
precision_for() {
  local step_type="$1" device="$2"
  # Device family: drop a .N sub-device suffix, uppercase
  local family
  family="$(echo "$device" | sed 's/[.:][0-9]*$//' | tr '[:lower:]' '[:upper:]')"
  case "$step_type" in
    gvadetect)
      case "$family" in GPU|NPU) echo "INT8" ;; *) echo "FP32" ;; esac ;;
    gvaclassify)
      case "$family" in GPU|NPU) echo "FP16-INT8" ;; *) echo "FP32-INT8" ;; esac ;;
  esac
}

# Workload config with the exact per-step device strings
GENERATED_WORKLOAD_CONFIG_NAME="workload_to_pipeline_asc_object_detection_classification_demostudio.json"

generate_workload_config() {
  local configs_dir="$1"
  local detect_device="$2"
  local classify_device="$3"
  local detect_precision classify_precision
  detect_precision="$(precision_for gvadetect   "$detect_device")"
  classify_precision="$(precision_for gvaclassify "$classify_device")"

  mkdir -p "$configs_dir"
  cat > "$configs_dir/$GENERATED_WORKLOAD_CONFIG_NAME" <<EOF
{
  "workload_pipeline_map": {
    "asc_object_detection_yolo11n_classification_effnetb0": [
      {
        "type": "gvadetect",
        "model": "yolo11n",
        "device": "$detect_device",
        "precision": "$detect_precision"
      },
      {
        "type": "gvaclassify",
        "model": "efficientnet-b0",
        "device": "$classify_device",
        "precision": "$classify_precision"
      }
    ]
  }
}
EOF
  log "Generated workload config: $configs_dir/$GENERATED_WORKLOAD_CONFIG_NAME"
  log "  Detection:      device=$detect_device  precision=$detect_precision"
  log "  Classification: device=$classify_device  precision=$classify_precision"
}

# Step 1: clone the upstream loss-prevention repo
log "Running suite setup ($SETUP_SCRIPT $APP_NAME)"
bash "$SETUP_SCRIPT" "$APP_NAME"

if [ ! -f "$COMPOSE_FILE" ]; then
  log "ERROR: docker-compose.yml not found at $COMPOSE_FILE"
  exit 1
fi

# Step 2: bring up the stack with upstream's `make run-lp`, which sets the env vars, inits the
# submodule, downloads the video and models, and runs docker compose up.

CAMERA_STREAM="camera_to_workload_asc_object_detection_classification.json"

# Needs $SUITE_DIR/configs/, which suite setup creates.
generate_workload_config "$SUITE_DIR/configs" "$LP_DETECT_DEVICE" "$LP_CLASSIFY_DEVICE"
WORKLOAD_DIST="$GENERATED_WORKLOAD_CONFIG_NAME"

# Default DISPLAY for visual mode
if [ -z "${DISPLAY:-}" ]; then
  export DISPLAY=":0"
  log "DISPLAY was not set — defaulting to :0"
fi

# Visual mode needs an X server and xhost; without them (headless, CI) use upstream's
# RENDER_MODE=0, with no window.
RENDER_MODE=1
display_number="${DISPLAY#*:}"
display_number="${display_number%%.*}"
if [ ! -S "/tmp/.X11-unix/X${display_number}" ] || ! command -v xhost >/dev/null 2>&1; then
  RENDER_MODE=0
  log "No X display at $DISPLAY (or no xhost) — running the pipeline without a window"
fi

# Allow local Docker containers to access the X11 display
if [ "$RENDER_MODE" = "1" ]; then
  xhost +local:docker 2>/dev/null || true
fi

cleanup() {
  log "Received shutdown signal — running stop.sh"
  bash "$SCRIPT_DIR/stop.sh" || true
}
trap cleanup EXIT INT TERM

# Tear down any existing stack before starting
if [ -f "$COMPOSE_FILE" ]; then
  existing_containers="$(cd "$SUITE_DIR" && docker compose -f src/docker-compose.yml ps -q 2>/dev/null)" || existing_containers=""
  if [ -n "$existing_containers" ]; then
    log "Stack is already running — bringing it down before restart"
    (cd "$SUITE_DIR" && make down-lp) || true
  fi
fi

log "Starting Combined Detection and Classification pipeline"
log "  Detect device:  $LP_DETECT_DEVICE"
log "  Classify device:$LP_CLASSIFY_DEVICE"
log "  Camera:         $CAMERA_STREAM"
log "  Workload:       $WORKLOAD_DIST"
log "  Stream loop:    true"
log "  Display:        $DISPLAY (render mode $RENDER_MODE)"

cd "$SUITE_DIR"

make run-lp \
  CAMERA_STREAM="$CAMERA_STREAM" \
  WORKLOAD_DIST="$WORKLOAD_DIST" \
  RENDER_MODE="$RENDER_MODE" \
  DISPLAY="$DISPLAY" \
  STREAM_LOOP=true

if [ "$RENDER_MODE" = "1" ]; then
  log "Stack is up — pipeline output window should appear on display $DISPLAY"
else
  log "Stack is up — the pipeline runs without a window"
fi

# Foreground tail so the frontend sees an active PID and gets container logs; ends with the stack.
docker compose -f src/docker-compose.yml logs -f