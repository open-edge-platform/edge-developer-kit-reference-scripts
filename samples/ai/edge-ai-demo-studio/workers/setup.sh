#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../logs/setup"
# Shared with ../setup.sh when it runs this, so cleanup_old_logs finds the
# parent's logs and leaves them alone.
TIMESTAMP="${EADS_SETUP_TIMESTAMP:-$(date +%Y%m%d_%H%M%S)}"

THIRDPARTY_DIR="$SCRIPT_DIR/thirdparty"
ROOT_THIRDPARTY_DIR="$SCRIPT_DIR/../thirdparty"

# Checked downloads and install manifests: scripts/bash/ in the repo, scripts/ in a packaged build.
for helper_dir in "$SCRIPT_DIR/../scripts/bash" "$SCRIPT_DIR/../scripts"; do
    if [ -f "$helper_dir/thirdparty_integrity.sh" ]; then
        # shellcheck source=SCRIPTDIR/../scripts/bash/thirdparty_integrity.sh
        source "$helper_dir/thirdparty_integrity.sh"
        break
    fi
done
if ! command -v install_verified_archive >/dev/null 2>&1; then
    echo "❌ ERROR: thirdparty_integrity.sh not found next to the project's setup scripts."
    exit 1
fi

# Each download is checked against the SHA-256 beside its URL (see thirdparty_integrity.sh). Moving
# to another release means updating both, from the project's own checksum list where it has one.
# Another uv release writes uv.lock differently when it re-locks, so a copy from any other download
# is replaced.
UV_ZIP_URL="https://releases.astral.sh/github/uv/releases/download/0.13.7/uv-x86_64-unknown-linux-gnu.tar.gz"
# From the release's uv-x86_64-unknown-linux-gnu.tar.gz.sha256
UV_SHA256="c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83"
UV_DIR="$THIRDPARTY_DIR/uv"
UV_PATH="$UV_DIR/uv"

OVMS_ZIP_URL_UBUNTU24="https://github.com/openvinotoolkit/model_server/releases/download/v2026.4.1/ovms_ubuntu24_2026.4.1_python_off.tar.gz"
# GitHub's digest of the release asset
OVMS_SHA256_UBUNTU24="2b7198671a9e99e030b408601733fbd61798d8a741337c867b96eb41c295b3f8"
OVMS_DIR="$THIRDPARTY_DIR/ovms"
# Setup and ovms_prepare (worker-common.sh) install Jinja2 into it: the manifest leaves it out.
OVMS_EXCLUDE="lib/python"

FFMPEG_DIR="$ROOT_THIRDPARTY_DIR/ffmpeg"
FFMPEG_PATH="$FFMPEG_DIR/bin/ffmpeg"

export UV_EXE="$UV_PATH"

