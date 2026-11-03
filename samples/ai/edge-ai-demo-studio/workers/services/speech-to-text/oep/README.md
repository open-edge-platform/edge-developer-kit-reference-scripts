# speech-to-text — OEP audio-analyzer, run natively

This worker is the [audio-analyzer microservice](https://github.com/open-edge-platform/edge-ai-libraries/tree/main/microservices/audio-analyzer)
from `open-edge-platform/edge-ai-libraries`, run as an ordinary Edge AI Studio
worker: no container runtime, one `uv` virtualenv, started by the app through
the same `start.sh <args>` + `/healthcheck` contract as everything else under
`workers/services/`.

| | |
|---|---|
| Upstream | `microservices/audio-analyzer` |
| Pinned tag | `tag` in [`workers/oep-services.json`](../../oep-services.json) |
| Port | `8023` |
| Backend | Whisper exported to OpenVINO (`openvino-genai`) on CPU, GPU or NPU |
| API | OpenAI-compatible `/v1/audio/transcriptions`, NDJSON `/v1/audio/transcriptions/stream`, Realtime-style WebSocket `/v1/realtime` |

## How the upstream source gets here

The service source is **not committed** to this repository. `start.sh` and
`start.ps1` call `oep_fetch services/speech-to-text/oep` (from
`workers/scripts/worker-common.sh`), which runs
`workers/oep-setup.sh fetch services/speech-to-text/oep`. That script reads
[`workers/oep-services.json`](../../oep-services.json), the catalogue of OEP
microservices Edge AI Studio uses together with the pinned release `tag`
(this worker's entry names `microservices/audio-analyzer`), and copies
`microservices/audio-analyzer` at that release tag into
`thirdparty/audio-analyzer` (gitignored) out of the one sparse clone of
`edge-ai-libraries` the script keeps under `workers/thirdparty/` — skipped
when the copy already carries that exact tag
(`.demo-studio-edge-ai-libraries-ref`). No file in the copy is changed:
everything the worker adapts goes through upstream's own configuration (see
below).

This runs on every start; it is cheap and idempotent. Bump the tag (`workers/oep-setup.sh pin <tag>`) to move to
a newer upstream; the next start remakes the copy. To try a different release
without editing the repository, set `EDGE_AI_LIBRARIES_REF=<tag>` for one
start. `workers/oep-setup.sh` lists every OEP-backed worker with its pin,
`check` verifies the copies, and `info services/speech-to-text/oep` shows
what this entry resolves to.

## Its own virtualenv

This worker is **not a uv project** and is excluded from the `workers/` uv
workspace (root `pyproject.toml`, `exclude`): upstream exports Whisper with
`optimum-cli` from the worker's own interpreter and imports `openai-whisper`
in-process, and upstream owns its pins (see below), which in the workspace would
apply to every worker. `start.sh` / `start.ps1` build `.venv` from upstream's own
`requirements.txt` at the fetched tag (`run_oep_worker` / `Start-OepWorker`, which
call `workers/scripts/oep_env.py`), then run `main.py` in it. The first start
installs everything and takes minutes; later starts only check, and a tag bump
rebuilds the environment.

```bash
./start.sh --port 8023 --model openai/whisper-base --device CPU   # first start installs .venv (large: torch + OpenVINO)
curl http://127.0.0.1:8023/healthcheck      # 503 "starting" -> 200 "ok"
curl -X POST http://127.0.0.1:8023/v1/audio/transcriptions \
  -F file=@recording.wav -F model=whisper-1 -F language=en -F response_format=verbose_json
```

## What is adapted, and where

Upstream ships a Docker-first setup; two small pieces make it run on the
host, and neither changes an upstream file.

**`main.py`** — the wrapper that runs the upstream FastAPI app unchanged and
adds only (through `worker_common.oep`):

- `--model/--device/--precision/--port` flags (what the frontend's
  `buildArgs` passes), published as `AUDIO_ANALYZER__MODELS__ASR__*`
  environment overrides before upstream loads its config — upstream's
  documented mechanism for targeted overrides. `openai/whisper-base` becomes
  upstream's `whisper-base`. `--precision` (`int8` default, `fp32`, `fp16`,
  `int4`; the Runtime Settings' Precision) is upstream's `weight_format`, the
  `optimum-cli --weight-format` of the export, which lands in
  `models/stt/openvino/<name>-<precision>`; fp32 leaves it unset, so it
  exports to `<name>` as before.
- `models_base_path` for every model family pointed at `<repo>/models/stt`
  (`worker_common.paths.models_dir`), so weights live with the other workers'
  models and the app's "clear model cache" action works. The Hugging Face
  snapshots the export starts from go to the cache every worker shares,
  `<repo>/models/huggingface` (`worker_common.use_shared_hf_cache`); the
  `models/stt/huggingface` this worker used to keep moves there on start.
- Browser recordings accepted: `audio_util.allowed_extensions` is upstream's
  list from its `config.yaml` plus `.webm`, `.weba`, `.ogg`, `.oga`, `.opus`
  and `.flac`, published as `AUDIO_ANALYZER__AUDIO_UTIL__ALLOWED_EXTENSIONS`.
  The app records microphone input with `MediaRecorder`, which produces
  WebM/Opus; upstream's ffmpeg chunking decodes all of them.
- Session storage moved per instance (see [Instances](#instances)).
- `/healthcheck`, answering 503 until upstream's startup (first-run OpenVINO
  export + warm-up) has finished, then 200 with `upstream`, `upstream_tag`,
  `active_model`, `device` and `startup_seconds`.

**Dependencies** — upstream's `requirements.txt` at the pinned tag, installed
the way its Dockerfile does (`"install"` in `workers/oep-services.json`: pip's
handling of the CPU torch index the file names, then `torchcodec` uninstalled).
Upstream owns those pins and their security fixes: a tag bump needs no change
here. [`overrides.txt`](overrides.txt) holds the only deviation, `pywhispercpp`
left out: it has no Windows wheels and compiles whisper.cpp there, and upstream
imports it only for its whisper.cpp provider, which this worker does not offer.

**NPU:** with upstream's pins (transformers 4.53.3, OpenVINO 2026.1) Whisper
runs on the NPU (`whisper-tiny` int8, checked 2026-10-30). Overriding
transformers to 5.x breaks that: OpenVINO 2026.1 and 2026.2 cannot run its
Whisper exports on the NPU (`!self_attn_nodes.empty()` at compile,
`unordered_map::at` at the first `generate`).

Everything else — chunking with `ffmpeg` from `thirdparty/ffmpeg` or `PATH`
and session handling — is upstream behaviour. That includes `language`: the
transcription routes default an omitted or empty one to `en`, so the app
always sends one to this backend and offers no Auto-detect here (the OpenVINO
Model Server backend has it).

## Models on disk

`list_models.py --models <id> [<id> ...]` reports which Whisper presets are
already exported to OpenVINO IR under `<repo>/models/stt/openvino/`, at any
precision, without starting the worker — mirroring upstream's own
`get_asr_model_path`/`_ir_exists` (see the script's header comment).

## Instances

After importing upstream, `main.py` sets `utils/app_paths.STORAGE_ROOT` to
`<this instance's data dir>/storage` (`worker_common.oep.redirect_storage_root`;
every upstream reader looks it up when it runs). Standalone, with no instance
assigned, that is upstream's original `storage/` under the copy. Without this, every instance would
share one `storage/` under the copy, and upstream's
`clear_storage_on_startup: true` (`config.yaml`) would let one instance
starting up delete another already-running instance's session folders
(uploads, chunks, ASR/diarization output). Model weights and the Hugging
Face cache stay on the shared `<repo>/models/stt`, same as any other worker.

## Optional upstream features

Anything in upstream's `config.yaml` can be overridden per start with
`AUDIO_ANALYZER__<SECTION>__<KEY>` environment variables (nested keys joined
with `__`). Values already set in the environment always win over `main.py`'s
defaults. For example, in `deployment.json` or the shell:

```bash
# Speaker diarization (needs a Hugging Face token with the pyannote model terms accepted)
export AUDIO_ANALYZER__MODELS__ASR__DIARIZATION=true
export HF_TOKEN=hf_...

# Voice sentiment alongside each transcript
export AUDIO_ANALYZER__SENTIMENT__ENABLED=true
```

Diarization labels speakers anonymously (`SPEAKER_00`, `SPEAKER_01`) with a
per-session primary-speaker flag; it does not enrol named speakers. The
built-in `diarization` worker remains the service for that.

Sentiment runs the SpeechBrain model with upstream's default provider
(`openvino`); set `AUDIO_ANALYZER__SENTIMENT__PROVIDER=pytorch` to run it as is.
