#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# shellcheck disable=SC1091
#
# TWIST2 Data Collection Launcher
#
# Starts all services required for teleoperated data collection with TWIST2:
#   1. Redis server (if not running)
#   2. Low-level controller (sim or real)
#   3. Teleop / motion server (high-level)
#   4. Data recorder
#
# Usage:
#   ./start-data-collection.sh [--sim | --real] [OPTIONS]
#
# Options:
#   --sim                Run low-level controller in simulation (default)
#   --real               Run low-level controller on real robot
#   --net IFACE          Network interface for real robot (default: eno1)
#   --robot-ip IP        Robot IP address (default: 192.168.123.164)
#   --offline            Use offline motion playback instead of VR teleop
#   --motion-file PATH   Motion file for offline mode (default: example walk)
#   --ckpt PATH          Policy checkpoint (default: twist2_1017_20k.onnx)
#   --device DEVICE      Inference device (default: cpu)
#   --human-height H     Operator height in meters for retargeting (default: 1.73)
#   --record-freq HZ     Data recording frequency (default: 30)
#   --redis-ip IP        Redis server IP (default: localhost)
#   --no-record          Disable data recording
#   -h, --help           Show this help message
#

set -euo pipefail

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
THIRDPARTY_DIR="$SCRIPT_DIR/thirdparty"
TWIST2_DIR="$THIRDPARTY_DIR/TWIST2"
VENV_TWIST2="$SCRIPT_DIR/.twist2-venv"
VENV_GMR="$SCRIPT_DIR/.gmr-venv"

# Defaults
MODE="sim"
NET_IFACE="eno1"
ROBOT_IP="localhost" # Teleimager server IP
TELEOP_MODE="online"
MOTION_FILE="$TWIST2_DIR/assets/example_motions/0807_yanjie_walk_001.pkl"
CKPT_PATH="$TWIST2_DIR/assets/ckpts/twist2_1017_20k.onnx"
DEVICE="cpu"
HUMAN_HEIGHT="1.73"
RECORD_FREQ="30"
REDIS_IP="localhost"
DO_RECORD=true

# Color codes
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

# Track child PIDs for cleanup
PIDS=()

# ============================================================================
# HELPERS
# ============================================================================

log_info()  { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $*"; }
log_error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $*" >&2; }
log_step()  { echo -e "${CYAN}[$(date '+%H:%M:%S')] >>>>${NC} $*"; }

usage() {
    sed -n '2,/^$/s/^# \?//p' "$0"
    exit 0
}

cleanup() {
    echo ""
    log_warn "Shutting down all services..."
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done
    log_info "All services stopped."
}

trap cleanup EXIT INT TERM

die() {
    log_error "$*"
    exit 1
}

# ============================================================================
# ARGUMENT PARSING
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --sim)           MODE="sim";            shift ;;
        --real)          MODE="real";           shift ;;
        --net)           NET_IFACE="$2";        shift 2 ;;
        --robot-ip)      ROBOT_IP="$2";         shift 2 ;;
        --offline)       TELEOP_MODE="offline"; shift ;;
        --motion-file)   MOTION_FILE="$2";      shift 2 ;;
        --ckpt)          CKPT_PATH="$2";        shift 2 ;;
        --device)        DEVICE="$2";           shift 2 ;;
        --human-height)  HUMAN_HEIGHT="$2";     shift 2 ;;
        --record-freq)   RECORD_FREQ="$2";      shift 2 ;;
        --redis-ip)      REDIS_IP="$2";         shift 2 ;;
        --no-record)     DO_RECORD=false;       shift ;;
        -h|--help)       usage ;;
        *) die "Unknown option: $1" ;;
    esac
done

# ============================================================================
# VALIDATION
# ============================================================================

[ -d "$TWIST2_DIR" ]      || die "TWIST2 not found at $TWIST2_DIR. Run setup.sh first."
[ -d "$VENV_TWIST2" ]     || die "TWIST2 venv not found at $VENV_TWIST2. Run setup.sh first."
[ -d "$VENV_GMR" ]        || die "GMR venv not found at $VENV_GMR. Run setup.sh first."
[ -f "$CKPT_PATH" ]       || die "Policy checkpoint not found: $CKPT_PATH"

if [[ "$TELEOP_MODE" == "offline" && ! -f "$MOTION_FILE" ]]; then
    die "Motion file not found: $MOTION_FILE"
fi

if [[ "$TELEOP_MODE" == "offline" && "$MODE" == "real" ]]; then
    die "Offline motion playback is only supported in simulation mode."
fi

# ============================================================================
# SUMMARY
# ============================================================================

echo ""
echo "=========================================="
echo " TWIST2 Data Collection"
echo "=========================================="
echo "  Mode:        $MODE"
echo "  Teleop:      $TELEOP_MODE"
echo "  Device:      $DEVICE"
echo "  Checkpoint:  $(basename "$CKPT_PATH")"
echo "  Redis:       $REDIS_IP"
if [[ "$MODE" == "real" ]]; then
    echo "  Net iface:   $NET_IFACE"
    echo "  Robot IP:    $ROBOT_IP"
