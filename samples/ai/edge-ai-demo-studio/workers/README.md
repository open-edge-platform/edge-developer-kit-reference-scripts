# workers/

The Python services the app starts, one process per service instance. Every
worker is a small FastAPI app built on the shared `worker-common` package, and
all of them live in one uv workspace rooted here.

## Layout

```
workers/
├── pyproject.toml        workspace root (virtual, no [project]); its comments explain every pin and exclusion
├── uv.lock               one lock for every member
├── .venv/                one shared environment
├── common/               worker-common: the shared library (see common/README.md)
│   ├── downloader/             model-downloader: Hugging Face, ModelScope, URLs, ovms --pull
│   ├── audio-input-stream/     live-microphone VAD segmentation for workers that transcribe in-process
│   ├── ovms-export/            the optimum-cli environment `ovms --pull` converts with (own .venv)
│   └── ovms-export-qwen3-asr/  the same for Qwen3-ASR (own .venv)
├── services/<name>/      one directory per worker; services with several backends nest one level
│                         deeper (ocr/paddleocr, speech-to-text/{ovms,oep}, text-to-speech/{kokoro,piper,...})
├── engines/multiserve/   the OVMS / llama.cpp model server behind Text Generation, Embeddings, Rerank
├── suites/               docker-compose apps from edge-ai-suites (shell only, not uv members)
├── scripts/              worker-common.sh / .ps1, sourced by every start script
├── oep-services.json     catalogue of upstream code fetched at a pinned release (see "Upstream code")
├── oep-setup.sh / .ps1   fetches what the catalogue lists
└── thirdparty/           uv, OVMS, upstream source caches (gitignored)
```

**The workspace root sits above its members on purpose.** uv finds a workspace
by walking up, so `uv run` inside any worker uses the shared `.venv` and
`worker-common = { workspace = true }` resolves without a `--project` flag.

**Some workers keep their own environment.** A worker whose dependencies
cannot share the workspace's pins (geti-sdk caps openvino, tflite-runtime
stops at Python 3.11, llama-index caps openai) is listed under `exclude` in
`pyproject.toml`, with the reason as a comment. It keeps its own `uv.lock`
and `.venv` and takes `worker-common` / `model-downloader` by path instead of
`{ workspace = true }`. Start scripts need no special casing: `run_worker`
uses the worker's own `uv.lock` when it has one.

**The OEP wrappers install upstream's own files.** `services/speech-to-text/oep`,
`services/text-to-speech/oep-tts` and `services/embeddings` are excluded too, but
have no `pyproject.toml` or `uv.lock`: their start scripts call `run_oep_worker` /
`Start-OepWorker`, which build `.venv` from the dependency file upstream ships at
the tag in `oep-services.json` (`"install"`, read by `scripts/oep_env.py`) plus
`worker-common`, then run `main.py` in it. Bumping the tag is the whole upgrade;
upstream owns those pins and their security fixes. `<worker>/overrides.txt` holds
the only deviations, each for something that does not install or run on our
platforms.

## How the app runs a worker

1. The service's `frontend/src/services/<id>/data.ts` names the directory
   (`workerSubDir`) and the arguments (`buildArgs`).
2. The app runs `start.sh` (`start.ps1` on Windows) in that directory with
   those arguments (including the `--port` it allocated) plus
   `--instance-id <id> --data-dir <dir>`, and sets `INSTANCE_ID`,
   `INSTANCE_DATA_DIR` and `EDGE_AI_STUDIO_URL` in the environment.
3. `run_worker` (from `scripts/worker-common.sh`) installs only this worker
   with `uv sync --frozen`, then runs `uv run --no-sync main.py <args>`
   (`run_oep_worker` for the OEP wrappers, above).
4. `main.py` binds `127.0.0.1` on the assigned port. The app polls
   `/healthcheck` and proxies the browser's calls to `/api/<type>@<instance>/...`.

There are no per-worker setup scripts. One-time provisioning (an export
environment, a model conversion) runs in `start.sh` / `start.ps1` on first
start, behind a check for the file it produces.

## Adding a worker

```
workers/services/<name>/
├── pyproject.toml   dependencies (workspace member)
├── main.py          the FastAPI app
├── start.sh         Linux entry point (executable)
├── start.ps1        Windows entry point
├── list_models.py   optional: reports which presets are on disk without starting the worker
└── README.md        optional: anything a reader of main.py would not guess
```

### `pyproject.toml`

```toml
[project]
name = "<name>"
version = "0.1.0"
description = "<one line>"
requires-python = ">=3.12,<3.13"
dependencies = [
    "worker-common",          # brings fastapi and uvicorn; worker-common[audio] adds pydub + soundfile
    "model-downloader",       # only if the worker downloads weights
    "openvino==2026.2.1",
]

[tool.uv.sources]
worker-common = { workspace = true }
model-downloader = { workspace = true }
```

Add `python-multipart` (or depend on `fastapi[standard]`) if a route takes
`File` / `Form` parameters. A worker that needs torch takes the XPU build,
declared in the member itself because uv reads a member's sources only from
that member:

