#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

set -euo pipefail

# Variables
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../logs/setup"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

THIRDPARTY_DIR="$SCRIPT_DIR/thirdparty"
ROOT_THIRDPARTY_DIR="$SCRIPT_DIR/../thirdparty"
UV_ZIP_PATH="$THIRDPARTY_DIR/uv.zip"
UV_ZIP_URL="https://github.com/astral-sh/uv/releases/download/0.8.13/uv-x86_64-unknown-linux-gnu.tar.gz"
UV_DIR="$THIRDPARTY_DIR/uv"
UV_PATH="$UV_DIR/uv"

OVMS_ZIP_PATH="$THIRDPARTY_DIR/ovms.tar.gz"
OVMS_ZIP_URL_UBUNTU22="https://github.com/openvinotoolkit/model_server/releases/download/v2025.3/ovms_ubuntu22_python_on.tar.gz"
OVMS_ZIP_URL_UBUNTU24="https://github.com/openvinotoolkit/model_server/releases/download/v2025.3/ovms_ubuntu24_python_on.tar.gz"
OVMS_DIR="$THIRDPARTY_DIR/ovms"

# FFmpeg is installed at project root thirdparty directory
FFMPEG_DIR="$ROOT_THIRDPARTY_DIR/ffmpeg"
FFMPEG_PATH="$FFMPEG_DIR/bin/ffmpeg"

export UV_EXE="$UV_PATH"

