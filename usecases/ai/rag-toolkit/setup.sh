#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -eou pipefail

# Constants
VENV_PATH="./.venv"
MODEL_PATH="./data/models"
DEFAULT_MODEL_ID="Qwen/Qwen2.5-7B-Instruct"
RENDER_GROUP_ID=$(getent group render | cut -d: -f3)
export RENDER_GROUP_ID

# Install dependencies
install_dependencies(){
    echo -e "Installing dependencies ..."
    sudo apt-get update
    sudo apt-get install -y python3-pip \
        python3-venv
}

# Create env and download model file
install_python_dependencies(){
    echo -e "Installing Python dependencies ..."
    python3 -m pip install --extra-index-url https://download.pytorch.org/whl/cpu \
        openvino==2025.3 \
        "optimum-intel[openvino,nncf]==1.26.1" 
}

# Validate docker installation
validate_docker_installation(){
    echo -e "Validating Docker installation ..."
    if ! command -v docker &> /dev/null
    then
        echo -e "Docker could not be found. Please install Docker to proceed."
        exit 1
    fi
}

# Check if python env is available
validate_and_activate_python_venv_available(){
    echo -e "Checking virtual environment availability ..."
    if [ ! -d "$VENV_PATH" ]; then
        echo -e "Python virtual environment not found. Creating a new one..."
        python3 -m venv "$VENV_PATH"
        # shellcheck source=/dev/null
        source "$VENV_PATH/bin/activate"
        python3 -m pip install --upgrade pip
        install_python_dependencies
    fi
    # shellcheck source=/dev/null
    source "$VENV_PATH/bin/activate"
}

# Check if LLM model available
validate_model_path(){
    # shellcheck source=/dev/null
    source "$VENV_PATH/bin/activate"
    echo -e "Checking model availability ..."
    if [ ! -f "$MODEL_PATH/llm/openvino_model.xml" ]; then
        echo -e "Model not found. Downloading default model ..."
        if ! optimum-cli export openvino \
            --model $DEFAULT_MODEL_ID \
            --weight-format int4 \
            --sym \
            --ratio 1.0 \
            --group-size -1 \
            "$MODEL_PATH/llm"; then
            echo -e "Failed to downloaded & converted model. Please check your internet connection."
            exit 1
        fi
    fi
}

# Check if embedding model available
validate_embedding_model(){
    echo -e "Checking embedding model availability ..."
    if [ ! -d "$MODEL_PATH/embeddings" ]; then
        echo -e "Embedding model not found. Downloading default model ..."
        if ! optimum-cli export openvino \
            --model BAAI/bge-large-en-v1.5 \
            --task feature-extraction \
            --weight-format fp16 \
            "$MODEL_PATH/embeddings/bge-large-en-v1.5"; then
            echo -e "Failed to downloaded & converted embedding model. Please check your internet connection."
            exit 1
        fi
    fi
}

# Check if reranker model available
validate_reranker_model(){
    echo -e "Checking reranker model availability ..."
    if [ ! -d "$MODEL_PATH/reranker" ]; then
        echo -e "Reranker model not found. Downloading default model ..."
        if ! optimum-cli export openvino \
            --model BAAI/bge-reranker-large \
            --task text-classification \
            --weight-format fp16 \
            "$MODEL_PATH/reranker/bge-reranker-large"; then
            echo -e "Failed to downloaded & converted reranker model. Please check your internet connection."
            exit 1
        fi
    fi
}

# Build application image
build_application_image(){
    echo -e "Building application images ..."
    docker compose build
}

# Start application image
start_application_image(){
    echo -e "Starting application images ..."
    docker compose up -d
}

main(){
    validate_docker_installation
    validate_and_activate_python_venv_available
    validate_model_path
    validate_embedding_model
    validate_reranker_model
    build_application_image
    start_application_image
}

main
