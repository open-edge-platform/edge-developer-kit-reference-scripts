#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export HF_LEROBOT_HOME="$ROOT"

exec uv run --locked lerobot-train \
  --dataset.repo_id="converted/dataset" \
  --dataset.video_backend=pyav \
  --policy.type=pi05 \
  --policy.dtype="${ROBOTIC_STUDIO_POLICY_DTYPE:-bfloat16}" \
  --policy.freeze_vision_encoder="${ROBOTIC_STUDIO_FREEZE_VISION_ENCODER:-true}" \
  --policy.push_to_hub=false \
  --batch_size="${ROBOTIC_STUDIO_BATCH_SIZE:-1}" \
  --num_workers="${ROBOTIC_STUDIO_NUM_WORKERS:-0}" \
  --steps="${ROBOTIC_STUDIO_STEPS:-7000}" \
  --save_freq="${ROBOTIC_STUDIO_SAVE_FREQ:-1000}" \
  --save_checkpoint=true \
  --log_freq 1 \
  "$@"
