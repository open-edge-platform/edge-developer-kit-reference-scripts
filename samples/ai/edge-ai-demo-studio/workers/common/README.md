# worker-common

Shared runtime helpers for Edge AI Studio workers. It is a member of the
`workers/` uv workspace, so any worker can depend on it with:

```bash
uv add --package <worker> worker-common
```

which records it as a workspace dependency:

```toml
dependencies = ["worker-common", ...]

[tool.uv.sources]
worker-common = { workspace = true }
```

## What it covers

| Module | Provides |
|---|---|
| `worker_common.app` | `create_app()` — FastAPI + CORS + `/healthcheck` (`healthcheck=False` for a readiness-gated route of your own, `allow_origins=` for a worker the browser calls directly); `cors_origins()` reads `ALLOWED_CORS` |
| `worker_common.cli` | `base_parser()` — `--port`, `--device`, opt-in `--source` (huggingface/modelscope) and `--host`; on by default, `--instance-id`/`--data-dir` (`instance=False` to drop them); `serve()` — uvicorn honouring `SERVER_HOST` / `SERVER_PORT`, then `--host`/`--port`, then `default_host` |
| `worker_common.instance` | the service-instance contract — see [Service instances](#service-instances) below |
| `worker_common.log` | `get_logger()` — one format, level from `LOG_LEVEL`, output on stderr |
| `worker_common.devices` | `openvino_devices()`, `default_openvino_device()`, `normalize_openvino_device()`, `torch_devices()`, `resolve_torch_device()` — the one device list the helper scripts, the OCR/Geti workers and the torch TTS workers report; runtimes imported lazily |
| `worker_common.audio` | the bundled ffmpeg: `ffmpeg_binary()`, `ffprobe_binary()`, `add_ffmpeg_to_path()`, `configure_pydub()`; `transcode_wav()` for a worker without pydub |
| `worker_common.net` | `local_ip()`, `lan_origins(port)` — CORS origins for a worker another device on the LAN reaches directly (WebRTC, the TTS demos) |
| `worker_common.proxy` | `ensure_loopback_no_proxy()` — adds `localhost,127.0.0.1,::1` to `no_proxy`/`NO_PROXY`, run when `worker_common` is imported (and by `base_parser()`) so a shell's `http_proxy` never swallows a worker's calls to itself, its OVMS, the app or a sibling; `loopback_opener()` — a proxy-free `urllib` opener, used by the readiness and sibling-lookup polls |
| `worker_common.ovms` | `OvmsServer` — spawn the shared OpenVINO Model Server in the environment `ovms --pull` ran in, `wait_model_ready()`, `stop()`; used by speech-to-text, image-generation and multiserve |
| `worker_common.openai_compat` | `install_models_routes()`, `install_openai_errors()`, `override_api_route()`, the `response_format` helpers |
| `worker_common.perf` | `server_timing()`, `timed()` — the model time a non-streamed answer reports to the app's Live metrics |
| `worker_common.cancel` | `CancelToken` (`cancel()`, `check()` raising `JobCancelled` at a job's next safe point), `CANCELLED` — the `DELETE` contract for background jobs |
| `worker_common.sse` | `sse_event()`, `sse_response()` (keep-alive comments while a generator is busy; a sync generator runs in the threadpool), `watch_status()` — output streams and job status events for long calls; see "Long-running calls" in `docs/DEVELOPMENT.md` |
| `worker_common.speech` | `speech_response()` — `POST /v1/audio/speech` from a generator of synthesized `(samples, sample_rate)` pieces: the whole file with `Server-Timing`, a growing stream (`stream: true`: WAV with `0xFFFFFFFF` sizes, PCM, MP3/AAC per piece) or OpenAI's `speech.audio.delta`/`done` events (`stream_format: "sse"`), each piece made under the worker's lock in the threadpool; `split_sentences()`, `encode_audio()`, `decode_wav()`. Needs numpy, so it is not re-exported from `worker_common`: import `worker_common.speech`. Used by every text-to-speech worker; checks in `tests/test_speech.py` |
| `worker_common.paths` | `project_root()`, `workers_root()`, `models_dir()`, `thirdparty_dir()` — sentinel-based, never counting `..` |
| `worker_common.startup` | `report_stage()`, `report_progress()`, `end_stage()`, `report_failure()`, the `startup_stage()` context manager and `safe_text()` — structured startup reports (one `EDGE_AI_STUDIO_STARTUP {json}` line on stdout, only when the app sets `EDGE_AI_STUDIO_STARTUP_EVENTS=1`) that name the step the app's startup panel shows: Downloading, Preparing, Loading model, Checking readiness. `model_downloader`'s fetches, `OvmsServer.wait_model_ready()` and `create_app()`'s lifespan already report, so most workers need nothing of their own; checks in `tests/test_startup.py` |

`worker-common[audio]` adds `pydub` and `soundfile` for the workers that
decode uploads or export non-WAV speech, so they do not each pin the pair.

## Usage

```python
from worker_common import base_parser, create_app, get_logger, serve

logger = get_logger(__name__)
app = create_app("diarization", lifespan=lifespan)
app.include_router(jobs.router)

if __name__ == "__main__":
    serve(app, base_parser("Diarization Worker", default_port=8026, source=True).parse_args())
```

A worker whose `/healthcheck` must answer 503 until a model is loaded, or
that the browser calls on its own port:

```python
from worker_common import OvmsServer, create_app, lan_origins

app = create_app("Lipsync Worker", lifespan=lifespan, healthcheck=False, allow_origins=lan_origins(8080))

server = OvmsServer(["--rest_port", "5009", "--source_model", model_id, ...], name="OVMS speech2text")
server.start()
if not server.wait_model_ready(model_id, 5009, timeout=600):
    raise RuntimeError("OVMS did not become ready")
```

Tests, self-running (no pytest runner for workers), from `workers/`:

```bash
.venv/bin/python common/tests/test_worker_common.py     # skeleton, instance, devices, audio, net, ovms, proxy
.venv/bin/python common/tests/test_openai_compat.py     # OpenAI surface
```

## Service instances

The app can run several instances of one service type at once (two Text
Generation models, two OCR pipelines, ...). Every worker process it starts
gets, on top of its usual arguments:

```
env  INSTANCE_ID          the instance id (unique within its type)
env  INSTANCE_KEY         "type@instanceId"
env  INSTANCE_DATA_DIR    this instance's own writable directory, created
                           before the process is spawned
env  EDGE_AI_STUDIO_URL   loopback URL of the app
args --instance-id <id> --data-dir <dir>   (unless the worker's parser opts
                                             out with `instance=False`)
```

`base_parser()` adds `--instance-id`/`--data-dir` by default, so a worker
gets both without doing anything; `worker_common.instance` is what backs
them and what a worker calls to honour the contract:

* **Where to write.** Never a path relative to the worker's source tree,
  never `os.environ["INSTANCE_DATA_DIR"]` read by hand — `instance_data_dir(default)`
  is the one place that decides: `args.data_dir` (when `args` is passed) /
  `--data-dir` read straight out of `sys.argv` (when it is not — for a
  worker that computes its data directory at import time, before its own
  `parse_args()` has run) / `INSTANCE_DATA_DIR` / `default`, in that order.
  Returns an absolute `Path` and creates it. `instance_id()` honours
  `--instance-id` the same way, ahead of the `INSTANCE_ID` environment.
* **Reaching a sibling service.** There is no fixed port for "the Text
  Generation worker" any more; whichever instance is running answers
  through the app at `/api/<type>@<instance>`, and that can change while
  this worker runs. `service_base_url("text-generation", suffix="/v1", env="TEXT_GENERATION_URL")`
  returns, in order: the named environment variable when a deployment set
  one (an explicit override); the address `resolve_service_address()` looks
  up through the app; or a deliberately unreachable URL so a missing
  sibling fails a request clearly instead of hitting a guessed port. The
  address is only valid for as long as that instance keeps running — a
  worker that builds a client once and keeps it should re-resolve every so
  often rather than trust it forever (see the frame-generation client's
  TTL-based re-resolution for the pattern).
* **A models directory shared between instances.** Two instances (of one
  type, or of two types that happen to point at the same models directory)
  must never download or convert the same model at once — the weights are
  shared, the download is not. Wrap it:

  ```python
  with shared_model_lock(model_repository_path / model_id):
      pull_model(...)
  ```

  It is a cross-process lock (an atomically created `.lock` directory). The
  holder writes its pid into an `owner` file inside it; a waiter reclaims the
  lock once that pid is confirmed dead (a process that crashed without
  cleaning up), never while it is still alive, however long the download —
  `timeout` (default 4 hours) is how long a waiter accepts sitting behind a
  live holder, and `stale` (default 2 hours) is a second, mtime-based
  safety net for a lock whose owner file is unreadable or whose liveness
  cannot be determined.
* **An embedded server of its own** (OVMS, a sidecar) binds `--port + 1` —
  instances of one type never share a port range, so this stays collision-free.

```python
from worker_common import instance_data_dir, service_base_url, shared_model_lock

data_dir = instance_data_dir("./watched_folder", args=args)
llm_url = service_base_url("text-generation", suffix="/v1", env="TEXT_GENERATION_URL")
```

## Adding to it

Only put something here when at least two workers need it and it has no
worker-specific behaviour. Anything importing a model runtime (torch,
openvino) is imported inside the function that needs it, never at module
level — `worker-common` must stay installable by the lightest worker.
