# text-to-speech/oep-tts — OEP text-to-speech, run natively

This worker is the [text-to-speech microservice](https://github.com/open-edge-platform/edge-ai-libraries/tree/main/microservices/text-to-speech)
from `open-edge-platform/edge-ai-libraries`, run as an ordinary Edge AI Studio
worker: no container runtime, one `uv` virtualenv, started by the app through
the same `start.sh <args>` + `/healthcheck` contract as everything else under
`workers/services/`.

It is one of the workers behind the single **Text to Speech** service. The
frontend picks the directory from the selected model
(`frontend/src/services/text-to-speech/lib/tts-models.ts`, `getTtsWorker`):

| Selected model | Worker directory |
|---|---|
| `kokoro` | `workers/services/text-to-speech/kokoro` (built-in) |
| `malaya` | `workers/services/text-to-speech/malaya` (built-in) |
| `piper` | `workers/services/text-to-speech/piper` (built-in) |
| anything else, e.g. `microsoft/speecht5_tts` | **this directory** |

So a model upstream serves is reachable without touching the built-in workers,
and a model that upstream gains later only needs an entry in
`ttsConfig.availableModels` (`frontend/src/services/text-to-speech/config.ts`). Kokoro stays a built-in worker because upstream
does not ship it at the pinned release (its implementations are SpeechT5,
Qwen3-TTS and Parler-TTS). Only SpeechT5 runs: upstream's `requirements.txt`
leaves out `qwen-tts` and `parler-tts`, which those two import (see
[Models](#models)).

| | |
|---|---|
| Upstream | `microservices/text-to-speech` |
| Pinned tag | `tag` in [`workers/oep-services.json`](../../../oep-services.json) |
| Port | `8020` (the Text to Speech service port) |
| Backend | OpenVINO (`openvino-genai`) on CPU or GPU |
| API | OpenAI-compatible `POST /v1/audio/speech` (OpenAI's six formats, or JSON+base64), `GET /v1/audio/voices`, `GET /v1/model-info`, `GET /v1/performance`, `GET /health` |

## How the upstream source gets here

The service source is **not committed** to this repository. `start.sh` and
`start.ps1` call `oep_fetch services/text-to-speech/oep-tts`, which runs
`workers/oep-setup.sh fetch services/text-to-speech/oep-tts`. That script
reads `workers/oep-services.json`, the catalogue of OEP microservices Edge AI
Studio uses together with the pinned release `tag` (this worker's entry names
`microservices/text-to-speech`), and copies that directory at that release
tag into `thirdparty/text-to-speech` (gitignored) out of the one sparse clone
of `edge-ai-libraries` the script keeps under `workers/thirdparty/`. The copy
is skipped when it already carries that exact tag
(`.demo-studio-edge-ai-libraries-ref`). No file in the copy is changed: every
native adaptation is an environment override or, for session storage, a
setting `main.py` makes after importing upstream (see "Instances" below).

Bump the tag (`workers/oep-setup.sh pin <tag>`) to move to a newer upstream;
the next start remakes the copy. To try a different release without editing
the repository, set `EDGE_AI_LIBRARIES_REF=<tag>` for one start.
`workers/oep-setup.sh` lists every OEP-backed worker with its pin, `check`
verifies the copies, and `info services/text-to-speech/oep-tts` shows what
this entry resolves to.

## Its own virtualenv

This worker is **not a uv project** and is excluded from the `workers/` uv
workspace (root `pyproject.toml`, `exclude`), like every OEP microservice
wrapper: upstream owns its pins (see below), and in the workspace they would
apply to every member. `start.sh` / `start.ps1` build `.venv` from upstream's own
`requirements.txt` at the fetched tag (`run_oep_worker` / `Start-OepWorker`, which
call `workers/scripts/oep_env.py`), then run `main.py` in it. The first start
installs everything and takes minutes; later starts only check, and a tag bump
rebuilds the environment.

```bash
./start.sh --port 8020 --model microsoft/speecht5_tts --device CPU   # first start installs .venv (large: torch + OpenVINO + optimum)
curl http://127.0.0.1:8020/healthcheck
curl -X POST http://127.0.0.1:8020/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"input": "Hello from Intel Edge AI.", "voice": "Ryan", "response_format": "wav"}' \
  --output speech.wav
```

## What is adapted, and where

Upstream ships a Docker-first setup and reads one `config.yaml` at import
time, with documented `TEXT_TO_SPEECH__<SECTION>__<KEY>` environment
overrides. The native run uses only those overrides.

**`main.py`** — the wrapper that runs the upstream FastAPI app unchanged and
adds only (through `worker_common.oep`):

- `--model/--device/--dtype/--port` flags (what the frontend's `buildArgs`
  passes), published as `TEXT_TO_SPEECH__MODELS__TTS__*` overrides before
  upstream loads its config. `--model` takes the Hugging Face id upstream
  expects (`speecht5` is accepted as a short alias), and `default_speaker` is
  set to `Ryan`, a SpeechT5 voice upstream's startup validation accepts
  (upstream's own default follows its default model). `--dtype` is the
  Runtime Settings' Precision (`models.default.quant`) and maps onto
  upstream's export precision (`int8` default, `int4`, `fp16`, `fp32`); each
  precision exports into a directory of its own. Upstream notes that int4
  produces noise on an integrated GPU.
- `models_base_path` pointed at `<repo>/models/tts/oep-tts`, so the exported
  IR lives with the other workers' models and the app's "clear model cache"
  action works. The Hugging Face snapshots the export starts from go to the
  cache every worker shares, `<repo>/models/huggingface`
  (`worker_common.use_shared_hf_cache`); the `models/tts/oep-tts/huggingface`
  this worker used to keep moves there on start.
- `pipeline.persist_outputs=false`: upstream otherwise writes every synthesis
  as `storage/<session>/speech.wav` + `generation.json` under the copy.
- `/healthcheck`, answering 503 until upstream's lifespan (first-run OpenVINO
  export, model preload, warm-up synthesis) has finished, then 200.
- `POST /v1/audio/speech` in front of upstream's: all six OpenAI
  `response_format` values and `speed` (re-encoded with the bundled ffmpeg),
  plus sentence streaming. Upstream synthesizes a whole text in one call;
  with `"stream": true` or
  `"stream_format": "sse"` the wrapper hands upstream one sentence per call
  (in the threadpool) and sends each sentence's audio as soon as it is back,
  in the shapes `worker_common.speech` documents (shared by every
  text-to-speech worker): a growing WAV with `0xFFFFFFFF`
  sizes, raw PCM, MP3/AAC per sentence, Opus/FLAC once complete, or OpenAI's
  `speech.audio.delta` / `speech.audio.done` events. Without either flag a
  request is one upstream synthesis, as before.

**Dependencies** — upstream's `requirements.txt` at the pinned tag, installed
the way its Dockerfile does (`"install"` in `workers/oep-services.json`, with
pip's handling of the CPU torch index the file names), with no deviations.
Upstream owns those pins and their security fixes: a tag bump needs no change
here. An `overrides.txt` beside this README would hold one, only for something
that does not install or run on our platforms.

Everything else — text normalisation, speaker embeddings under `assets/`,
session ids, latency stats — is upstream behaviour.

## Models

| `models.default.name` | Devices | Voices | Notes |
|---|---|---|---|
| `microsoft/speecht5_tts` | CPU, GPU | `Ryan`, `Miles`, `Aaron`, `Nora`, `Elena`, `Kabir`, `Angus` (CMU Arctic ids accepted as aliases) | English only. Exported with optimum + `microsoft/speecht5_hifigan`, then compressed to `--dtype`. |

Qwen3-TTS is not offered. Upstream's code supports it, but its only `qwen-tts`
release (`0.1.1`) pins `transformers==4.57.3`, which has known critical CVEs;
upstream's own docs (Configuration, "Qwen3-TTS dependency limitation") leave
`qwen-tts` out for that reason, so the model fails at startup on every device.
Offer it again once a `qwen-tts` release supports transformers 5.

Upstream's request model accepts `response_format: wav | json` only and has no
speed or volume fields. The wrapper's route above re-encodes to the other
formats and applies `speed`, so the demo offers the same formats and speed as
for the built-in workers and hides only volume. Unknown fields are ignored, so
clients written for the built-in workers (the lipsync worker, samples) keep
working as long as they send a voice the model knows.

### Models on disk

`list_models.py --models <id> [<id> ...]` reports whether the model above is
already exported to OpenVINO IR under
`models/tts/oep-tts/openvino/<model>__<dtype>/`, without starting the
worker — mirroring upstream's own `ensure_speecht5.model_exists`.

## Instances

`main.py` publishes `TEXT_TO_SPEECH__PIPELINE__PERSIST_OUTPUTS=false`, so
upstream's `pipeline.py` never calls its own `utils/app_paths.get_session_dir`
and nothing is written under `storage/` in normal operation — the WAV
`POST /v1/audio/speech` returns comes straight from upstream's in-memory
result. If a deployment overrides `TEXT_TO_SPEECH__PIPELINE__PERSIST_OUTPUTS=true`
(both are `setdefault`, so an explicit value wins), session output still
stays per instance: after importing upstream, `main.py` sets
`utils/app_paths.STORAGE_ROOT` to `<this instance's data dir>/storage`
(`worker_common.oep.redirect_storage_root`; every upstream reader looks it up
when it runs). Standalone, with no instance assigned, that is upstream's
original `storage/` under the copy. Without this, every instance would share one `storage/`
under the copy, and `TEXT_TO_SPEECH__APP__CLEAR_STORAGE_ON_STARTUP=true`
would let one instance starting up delete another already-running instance's
session folders. Model weights and the Hugging Face cache stay on the shared
`<repo>/models/tts/oep-tts`, same as any other worker.

## Optional upstream settings

Anything in upstream's `config.yaml` can be overridden per start with
`TEXT_TO_SPEECH__<SECTION>__<KEY>` environment variables. Values already set in
the environment always win over `main.py`'s defaults. For example, in
`deployment.json` or the shell:

```bash
# Run the PyTorch implementation instead of OpenVINO
export TEXT_TO_SPEECH__MODELS__TTS__RUNTIME=pytorch

# Keep every synthesis under thirdparty/.../storage/<session>/
export TEXT_TO_SPEECH__PIPELINE__PERSIST_OUTPUTS=true
```
