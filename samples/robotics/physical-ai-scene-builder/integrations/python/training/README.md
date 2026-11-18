<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Physical AI Scene Builder Raw Dataset and Training

## Description

This download contains the recorded episodes in `raw/` and tools to convert them to LeRobot v3
format and train ACT or Pi0.5 policies. Training is available with either LeRobot or Physical AI.

## Before You Start

1. Extract the full archive and keep its files together. Run commands from the archive root.
2. Use Linux with Python 3.12 to 3.14 and `uv`.
3. Install the system libraries required by the training dependencies:

```sh
sudo apt update
sudo apt install libsdl2-dev libfreetype6-dev libfontconfig1-dev pkg-config
```

## Quick Start

Install the locked Python environment:

```sh
uv sync --locked
```

Convert the raw episodes into the canonical LeRobot v3 dataset at `converted/dataset`:

```sh
uv run --locked python convert_to_lerobot.py
```

Choose a training framework and policy:

| Framework   | ACT                            | Pi0.5                           |
| ----------- | ------------------------------ | ------------------------------- |
| LeRobot     | `bash lerobot_train_act.sh`    | `bash lerobot_train_pi05.sh`    |
| Physical AI | `bash physicalai_train_act.sh` | `bash physicalai_train_pi05.sh` |

LeRobot checkpoints are written under `outputs/`. Physical AI checkpoints are written under
`experiments/lightning_logs/version_N/checkpoints/`.

ACT loads data with 4 worker processes (about 1.5 GB of memory each), which roughly halves training
time compared with loading in the training process. On a machine short of memory, lower it:
`--data.init_args.num_workers=2` for Physical AI, `ROBOTIC_STUDIO_NUM_WORKERS=2` for LeRobot.

## File Structure

```text
dataset-training/
├── README.md                     # This guide
├── pyproject.toml                # Training dependencies and project settings
├── uv.lock                       # Locked dependency versions
├── raw/                          # Recorded episode metadata, state/action arrays, and camera videos
├── convert_to_lerobot.py         # Convert raw recordings to LeRobot v3 format
├── lerobot_train_act.sh          # Train an ACT policy with LeRobot
├── lerobot_train_pi05.sh         # Train a Pi0.5 policy with LeRobot
├── physicalai_train_act.sh       # Train an ACT policy with Physical AI
├── physicalai_train_pi05.sh      # Train a Pi0.5 policy with Physical AI
├── configs/
│   ├── physicalai_act.yaml       # Physical AI ACT training settings
│   └── physicalai_pi05.yaml      # Physical AI Pi0.5 training settings
└── converted/dataset/            # Generated LeRobot v3 dataset
```
