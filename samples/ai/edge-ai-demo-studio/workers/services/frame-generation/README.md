# Frame Generation Worker

Standalone RIFE (IFNet) video frame interpolation service running on OpenVINO
(CPU/GPU/NPU).

It serves two use cases:

- **Pairwise interpolation** (`POST /v1/frame-generation/interpolate`) — fill
  the frames between keyframe pairs. Used by the lipsync worker
  (`services/lipsync`, through `modules/frame_generation/client.py`) to reach
  the avatar frame rate when Wav2Lip inference alone cannot keep up.
- **Video interpolation** (`POST /v1/frame-generation/video`) — upload a video
  and interpolate between every pair of consecutive frames, either to multiply
  its frame rate (`mode=fps`, 2x-4x, same duration, audio kept) or to produce
  smooth slow motion (`mode=slowmo`, same frame rate, 2x-4x duration, audio
  dropped). Jobs are queued and run one at a time on a dedicated worker
  thread; poll `GET /v1/tasks/{taskId}` for queue position and progress
  (`progress` 0-1 plus `frames_done`/`frames_total` output frames while
  running), or follow `GET /v1/tasks/{taskId}/events`, which sends the same
  status as a Server-Sent Event whenever it changes and ends after the final
  one (`worker_common.sse.watch_status`). `DELETE /v1/tasks/{taskId}` cancels
  a task (`worker_common.cancel`): a queued one ends `cancelled` at once and
  leaves the queue, a running one reports `cancel_requested: true` until its
  next chunk, then stops and its partial video is deleted. Download the result from
  `GET /v1/frame-generation/video/{taskId}`: a task's status and output video
  are deleted `RESULT_TTL_SECONDS` (an hour) after it ends, and so are files
  that old in `data/uploads` and `data/outputs` no task knows about.

There is also `POST /v1/frame-generation/benchmark`, which measures the
interpolation throughput (frames/sec) for a given gap schedule so callers such
as the lipsync planner can decide how densely to interpolate.
`interpolate` and `benchmark` share the model with the video job thread: they
take the same lock (a video job releases it between chunks) in a worker
thread, so a running video job never stalls the server.
`GET /healthcheck` answers 503 until the model is downloaded, converted and
warmed, then `{"status": "ok", "device": "<device>"}`.

## Run

The worker is a member of the `workers/` uv workspace (see
[`workers/README.md`](../../README.md)): it runs in the shared `.venv` and
builds on `worker-common` (app skeleton, CLI, logging, devices) and
`model-downloader` (weights).

```bash
./start.sh --port 8031 --device AUTO
```

Arguments:

- `--port` — server port (default `8031`; `SERVER_PORT` wins)
- `--device` — OpenVINO device for the RIFE model: `AUTO`, `CPU`, `GPU`,
  `GPU.1`, `NPU` (default `AUTO`). With `AUTO`, OpenVINO selects the device (a
  discrete GPU, then an integrated GPU, then the CPU); the model is compiled
  with static shapes on every device but the CPU, AUTO included, and
  `/healthcheck` reports the device it runs on. The app offers `AUTO`, `CPU` and
  `GPU` only: the NPU compiler cannot fit RIFE's GridSample warp at full-frame
  resolutions.
- `--source` — model download source: `huggingface` or `modelscope`

The RIFE weights (`TensorForger/RIFE-safetensors`, `flownet.safetensors`) are
fetched through `model_downloader.fetch_file` into `<repo>/models/rife/` on
first start and converted to an OpenVINO IR (`<repo>/models/rife/rife_ov/`)
automatically — the same shared root the frontend's
`modelDirectories: ['models/rife']` and every other instance of this worker
use (`worker_common.models_dir("rife", ...)`), not this worker's own source
directory. A worker directory from before this moved
(`workers/services/frame-generation/models/rife/`) is migrated into place
automatically on first startup after the upgrade, when the new location does
not exist yet; see `worker_common.paths.migrate_legacy_models_dir`.

## Models on disk

`list_models.py --models RIFE` reports whether both the raw checkpoint
(`<repo>/models/rife/flownet.safetensors`) and the converted OpenVINO IR
(`<repo>/models/rife/rife_ov/rife.xml`+`.bin`) are already on disk, without
starting the worker.
