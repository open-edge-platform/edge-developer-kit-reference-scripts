# Text To Speech

## Validated Hardware Requirements
- **CPU:** 13th generation Intel Core processors or newer
- **GPU:** Intel® Arc™ graphics
- **RAM:** 32GB (may vary based on model size)
- **Disk:** 128GB (may vary based on model size)

## Software Version
* OpenVINO: 2024.6.0
* Optimum Intel: 1.21.0

## Supported Inference Device
* TTS_DEVICE
  - CPU
  - GPU
* BERT_DEVICE
  - CPU
  - GPU
  - NPU

## Quick Start
### 1. Install Operating System
Install the latest [Ubuntu 24.04 LTS Desktop](https://releases.ubuntu.com/noble/). Refer to the [Ubuntu Desktop installation tutorial](https://ubuntu.com/tutorials/install-ubuntu-desktop#1-overview) if needed.

### 2. Install GPU Driver (Optional)
If you plan to use a GPU for inference, install the appropriate GPU driver:
- **Intel® Arc™ A-Series Graphics:** [Installation Guide](../../../README.md#-5-minute-quick-start)

### 3. Set Up Docker
Follow the instructions [here](https://docs.docker.com/engine/install/) to install Docker and Docker Compose.

### 4. Build the Text To Speech Docker Image
```bash
docker build -t text-to-speech .
```

### 5. Run the Text To Speech container
  > By default, using -p xxxx:xxxx in docker run exposes the container ports externally on all network interfaces. To restrict access to localhost only, use -p 127.0.0.1:xxxx:xxxx instead.
* **CPU**
```bash
docker run -it --rm \
    -p 5995:5995 \
    -e TTS_DEVICE=CPU \
    -e BERT_DEVICE=CPU \
    -v app-data:/usr/src/app/data \
    text-to-speech
```

* **GPU**
```bash
export RENDER_GROUP_ID=$(getent group render | cut -d: -f3)
docker run -it --rm \
    --group-add $RENDER_GROUP_ID \
    --device /dev/dri:/dev/dri \
    -p 5995:5995 \
    -e TTS_DEVICE=GPU \
    -e BERT_DEVICE=GPU \
    -v app-data:/usr/src/app/data \
    text-to-speech
```

* **NPU**
```bash
export RENDER_GROUP_ID=$(getent group render | cut -d: -f3)
docker run -it --rm \
    --group-add $RENDER_GROUP_ID \
    --device /dev/dri:/dev/dri \
    --device /dev/accel:/dev/accel \
    -p 5995:5995 \
    -e TTS_DEVICE=CPU \
    -e BERT_DEVICE=NPU \
    -v app-data:/usr/src/app/data \
    text-to-speech
```

## FAQ
### Supported config in environment variables
| Environment Variable | Info                        | Default Value |
|----------------------|-----------------------------|---------------|
| TTS_DEVICE           | Device to run TTS model     | CPU           |
| BERT_DEVICE          | Device to run BERT model    | CPU           |
| USE_INT8             | Run model in INT8 precision | False         |

### Remove the application data
```bash
docker volume rm app-data
```

## Limitations
1. Unable to run INT8 with GPU device. Please use CPU or GPU devices.