fi
if [[ "$TELEOP_MODE" == "offline" ]]; then
    echo "  Motion file: $(basename "$MOTION_FILE")"
else
    echo "  Human height: ${HUMAN_HEIGHT}m"
fi
echo "  Recording:   $DO_RECORD (${RECORD_FREQ}Hz)"
echo "=========================================="
echo ""

# ============================================================================
# 1. REDIS
# ============================================================================

log_step "Checking Redis..."
if command -v redis-cli &>/dev/null && redis-cli -h "$REDIS_IP" ping &>/dev/null; then
    log_info "Redis is running on $REDIS_IP"
else
    if [[ "$REDIS_IP" == "localhost" || "$REDIS_IP" == "127.0.0.1" ]]; then
        log_warn "Redis not responding. Attempting to start..."
        sudo systemctl start redis-server || die "Failed to start Redis"
        sleep 1
        redis-cli ping &>/dev/null || die "Redis failed to start"
        log_info "Redis started"
    else
        die "Cannot reach Redis at $REDIS_IP. Ensure it is running on the remote host."
    fi
fi

# ============================================================================
# 2. LOW-LEVEL CONTROLLER
# ============================================================================

log_step "Starting low-level controller ($MODE)..."

if [[ "$MODE" == "sim" ]]; then
    (
        source "$VENV_TWIST2/bin/activate"
        cd "$TWIST2_DIR/deploy_real"
        exec python server_low_level_g1_sim.py \
            --xml ../assets/g1/g1_sim2sim_29dof.xml \
            --policy "$CKPT_PATH" \
            --device "$DEVICE" \
            --measure_fps 1 \
            --policy_frequency 100 \
            --limit_fps 1
    ) &
    PIDS+=($!)
    log_info "Sim controller started (PID ${PIDS[-1]})"

elif [[ "$MODE" == "real" ]]; then
    (
        source "$VENV_TWIST2/bin/activate"
        cd "$TWIST2_DIR/deploy_real"
        exec python server_low_level_g1_real.py \
            --policy "$CKPT_PATH" \
            --net "$NET_IFACE" \
            --device "$DEVICE" \
            --use_hand \
            --hand_type inspire \
            --use_arm_sdk
    ) &
    PIDS+=($!)
    log_info "Real controller started (PID ${PIDS[-1]})"
fi

# Give the low-level controller time to initialize
sleep 3

# ============================================================================
# 3. HIGH-LEVEL: TELEOP or MOTION SERVER
# ============================================================================

if [[ "$TELEOP_MODE" == "online" ]]; then
    log_step "Starting VR teleop (GMR retargeting)..."
    (
        source "$VENV_GMR/bin/activate"
        cd "$TWIST2_DIR/deploy_real"
        exec python xrobot_teleop_to_robot_w_hand.py \
            --robot unitree_g1 \
            --actual_human_height "$HUMAN_HEIGHT" \
            --redis_ip "$REDIS_IP" \
            --target_fps 100 \
            --measure_fps 0
    ) &
    PIDS+=($!)
    log_info "VR teleop started (PID ${PIDS[-1]})"

elif [[ "$TELEOP_MODE" == "offline" ]]; then
    log_step "Starting offline motion server..."
    (
        source "$VENV_TWIST2/bin/activate"
        cd "$TWIST2_DIR/deploy_real"
        exec python server_motion_lib.py \
            --motion_file "$MOTION_FILE" \
            --robot unitree_g1_with_hands \
            --vis \
            --redis_ip "$REDIS_IP"
    ) &
    PIDS+=($!)
    log_info "Motion server started (PID ${PIDS[-1]})"
fi

# ============================================================================
# 4. DATA RECORDER
# ============================================================================

if [[ "$DO_RECORD" == true ]]; then
    sleep 2
    log_step "Starting data recorder (${RECORD_FREQ}Hz)..."

    RECORD_ARGS=(--frequency "$RECORD_FREQ" --robot_ip "$ROBOT_IP" --redis_ip "$REDIS_IP" --data_folder "$SCRIPT_DIR/datasets")
    if [[ "$MODE" == "sim" ]]; then
        RECORD_ARGS+=(--sim)
    fi

    (
        source "$VENV_TWIST2/bin/activate"
        cd "$TWIST2_DIR/deploy_real"
        exec python server_data_record.py "${RECORD_ARGS[@]}"
    ) &
    PIDS+=($!)
    log_info "Data recorder started (PID ${PIDS[-1]})"
else
    log_info "Data recording is disabled"
fi

# ============================================================================
# RUNNING
# ============================================================================

echo ""
log_info "All services running. Press Ctrl+C to stop."
echo ""

# Wait for any child to exit
wait -n "${PIDS[@]}" 2>/dev/null || true
log_warn "A service exited. Shutting down..."
