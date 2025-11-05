#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Parse arguments
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --model-id)
      modelId="$2"
      shift
      shift
      ;;
    --port)
      port="$2"
      shift
      shift
      ;;
    --device)
      device="$2"
      shift
      shift
      ;;
    *)
      echo "Unknown parameter: $1"
      exit 1
      ;;
  esac
done

# Navigate to the directory containing main.py
scriptPath="$(dirname "$0")"
cd "$scriptPath" || exit

# Run main.py with uvicorn and the provided parameters
uv run main.py --port "$port" --model-id "$modelId" --device "$device"
