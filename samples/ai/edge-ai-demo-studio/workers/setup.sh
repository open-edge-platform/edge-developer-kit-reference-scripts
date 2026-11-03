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
UV_ZIP_PATH="$THIRDPARTY_DIR/uv.zip"
UV_ZIP_URL="https://releases.astral.sh/github/uv/releases/download/0.13.3/uv-x86_64-unknown-linux-gnu.tar.gz"
UV_DIR="$THIRDPARTY_DIR/uv"
UV_PATH="$UV_DIR/uv"

OVMS_ZIP_PATH="$THIRDPARTY_DIR/ovms.tar.gz"
OVMS_ZIP_URL_UBUNTU24="https://github.com/openvinotoolkit/model_server/releases/download/v2026.4.0/ovms_ubuntu24_2026.4.0_python_off.tar.gz"
OVMS_DIR="$THIRDPARTY_DIR/ovms"

FFMPEG_DIR="$ROOT_THIRDPARTY_DIR/ffmpeg"
FFMPEG_PATH="$FFMPEG_DIR/bin/ffmpeg"

export UV_EXE="$UV_PATH"

cleanup_temp_files() {
    rm -f "$UV_ZIP_PATH" "$OVMS_ZIP_PATH" 2>/dev/null
}
trap cleanup_temp_files EXIT INT TERM

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