```toml
dependencies = [..., "torch==2.13.0"]

[tool.uv.sources]
torch = { index = "pytorch" }

[[tool.uv.index]]
name = "pytorch"
url = "https://download.pytorch.org/whl/xpu"
explicit = true
```

Use the versions the other members use, or the workspace stops resolving:

| Package | Version |
|---|---|
| `openvino` / `openvino-genai` | `2026.2.1` / `2026.2.1.0` |
| `torch` / `torchvision` / `torchaudio` | `2.13.0` / `0.28.0` / `2.11.0` (XPU index) |

Don't add `triton-xpu` or `opencv-python-headless` (the root removes both;
use `opencv-python`). Don't add git dependencies either: uv keeps a full clone
of each in its cache, so a package with no usable release is vendored through
`oep-services.json` beside `main.py`, with its requirements listed in the
worker's `pyproject.toml` (see [Upstream code](#upstream-code)). Don't take the
copy by path: it is gitignored, and `uv run` or `uv lock` anywhere in the
workspace would fail with `Distribution not found` until it was fetched.

Then lock from `workers/` (or from the worker directory if it is excluded):

```bash
thirdparty/uv/uv lock
```

Start scripts install with `--frozen`, so a stale lock silently skips the new
dependency. The `uv lockfiles` CI job fails on it.

### `main.py`

```python
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from model_downloader import fetch_snapshot
from pydantic import BaseModel
from worker_common import AUTO_DEVICE, base_parser, create_app, get_logger, models_dir, serve

logger = get_logger(__name__)

ARGS = None
MODEL = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL
    model_path = models_dir("<name>", ARGS.model.replace("/", "_"))
    fetch_snapshot(ARGS.model, model_path, source=ARGS.source)
    MODEL = load_model(model_path, ARGS.device)  # your runtime
    logger.info("Loaded %s on %s", ARGS.model, ARGS.device)
    yield
    MODEL = None


# /healthcheck answers once the lifespan above has finished.
app = create_app("<Name> Worker", lifespan=lifespan)


class RunRequest(BaseModel):
    text: str


@app.post("/v1/run")
def run(req: RunRequest):
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return {"result": MODEL(req.text)}


def main():
    global ARGS
    parser = base_parser("<Name> Worker", default_port=8099, default_device=AUTO_DEVICE, source=True)
    parser.add_argument("--model", default="<org>/<model>")
    ARGS = parser.parse_args()
    serve(app, ARGS)


if __name__ == "__main__":
    main()
```

`default_port` is only used when the worker is started by hand; the app always
passes `--port`. Declare request models at module scope: with
`from __future__ import annotations` FastAPI resolves annotations against
module globals, and a model defined inside a function is silently read as a
query string instead of a body.

### `start.sh` and `start.ps1`

```bash
#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKERS_ROOT="$SCRIPT_DIR"
while [ "$WORKERS_ROOT" != "/" ] && [ ! -f "$WORKERS_ROOT/scripts/worker-common.sh" ]; do
    WORKERS_ROOT="$(dirname "$WORKERS_ROOT")"
done
# shellcheck source=workers/scripts/worker-common.sh
. "$WORKERS_ROOT/scripts/worker-common.sh"

cd "$SCRIPT_DIR"
require_uv
run_worker "$@"
```

```powershell
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkersRoot = $ScriptDir
while (-not (Test-Path (Join-Path $WorkersRoot "scripts\worker-common.ps1"))) {
    $WorkersRoot = Split-Path -Parent $WorkersRoot
}
. (Join-Path $WorkersRoot "scripts\worker-common.ps1")

Set-Location $ScriptDir
Test-UV
Start-Worker @args
```

The loop finds `workers/` at any depth, so the same lines work in
`services/<name>/` and `services/<group>/<backend>/`; never count `../`. Before
`run_worker`, add what the worker needs: `require_ffmpeg`, `ovms_prepare` for
an OVMS-backed worker, `oep_fetch <worker>` for catalogued upstream code. The
script exports `WORKERS_ROOT`, `PROJECT_ROOT`, `UV_CMD`, `OVMS_PATH`,
`FFMPEG_PATH`, `MODELS_DIR` and `HF_HOME` (the shared Hugging Face cache,
`<repo>/models/huggingface`, unless one is already set).

### `list_models.py` (optional)

`python3 list_models.py --models <id> [<id> ...]` prints
`[{"name", "downloaded", "path", "files"}]` so the configure sheet shows which
presets are on disk without starting the worker. `files` is every file or
folder on disk that only this preset uses, partial downloads included: its
exports at every precision, raw checkpoints, and its repository folder in the
shared Hugging Face cache (`hf_repo_dir(repo_id)`). It is what Runtime
Settings → Maintenance deletes when a user deletes that one model, so leave
out anything another preset also needs. The app deletes only paths inside the
service's `modelDirectories` or a Hugging Face repository folder. It runs
outside the worker's environment: stdlib only, plus `worker_common/paths.py`
loaded by file path (see `services/diarization/list_models.py`). The app runs
it when `data.ts` declares `modelCatalog: 'script'`. A worker with a few fixed
files per preset can declare `modelCatalog: { presetPaths: {...} }` instead
and ship no script.

