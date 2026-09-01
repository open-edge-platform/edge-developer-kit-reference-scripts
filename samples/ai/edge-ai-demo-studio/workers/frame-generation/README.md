# Frame Generation Worker

Standalone RIFE (IFNet) video frame interpolation service running on OpenVINO
(CPU/GPU/NPU).

It serves two use cases:

- **Pairwise interpolation** (`POST /v1/frame-generation/interpolate`) — fill
  the frames between keyframe pairs. Used by the lipsync worker to reach the
  avatar frame rate when Wav2Lip inference alone cannot keep up.
- **Video interpolation** (`POST /v1/frame-generation/video`) — upload a video
  and interpolate between every pair of consecutive frames, either to multiply
  its frame rate (`mode=fps`, 2x-4x, same duration, audio kept) or to produce
  smooth slow motion (`mode=slowmo`, same frame rate, 2x-4x duration, audio
  dropped). Jobs are queued and run one at a time on a dedicated worker
  thread; poll `GET /v1/tasks/{taskId}` for queue position and progress.

There is also `POST /v1/frame-generation/benchmark`, which measures the
interpolation throughput (frames/sec) for a given gap schedule so callers such
as the lipsync planner can decide how densely to interpolate.

## Run

```bash
./start.sh --port 8031 --device GPU
```

Arguments:

- `--port` — server port (default `8031`)
- `--device` — OpenVINO device for the RIFE model: `CPU`, `GPU`, `GPU.1`, `NPU`
  (default `CPU`)
- `--source` — model download source: `huggingface` or `modelscope`

The RIFE weights are downloaded to `models/rife/` on first start and converted
to an OpenVINO IR automatically.
