#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export HF_LEROBOT_HOME="$ROOT"
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"

exec uv run --locked lerobot-train \
  --dataset.repo_id="converted/dataset" \
  --dataset.video_backend=pyav \
  --policy.type=act \
  --policy.push_to_hub=false \
  --batch_size="${ROBOTIC_STUDIO_BATCH_SIZE:-32}" \
  --num_workers="${ROBOTIC_STUDIO_NUM_WORKERS:-4}" \
  --steps="${ROBOTIC_STUDIO_STEPS:-20000}" \
  --save_freq="${ROBOTIC_STUDIO_SAVE_FREQ:-1000}" \
  --save_checkpoint=true \
  --log_freq 1 \
  "$@"
