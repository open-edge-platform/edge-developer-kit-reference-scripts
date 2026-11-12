# Docker setup & run

This document explains how to build and run the project with Docker, and how to enable GPU / NPU device passthrough.

1) Enable device passthrough (optional)
- If your system has an NPU, uncomment the following line in `docker/compose.yml` under `devices`:
  - "/dev/accel:/dev/accel"
- If your system has a GPU, uncomment the following line in `docker/compose.yml` under `devices`:
  - "/dev/dri:/dev/dri"

2) Build the image
Run from the project root or from `docker/`:

```
docker compose build
```

The image contains both llama.cpp builds, SYCL and Vulkan, for the LLM engine. SYCL is the default. To use Vulkan, set `LLAMACPP_BACKEND=vulkan` in the shell or in a `.env` file next to `docker-compose.yml`, then run `docker compose up -d`. Switching back works the same way and needs no rebuild.

3) Export render group ID (for GPU access) and run
If you use GPU passthrough, export the `RENDER_GROUP_ID` environment variable so the container can access the render group:

```
export RENDER_GROUP_ID=$(getent group render | awk -F: '{printf "%s\n", $3}')
docker compose up -d
```

Notes
- If you don't have GPU/NPU hardware, you can leave the device lines commented; the app will still run but without hardware acceleration.
- If `getent group render` returns nothing, you may need to find the appropriate group ID for your system (often `render` or `video`) or run without setting `RENDER_GROUP_ID` and adjust permissions manually.
- The container uses the host's network and the app listens on `127.0.0.1:8080`; open http://127.0.0.1:8080 on the host after the container is running. Port `8080` must be free on the host.
