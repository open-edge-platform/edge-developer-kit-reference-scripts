#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
export HF_LEROBOT_HOME="$ROOT"
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"

# Lightning's `accelerator: auto` cannot see the Intel XPU accelerator that physicalai
# registers, so it silently falls back to the CPU. Detect the device physicalai itself
# would pick and pass it through explicitly; CUDA and CPU machines are unaffected.
# Importing the policies prints transformers docstring warnings on stdout, so keep only the
# last line (the device); otherwise the check below fails and training runs on the CPU.
ACCELERATOR="${ROBOTIC_STUDIO_ACCELERATOR:-}"
if [ -z "$ACCELERATOR" ]; then
  ACCELERATOR="$(uv run --locked python -c 'import physicalai.train; from physicalai.devices import get_available_device; print(get_available_device())' | tail -n 1)"
fi
echo "Training on: $ACCELERATOR (set ROBOTIC_STUDIO_ACCELERATOR to override)" >&2
if [ "$ACCELERATOR" = "xpu" ]; then
  exec uv run --locked physicalai fit --config configs/physicalai_pi05.yaml \
    --trainer.accelerator=xpu --trainer.strategy=xpu_single "$@"
fi
exec uv run --locked physicalai fit --config configs/physicalai_pi05.yaml "$@"
