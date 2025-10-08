## Introduction

This is a demo application that uses power of AI (Large Video Language model) for live video stream captioning for retail loss prevention scenario and Visual RAG (text-to-image retrieval) using Intel VDMS vector database.

![img](./resource/snapshot.gif)

## Pre-requisite:

- Ubuntu 24.04 LTS
- Docker (https://docs.docker.com/engine/install/ubuntu/)
- Miniforge Conda (https://conda-forge.org/download/)
- Intel Openvino 2025.2.0 (https://docs.openvino.ai/2025/get-started/install-openvino.html)
- Python 3.10+
- tmux
- Target Hardware:
  - Intel&reg; Core&trade; Processors Platform (Alderlake, Raptor Lake, Arrow Lake, etc)
  - Intel&reg; Arc&trade; A-series or Intel&reg; Arc&trade; B-series graphics card (A770/B580)
  - Intel&reg; Core&trade; Ultra Series Processor Platform (Lunar Lake, Arrow Lake-H)
- Additional installation guide, see [link](../../../README.md#-5-minute-quick-start).

## Environment Setup

1. Refer to the pre-requisite section, and follow the instructions from the website to install docker, Miniforge Conda.
2. Install other ubuntu dependencies

```
sudo apt update
sudo apt install tmux
```

3. Pull the code

```
mkdir -p $HOME/work
cd $HOME/work
git clone https://github.com/intel/edge-developer-kit-reference-scripts edge-ai-devkit
cp -rf edge-ai-devkit/usecases/ai/video_summarization ./video_summarization
cd $HOME/work/video_summarization
```

4. Create conda environment and install conda packages. 

```
conda create -n openvino-env python=3.11
conda activate openvino-env
conda update --all
conda install -c conda-forge openvino=2025.2.0
pip install -r requirements.txt
```



## Model Preparation

Convert and Quantized MiniCPM-v-2_6 to OpenVINO IR format (INT8)

```
mkdir -p $HOME/work
cd $HOME/work
optimum-cli export openvino -m openbmb/MiniCPM-V-2_6 --trust-remote-code --weight-format int8 MiniCPM_INT8
```



## Starting Demo App

This demo app is comprising of the following modules/components:

- VLM API service (port 8000)

- Retriver API service (port 8001)

- Live Summarizer UI (port 8888)

- Video RAG UI (port 9999)

- Simple-RTSP-server (port 8554)

- VDMS Vector DB (port 55555)

  

There are 2 methods to run the demo, manual or via Docker. It is recommended to follow docker way of starting the Demo App for simplicity.



## Manually Starting Service

1. Activate conda environment and change directory to the project folder

   ```
   conda activate openvino-env
   cd $HOME/work/video_summarization
   ```

2. Start API server

   ``` 
   uvicorn api.app:app --port 8000 
   uvicorn api.retriever_api:app --port 8001
   ```

3. Start Intel VDMS vector DB

   ```
   docker run --rm -d --name vdms-rag -p 55555:55555 intellabs/vdms:latest
   ```

4. Start Live Summarizer:

``` streamlit
streamlit run app_ov_test.py --server.port 8888 --server.address 127.0.0.1
```

5. Start Video RAG UI:

```
streamlit run app_rag.py --server.port 9999 --server.address 127.0.0.1
```

6. Create chunks folder

```
mkdir ./chunks
```

7. Start virtual camera stream. You may use the utility script below to do that.

```
./start_virtual_rtsp_cam0.sh /path/to/video.mp4   #replace /path/to/video.mp4 with the absolute path to your own video file
```

> Note: The utility script only create one video stream, please copy and edit the script so more stream can be created. Make sure the video is posted to the URL as shown in the table below:
>
> | Camera Name | URL                         |
> | ----------- | --------------------------- |
> | CAM0        | http://localhost:8554/live  |
> | CAM1        | http://localhost:8554/live1 |
> | CAM2        | http://localhost:8554/live2 |

> Utility Script:
>
> - clear_database.sh - use this script to clear the VDMS vector store
>
> - start_virtual_rtsp_cam0.sh - use this script to create a virtual camera stream. Expected input video format. Resolution: 1920x1080, Framerate: 15fps.
>



## Start using docker

1. Name of the docker containers and its associated ports. Please make sure the ports are not used by any other locally hosted services.

   | Container Name  | Exposed Ports |
   | --------------- | ------------- |
   | vlm_api_service | 8000          |
   | rag_api_service | 8001          |
   | vector_store    | 55555         |
   | rtmp_server     | 8554          |
   | summarizer_ui   | 8888          |
   | retriever_ui    | 9999          |

   

2. create chunks folder (folder to hold the video chunks file), and change permission of the chunks folder.

```
mkdir -p ../chunks
chmod 777 ../chunks
```

3. Launch linux terminal from desktop and cd to project directory:

```
cd $HOME/work/video_summarization
```

4. Run the command below:

```
docker compose build
docker compose up -d
```

5. Start virtual camera stream. You may use the utility script below to do that.

```
./start_virtual_rtsp_cam0.sh /path/to/video.mp4   #replace /path/to/video.mp4 with the absolute path to your own video file
```

> Note: The utility script only create one video stream, please copy and edit the script so more stream can be created. Make sure the video is posted to the URL as shown in the table below:
>
> | Camera Name | URL                         |
> | ----------- | --------------------------- |
> | CAM0        | http://localhost:8554/live  |
> | CAM1        | http://localhost:8554/live1 |
> | CAM2        | http://localhost:8554/live2 |

> Utility Script:
>
> - start_virtual_rtsp_cam0.sh - use this script to create a virtual camera stream

6. To stop the demo:

```
docker compose down
```

7. Other useful command

```
tmux ls   # use this command to check if virtual camera stream is running
docker compose ls   # use this command to check if all services of the demo is running
docker compose top # use this command to check the container name
docker compose logs [container_name]  # use this command to retrieve the runtime logs of a specific container
```

8. The docker-compose.yml uses environment variables to pass additional configuration parameters to the containers. Change this from 

| Environment Variables                                 | Containers                                                   | Default Value | Sample Value                 |
| ----------------------------------------------------- | ------------------------------------------------------------ | ------------- | ---------------------------- |
| **Proxy settings**: HTTP_PROXY, HTTPS_PROXY, NO_PROXY | vlm_api_service, rag_api_service, summarizer_ui, retriever_ui | None          | http://proxy.domain.com:8080 |
| * **AI backend:** DEVICE                              | vlm_api_service                                              | GPU           | GPU.1, GPU.0, GPU, CPU, NPU  |

> ***Note:** 
>
> 1. DEVICE=NPU is not supported yet
> 2. You may also use this command to identify all AI accelerator supported in your HW. ```python -c "import openvino as ov; print(ov.Core().available_devices)"```

## Performance

1. Install qmassa. Follow instruction in https://github.com/ulissesf/qmassa.

1. Run qmassa in command line to view the GPU utilization.

   ``` 
   sudo $HOME/.cargo/bin/qmassa
   ```

   > Note: If it doesn't correctly show the gpu utilization for your intel GPU device, pass the parameter "-d bus:device:func" to qmassa. You may look up for the BDF (bus:device:func) of your Intel GPU card using the command 'lspci'.
