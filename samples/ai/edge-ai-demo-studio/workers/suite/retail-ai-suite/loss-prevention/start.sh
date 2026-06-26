#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

APP_NAME="loss-prevention"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SETUP_SCRIPT="$SUITE_ROOT/setup.sh"
SUITE_DIR="$SCRIPT_DIR/src"
COMPOSE_FILE="$SUITE_DIR/src/docker-compose.yml"

# ── Parse optional device override ────────────────────────────────
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

# ── Derive precision from device family ───────────────────────────
# Returns the correct precision for each step type given the selected device.
# gvadetect  — GPU/NPU (incl. GPU.0, GPU.1): INT8; CPU: FP32
# gvaclassify — all devices:                  INT8
precision_for() {
  local step_type="$1" device="$2"
  # Strip sub-device suffix (.0, .1, …) and normalise to uppercase family
  local family
  family="$(echo "$device" | sed 's/[.:][0-9]*$//' | tr '[:lower:]' '[:upper:]')"
  case "$step_type" in
    gvadetect)
      case "$family" in GPU|NPU) echo "INT8" ;; *) echo "FP32" ;; esac ;;
    gvaclassify)
      echo "INT8" ;;
  esac
}

# ── Generate workload config with exact per-step device strings ───
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

# ── Step 1: Clone upstream loss-prevention repo ───────────────────
log "Running suite setup ($SETUP_SCRIPT $APP_NAME)"
bash "$SETUP_SCRIPT" "$APP_NAME"

if [ ! -f "$COMPOSE_FILE" ]; then
  log "ERROR: docker-compose.yml not found at $COMPOSE_FILE"
  exit 1
fi

# ── Step 2: Bring up the stack via upstream Makefile ──────────────
# The upstream Makefile (make run-lp) correctly sets all required env vars
# (LP_TAG, LP_IP, LOCAL_UID, LOCAL_GID, MINIO_*, RABBITMQ_*, etc.) and
# orchestrates: submodule init, sample video download, model download (via the
# model-downloader container in compose), and docker compose up.

CAMERA_STREAM="camera_to_workload_asc_object_detection_classification.json"

# Generate the workload-to-pipeline config with exact device strings.
# This must run after suite setup so $SUITE_DIR/configs/ exists.
generate_workload_config "$SUITE_DIR/configs" "$LP_DETECT_DEVICE" "$LP_CLASSIFY_DEVICE"
WORKLOAD_DIST="$GENERATED_WORKLOAD_CONFIG_NAME"

# Validate DISPLAY for visual mode
if [ -z "${DISPLAY:-}" ]; then
  export DISPLAY=":0"
  log "DISPLAY was not set — defaulting to :0"
fi

# Allow local Docker containers to access the X11 display
if command -v xhost >/dev/null 2>&1; then
  xhost +local:docker 2>/dev/null || true
fi

cleanup() {
  log "Received shutdown signal — running 'make down-lp'"
  (cd "$SUITE_DIR" && make down-lp) || true
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
log "  Display:        $DISPLAY"

cd "$SUITE_DIR"

# Use make run-lp which handles all env var setup, model downloads (via the
# model-downloader container), submodule init, sample video download, and
# docker compose up.
make run-lp \
  CAMERA_STREAM="$CAMERA_STREAM" \
  WORKLOAD_DIST="$WORKLOAD_DIST" \
  RENDER_MODE=1 \
  DISPLAY="$DISPLAY" \
  STREAM_LOOP=true

log "Stack is up — pipeline output window should appear on display $DISPLAY"

# Keep this process alive so the frontend sees an active PID.
# docker compose logs -f also forwards all container output to the
# frontend's log viewer and exits naturally if the stack goes down.
docker compose -f src/docker-compose.yml logs -f