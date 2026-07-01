#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Teleimager Camera Server
#
# Starts the RealSense camera streaming server (teleimager).
# Run this BEFORE data-collection.sh when collecting data on the real robot.
#
# On first run, detects connected cameras and prompts for role assignment
# (head_camera / table_camera). Config is saved to data/camera-config.yaml.
#
# Usage:
#   ./start-camera-server.sh
#

set -euo pipefail

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
THIRDPARTY_DIR="$SCRIPT_DIR/thirdparty"
TELEIMAGER_DIR="$THIRDPARTY_DIR/teleimager"
VENV_TELEIMAGER="$SCRIPT_DIR/.teleimager-venv"
CAMERA_CONFIG="$SCRIPT_DIR/data/camera-config.yaml"

# Color codes
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

# ============================================================================
# HELPERS
# ============================================================================

log_info()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $*"; }
log_error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $*" >&2; }
log_step()  { echo -e "${CYAN}[$(date '+%H:%M:%S')] >>>>${NC} $*"; }

die() {
    log_error "$*"
    exit 1
}

# ============================================================================
# VALIDATION
# ============================================================================

[ -d "$VENV_TELEIMAGER" ] || die "Teleimager venv not found at $VENV_TELEIMAGER. Run setup.sh first."

if ! command -v rs-enumerate-devices &>/dev/null; then
    die "rs-enumerate-devices not found. Install librealsense2-utils."
fi

# ============================================================================
# DETECT CAMERAS
# ============================================================================

log_step "Detecting RealSense cameras..."

mapfile -t CAMERA_SERIALS < <(rs-enumerate-devices | grep "Serial Number" | grep -v "Asic" | awk '{print $NF}')
NUM_CAMERAS=${#CAMERA_SERIALS[@]}

if [[ $NUM_CAMERAS -eq 0 ]]; then
    die "No RealSense cameras detected. Please connect camera(s) and try again."
fi

log_info "Detected $NUM_CAMERAS RealSense camera(s): ${CAMERA_SERIALS[*]}"

# ============================================================================
# CAMERA CONFIG
# ============================================================================

if [[ -f "$CAMERA_CONFIG" ]]; then
    log_info "Camera config found: $CAMERA_CONFIG"

    # Validate that configured serials are still connected
    CONFIG_SERIALS=$(grep -oP 'serial_number:\s*\K\S+' "$CAMERA_CONFIG" || true)
    MISSING=false
    for serial in $CONFIG_SERIALS; do
        FOUND=false
        for connected in "${CAMERA_SERIALS[@]}"; do
            if [[ "$serial" == "$connected" ]]; then
                FOUND=true
                break
            fi
        done
        if [[ "$FOUND" == false ]]; then
            log_error "Camera serial $serial in config is not connected."
            MISSING=true
        fi
    done

    if [[ "$MISSING" == true ]]; then
        die "Camera config has serial(s) not matching connected cameras. Please delete $CAMERA_CONFIG and re-run."
    fi
    log_info "Camera config validated — all serials match connected cameras."
else
    log_info "No camera config found. Creating one..."
    mkdir -p "$(dirname "$CAMERA_CONFIG")"

    echo ""
    echo "========================================="
    echo " Camera Configuration"
    echo "========================================="
    echo "Connected cameras:"
    for i in "${!CAMERA_SERIALS[@]}"; do
        echo "  [$((i+1))] ${CAMERA_SERIALS[$i]}"
    done
    echo ""

    # --- Assign head_camera ---
    if [[ $NUM_CAMERAS -eq 1 ]]; then
        HEAD_SERIAL="${CAMERA_SERIALS[0]}"
        log_info "Single camera detected — assigning ${HEAD_SERIAL} as head_camera."
        TABLE_SERIAL=""
    else
        while true; do
            read -rp "Select head_camera [1-$NUM_CAMERAS]: " HEAD_IDX
            if [[ "$HEAD_IDX" =~ ^[0-9]+$ ]] && (( HEAD_IDX >= 1 && HEAD_IDX <= NUM_CAMERAS )); then
                HEAD_SERIAL="${CAMERA_SERIALS[$((HEAD_IDX-1))]}"
                break
            fi
            echo "Invalid selection. Enter a number between 1 and $NUM_CAMERAS."
        done

        # --- Assign table_camera ---
        while true; do
            read -rp "Select table_camera [1-$NUM_CAMERAS]: " TABLE_IDX
            if [[ "$TABLE_IDX" =~ ^[0-9]+$ ]] && (( TABLE_IDX >= 1 && TABLE_IDX <= NUM_CAMERAS )); then
                if [[ "${CAMERA_SERIALS[$((TABLE_IDX-1))]}" == "$HEAD_SERIAL" ]]; then
                    echo "Cannot use the same camera for both roles. Pick a different one."
                    continue
                fi
                TABLE_SERIAL="${CAMERA_SERIALS[$((TABLE_IDX-1))]}"
                break
            fi
            echo "Invalid selection. Enter a number between 1 and $NUM_CAMERAS."
        done
    fi

    # --- Write config YAML ---
    cat > "$CAMERA_CONFIG" <<EOF
# Auto-generated camera config for teleimager
# forehead_camera: forehead / main view
forehead_camera:
  enable_zmq: true
  zmq_port: 55555
  enable_webrtc: false
  webrtc_port: 60001
  webrtc_codec: h264
  type: realsense
  image_shape: [480, 640]
  binocular: false
  fps: 30
  video_id: null
  serial_number: ${HEAD_SERIAL}
  physical_path: null
EOF

    if [[ -n "$TABLE_SERIAL" ]]; then
        cat >> "$CAMERA_CONFIG" <<EOF

# table_camera: table / workspace view
table_camera:
  enable_zmq: true
  zmq_port: 55556
  enable_webrtc: false
  webrtc_port: 60002
  webrtc_codec: h264
  type: realsense
  image_shape: [480, 640]
  binocular: false
  fps: 30
  video_id: null
  serial_number: ${TABLE_SERIAL}
  physical_path: null
EOF
    fi

    log_info "Camera config written to $CAMERA_CONFIG"
    echo ""
fi

# ============================================================================
# START TELEIMAGER
# ============================================================================

# Symlink config to where teleimager expects it
[ -d "$TELEIMAGER_DIR" ] || die "teleimager not found at $TELEIMAGER_DIR. Run setup.sh first."
TELEIMAGER_CONFIG_TARGET="$THIRDPARTY_DIR/teleimager/cam_config_server.yaml"
ln -sf "$CAMERA_CONFIG" "$TELEIMAGER_CONFIG_TARGET"
log_info "Symlinked config to $TELEIMAGER_CONFIG_TARGET"

# Also symlink to training-ws so ImageClient fallback path resolves correctly
TRAINING_WS_CONFIG="$SCRIPT_DIR/training-ws/cam_config_server.yaml"
ln -sf "$CAMERA_CONFIG" "$TRAINING_WS_CONFIG"
log_info "Symlinked config to $TRAINING_WS_CONFIG"

log_step "Starting teleimager server (Ctrl+C to stop)..."
# shellcheck source=/dev/null
source "$VENV_TELEIMAGER/bin/activate"
exec python -m teleimager.image_server --rs
