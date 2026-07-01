<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Imitation Learning on Unitree\* G1 with PICO\* 4 Ultra Teleoperation

This document describes how to collect teleoperation data from a **PICO\* 4 Ultra** headset, train an **ACT (Action Chunking with Transformers)** policy using **LeRobot**\*, and deploy the trained policy on an **Intel® Core™ Ultra** platform for real-time control of the **Unitree\* G1 EDU** humanoid robot.

The task demonstrated is **PCB grab-and-inspect** — the robot grabs a printed circuit board and holds it up for visual inspection using its arms.

---

## Architecture Overview

```
+----------------+      Data Collection       +-----------------+
|  PICO 4 Ultra  | ------------------------>  |  Unitree G1     |
|  + 2 Motion    |       Wireless via         |  EDU (29 DOF)   |
|  Trackers      |       XRoboToolkit         |  + Inspire Hands|
+----------------+                            +-----------------+
         |                                       |
         |       TWIST2 data format              |
         v                                       v
    +-------------------+                +------------------+
    |   Data Recorder   |                |   TWIST2 WBC     |
    |   (custom script) |                |   (70-90 Hz)     |
    +-------------------+                +------------------+
              |
              |  Custom conversion
              v
    +-------------------+
    |  LeRobot Dataset  |
    +-------------------+
              |
              |  LeRobot 0.5.1 train
              |  ACT policy
              v
    +-------------------+
    |  Trained ACT      |
    |  Policy (.pt)     |
    +-------------------+
              |
              |  PyTorch / OpenVINO
              v
    +-------------------+       SDK mode       +-----------------+
    |  Intel Core Ultra | ------------------>  |  Unitree G1     |
    |  3 Series         |       30 Hz,        |  EDU            |
    |  (integrated GPU) |       position      |  + Inspire Hands|
    +-------------------+       targets       +-----------------+
```

---

## Prerequisites

- Linux (Ubuntu\* 24.04 LTS recommended)
- Intel\* GPU with XPU\* support (for TWIST2 controller and training)
- [uv](https://docs.astral.sh/uv/getting-started/installation/) package manager
- PICO 4 Ultra headset with 2 motion trackers (for VR teleoperation)
- Unitree G1 EDU connected via Ethernet (for real robot deployment)
- Isaac Gym\* downloaded from [NVIDIA\*](https://developer.nvidia.com/isaac-gym) and extracted to `thirdparty/isaacgym`

## Setup

Run the setup script to install all dependencies, SDKs, and Python environments:

```bash
./setup.sh
```

This creates three virtual environments:

| Environment | Python | Purpose |
|-------------|--------|---------|
| `.twist2-venv` | 3.8 | TWIST2 whole-body controller, data recording |
| `.gmr-venv` | 3.10 | General Motion Retargeting, VR teleop |
| `training-ws/.venv` | 3.12 | ACT policy training & inference |

---

## Run

### 1. Data Collection

Start the TWIST2 teleoperation pipeline:

```bash
# Simulation mode with VR teleop (default, recording enabled)
./start-data-collection.sh

# Simulation mode with VR teleop, recording disabled
./start-data-collection.sh --no-record

# Simulation with offline motion playback
./start-data-collection.sh --offline --motion-file path/to/motion.pkl

# Real robot with VR teleop and recording enabled
./start-data-collection.sh --real --net eno1
```

> **Note:** For real robot data collection, start the camera server first in a separate terminal:
> ```bash
> ./start-camera-server.sh
> ```

Key options:
- `--sim` / `--real` — Controller mode (default: sim)
- `--no-record` — Disable data recording
- `--offline` — Use pre-recorded motion instead of VR teleop
- `--device DEVICE` — Inference device (default: cpu)
- `--human-height H` — Operator height for retargeting (default: 1.73m)

Controller buttons (during teleoperation):
- **A** — Toggle between pause and teleop mode
- **Y** — Toggle between start recording and stop recording & save episode
- **X** — Force stop

### 2. Dataset Conversion

Convert TWIST2 recordings to LeRobot format:

```bash
cd training-ws
uv run python scripts/convert-ds.py \
  --dataset_path ../datasets/<task_name> \
  --output_path ./data/outputs/<lerobot_dataset>
```

### 3. Training

Train an ACT policy:

```bash
cd training-ws
./scripts/train-act.sh train ./data/outputs/<lerobot_dataset>
```

To resume from a checkpoint:

```bash
cd training-ws
./scripts/train-act.sh resume ./data/outputs/training/<exp_name>/<datetime> [steps]
```

Training defaults: 20K steps, batch size 32, XPU device. Edit `scripts/train-act.sh` to change device, dataset path, or hyperparameters.

### 4. Evaluation

#### Simulation (MuJoCo)

Validate model inference in simulation before deploying on hardware:

```bash
cd training-ws
source .venv/bin/activate
python eval-simulation.py \
  --episode-dir ../datasets/<task_name>/episode_0000 \
  --dataset-dir ./data/outputs/<lerobot_dataset> \
  --model-dir ./data/outputs/training/<exp_name>/<datetime>/checkpoints/last/pretrained_model \
  --model-device xpu
```

#### Real Robot

> **Note:** Before deploying on the real robot, ensure:
> 1. For real robot deployment, start the camera server first in a separate terminal: `./start-camera-server.sh`
> 2. Set `export CYCLONEDDS_HOME=<path>/thirdparty/cyclonedds/install`
> 3. Hang the robot on a hanger and enter dev mode on the robot remote: press `L2+R2`

Deploy the trained policy on the physical G1:

```bash
cd training-ws
source .venv/bin/activate
python eval-robot.py \
  --robot-net eno1 \
  --robot-config configs/g1.yaml \
  --robot-host 192.168.123.164 \
  --model-dir ./data/outputs/training/<exp_name>/<datetime>/checkpoints/last/pretrained_model \
  --temporal-ensemble-coeff 0.01 \
  --model-device xpu
```

Or use the convenience script:

```bash
cd training-ws
./run-real-robot.sh
```

---

## References

- **TWIST2 (original):** <https://yanjieze.com/projects/TWIST2/> — Scalable, Portable, and Holistic Humanoid Data Collection System (ICRA 2026)
- **TWIST2 (original code):** <https://github.com/amazon-far/TWIST2>
- **TWIST2 (fork with Inspire hand support):** <https://github.com/xiangyang-95/TWIST2/tree/twist2-inspire>
- **XRoboToolkit:** <https://github.com/XR-Robotics>
- **LeRobot:** <https://github.com/huggingface/lerobot> — Open-source foundation models for robotics
- **ACT Paper:** [Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware](https://arxiv.org/abs/2304.13705) (Zhao et al., 2023)

---
