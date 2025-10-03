#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Default values
port=5003
ovmsPort=5951
embeddingModelId=""
embeddingDevice="CPU"
rerankerModelId=""
rerankerDevice="CPU"

# Parse arguments
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --port)
      port="$2"
      shift
      shift
      ;;
    --ovms-port)
      ovmsPort="$2"
      shift
      shift
      ;;
    --embedding-model-id)
      embeddingModelId="$2"
      shift
      shift
      ;;
    --embedding-device)
      embeddingDevice="$2"
      shift
      shift
      ;;
    --reranker-model-id)
      rerankerModelId="$2"
      shift
      shift
      ;;
    --reranker-device)
      rerankerDevice="$2"
      shift
      shift
      ;;
    *)
      echo "Unknown parameter: $1"
      echo "Usage: $0 [--port PORT] [--ovms-port OVMS_PORT] --embedding-model-id EMBEDDING_MODEL --embedding-device DEVICE --reranker-model-id RERANKER_MODEL --reranker-device DEVICE"
      echo "Example: $0 --embedding-model-id OpenVINO/bge-base-en-v1.5-int8-ov --reranker-model-id OpenVINO/bge-reranker-base-int8-ov"
      exit 1
      ;;
  esac
done

# Check required parameters
if [[ -z "$embeddingModelId" ]]; then
  echo "Error: --embedding-model-id is required"
  exit 1
fi

if [[ -z "$rerankerModelId" ]]; then
  echo "Error: --reranker-model-id is required"
  exit 1
fi

# Navigate to the directory containing main.py
scriptPath="$(dirname "$0")"
cd "$scriptPath" || exit

# Run main.py with uvicorn and the provided parameters
uv run main.py --port "$port" --ovms-port "$ovmsPort" --embedding-model-id "$embeddingModelId" --embedding-device "$embeddingDevice" --reranker-model-id "$rerankerModelId" --reranker-device "$rerankerDevice"
