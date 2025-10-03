#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PARENT_THIRDPARTY_DIR="$SCRIPT_DIR/../thirdparty"
PARENT_UV_PATH="$PARENT_THIRDPARTY_DIR/uv/uv"
UV_CMD="$PARENT_UV_PATH"

echo "Setup Digital Avatar Environment"

setup_env() {
  if [ -f "$HOME/.local/bin/env" ]; then
    # shellcheck disable=SC1091
    source "$HOME/.local/bin/env"
  else
    echo "Notice: $HOME/.local/bin/env not found; continuing without it"
  fi
  echo "Setup Virtual Environment"
  echo "Remove existing venv if exists"
  rm -rf .venv

  echo "Create 3.11.9 venv environment"
  "$UV_CMD" venv --python=3.11.9
  if [ -f ".venv/bin/activate" ]; then
    # shellcheck disable=SC1091
    source ".venv/bin/activate"
  else
    echo "Notice: .venv/bin/activate not found; continuing without it"
  fi
}

pytorch_installation() {
  cd "$SCRIPT_DIR" || exit
  echo "Installing PyTorch for xPU"
  "$UV_CMD" pip install -U pip
  "$UV_CMD" pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/xpu
  "$UV_CMD" pip install huggingface-hub[cli]
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

main_dependencies_installation() {
  echo "Install Digital Avatar Dependencies"
  cd "$SCRIPT_DIR" || exit
  "$UV_CMD" pip install -r requirements.txt
}

setup_env
pytorch_installation
main_dependencies_installation
wav2lip_dependencies_installation