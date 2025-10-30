#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

PARENT_THIRDPARTY_DIR="$SCRIPT_DIR/../thirdparty"
PARENT_UV_PATH="$PARENT_THIRDPARTY_DIR/uv/uv"
UV_CMD="$PARENT_UV_PATH"

echo "Setup Digital Avatar Environment"

check_uv_installed() {
  echo -e "Checking if uv is installed in workers thirdparty directory..."
  if [ -x "$PARENT_UV_PATH" ]; then
      echo -e "Found uv in workers thirdparty folder."
  else
      echo -e "uv not found in expected location: $PARENT_UV_PATH"
      echo -e "Please ensure the workers setup has been run first."
      exit 1
  fi
}

create_venv() {
  if [[ -d "$VENV_DIR" ]]; then
    echo "Virtual environment already exists at $VENV_DIR."
  else
    echo "Creating Python 3.11 virtual environment with uv ..."
    "$UV_CMD" venv --seed --python 3.11 "$VENV_DIR"
  fi
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  "$UV_CMD" sync
  "$UV_CMD" run python -m ensurepip
}

wav2lip_dependencies_installation() {
  echo -n "Installing Wav2Lip dependencies"

  rm -rf "$SCRIPT_DIR"/tmp/Wav2Lip
  git clone https://github.com/Rudrabha/Wav2Lip "$SCRIPT_DIR"/tmp/Wav2Lip
  cd "$SCRIPT_DIR"/tmp/Wav2Lip || exit
  git checkout bac9a81e63ecc153202353372e5724b83d9e6322
  git apply "$SCRIPT_DIR"/patches/0001-Patch-to-support-256x256-and-xPU.patch

  cd "$SCRIPT_DIR" || exit
  rm -rf "$SCRIPT_DIR"/modules/lipsync/wav2lip/wav2lip256
  
  mkdir -p "$SCRIPT_DIR"/modules/lipsync/wav2lip/wav2lip256
  cp -rf "$SCRIPT_DIR"/tmp/Wav2Lip/face_detection "$SCRIPT_DIR"/modules/lipsync/wav2lip/wav2lip256/face_detection
  cp -rf "$SCRIPT_DIR"/tmp/Wav2Lip/models "$SCRIPT_DIR"/modules/lipsync/wav2lip/wav2lip256/
  cp -rf "$SCRIPT_DIR"/tmp/Wav2Lip/audio.py "$SCRIPT_DIR"/modules/lipsync/wav2lip/wav2lip256/
  cp -rf "$SCRIPT_DIR"/tmp/Wav2Lip/hparams.py "$SCRIPT_DIR"/modules/lipsync/wav2lip/wav2lip256/

  rm -rf  "$SCRIPT_DIR"/tmp

  "$UV_CMD" run hf download Kedreamix/Linly-Talker --local-dir models/wav2lip/ --include checkpoints/wav2lipv2.pth
  
  "$UV_CMD" run modules/lipsync/wav2lip/wav2lip_avatar_generator.py --video_path data/samples/sample_video_ai.mp4
}

main() {
  echo "Starting setup for Lipsync with Intel GPU support ..."
  check_uv_installed
  create_venv
  wav2lip_dependencies_installation
  echo "Setup completed successfully!"
}

main