<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Control Policies Training

This folder contains all the scripts required to train and run inference for control policies on Unitree* G1 EDU with Inspire* FTP hands.

Currently supported policies:
- ACT


## Requirements

* [uv](https://docs.astral.sh/uv/getting-started/installation/)

## Install 

```bash
uv venv --python=3.12 .venv
uv sync
```

## Convert dataset

```bash
python3 scripts/convert-ds.py --dataset_path <twist2-dataset-path>
```

## Dataset playback

Play back the recorded dataset joint values directly in MuJoCo*:

```bash
python3 eval-simulation.py --mode playback \
	--episode-dir ./data/datasets/20260317_1812/episode_0000 \
	--playback-source state
```

Use recorded actions instead of recorded states, and loop continuously:

```bash
python3 eval-simulation.py --mode playback \
	--episode-dir ./data/datasets/20260317_1812/episode_0000 \
	--playback-source action \
	--loop-playback
```

## Training

* Train ACT model
```bash
./scripts/train-act.sh
```

## Inference on Simulation

This helps to validate the model inference result in simulation before running on real robot
```bash
python3 eval-simulation.py --mode inference \
	--episode-dir ./data/datasets/20260317_1812/episode_0000 \
	--dataset-dir ./data/outputs/lerobot_twist_dataset \
	--model-dir ./data/outputs/training/act/checkpoints/last/pretrained_model \
	--model-device xpu:1
```

## Inference on Real Robot

### Prerequisite

* Modified version of unitree_sdk
* Inspire SDK 

#### 1. Install modified version of unitree_sdk

```bash
sudo apt-get update
sudo apt-get install -y build-essential cmake python3-dev python3-pip pybind11-dev

mkdir -p thirdparty
rm -rf thirdparty/unitree_sdk2
git clone https://github.com/YanjieZe/unitree_sdk2.git thirdparty/unitree_sdk2

source .venv/bin/activate
cd thirdparty/unitree_sdk2/python_binding
export UNITREE_SDK2_PATH=$(pwd)/..
bash build.sh --sdk-path $UNITREE_SDK2_PATH --clean

SITE_PACKAGES=$(python -c "import site; print(site.getsitepackages()[0])")
echo "Installing to: $SITE_PACKAGES"

sudo cp build/lib/unitree_interface.cpython-*-linux-gnu.so $SITE_PACKAGES/unitree_interface.so
python -c "import unitree_interface; print('✓ Unitree SDK Python binding installed successfully')"
python -c "import unitree_interface; print('Available robot types:', list(unitree_interface.RobotType.__members__.keys()))"

cd ../../..
```

#### 2. Compile and build CycloneDDS

```bash
mkdir -p thirdparty
rm -rf thirdparty/cyclonedds
git clone https://github.com/eclipse-cyclonedds/cyclonedds -b releases/0.10.x thirdparty/cyclonedds

cd thirdparty/cyclonedds && mkdir build install && cd build
cmake .. -DCMAKE_INSTALL_PREFIX=../install
cmake --build . --target install
cd ../../..

export CYCLONEDDS_HOME=$PWD/thirdparty/cyclonedds/install
```

#### 3. Install Inspire SDK

```bash
mkdir -p thirdparty
rm -rf thirdparty/inspire_hand_ws
git clone --recurse-submodules https://github.com/NaCl-1374/inspire_hand_ws.git thirdparty/inspire_hand_ws

source .venv/bin/activate
cd thirdparty/inspire_hand_ws/unitree_sdk2_python
uv pip install -e .
cd ../inspire_hand_sdk
uv pip install -e .
cd ../../..
```
