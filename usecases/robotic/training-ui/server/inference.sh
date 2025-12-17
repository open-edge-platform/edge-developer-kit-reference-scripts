#!/bin/bash

# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -e

rm -rf /home/user/.cache/huggingface/lerobot/lerobot/eval_pick888

POLICY_PATH=""
CAMERA_CONFIG='{ hand: {type: opencv, index_or_path: /dev/video0, width: 640, height: 480, fps: 30}, front: {type: opencv, index_or_path: /dev/video2, width: 640, height: 480, fps: 25}}'
OPENVINO_MODEL_PATH="./data/ov_models/ov_model.xml"
OPENVINO_DEVICE="${OPENVINO_DEVICE:-CPU}"

COMMON_ARGS=(
  --robot.type=so101_follower
  --robot.port=/dev/ttyACM1
  "--robot.cameras=$CAMERA_CONFIG"
  --robot.id=my_follower_arm
  --display_data=false
  --dataset.repo_id=lerobot/eval_pick888
  --dataset.single_task=pickup
  --dataset.episode_time_s=999999
  "--policy.path=$POLICY_PATH"
)

run_pytorch() {
  echo "Running lerobot-record (PyTorch backend)..."
  lerobot-record "${COMMON_ARGS[@]}"
}

run_openvino() {
  echo "Running inference.py (OpenVINO backend)..."
  python3 inference.py "${COMMON_ARGS[@]}" --openvino_model_path="$OPENVINO_MODEL_PATH" --openvino_device="$OPENVINO_DEVICE"
}

if [ -z "$POLICY_PATH" ]; then
    echo "Please put the pretrained model path in POLICY_PATH first before running the script. Rerun the script after making the changes."
    exit 1
fi
echo "Make sure you have the correct configurations of camera as your training setup. Edit the CAMERA_CONFIG if required."

read -rp "Select inference backend (openvino/pytorch) [openvino]: " backend
backend=${backend:-openvino}
backend=${backend,,}

case "$backend" in
  pytorch|torch)
    run_pytorch
    ;;
  openvino|ov)
    run_openvino
    ;;
  *)
    echo "Unsupported backend: $backend" >&2
    exit 1
    ;;
esac
