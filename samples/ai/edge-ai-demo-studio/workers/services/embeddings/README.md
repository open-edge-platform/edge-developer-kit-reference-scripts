# embeddings — OEP multimodal embeddings, run natively

This worker is the [multimodal-embedding-serving microservice](https://github.com/open-edge-platform/edge-ai-libraries/tree/main/microservices/multimodal-embedding-serving)
from `open-edge-platform/edge-ai-libraries`, run as an ordinary Edge AI Studio
worker: no container runtime, one `uv` virtualenv, started by the app through
the same `start.sh <args>` + `/healthcheck` contract as everything else under
`workers/services/`.

It is the second engine of the **Text Embedding** service (`embeddings`,
port 8007). The service's `engine` field picks which one runs; the service
page shows a selector for it (`frontend/src/services/embeddings/data.ts`):

| Engine | What runs | Embeds |
|---|---|---|
| `multiserve` (default) | `workers/engines/multiserve`: OpenVINO Model Server or llama.cpp | text |
| `worker` | **this directory** (`workers/services/embeddings`, the default worker dir for the service id) | text **and images** (CLIP, SigLIP); text only for `QwenText/*` |

Switching engines resets the model to that engine's default, because model
names are engine-specific (`OpenVINO/Qwen3-Embedding-0.6B-int8-ov` vs
`CLIP/clip-vit-b-16`). Both engines answer OpenAI-shaped `POST /v1/embeddings`,
so the vectordb worker and the RAG samples (`rag-chatbot`, `ai-exam-marking`,
`webcam-vlm`, `digital-avatar`) work on either without changes.

| | |
|---|---|
| Upstream | `microservices/multimodal-embedding-serving` |
| Pinned tag | `tag` in [`workers/oep-services.json`](../../oep-services.json) |
| Port | `8007` (the Text Embedding service port) |
| Backend | OpenVINO on CPU, GPU or NPU (NPU for the CLIP / SigLIP models; the Qwen text model fails to compile on the NPU driver) |
| API | OpenAI-compatible `POST /v1/embeddings`, `GET /v1/models` (added by the wrapper) plus every upstream route: `POST /embeddings` (typed text / image / video input), `GET /models`, `GET /model/current`, `GET /model/capabilities`, `GET /health` |

## How the upstream source gets here

The service source is **not committed** to this repository. `start.sh` and
`start.ps1` call `oep_fetch services/embeddings`, which runs
`workers/oep-setup.sh fetch services/embeddings`. That script reads
`workers/oep-services.json`, the catalogue of OEP microservices Edge AI Studio
uses together with the pinned release `tag` (this worker's entry names
`microservices/multimodal-embedding-serving`), and copies that directory at
that release tag into `thirdparty/multimodal-embedding-serving` (gitignored)
out of the one sparse clone of `edge-ai-libraries` the script keeps under
`workers/thirdparty/`. The copy is skipped when it already carries that exact
tag (`.demo-studio-edge-ai-libraries-ref`). There is no `overlay/`: every
native adaptation is an environment variable or an in-memory stub, so
upstream files are never replaced.

Bump the tag (`workers/oep-setup.sh pin <tag>`) to move to a newer upstream;
the next start remakes the copy. To try a different release without editing
the repository, set `EDGE_AI_LIBRARIES_REF=<tag>` for one start.
`workers/oep-setup.sh` lists every OEP-backed worker with its pin, `check`
verifies the copies, and `info services/embeddings` shows what this entry
resolves to.

## Its own virtualenv

This worker is **not a uv project** and is excluded from the `workers/` uv
workspace (root `pyproject.toml`, `exclude`): upstream converts CLIP / SigLIP /
Qwen models with `optimum.intel` in-process, and upstream owns its pins (see
below), which in the workspace would apply to every worker. `start.sh` /
`start.ps1` build `.venv` from upstream's own Poetry project and `poetry.lock` at
the fetched tag (`run_oep_worker` / `Start-OepWorker`, which call
`workers/scripts/oep_env.py`), then run `main.py` in it. The first start installs
everything and takes minutes; later starts only check, and a tag bump rebuilds
the environment.

```bash
./start.sh --port 8007 --model CLIP/clip-vit-b-16 --device CPU   # first start installs .venv (large: torch + OpenVINO + optimum + open_clip)
curl http://127.0.0.1:8007/healthcheck
curl -X POST http://127.0.0.1:8007/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"input": [{"type": "image_url", "image_url": "https://example.com/photo.jpg"}, "a photo of a cat", "a photo of a dog"]}'
```

## What is adapted, and where

Upstream ships a Docker-first setup: `setup.sh` exports `EMBEDDING_*`
variables for compose, and the app reads them once at import through a
pydantic `Settings` class. The native run sets the same variables.

**`main.py`** — the wrapper that runs the upstream FastAPI app unchanged and
adds only (through `worker_common.oep`):

- `--model/--device/--port` flags (what the frontend's `buildArgs` passes),
  published as `EMBEDDING_MODEL_NAME`, `EMBEDDING_DEVICE`, `EMBEDDING_USE_OV=true`
  and the per-device defaults upstream's `setup.sh` exports
  (`OV_PERFORMANCE_MODE`, `INFER_BATCH_SIZE`, `PREPROCESS_WORKERS`) before
  upstream loads its settings. `--model` takes upstream's `<Family>/<name>`
  ids (`clip`, `siglip`, `qwen3-embedding` and `Qwen/Qwen3-Embedding-*` are
  accepted as aliases).
- `--batch-size`, `--performance-mode` (`LATENCY`/`THROUGHPUT`) and
  `--model-cache` (the Runtime Settings' Advanced tuning): `INFER_BATCH_SIZE`,
  `OV_PERFORMANCE_MODE` and `OV_ENABLE_MODEL_CACHE=1`. Given, they win over
  the per-device defaults and the environment.
- `--precision` (`int8` default, `fp16`; the Runtime Settings' Precision):
  the weight format of a Qwen text model's export, set on upstream's preset
  (`MODEL_CONFIGS`, int8 there) after import and before its startup event
  builds the model. Each exports into its own `<model>/<FORMAT>` directory;
  fp16 is upstream's uncompressed export. int4 is not offered: upstream asks
  for it with `load_in_4bit`, which optimum-intel ignores. CLIP and SigLIP
  convert at their own precision.
- `EMBEDDING_OV_MODELS_DIR` pointed at `<repo>/models/embeddings`
  (`worker_common.paths.models_dir`), so the converted OpenVINO IR lives with
  the other workers' models and the app's "clear model cache" action works.
  The downloaded checkpoints go to the Hugging Face cache every worker
  shares, `<repo>/models/huggingface` (`worker_common.use_shared_hf_cache`);
  the `models/embeddings/huggingface` this worker used to keep moves there on
  start.
- placeholder modules for `mobileclip` and `cn_clip` in `sys.modules`:
  upstream's handler registry imports every handler eagerly, and those two
  packages are git-only / `--no-deps` installs in upstream's container (see
  below). The stubs keep the registry importable; selecting a MobileCLIP or
  CN-CLIP model fails at load time with a clear message.
- `POST /v1/embeddings` and `GET /v1/models` in the OpenAI shape. Upstream's
  own `POST /embeddings` takes one typed input and returns a bare vector,
  which would break every client written for multiserve. The added route
  accepts a string, a list of strings, or a list mixing strings with
  `{"type": "image_base64", "image_base64": "..."}` (raw or `data:` URL) and
  `{"type": "image_url", "image_url": "..."}` items, embeds texts in one
  batch, and returns `float` or `base64` vectors with the loaded model name.
  A different `model` in the request is logged and answered with the loaded
  model rather than rejected, since multiserve clients send multiserve ids.
- `/healthcheck`, answering 503 until upstream's startup (checkpoint
  download, first-run OpenVINO conversion, compile, health embedding) has
  finished, then 200 with the model's `capabilities` (modalities).

**Dependencies** — upstream's Poetry project at the pinned tag with its
`poetry.lock` as constraints, the way its Dockerfile runs `poetry install`
(`"install"` in `workers/oep-services.json`): torch/torchvision come from its
`pytorch-cpu` source, and its git packages (optimum-intel at `41640b8f9`, optimum)
at the commits the lock records, so `git` must be on `PATH` (the project setup
puts MinGit there on Windows). Upstream owns those pins and their security
fixes: a tag bump needs no change here. The only deviations:

- `cn-clip` (Chinese CLIP) is left out ([`overrides.txt`](overrides.txt)): it
  hard-pins `lmdb==1.3.0`, which has no wheels for Python 3.12 and needs a C
  compiler. The `CN-CLIP/*` models are therefore unavailable.
- `mobileclip` (installed from Apple's git repository with `--no-deps` in
  upstream's Dockerfile) and `salesforce-lavis` (BLIP-2 extras, `--no-deps`)
  are not installed. `MobileCLIP/*` models are unavailable; `Blip2/blip2`
  loads through `transformers` and is not listed in the UI (4 GB checkpoint,
  256-d retrieval embeddings).
- `gunicorn` is installed as upstream lists it, though only upstream's
  container entrypoint uses it; the wrapper runs uvicorn like every other
  worker.

Everything else — batching, image preprocessing workers, video frame
extraction, the security checks on remote URLs and local paths — is upstream
behaviour.

## Models

| `models.default.name` | Modalities | Dimensions | Notes |
|---|---|---|---|
| `CLIP/clip-vit-b-32` | text, image | 512 | open_clip `ViT-B-32` / `laion2b_s34b_b79k` |
| `CLIP/clip-vit-b-16` (default) | text, image | 512 | open_clip `ViT-B-16` / `openai`, converted with optimum-intel |
| `CLIP/clip-vit-l-14` | text, image | 768 | open_clip `ViT-L-14` / `datacomp_xl_s13b_b90k`; heavy |
| `SigLIP/siglip2-vit-b-16` | text, image | 768 | open_clip `ViT-B-16-SigLIP2` / `webli`; upstream traces the encoders itself |
| `SigLIP/siglip2-vit-l-16` | text, image | 1024 | heavy |
| `QwenText/qwen3-embedding-0.6b` | text | 1024 | `Qwen/Qwen3-Embedding-0.6B`, exported int8 with optimum-intel; instruction-aware |

Devices: `CPU`, `GPU`, and `NPU` for the CLIP / SigLIP models (OpenVINO).
On the NPU upstream reshapes both encoders to static batch-16 shapes (larger
requests are chunked) and enables OpenVINO's compiled-blob cache under
`ov-models/ov_cache`, so the first NPU start compiles for about a minute and
later starts take a couple of seconds. `QwenText/*` is CPU/GPU only: the NPU
driver rejects its compiled graph (`ZE_RESULT_ERROR_INVALID_ARGUMENT`). Model
switching means a restart, as with every worker; the first start of a model
downloads and converts it (about a minute for the ViT-B models on CPU), later
starts reuse the IR under `models/embeddings/ov-models`.

### Models on disk

`list_models.py --models <id> [<id> ...]` reports which of the six models
above already have their OpenVINO IR under `models/embeddings/ov-models`,
without starting the worker. CLIP/SigLIP ids map to a fixed
`<open_clip name>_<pretrained tag>` file prefix and QwenText to a sanitized
`<hf id>/<weight format>/` subdirectory — see the script's header comment
for the exact table.

## Instances

Nothing to redirect per instance: `/v1/embeddings` and upstream's text/image
routes only read the model. Upstream's own `POST /embeddings` writes a temp
file per video request under `<system temp>/videoQnA`, shared by every
instance; the names are `uuid4()`-derived, so instances never collide.

## Optional upstream settings

Anything upstream reads from the environment can be overridden per start.
Values already set in the environment win over `main.py`'s defaults (but not
over the tuning flags above). For example, in the shell:

```bash
# Run the PyTorch implementation instead of OpenVINO
export EMBEDDING_USE_OV=false

# Larger inference batches / more preprocessing threads
export INFER_BATCH_SIZE=64
export PREPROCESS_WORKERS=16

# Persist compiled OpenVINO blobs on CPU/GPU too (upstream: NPU only)
export OV_ENABLE_MODEL_CACHE=1
```
