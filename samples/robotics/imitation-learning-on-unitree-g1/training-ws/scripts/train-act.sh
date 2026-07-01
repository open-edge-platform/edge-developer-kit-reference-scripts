#!/bin/bash
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# shellcheck source=/dev/null
source .venv/bin/activate

# Ensure video decoding patch is installed in venv (survives venv reinstalls)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_PKG=".venv/lib/python$(.venv/bin/python -S -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')/site-packages"
if [ ! -f "$SITE_PKG/patch_video_backend.pth" ]; then
  echo "Installing video backend patch into venv..."
  cp "$SCRIPT_DIR/patch_video_backend.py" "$SITE_PKG/"
  echo "import patch_video_backend" > "$SITE_PKG/patch_video_backend.pth"
fi

# Preflight: check for GPU via clinfo
if ! command -v clinfo &>/dev/null; then
  echo "ERROR: clinfo not found. Install with: sudo apt install clinfo"
  exit 1
fi

GPU_COUNT=$(clinfo 2>/dev/null | grep -c "Device Type.*GPU")
if [ "$GPU_COUNT" -eq 0 ]; then
  echo "ERROR: No GPU detected by clinfo. Check your driver/runtime installation."
  echo "Run 'clinfo' for details."
  exit 1
fi

echo "$GPU_COUNT GPU device(s) detected."

DATETIME=$(date +"%Y-%m-%d_%H-%M-%S")
SEED=42
DEVICE=xpu
BATCH_SIZE=32
# Set NUM_WORKERS to 1/4 of available CPUs (min 1)
NUM_CPUS=$(nproc)
NUM_WORKERS=$(( NUM_CPUS / 4 ))
NUM_WORKERS=$(( NUM_WORKERS < 1 ? 1 : NUM_WORKERS ))
STEPS=20000
SAVE_AND_EVAL_FREQ=1000

COMMAND=${1:-train}

case "$COMMAND" in
  train)
    DATASET_ROOT=${2:-./data/outputs/full-v1}
    # Exp name is dataset name
    EXP_NAME=$(basename "$DATASET_ROOT")
    OUTPUT_DIR=./data/outputs/training/$EXP_NAME/$DATETIME
    TRAIN_LOG=train.log

    if [ -d "$OUTPUT_DIR" ]; then
      echo "Output directory already exists. Please remove it before training."
      echo "Command: rm -rf $OUTPUT_DIR"
      exit 1
    fi

    lerobot-train \
      --dataset.repo_id=lerobot/twist-dataset \
      --dataset.root="$DATASET_ROOT" \
      --dataset.video_backend pyav \
      --dataset.image_transforms.enable=true \
      --policy.type=act \
      --output_dir="$OUTPUT_DIR" \
      --job_name=lerobot_twist_dataset \
      --wandb.enable=false \
      --seed $SEED \
      --steps $STEPS \
      --save_checkpoint true \
      --eval_freq $SAVE_AND_EVAL_FREQ \
      --save_freq $SAVE_AND_EVAL_FREQ \
      --log_freq 1 \
      --batch_size=$BATCH_SIZE \
      --num_workers $NUM_WORKERS \
      --policy.repo_id=lerobot/act_policy \
      --policy.device=$DEVICE \
      --policy.use_amp=true \
      --policy.push_to_hub=false 2>&1 | tee $TRAIN_LOG
    ;;

  resume)
    # Resume mode: reuse the saved train_config.json from a previous run's last
    # checkpoint. When resuming, only a few runtime args (e.g. --steps) can be
    # overridden; dataset/policy/batch_size are locked to the original config.
    RESUME_DIR=$2
    RESUME_STEPS=${3:-$STEPS}
    if [ -z "$RESUME_DIR" ] || [ ! -d "$RESUME_DIR/checkpoints/last" ]; then
      echo "Usage: $0 resume <output_dir> [steps]"
      echo "No checkpoint found at: $RESUME_DIR/checkpoints/last"
      exit 1
    fi
    lerobot-train \
      --config_path="$RESUME_DIR"/checkpoints/last/pretrained_model/train_config.json \
      --resume=true \
      --steps="$RESUME_STEPS" 2>&1 | tee -a "$RESUME_DIR"/resume.log
    ;;

  *)
    echo "Usage: $0 {train|resume} [options]"
    echo ""
    echo "Commands:"
    echo "  train  [dataset_path]          Train a new ACT policy (default dataset: ./data/outputs/full-v1)"
    echo "  resume <output_dir> [steps]    Resume training from a checkpoint"
    exit 1
    ;;
esac