cleanup_old_logs() {
    if [ -d "$LOG_DIR" ]; then
        # Logs with this run's timestamp mean a parent setup is running: keep its log.
        local current_timestamp_logs
        current_timestamp_logs=$(find "$LOG_DIR" -name "*_${TIMESTAMP}.log" 2>/dev/null | wc -l)
        if [ "$current_timestamp_logs" -eq 0 ]; then
            echo "Cleaning up old setup logs..."
            rm -f "$LOG_DIR"/*_*.log
            echo "Old logs removed."
        else
            echo "Skipping log cleanup (running as part of main setup)"
        fi
    fi
}

setup_logging() {
    mkdir -p "$LOG_DIR"
    cleanup_old_logs
    if [[ $VERBOSE -eq 0 ]]; then
        echo "Detailed logs will be written to: $LOG_DIR"
    fi
}

get_service_log() {
    local service_name="$1"
    echo "$LOG_DIR/${service_name}_${TIMESTAMP}.log"
}

# show_log_tail <log> -- the end of a step's own log, so its error also shows wherever this
# script's output goes (the Workers log, when the main setup runs it).
show_log_tail() {
    echo "--- Last lines of $1 ---"
    tail -n 20 "$1"
    echo "------------------------------------"
}

check_uv_installed() {
    echo "Checking if uv is installed..."

    local uv_log_file
    uv_log_file="$(get_service_log "uv")"
    echo "=== UV Setup Log - $(date) ===" > "$uv_log_file"

    if ! install_verified_archive "uv" "$UV_ZIP_URL" "$UV_SHA256" "$UV_DIR" 2>&1 | tee -a "$uv_log_file"; then
        echo "❌ ERROR: Failed to install uv"
        echo "Check log file: $uv_log_file"
        exit 1
    fi

    if "$UV_PATH" --version >/dev/null 2>&1; then
        echo "✅ uv is ready."
        echo "UV setup completed successfully at $(date)" >> "$uv_log_file"
        return 0
    else
        echo "❌ ERROR: Failed to download/extract uv."
        echo "Please manually download uv from: https://github.com/astral-sh/uv/releases"
        echo "Extract uv to: $SCRIPT_DIR/thirdparty/uv/"
        echo "UV setup failed at $(date)" >> "$uv_log_file"
        exit 1
    fi
}

get_thirdparty_dependencies() {
    echo "Creating thirdparty directory..."
    if ! mkdir -p "$THIRDPARTY_DIR"; then
        echo "❌ ERROR: Failed to create thirdparty directory"
        exit 1
    fi

    # Only Ubuntu 24's build is pinned; it matters only when there is something to download.
    if ! check_install "$OVMS_DIR" "$OVMS_SHA256_UBUNTU24" quick >/dev/null; then
        UBUNTU_VERSION="$(lsb_release -rs | cut -d. -f1)"
        if [ "$UBUNTU_VERSION" != "24" ]; then
            echo "❌ ERROR: Unsupported Ubuntu version: $UBUNTU_VERSION. Only 24 is supported."
            exit 1
        fi
    fi

    # Replaced unless intact and from this download: a new one is extracted beside it, so a
    # failure leaves it usable.
    local ovms_log_file
    ovms_log_file="$(get_service_log "ovms")"
    echo "=== OVMS Setup Log - $(date) ===" > "$ovms_log_file"
    if ! install_verified_archive --exclude "$OVMS_EXCLUDE" "OpenVINO Model Server" \
        "$OVMS_ZIP_URL_UBUNTU24" "$OVMS_SHA256_UBUNTU24" "$OVMS_DIR" 2>&1 | tee -a "$ovms_log_file"; then
        echo "❌ ERROR: Failed to install OVMS"
        echo "Check log file: $ovms_log_file"
        exit 1
    fi
    echo "OVMS setup completed successfully at $(date)" >> "$ovms_log_file"

    # OVMS needs these in its own Python directory for chat templates.
    local ovms_lib_python="$OVMS_DIR/lib/python"
    if [ ! -d "$ovms_lib_python/jinja2" ] || [ ! -d "$ovms_lib_python/markupsafe" ]; then
        echo "Installing OVMS template dependencies..."
        "$UV_PATH" pip install --target "$ovms_lib_python" "Jinja2==3.1.6" "MarkupSafe==3.0.2"
    fi

    if [ ! -x "$FFMPEG_PATH" ]; then
        echo "⚠️  WARNING: FFmpeg not found at $FFMPEG_PATH"
        echo "FFmpeg should be installed by the main setup.sh script at the project root."
        echo "If you're running workers/setup.sh directly, please run setup.sh from the project root first."
    else
        echo "✅ FFmpeg found at $FFMPEG_PATH"
    fi
}

setup_workers() {
    if [[ $SKIP_STT -eq 1 || $SKIP_TTS -eq 1 || $SKIP_LLM -eq 1 || $SKIP_EMBEDDING -eq 1 ]]; then
        echo "NOTE: --skip flags have no effect; service dependencies are installed on first start."
    fi

    # With --continue-on-error a failed step doesn't stop the next one; the
    # function still returns non-zero at the end.
    local failed=0
    local started=$SECONDS

    echo "Syncing shared worker packages into workers/.venv..."
    local ws_log
    ws_log="$(get_service_log "workspace")"
    echo "=== Shared Worker Sync Log - $(date) ===" > "$ws_log"
    if [[ $VERBOSE -eq 1 ]]; then
        if "$UV_PATH" sync --frozen --inexact --project "$SCRIPT_DIR" \
            --package worker-common --package model-downloader --package helper 2>&1 | tee -a "$ws_log"; then
            rc=0
        else
            rc=${PIPESTATUS[0]}
        fi
    else
        echo "Output is being logged to: $ws_log"
        if "$UV_PATH" sync --frozen --inexact --project "$SCRIPT_DIR" \
            --package worker-common --package model-downloader --package helper >> "$ws_log" 2>&1; then
            rc=0
        else
            rc=$?
        fi
    fi
    if [ "$rc" -eq 0 ]; then
        echo "✅ Shared worker environment ready: $SCRIPT_DIR/.venv ($((SECONDS - started))s)"
    else
        echo "❌ Shared worker sync failed (exit $rc). See $ws_log"
        [[ $VERBOSE -eq 1 ]] || show_log_tail "$ws_log"
        failed=1
        [[ $CONTINUE_ON_ERROR -eq 1 ]] || return 1
    fi
    # Engine binaries are shared third-party assets. The engine's Python
    # package is installed by its start script when the user selects it.
    if [ -f "$SCRIPT_DIR/engines/setup.sh" ]; then
        local engine_log
        engine_log="$(get_service_log "engines")"
        echo "=== Engine Setup Log - $(date) ===" > "$engine_log"
        echo "Setting up engine binaries..."
        started=$SECONDS
        if [[ $VERBOSE -eq 1 ]]; then
            if bash "$SCRIPT_DIR/engines/setup.sh" 2>&1 | tee -a "$engine_log"; then
                echo "✅ Engine binaries ready ($((SECONDS - started))s)"
            else
                echo "❌ Engine setup failed. See $engine_log"
                failed=1
            fi
        else
            echo "Output is being logged to: $engine_log"
            if bash "$SCRIPT_DIR/engines/setup.sh" >> "$engine_log" 2>&1; then
                echo "✅ Engine binaries ready ($((SECONDS - started))s)"
            else
                echo "❌ Engine setup failed. See $engine_log"
                show_log_tail "$engine_log"
                failed=1
            fi
        fi
    fi
    if [[ $failed -ne 0 ]]; then
        return 1
    fi
    echo "Shared third-party tools and worker environment are ready. Service dependencies install on first start."
}

main() {
    echo "=== Workers Setup ==="
    
    setup_logging

    cd "$SCRIPT_DIR"
    check_uv_installed

    export UV_PATH

    get_thirdparty_dependencies
    if [[ $SETUP_WORKERS -eq 1 ]]; then
        setup_workers
    else
        echo "Shared third-party tools are ready. Use --setup-workers to create the shared environment."
    fi
}

# --- Argument parsing ---

SKIP_STT=0
SKIP_EMBEDDING=0
SKIP_LLM=0
SKIP_TTS=0
VERBOSE=0
SETUP_WORKERS=0
CONTINUE_ON_ERROR=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-stt)
            SKIP_STT=1
            shift
            ;;
        --skip-embedding)
            SKIP_EMBEDDING=1
            shift
            ;;
        --skip-llm)
            SKIP_LLM=1
            shift
            ;;
        --skip-tts)
            SKIP_TTS=1
            shift
            ;;
        --verbose)
            VERBOSE=1
            shift
            ;;
        --setup-workers)
            SETUP_WORKERS=1
            shift
            ;;
        --continue-on-error)
            CONTINUE_ON_ERROR=1
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--skip-stt] [--skip-embedding] [--skip-llm] [--skip-tts] [--verbose] [--setup-workers] [--continue-on-error]"
            exit 1
            ;;
    esac
done

main