### Wire it into the app

Add `frontend/src/services/<id>/data.ts` exporting `service` and `worker`,
then run `npm run codegen` in `frontend/`. The worker half:

```ts
export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => [
    '--port', String(doc.port),
    '--device', doc.models?.default?.device ?? 'AUTO',
    '--model', doc.models?.default?.name ?? '<org>/<model>',
  ],
  workerSubDir: 'services/<name>',     // relative to workers/
  modelDirectories: ['models/<name>'], // what "Clear model cache" removes
  modelCatalog: 'script',              // only with a list_models.py
}
```

The demo, params hook, config and docs are covered in
[docs/DEVELOPMENT.md § Adding a New Service](../docs/DEVELOPMENT.md#adding-a-new-service).

## Common imports

Everything below comes from `worker_common` unless noted. Don't
re-implement any of it in a worker; [common/README.md](common/README.md)
describes each module.

| For | Use |
|---|---|
| FastAPI app, CORS, `/healthcheck` | `create_app(title, lifespan=...)`; `healthcheck=False` to serve your own route (503 until ready), `allow_origins=lan_origins(port)` when the browser calls the worker directly |
| `--port`, `--device`, `--source`, `--instance-id`, `--data-dir` | `base_parser(...)`, then `serve(app, args)` (binds `127.0.0.1`) |
| Logging | `get_logger(__name__)` |
| Devices | `AUTO_DEVICE`, `openvino_devices()`, `resolve_torch_device()`. Hand `AUTO` to OpenVINO as it is, never pick the device yourself: GPU-only compile options go through `openvino_compile_config(device, gpu=...)`, and `openvino_execution_device(compiled)` names the device OpenVINO selected |
| Where models go | `models_dir("<name>", ...)`, which is `<repo>/models/<name>/...` |
| Hugging Face hub cache | the one every worker shares, `hf_home()` (`<repo>/models/huggingface`). Never point `HF_HOME` at a folder of your own: two workers needing one repository would download it twice. A worker started without the launcher calls `use_shared_hf_cache()` before anything imports `huggingface_hub`. If the worker loads weights from the hub cache, add `'models/huggingface'` to its `modelDirectories` |
| Downloading weights | `from model_downloader import fetch_snapshot, fetch_file, fetch_url, fetch_omz_ir, ovms_pull`. Never call `huggingface_hub`, `modelscope` or `ovms --pull` directly |
| Converting a shared model | `with shared_model_lock(path):` so two instances never convert the same model at once (downloads already lock) |
| Where to write anything else | `instance_data_dir("./data", args=args)`, never a path in the source tree |
| Calling another service | `service_base_url("text-generation", suffix="/v1", env="TEXT_GENERATION_URL")` |
| OpenVINO Model Server | `OvmsServer(...)`, `.start()`, `.wait_model_ready()` |
| ffmpeg / pydub | `add_ffmpeg_to_path()`, `configure_pydub()`, `transcode_wav()` |
| OpenAI-compatible routes | `install_models_routes(app, lambda: [MODEL_ID])`, `install_openai_errors(app)` |
| Text-to-speech output | `from worker_common.speech import speech_response` |
| Long calls, background jobs | `sse_response()`, `watch_status()`, `CancelToken` |
| Model time for Live metrics | `server_timing()`, `timed()` |
| Wrapping an OEP microservice | `worker_common.oep` |

If the capability exists in OpenAI's API (chat, embeddings, transcription,
speech, images), serve it under `/v1/...` in OpenAI's shape so an OpenAI SDK
works against the worker unchanged.

## Upstream code

A worker that wraps an
[edge-ai-libraries](https://github.com/open-edge-platform/edge-ai-libraries)
microservice, or needs a package with no usable release (kokoro, malaya, vieneu),
gets that code from a git clone at the pin in `oep-services.json`. Nothing upstream
is committed or edited in place: the start script calls
`oep_fetch <worker>`, which copies the source into the worker's gitignored
`thirdparty/`, or beside `main.py` for a package the worker imports. Each
such worker's README lists what it changes in the copy (overlay files, a
patch, environment settings, in-memory replacements).
[docs/DEVELOPMENT.md § OEP-backed workers](../docs/DEVELOPMENT.md#oep-backed-workers-vendored-sources-and-custom-workers)
has the catalogue format and the steps for adding one.

```bash
./oep-setup.sh                  # list catalogued services, sources, suites, custom workers
./oep-setup.sh check            # exit 1 when a copy is missing or at another pin
./oep-setup.sh fetch <worker>   # what start scripts run; also fetch --all
./oep-setup.sh pin <tag>        # bump the edge-ai-libraries tag, then fetch --all
```

## Commands

```bash
./setup.sh --setup-workers                    # shared .venv and common packages only
./services/<name>/start.sh --port 8099        # run one worker by hand
thirdparty/uv/uv add --package <name> <pkg>   # add a dependency to one member
thirdparty/uv/uv lock                         # after any pyproject.toml change
.venv/bin/python common/tests/test_worker_common.py   # shared helper checks, no worker started
.venv/bin/python common/tests/test_openai_compat.py
```