check_uv_installed() {
    echo "Checking if uv is installed..."
    # Another uv release writes uv.lock differently when it re-locks, so replace a copy that isn't the pinned one.
    local pinned="${UV_ZIP_URL#*/download/}"
    pinned="${pinned%%/*}"
    if [ -x "$UV_PATH" ]; then
        local installed
        installed="$("$UV_PATH" --version 2>/dev/null)" || installed=""
        installed="$(echo "$installed" | cut -d' ' -f2)"
        if [ "$installed" = "$pinned" ]; then
            echo "✅ uv $installed found in thirdparty folder."
            return 0
        elif [ -n "$installed" ]; then
            echo "uv $installed in thirdparty folder is not the pinned $pinned. Downloading $pinned..."
        else
            # Usually a download or extract that was cut short.
            echo "⚠️  uv binary in thirdparty folder is not working. Downloading it again..."
        fi
        rm -rf "$UV_DIR"
    else
        echo "uv is not installed. Downloading uv binary..."
    fi
    
    local uv_log_file
    uv_log_file="$(get_service_log "uv")"
    echo "=== UV Setup Log - $(date) ===" > "$uv_log_file"
    
    if ! mkdir -p "$THIRDPARTY_DIR"; then
        echo "❌ ERROR: Failed to create thirdparty directory"
        exit 1
    fi
    
    if ! mkdir -p "$UV_DIR"; then
        echo "❌ ERROR: Failed to create UV directory"
        exit 1
    fi
    
    echo "Downloading uv from $UV_ZIP_URL..."
    if [[ $VERBOSE -eq 1 ]]; then
        if ! wget -O "$UV_ZIP_PATH" "$UV_ZIP_URL" 2>&1 | tee -a "$uv_log_file"; then
            echo "❌ ERROR: Failed to download uv from $UV_ZIP_URL"
            exit 1
        fi
    else
        if ! wget -q -O "$UV_ZIP_PATH" "$UV_ZIP_URL" >> "$uv_log_file" 2>&1; then
            echo "❌ ERROR: Failed to download uv"
            echo "Check log file: $uv_log_file"
            exit 1
        fi
    fi
    
    echo "Extracting uv binary..."
    if [[ $VERBOSE -eq 1 ]]; then
        if ! tar --strip-components=1 -xzf "$UV_ZIP_PATH" -C "$UV_DIR" 2>&1 | tee -a "$uv_log_file"; then
            echo "❌ ERROR: Failed to extract uv archive"
            rm -f "$UV_ZIP_PATH"
            exit 1
        fi
    else
        if ! tar --strip-components=1 -xzf "$UV_ZIP_PATH" -C "$UV_DIR" >> "$uv_log_file" 2>&1; then
            echo "❌ ERROR: Failed to extract uv archive"
            echo "Check log file: $uv_log_file"
            rm -f "$UV_ZIP_PATH"
            exit 1
        fi
    fi
    
    rm -f "$UV_ZIP_PATH"
    
    if "$UV_PATH" --version >/dev/null 2>&1; then
        echo "✅ uv is successfully downloaded and extracted."
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

# The version setup recorded when it installed OVMS, else the one the package
# reports in its metadata ("2026.2.0.5e9dcfc46"); empty when neither exists.
installed_ovms_version() {
    if [ -f "$OVMS_DIR/.installed-version" ]; then
        cat "$OVMS_DIR/.installed-version"
    elif [ -f "$OVMS_DIR/metadata.json" ]; then
        sed -n 's/.*"PROJECT_VERSION": *"\([^"]*\)".*/\1/p' "$OVMS_DIR/metadata.json"
    fi
}

get_thirdparty_dependencies() {
    echo "Creating thirdparty directory..."
    if ! mkdir -p "$THIRDPARTY_DIR"; then
        echo "❌ ERROR: Failed to create thirdparty directory"
        exit 1
    fi

    # The OVMS URL pins the wanted version; an install of any other version is replaced.
    local ovms_wanted ovms_installed=""
    ovms_wanted="$(sed -E 's/.*_([0-9]+\.[0-9]+\.[0-9]+)_python.*/\1/' <<< "$OVMS_ZIP_URL_UBUNTU24")"
    if [ -d "$OVMS_DIR" ]; then
        ovms_installed="$(installed_ovms_version)"
    fi

    if [ -n "$ovms_installed" ] && [[ "$ovms_installed" == "$ovms_wanted" || "$ovms_installed" == "$ovms_wanted".* ]]; then
        echo "✅ OVMS $ovms_installed already installed. Skipping download."
    else
        if [ -d "$OVMS_DIR" ]; then
            echo "Replacing OVMS ${ovms_installed:-(unknown version)} with $ovms_wanted..."
        else
            echo "Downloading OpenVINO Model Server for Linux..."
        fi

        local ovms_log_file
        ovms_log_file="$(get_service_log "ovms")"
        echo "=== OVMS Setup Log - $(date) ===" > "$ovms_log_file"
        
        UBUNTU_VERSION="$(lsb_release -rs | cut -d. -f1)"
        if [ "$UBUNTU_VERSION" = "24" ]; then
            OVMS_ZIP_URL="$OVMS_ZIP_URL_UBUNTU24"
        else
            echo "❌ ERROR: Unsupported Ubuntu version: $UBUNTU_VERSION. Only 24 is supported."
            exit 1
        fi
        
        echo "Downloading from $OVMS_ZIP_URL..."
        if [[ $VERBOSE -eq 1 ]]; then
            if ! wget -O "$OVMS_ZIP_PATH" "$OVMS_ZIP_URL" 2>&1 | tee -a "$ovms_log_file"; then
                echo "❌ ERROR: Failed to download OVMS"
                exit 1
            fi
        else
            if ! wget -q -O "$OVMS_ZIP_PATH" "$OVMS_ZIP_URL" >> "$ovms_log_file" 2>&1; then
                echo "❌ ERROR: Failed to download OVMS"
                echo "Check log file: $ovms_log_file"
                exit 1
            fi
        fi
        
        # Extract beside the current install so a failure leaves it usable.
        local ovms_staging="$OVMS_DIR.new"
        rm -rf "$ovms_staging"
        if ! mkdir -p "$ovms_staging"; then
            echo "❌ ERROR: Failed to create OVMS directory"
            rm -f "$OVMS_ZIP_PATH"
            exit 1
        fi

        echo "Extracting OVMS..."
        if [[ $VERBOSE -eq 1 ]]; then
            if ! tar -xzf "$OVMS_ZIP_PATH" -C "$ovms_staging" --strip-components=1 2>&1 | tee -a "$ovms_log_file"; then
                echo "❌ ERROR: Failed to extract OVMS archive"
                rm -rf "$OVMS_ZIP_PATH" "$ovms_staging"
                exit 1
            fi
        else
            if ! tar -xzf "$OVMS_ZIP_PATH" -C "$ovms_staging" --strip-components=1 >> "$ovms_log_file" 2>&1; then
                echo "❌ ERROR: Failed to extract OVMS archive"
                echo "Check log file: $ovms_log_file"
                rm -rf "$OVMS_ZIP_PATH" "$ovms_staging"
                exit 1
            fi
        fi

        rm -f "$OVMS_ZIP_PATH"
        rm -rf "$OVMS_DIR"
        mv "$ovms_staging" "$OVMS_DIR"
        echo "$ovms_wanted" > "$OVMS_DIR/.installed-version"
        echo "✅ OVMS $ovms_wanted downloaded and extracted successfully."
        echo "OVMS setup completed successfully at $(date)" >> "$ovms_log_file"
    fi

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
        echo "✅ Shared worker environment ready: $SCRIPT_DIR/.venv"
    else
        echo "❌ Shared worker sync failed (exit $rc). See $ws_log"
        failed=1
        [[ $CONTINUE_ON_ERROR -eq 1 ]] || return 1
    fi
    # Engine binaries are shared third-party assets. The engine's Python
    # package is installed by its start script when the user selects it.
    if [ -f "$SCRIPT_DIR/engines/setup.sh" ]; then
        local engine_log
        engine_log="$(get_service_log "engines")"
        echo "=== Engine Setup Log - $(date) ===" > "$engine_log"
        if [[ $VERBOSE -eq 1 ]]; then
            if ! bash "$SCRIPT_DIR/engines/setup.sh" 2>&1 | tee -a "$engine_log"; then
                echo "❌ Engine setup failed. See $engine_log"
                failed=1
            fi
        else
            bash "$SCRIPT_DIR/engines/setup.sh" >> "$engine_log" 2>&1 || {
                echo "❌ Engine setup failed. See $engine_log"
                failed=1
            }
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
