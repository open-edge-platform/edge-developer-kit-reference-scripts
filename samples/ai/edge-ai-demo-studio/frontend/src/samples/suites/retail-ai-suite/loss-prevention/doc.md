# Loss Prevention — Combined Detection and Classification

Runs a real-time retail loss prevention pipeline combining object detection and product classification on an RTSP video stream using DL Streamer and OpenVINO.

## Overview

The **Loss Prevention** sample application is part of the Retail AI Suite reference implementation. It demonstrates a Combined Detection and Classification workload: a GStreamer pipeline first runs **YOLO11n** to detect objects in each video frame, then passes the detections through **EfficientNet-B0** for product classification — both powered by OpenVINO inference on the selected device (CPU, GPU, or NPU).

The pipeline renders an annotated video window directly on the host display, with bounding boxes and classification labels overlaid on the retail video stream. Each model's inference device is set independently, supporting CPU, GPU (including GPU.0, GPU.1 for multi-GPU systems), NPU, and HETERO mode where detection and classification run on different devices.

## How it Works

The application workflow has three stages: input, processing, and output.

### Input

- An RTSP video stream served by the bundled `rtsp-streamer` container (MediaMTX), which loops a sample retail video file (`obj_classification-1920-15-bench.mp4`) from `performance-tools/sample-media/`.
- The camera-to-workload mapping is configured via `configs/camera_to_workload_asc_object_detection_classification.json`.

### Processing

- **RTSP Streamer**: MediaMTX streams the sample video at `rtsp://rtsp-streamer:8554/<video-name>` within the Docker network.
- **lp-pipeline-runner**: The main GStreamer pipeline container. It reads the workload-to-pipeline mapping (`workload_to_pipeline_asc_object_detection_classification_demostudio.json`, generated at start time with exact device strings) and dynamically constructs a pipeline that chains:
  1. `gvadetect` — YOLO11n object detection (INT8) via OpenVINO.
  2. `gvaclassify` — EfficientNet-B0 product classification (INT8) via OpenVINO.
  3. `gvawatermark` + `autovideosink` — Annotated frame rendering to the X11 display.
- **RabbitMQ**: Message broker for pipeline event coordination (internal).
- **MinIO**: S3-compatible object storage for result frames and metadata (internal).
- **model-downloader**: One-shot container that downloads the required model files on first start.

### Output

- A visual window on the connected display showing the retail video stream with detection bounding boxes and classification labels overlaid.
- Pipeline throughput logs in `results/pipeline_stream*.log`.
- Full GStreamer output in `results/gst-launch_*.log`.

## Getting Started

1. Click **Configure** on the Loss Prevention service to select the inference device:
   - **CPU / GPU / GPU.0 / GPU.1 / NPU** — both models run on the same device.
   - **HETERO (per-model)** — select a separate device for YOLO11n detection and EfficientNet-B0 classification.
2. Click **Start** on the service. Demo Studio will:
   - Sparse-clone the `edge-ai-suites` repo at ref `2026.0` to resolve the pinned `loss-prevention` submodule commit.
   - Clone `intel-retail/loss-prevention` at that exact commit and initialise the `performance-tools` submodule.
   - Generate `configs/workload_to_pipeline_asc_object_detection_classification_demostudio.json` with the exact selected device(s) and matching precision (YOLO11n: FP32 on CPU, INT8 on GPU/NPU; EfficientNet-B0: INT8 on all devices).
   - Download the YOLO11n and EfficientNet-B0 models via the upstream `model-downloader` container.
   - Download the sample retail video via the upstream `download-sample-videos` script.
   - Generate a compose override that suppresses host port exposure and enables device access.
   - Run `docker compose up -d` with `RENDER_MODE=1 DISPLAY=:0`, `CAMERA_STREAM=camera_to_workload_asc_object_detection_classification.json`, `WORKLOAD_DIST=workload_to_pipeline_asc_object_detection_classification_demostudio.json`, and `STREAM_LOOP=true`.
   - Wait for all containers to become healthy.
3. Once the service is **Online**, the GStreamer pipeline output window will appear on the host display (`:0`). It shows the retail video stream with bounding boxes and classification labels overlaid. If the window does not appear, see **Re-opening the display window** below.
4. Use the **Reopen Display Window** button on the Launch Demo page to restart only the `lp-pipeline-runner` container and reopen the display window without tearing the whole stack down.
5. Stop the service from Demo Studio to run `docker compose down -v` and tear the stack down.

## Prerequisites

- Linux host with a connected display (X11). The host display server must allow Docker containers to open windows; run `xhost +local:docker` if the window is blocked.
- [Docker](https://docs.docker.com/engine/install)
- Sufficient disk space for models and the sample video.
- For GPU inference: Intel GPU drivers installed (`/dev/dri` accessible).
- For NPU inference: Intel NPU drivers installed (`/dev/accel` accessible).

## Re-opening the display window

The GStreamer pipeline renders its annotated output directly in an X11 window on the host display. This window may disappear if:

- The display connection is interrupted or the screen is locked and unlocked.
- The `lp-pipeline-runner` container exits or crashes while the rest of the stack continues running.
- The X11 display permission is revoked (e.g., `xhost` is reset).

To reopen the window without stopping the entire stack, click **Reopen Display Window** on the Launch Demo page. This button runs `docker compose restart lp-pipeline-runner`, which restarts only the pipeline container. All other containers (RabbitMQ, MinIO, RTSP streamer) remain running, so the restart completes in a few seconds.

> **Note:** After a restart, the GStreamer pipeline will re-read the RTSP stream from the beginning and the display window will reopen on the host display. If it still does not appear, verify that `DISPLAY` is set correctly and run `xhost +local:docker` to grant Docker containers access to the X server.

## Important Notice

This reference implementation is intended to allow users to examine and evaluate the Loss Prevention application and the associated performance of Intel technology solutions. The accuracy of computer-vision models is a function of the relation between the data used to train them and the data the models encounter after deployment. The bundled models have been tested using datasets that may not be sufficient for use in production applications. Intel recommends and requests that these models be tested against data the models are likely to encounter in specific deployments.

## Licensing Information

**FFmpeg**: FFmpeg is an open source project licensed under LGPL and GPL. See [FFmpeg Legal Information](https://www.ffmpeg.org/legal.html). You are solely responsible for determining if your use of FFmpeg requires any additional licenses.

**GStreamer**: GStreamer is an open source framework licensed under LGPL. See [GStreamer Licensing Information](https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html). You are solely responsible for determining if your use of GStreamer requires any additional licenses.
