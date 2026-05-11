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

3) Export render group ID (for GPU access) and run
If you use GPU passthrough, export the `RENDER_GROUP_ID` environment variable so the container can access the render group:

```
export RENDER_GROUP_ID=$(getent group render | awk -F: '{printf "%s\n", $3}')
docker compose up -d
```

Notes
- If you don't have GPU/NPU hardware, you can leave the device lines commented; the app will still run but without hardware acceleration.
- If `getent group render` returns nothing, you may need to find the appropriate group ID for your system (often `render` or `video`) or run without setting `RENDER_GROUP_ID` and adjust permissions manually.
- The app is exposed on port `8080` by default; open http://localhost:8080 after the container is running.