# Function to cleanup old logs
cleanup_old_logs() {
    if [ -d "$LOG_DIR" ]; then
        # Check if there are any logs with current timestamp (means we're called from parent setup)
        # In that case, don't cleanup as it would delete the parent's log file
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

# Function to setup logging
setup_logging() {
    if [[ $VERBOSE -eq 0 ]]; then
        mkdir -p "$LOG_DIR"
        cleanup_old_logs
        echo "Detailed logs will be written to service-specific files in: $LOG_DIR"
    fi
}

# Function to get service-specific log file
get_service_log() {
    local service_name="$1"
    echo "$LOG_DIR/${service_name}_${TIMESTAMP}.log"
}

# Function to log messages
log_message() {
    local message="$1"
    if [[ $VERBOSE -eq 1 ]]; then
        echo "$message"
    else
        echo "$message"
        echo "$message" >> "$LOG_FILE"
    fi
}

# Function to check if uv is installed
check_uv_installed() {
    echo "Checking if uv is installed..."
    if [ -x "$UV_PATH" ]; then
        echo "✅ uv found in thirdparty folder."
        if "$UV_PATH" --version >/dev/null 2>&1; then
            return 0
        else
            echo "❌ ERROR: uv binary found but not working properly"
            exit 1
        fi
    fi
    echo "uv is not installed. Downloading uv binary..."
    
    local uv_log_file
    uv_log_file="$(get_service_log "uv")"
    if [[ $VERBOSE -eq 0 ]]; then
        echo "=== UV Setup Log - $(date) ===" > "$uv_log_file"
        echo "" >> "$uv_log_file"
        echo "Logging UV setup to: $uv_log_file"
    fi
    
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
        if ! wget -O "$UV_ZIP_PATH" "$UV_ZIP_URL"; then
            echo "❌ ERROR: Failed to download uv from $UV_ZIP_URL"
            echo "Please check your internet connection and try again."
            exit 1
        fi
    else
        if ! wget -q -O "$UV_ZIP_PATH" "$UV_ZIP_URL" 2>> "$uv_log_file"; then
            echo "❌ ERROR: Failed to download uv"
            echo "Check log file: $uv_log_file"
            exit 1
        fi
    fi
    
    echo "Extracting uv binary..."
    if [[ $VERBOSE -eq 1 ]]; then
        if ! tar --strip-components=1 -xzf "$UV_ZIP_PATH" -C "$UV_DIR"; then
            echo "❌ ERROR: Failed to extract uv archive"
            rm -f "$UV_ZIP_PATH"
            exit 1
        fi
    else
        if ! tar --strip-components=1 -xzf "$UV_ZIP_PATH" -C "$UV_DIR" 2>> "$uv_log_file"; then
            echo "❌ ERROR: Failed to extract uv archive"
            echo "Check log file: $uv_log_file"
            rm -f "$UV_ZIP_PATH"
            exit 1
        fi
    fi
    
    rm -f "$UV_ZIP_PATH"
    
    if "$UV_PATH" --version >/dev/null 2>&1; then
        echo "✅ uv is successfully downloaded and extracted."
        if [[ $VERBOSE -eq 0 ]]; then
            echo "UV setup completed successfully at $(date)" >> "$uv_log_file"
        fi
        return 0
    else
        echo "❌ ERROR: Failed to download/extract uv."
        echo "Please manually download uv from: https://github.com/astral-sh/uv/releases"
        echo "Extract uv to: $SCRIPT_DIR/thirdparty/uv/"
        if [[ $VERBOSE -eq 0 ]]; then
            echo "UV setup failed at $(date)" >> "$uv_log_file"
        fi
        exit 1
    fi
}

# Function to download third-party dependencies
get_thirdparty_dependencies() {
    echo "Creating thirdparty directory..."
    if ! mkdir -p "$THIRDPARTY_DIR"; then
        echo "❌ ERROR: Failed to create thirdparty directory"
        exit 1
    fi

    if [ -d "$OVMS_DIR" ]; then
        echo "✅ OVMS directory already exists. Skipping download."
    else
        echo "Downloading OpenVINO Model Server for Linux..."
        
        local ovms_log_file
        ovms_log_file="$(get_service_log "ovms")"
        if [[ $VERBOSE -eq 0 ]]; then
            echo "=== OVMS Setup Log - $(date) ===" > "$ovms_log_file"
            echo "" >> "$ovms_log_file"
            echo "Logging OVMS setup to: $ovms_log_file"
        fi
        
        # Detect Ubuntu version
        UBUNTU_VERSION="$(lsb_release -rs | cut -d. -f1)"
        if [ "$UBUNTU_VERSION" = "22" ]; then
            OVMS_ZIP_URL="$OVMS_ZIP_URL_UBUNTU22"
        elif [ "$UBUNTU_VERSION" = "24" ]; then
            OVMS_ZIP_URL="$OVMS_ZIP_URL_UBUNTU24"
        else
            echo "❌ ERROR: Unsupported Ubuntu version: $UBUNTU_VERSION. Only 22 and 24 are supported."
            exit 1
        fi
        
        echo "Downloading from $OVMS_ZIP_URL..."
        if [[ $VERBOSE -eq 1 ]]; then
            if ! wget -O "$OVMS_ZIP_PATH" "$OVMS_ZIP_URL"; then
                echo "❌ ERROR: Failed to download OVMS"
                exit 1
            fi
        else
            if ! wget -q -O "$OVMS_ZIP_PATH" "$OVMS_ZIP_URL" 2>> "$ovms_log_file"; then
                echo "❌ ERROR: Failed to download OVMS"
                echo "Check log file: $ovms_log_file"
                exit 1
            fi
        fi
        
        if ! mkdir -p "$OVMS_DIR"; then
            echo "❌ ERROR: Failed to create OVMS directory"
            rm -f "$OVMS_ZIP_PATH"
            exit 1
        fi
        
        echo "Extracting OVMS..."
        if [[ $VERBOSE -eq 1 ]]; then
            if ! tar -xzf "$OVMS_ZIP_PATH" -C "$OVMS_DIR" --strip-components=1; then
                echo "❌ ERROR: Failed to extract OVMS archive"
                rm -f "$OVMS_ZIP_PATH"
                exit 1
            fi
        else
            if ! tar -xzf "$OVMS_ZIP_PATH" -C "$OVMS_DIR" --strip-components=1 2>> "$ovms_log_file"; then
                echo "❌ ERROR: Failed to extract OVMS archive"
                echo "Check log file: $ovms_log_file"
                rm -f "$OVMS_ZIP_PATH"
                exit 1
            fi
        fi
        
        rm -f "$OVMS_ZIP_PATH"
        echo "✅ OVMS downloaded and extracted successfully."
        if [[ $VERBOSE -eq 0 ]]; then
            echo "OVMS setup completed successfully at $(date)" >> "$ovms_log_file"
        fi
    fi

    # Verify FFmpeg is available from project root (installed by main setup.sh)
    if [ ! -x "$FFMPEG_PATH" ]; then
        echo "⚠️  WARNING: FFmpeg not found at $FFMPEG_PATH"
        echo "FFmpeg should be installed by the main setup.sh script at the project root."
        echo "If you're running workers/setup.sh directly, please run setup.sh from the project root first."
    else
        echo "✅ FFmpeg found at $FFMPEG_PATH"
    fi
}

setup_workers() {
    # Discover all subdirectories with setup.sh files
    WORKER_DIRS=()
    while IFS= read -r -d '' dir; do
        if [ -f "$dir/setup.sh" ]; then
            WORKER_DIRS+=("$dir")
        fi
    done < <(find "$SCRIPT_DIR" -maxdepth 1 -type d ! -path "$SCRIPT_DIR" -print0)

    if [ ${#WORKER_DIRS[@]} -eq 0 ]; then
        echo "No worker directories with setup.sh found."
        exit 0
    fi

    # Determine skip mapping for known workers
    declare -A SKIP_MAP
    SKIP_MAP["speech-to-text"]=$SKIP_STT
    SKIP_MAP["embedding"]=$SKIP_EMBEDDING
    SKIP_MAP["text-generation"]=$SKIP_LLM
    SKIP_MAP["text-to-speech"]=$SKIP_TTS

    echo "Found worker directories:"
    for dir in "${WORKER_DIRS[@]}"; do
        name=$(basename "$dir")
        status=""
        if [[ ${SKIP_MAP[$name]:-0} -eq 1 ]]; then
            status=" (SKIPPED)"
        fi
        echo "  - $name$status"
    done
    echo "================="
    
    # Track setup results
    SUCCESSFUL_SETUPS=()
    FAILED_SETUPS=()
    SKIPPED_SETUPS=()
    
    for worker_dir in "${WORKER_DIRS[@]}"; do
        name=$(basename "$worker_dir")
        if [[ ${SKIP_MAP[$name]:-0} -eq 1 ]]; then
            echo "Skipping $name setup..."
            SKIPPED_SETUPS+=("$name")
            continue
        fi
        
        echo "Starting $name setup..."
        setup_script="$worker_dir/setup.sh"
        if [ ! -f "$setup_script" ]; then
            echo "Warning: setup.sh not found in $worker_dir, skipping..."
            FAILED_SETUPS+=("$name: setup.sh not found")
            if [[ $CONTINUE_ON_ERROR -ne 1 ]]; then
                echo "Setup failed for $name. Use --continue-on-error to continue with remaining workers."
                exit 1
            fi
            continue
        fi
        
        local worker_log_file
        worker_log_file="$(get_service_log "$name")"
        if [[ $VERBOSE -eq 1 ]]; then
            set +e 
            bash -x "$setup_script"
            rc=$?
            set -e  
        else
            echo "=== $name Worker Setup Log - $(date) ===" > "$worker_log_file"
            echo "" >> "$worker_log_file"
            echo "This may take several minutes depending on your internet connection..."
            echo "Use --verbose to see detailed output."
            echo "Output is being logged to: $worker_log_file"
            set +e  
            bash "$setup_script" >> "$worker_log_file" 2>&1
            rc=$?
            set -e  
        fi
        
        if [ $rc -eq 0 ]; then
            echo "✅ $name setup completed successfully!"
            SUCCESSFUL_SETUPS+=("$name")
            if [[ $VERBOSE -eq 0 ]]; then
                echo "$name setup completed successfully at $(date)" >> "$worker_log_file"
            fi
        else
            echo ""
            echo "╔════════════════════════════════════════════════════════════════╗"
            echo "║  ❌ WORKER SETUP FAILED: $name"
            echo "║  Exit Code: $rc"
            if [[ $VERBOSE -eq 0 ]]; then
                echo "║  Log File: $worker_log_file"
            fi
            echo "╚════════════════════════════════════════════════════════════════╝"
            echo ""
            
            FAILED_SETUPS+=("$name: failed with exit code $rc")
            if [[ $VERBOSE -eq 0 ]]; then
                echo "$name setup failed with exit code $rc at $(date)" >> "$worker_log_file"
                echo ""
                echo "To view the error details, run:"
                echo "  cat $worker_log_file"
                echo ""
            fi
            if [[ $CONTINUE_ON_ERROR -ne 1 ]]; then
                echo "Setup failed for $name. Use --continue-on-error to continue with remaining workers."
                exit 1
            else
                echo "⚠️  Setup failed for $name, but continuing with remaining workers..."
                echo ""
            fi
        fi
    done
    
    # Display summary
    echo ""
    echo "=== Setup Summary ==="
    
    if [ ${#SUCCESSFUL_SETUPS[@]} -gt 0 ]; then
        echo "✅ Successful setups (${#SUCCESSFUL_SETUPS[@]}):"
        for success in "${SUCCESSFUL_SETUPS[@]}"; do
            echo "  - $success"
        done
    fi
    
    if [ ${#FAILED_SETUPS[@]} -gt 0 ]; then
        echo "❌ Failed setups (${#FAILED_SETUPS[@]}):"
        for failure in "${FAILED_SETUPS[@]}"; do
            # Extract worker name from failure message
            worker_name=$(echo "$failure" | cut -d':' -f1)
            echo "  - $failure"
            if [[ $VERBOSE -eq 0 ]]; then
                local failed_log_file
                failed_log_file="$(get_service_log "$worker_name")"
                if [ -f "$failed_log_file" ]; then
                    echo "    Log: $failed_log_file"
                fi
            fi
        done
    fi
    
    if [ ${#SKIPPED_SETUPS[@]} -gt 0 ]; then
        echo "⏭️  Skipped setups (${#SKIPPED_SETUPS[@]}):"
        for skipped in "${SKIPPED_SETUPS[@]}"; do
            echo "  - $skipped"
        done
    fi
    
    echo "==================="
    
    # Final status
    if [ ${#FAILED_SETUPS[@]} -eq 0 ]; then
        echo "All worker setup processes completed successfully!"
        exit 0
    else
        echo "Some worker setups failed. Check the summary above for details."
        echo "Check individual service logs in $LOG_DIR for detailed error information."
        exit 1
    fi
}

main() {
    # Main script
    echo "=== Workers Setup ==="
    
    # Setup logging
    setup_logging

    cd "$SCRIPT_DIR"
    check_uv_installed

    # Temporarily add UV_PATH to environment
    export UV_PATH

    get_thirdparty_dependencies
    if [[ $SETUP_WORKERS -eq 1 ]]; then
        setup_workers
    else
        echo "Skipping worker setup (default). Use --setup-workers to enable."
    fi
}

# --- Argument parsing ---

# Default: skip worker setup unless --setup-workers is provided
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