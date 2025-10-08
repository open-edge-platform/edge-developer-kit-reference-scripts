# Object Detection Microservice

## Overview

Object detection microservice that interacts with YOLO models using OpenVINO™ Model Server(OVMS) to perform object detection tasks.

## Model Validated

Model | Format | Device
--- | --- | ---
YOLO11n | OpenVINO™ IR | CPU, GPU, NPU
YOLO11s | OpenVINO™ IR | CPU, GPU, NPU
YOLO11m | OpenVINO™ IR | CPU, GPU, NPU
YOLO11l | OpenVINO™ IR | CPU, GPU, NPU
YOLO11x | OpenVINO™ IR | CPU, GPU, NPU

## Software Ingredient

Package | Version
--- | ---
openvino-dev | 2024.6.0
opencv-python | 4.10.0.84
ultralytics | 8.3.61
python-multipart | 0.0.20
ovmsclient | 2023.1
grpcio | 1.69.0

## Prerequisites
- [Docker Engine](https://docs.docker.com/engine/install/ubuntu/)

- Optional: [GPU Driver](../../../README.md#-5-minute-quick-start)


## Download and prepare YOLO model

-   The models directory are to be structured as such:
    ```bash
    # Example
    models/
       └── 1/
           ├── coco_labels.txt
           ├── metadata.yaml
           ├── yolo11n.bin
           └── yolo11n.xml
    ```
    Where `1` here is represents the `model_version`

-   Download the model
    >Note: Setup [step 1](#local-environment) first before running the commands below.

    ```python
    # Example
    from ultralytics import YOLO

    model = YOLO("yolo11n.pt")
    ```

-   Convert models into OpenVINO™ IR format. This will create a directory `<model_name>_openvino_model` that will store the converted models:
    ```bash
    mkdir -p models/ && cd models/
    yolo export model=<model_name>.pt format=openvino

    # Example 1: Download model and convert it into OpenVINO™ IR format
    yolo export model=yolo11n.pt format=openvino

    # Example 2: Specify the model's desired input size e.g. [1, 3, 640, 640]
    yolo export model=yolo11n.pt format=openvino imgsz=640,640
    ```


## Prepare image data for inference

-   The data to be inferenced can be stored in this folder:
    ```bash
    # Example
    images/
    └── coco_bike.png
    ```

-   Sample image to download:
    ```bash
    mkdir -p images && cd images
    wget https://storage.openvinotoolkit.org/repositories/openvino_notebooks/data/data/image/coco_bike.jpg
    ```

## Run server

### Local environment

1.  Install OpenVINO™ Development Tools and other dependencies

    ```bash
    python3 -m venv venv

    source venv/bin/activate

    pip3 install --upgrade pip
    pip3 install -r requirements.txt
    ```

### Docker

-   Download docker images

    ```bash
    # For CPU
    docker pull openvino/model_server:latest

    # For GPU
    docker pull openvino/model_server:latest-gpu
    ```
    >Note: For NPU, you will need to build the docker image as shown [here](#infer-on-npu).

-   From here, you can start the docker through various means depending on what accelerator(CPU, GPU or NPU) to run inference on.
-   Below are example commands to run docker and inference. Replace any arguments where necessary.
    > By default, using -p xxxx:xxxx in docker run exposes the container ports externally on all network interfaces. To restrict access to localhost only, use -p 127.0.0.1:xxxx:xxxx instead.

### Infer on CPU

```bash
# Example docker run CPU
docker run --rm -d -v $(pwd)/models:/models -p 9000:9000 -p 8000:8000 openvino/model_server:latest \
--model_name yolo11n --model_path /models/yolo11n --port 9000 --rest_port 8000 --layout NHWC:NCHW
```

```bash
# Example inference with CPU
python3 main.py --accelerator CPU --models_dir ./models --model_name yolo11n --image_path images/coco_bike.jpg --output_image_path result_image.jpg --ovms_address 127.0.0.1:9000
```

### Infer on GPU

>Note: Replace GPU with GPU.1 if you have more than 1 GPUs
```bash
# Example docker run GPU
docker run --rm -d --group-add $(stat -c "%g" /dev/dri/render* | head -n 1) -u $(id -u) --device=/dev/dri:/dev/dri -v $(pwd)/models:/models -p 9000:9000 -p 8000:8000 openvino/model_server:latest-gpu \
--model_name yolo11n --model_path /models/yolo11n --port 9000 --rest_port 8000 --layout NHWC:NCHW
```

```bash
# Example inference with GPU
python3 main.py --accelerator GPU --models_dir ./models --model_name yolo11n --image_path images/coco_bike.jpg --output_image_path result_image.jpg --ovms_address 127.0.0.1:9000
```

### Infer on NPU

Build docker:
```
git clone https://github.com/openvinotoolkit/model_server.git

cd model_server
make release_image NPU=1
```

```bash
# Example docker run NPU
docker run --rm -d --device=/dev/accel:/dev/accel:rwm --group-add=$(stat -c "%g" /dev/dri/render* | head -n 1) -u $(id -u) -v $(pwd)/models:/models -p 9000:9000 -p 8000:8000 openvino/model_server:latest-npu \
--model_name yolo11n --model_path /models/yolo11n --port 9000 --rest_port 8000 --layout NHWC:NCHW
```

```bash
# Example inference with NPU
python3 main.py --accelerator NPU --models_dir ./models --model_name yolo11n --image_path images/coco_bike.jpg --output_image_path result_image.jpg --ovms_address 127.0.0.1:9000
```
