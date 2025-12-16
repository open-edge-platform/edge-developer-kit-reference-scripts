# Server App for Robotic EmbodiedAI

This server application is a core component of the Robotic EmbodiedAI project. It provides backend services, data management, and robot simulation utilities for embodied AI research and development.

## Features

- Robot and teleoperator calibration
- Data management for simulation and real-world experiments
- Model training and checkpointing
- MuJoCo-based simulation runner
- Modular architecture for easy extension

## Setup

1. **Install system dependencies**
	```bash
	sudo apt install build-essential git cmake libevdev-dev python3-dev
	```

2. **Install UV**
	```bash
	curl -LsSf https://astral.sh/uv/install.sh | sh
	```

3. **Create a Python virtual environment**
	```bash
	uv venv --python 3.11 .venv
	```


4. **Install Python dependencies**
	```bash
	source .venv/bin/activate
	uv pip install -r requirements.txt --index-strategy unsafe-best-match
	uv pip install torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1 --index-url https://download.pytorch.org/whl/xpu
	```

## Run Server

1. **Plug in the devices according to the order**
	
	First plug in the leader arm, then followed by the USB/RealSense camera that point at the follower arm. Finally, plug in the follower arm with the camera on the follower arm. Ordering is very important in helping to identify the device later while setting the configurations.

	| Device | Port |
	| ------ | ---- |
	| Leader Arm | ttyACM0 |
	| USB/RealSense Camera | /dev/video0 |
	| Follower Arm | ttyACM1 |
	| Camera on Follower Arm | /dev/video2 |

2. **Ensure permission are set for the motor drivers**

	**This must be run whenever you plug out and plug in back the device.** In our case, The leader arm at `TTYACM0` and follower arm at `TTYACM1`.
	```bash
	sudo chmod 666 /dev/ttyACM0
	sudo chmod 666 /dev/ttyACM1
	```

3. **Calibrate the leader and the follower arm (One time only)**
	
	Use the `calibrate-leader.sh` and `calibrate-robot.sh` script to calibrate the leader and the follower arm accordingly. Refer to the video in the [link](https://huggingface.co/docs/lerobot/en/so101#calibration-video) if you are not sure how to do it.

4. **Run the command below to start the server**

	Once started, the server will be brought up at http://localhost:5989.
	```bash
	source .venv/bin/activate
	python main.py
	```

## Inference with the trained model using OpenVINO

1. Use the script `convert.py` to convert the model to OpenVINO format after training completed. Example command as below. `task-uuid` and `dataset-name` can be refer in the UI.
	```bash
	python3 convert.py --model-weight-dir ./output/<task-uuid>/<dataset-name>/checkpoints/last/pretrained_model/ --dataset-dir ./data/datasets/<dataset-name>/
	```

2. Use the provided `inference.sh` script to run the inference easily. Configure the `CAMERA_CONFIG` and `POLICY_PATH` based on your training dataset. Configure the `OPENVINO_DEVICE` to run inference on different devices on Intel platform.

## License

See the root project for license information.
