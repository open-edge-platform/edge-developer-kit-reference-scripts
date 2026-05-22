# Automatic Speech Recognition 

## Requirements

### Validated Hardware Requirements
- **CPU:** 13th generation Intel Core processors or newer
- **GPU:** Intel® Arc™ graphics
- **RAM:** 32GB (may vary based on model size)
- **Disk:** 128GB (may vary based on model size)

### Supported Inference Device
* CPU
* GPU
* NPU

## Quick Start
### 1. Install Operating System
Install the latest [Ubuntu 24.04 LTS Desktop](https://releases.ubuntu.com/noble/). Refer to the [Ubuntu Desktop installation tutorial](https://ubuntu.com/tutorials/install-ubuntu-desktop#1-overview) if needed.

### 2. Install GPU Driver (Optional)
If you plan to use a GPU for inference, install the appropriate GPU driver:
- **Intel® Arc™ A-Series Graphics:** [Installation Guide](../../../README.md#-5-minute-quick-start)

### 3. Set Up Docker
Follow the instructions [here](https://docs.docker.com/engine/install/) to install Docker and Docker Compose.

### 4. Build the Automatic Speech Recognition Docker Image
```bash
docker build -t automatic-speech-recognition .
```

### 5. Run the Automatic Speech Recognition container
  > By default, using -p xxxx:xxxx in docker run exposes the container ports externally on all network interfaces. To restrict access to localhost only, use -p 127.0.0.1:xxxx:xxxx instead.
* **CPU**
    ```bash
    docker run -it --rm \
        -p 5996:5996 \
        -e DEFAULT_MODEL_ID=openai/whisper-tiny \
        -e STT_DEVICE=CPU \
        -v app-data:/usr/src/app/data \
        automatic-speech-recognition
    ```

* **GPU**
    ```bash
    export RENDER_GROUP_ID=$(getent group render | cut -d: -f3)
    docker run -it --rm \
        --group-add $RENDER_GROUP_ID \
        --device /dev/dri:/dev/dri \
        -p 5996:5996 \
        -e DEFAULT_MODEL_ID=openai/whisper-tiny \
        -e STT_DEVICE=GPU \
        -v app-data:/usr/src/app/data \
        automatic-speech-recognition
    ```
