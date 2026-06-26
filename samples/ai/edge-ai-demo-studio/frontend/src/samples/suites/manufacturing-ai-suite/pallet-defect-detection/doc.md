# Pallet Defect Detection Sample Application

Performs near real-time pallet defect detection on warehouse video streams using DL Streamer Pipeline Server with OpenVINO inference and WebRTC playback.

## Overview

The **Pallet Defect Detection** sample application is part of the Manufacturing AI Suite — Industrial Edge Insights for Vision template. It runs an OpenVINO INT8 detection model against a sample warehouse video, publishes the annotated stream over WebRTC via MediaMTX, indexes detections through MQTT, and exposes telemetry via OpenTelemetry / Prometheus.

This sample demonstrates how to combine edge AI microservices for video ingestion, object detection, and dashboarding into a single docker-compose deployment that targets industrial use cases such as quality control on a manufacturing line.

## How it Works

The application workflow has three stages: inputs, processing, and outputs.

### Inputs

- A bundled sample warehouse video that loops continuously, simulating a live camera feed.
- (Optional) RTSP camera streams, configured by editing the source URI in `apps/pallet-defect-detection/payload.json`.

### Processing

- **NGINX reverse proxy**: All external traffic terminates at NGINX with HTTPS (self-signed cert) and is routed to the appropriate microservice (`/api/` → DL Streamer, `/mediamtx/` → MediaMTX, `/minio/` → MinIO, `/prometheus/` → Prometheus).
- **DL Streamer Pipeline Server**: Runs the GStreamer pipeline declared in `apps/pallet-defect-detection/configs/pipeline-server-config.json` and applies the OpenVINO INT8 detection model. The selected device (CPU / GPU / NPU) maps to a different pipeline name (`pallet_defect_detection`, `..._gpu`, `..._npu`) declared in `apps/pallet-defect-detection/payload.json`.
- **MediaMTX**: Receives the annotated frames from DL Streamer and exposes them as a WebRTC stream at `/mediamtx/pdd/`.
- **MQTT broker (eclipse-mosquitto)**: Carries detection metadata between microservices.
- **MinIO**: Stores frames or other artifacts pushed by the pipeline (S3-compatible).
- **OpenTelemetry Collector + Prometheus**: Capture metrics from the pipeline server.
- **Coturn**: TURN server used by WebRTC for NAT traversal.

### Outputs

- WebRTC video stream with overlaid pallet detections (visit `/mediamtx/pdd/`).
- DL Streamer pipeline status REST API (`/api/pipelines/status`).
- Prometheus scraping endpoint (`/prometheus/`).
- MinIO object browser (`/minio/`).

## Getting Started

1. Click **Start** on the Pallet Defect Detection service. Demo Studio will:
   - Sparse-clone the upstream `manufacturing-ai-suite/industrial-edge-insights-vision` template.
   - Generate `.env` from `.env_pallet-defect-detection`, filling in `HOST_IP`, MinIO credentials, WebRTC credentials, and the configured ports.
   - Run upstream `setup.sh` to download the OpenVINO INT8 detection model and warehouse video.
   - Patch the bundled NGINX config to expose `/nginx_healthz` over HTTP for the Demo Studio health check.
   - `docker compose up -d` and wait for all containers to become healthy.
   - Call `sample_start.sh -p pallet_defect_detection[_gpu|_npu]` to launch the GStreamer pipeline.
2. Once the service is **Online**, click **Open Stream** to view the WebRTC feed at `https://<host>:<https-port>/mediamtx/pdd/`. Accept the self-signed certificate prompt in your browser.
3. Stop the service from Demo Studio to run `docker compose down -v` and tear the stack down.

## Important Notice

This reference implementation is intended to allow users to examine and evaluate the Pallet Defect Detection application and the associated performance of Intel technology solutions. The accuracy of computer-vision models is a function of the relation between the data used to train them and the data the models encounter after deployment. The bundled model has been tested using datasets that may not be sufficient for use in production applications. Intel recommends and requests that this model be tested against data the model is likely to encounter in specific deployments.

## Licensing Information

**FFmpeg**: FFmpeg is an open source project licensed under LGPL and GPL. See [FFmpeg Legal Information](https://www.ffmpeg.org/legal.html). You are solely responsible for determining if your use of FFmpeg requires any additional licenses.

**GStreamer**: GStreamer is an open source framework licensed under LGPL. See [GStreamer Licensing Information](https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html). You are solely responsible for determining if your use of GStreamer requires any additional licenses.
