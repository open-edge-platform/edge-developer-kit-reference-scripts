#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_DIR="$(dirname "$SCRIPT_DIR")"
WORKERS_THIRDPARTY_DIR="$WORKERS_DIR/thirdparty"
UV_CMD="$WORKERS_THIRDPARTY_DIR/uv/uv"
HOME_DIR="$(dirname "$WORKERS_DIR")"

OVMS_PID=""

prepare_model() {
    echo "Downloading and exporting models for Robotics AI samples ..."
    local model_dir="$HOME_DIR/models/multiserve/text-generation/OV/text_generation"
    local config_dir
    config_dir=$(dirname "$model_dir")

    cd "$SCRIPT_DIR"
    if [ ! -d ".export-venv" ]; then
        "$UV_CMD" venv --python=3.12 .export-venv
    fi
    
    # shellcheck source=/dev/null
    source .export-venv/bin/activate

    cd "$HOME_DIR"
    "$UV_CMD" pip install -r https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/tags/v2025.4.1/demos/common/export_models/requirements.txt --index-strategy unsafe-best-match
    mkdir -p "$model_dir"
    mkdir -p thirdparty/ovms
    curl https://raw.githubusercontent.com/openvinotoolkit/model_server/refs/heads/releases/2025/4/demos/common/export_models/export_model.py -o thirdparty/ovms/export_model.py
    rm -f "$config_dir/config.json" || true
    hf download Qwen/Qwen3-4B-Instruct-2507
    optimum-cli export openvino -m Qwen/Qwen3-4B-Instruct-2507 --weight-format int4 "$model_dir/Qwen/Qwen3-4B-Instruct-2507"
    python3 thirdparty/ovms/export_model.py text_generation --source_model Qwen/Qwen3-4B-Instruct-2507 --weight-format int4 --pipeline_type LM --enable_prefix_caching --model_name Qwen/Qwen3-4B-Instruct-2507 --config_file_path "$config_dir/config.json" --model_repository_path "$model_dir" --tool_parser hermes3 --cache_size 4 --target_device GPU  --extra_quantization_params "--sym --group-size 128 --ratio 1.0"
    python3 thirdparty/ovms/export_model.py text_generation --source_model OpenGVLab/InternVL3-2B --weight-format int4 --pipeline_type VLM --enable_prefix_caching --model_name OpenGVLab/InternVL3-2B --config_file_path "$config_dir/config.json" --model_repository_path "$model_dir" --cache_size 4 --target_device GPU
    cat "$config_dir/config.json"
    deactivate

    cd "$SCRIPT_DIR"
    echo "Model preparation completed."
}

install_xpu_smi() {
    echo "Checking and installing XPU SMI if necessary ..."
    local XPU_SMI_RELEASE_URL="https://github.com/intel/xpumanager/releases/download/v1.3.5/xpu-smi_1.3.5_20251216.170635.605ff78d.u24.04_amd64.deb"
    local XPU_SMI_DOWNLOAD_FILE="xpu-smi.deb"

    if command -v xpu-smi &> /dev/null; then
        echo "XPU SMI is already installed."
        return 0
    fi

    wget "$XPU_SMI_RELEASE_URL" -O "$XPU_SMI_DOWNLOAD_FILE"
    sudo dpkg -i "$XPU_SMI_DOWNLOAD_FILE"
    rm -f "$XPU_SMI_DOWNLOAD_FILE"
    echo "XPU SMI installation completed."
}

cleanup() {
    if [ -n "$OVMS_PID" ] && kill -0 "$OVMS_PID" 2>/dev/null; then
        echo "Stopping OVMS (PID $OVMS_PID) ..."
        kill "$OVMS_PID"
        wait "$OVMS_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT INT TERM

free_port() {
    local port="$1"
    local existing_pid
    existing_pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    if [ -n "$existing_pid" ]; then
        echo "Port $port is in use by PID $existing_pid. Killing it ..."
        kill "$existing_pid" 2>/dev/null || true
        # Wait until the port is actually free (up to 5 s)
        local waited=0
        while lsof -ti tcp:"$port" >/dev/null 2>&1; do
            if [ "$waited" -ge 5 ]; then
                echo "WARNING: Port $port still in use after ${waited}s; proceeding anyway."
                break
            fi
            sleep 1
            waited=$((waited + 1))
        done
        echo "Port $port is now free."
    fi
}

start_ovms_background() {
    echo "Starting OVMS in the background ..."
    local model_dir="$HOME_DIR/models/multiserve/text-generation/OV/text_generation"
    local config_dir
    config_dir=$(dirname "$model_dir")/config.json

    if [ ! -f "$config_dir" ]; then
        echo "ERROR: OVMS configuration file not found at $config_dir"
        echo "Please run the workers setup script first."
        exit 1
    fi

    free_port 8025

    # Start OVMS in the background
    export LD_LIBRARY_PATH=$WORKERS_THIRDPARTY_DIR/ovms/lib
    export PATH=$PATH:$WORKERS_THIRDPARTY_DIR/ovms/bin
    export PYTHONPATH=$WORKERS_THIRDPARTY_DIR/ovms/lib/python
    echo "OVMS environment variables set. Starting OVMS with config at $config_dir ..."
    ovms --rest_port 8025 --config_path "$config_dir" &
    OVMS_PID=$!
    echo "OVMS started in the background (PID $OVMS_PID). Logs are being written to $WORKERS_DIR/ovms.log"
}

main() {
    cd "$SCRIPT_DIR"
    prepare_model
    install_xpu_smi
    start_ovms_background
    "$UV_CMD" run main.py "$@"
}

main "$@"
