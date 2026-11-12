# speech-to-text/ovms — Whisper and Qwen3-ASR on OpenVINO Model Server

The built-in backend of the Speech to Text service (`metadata.sttBackend:
"ovms"`; see [../README.md](../README.md) for how it sits next to the OEP
audio-analyzer backend in `../oep`).

| | |
|---|---|
| Port | allocated by the app at start (`--port`); the internal OVMS REST port is `--port + 1` unless `--ovms-port` is given, so two instances never collide |
| Serving | `workers/thirdparty/ovms` — `ovms --task speech2text` |
| Models | `openai/whisper-*` (converted on first start), `Qwen/Qwen3-ASR-1.7B-hf` (converted on first start, own conversion environment), or pre-converted `OpenVINO/*-ov` repositories |
| Devices | AUTO, CPU, GPU, NPU (Qwen3-ASR: AUTO, CPU, GPU) |
| Environment | member of the `workers/` uv workspace (shared `workers/.venv`) |

## How a model gets served

`modules/stt_ovms.py` runs `ovms --pull --task speech2text` into
`<repo>/models/stt/ovms` and then starts OVMS serving that graph on the
internal port:

- `OpenVINO/*` and `*-ov` repositories already hold OpenVINO IR and are
  downloaded as they are;
- `openai/whisper-*` (and any other Hugging Face Whisper checkpoint) is
  converted during the pull. OVMS shells out to `optimum-cli` from the shared
  optimum environment that `ovms_prepare` / `Initialize-Ovms` provision
  (`workers/common/ovms-export` on Linux, the OVMS-bundled Python on Windows);
  `--precision` (`int8` default, `fp32`, `fp16`, `int4`; the Runtime
  Settings' Precision, stored as `models.default.quant`) is the export's
  `--weight-format`. Each precision but fp32 converts into a repository of
  its own, `<repo>/models/stt/ovms-<precision>`: a pull of a model the
  repository already holds keeps its weights, so sharing one would never
  convert again.
- `Qwen/Qwen3-ASR-*` needs an exporter the shared environment cannot hold
  (an optimum-intel fork on transformers 5.13), so it converts with
  [`workers/common/ovms-export-qwen3-asr`](../../../common/ovms-export-qwen3-asr).
  `model_downloader.ovms` picks that environment from the model id
  (`EXPORT_PROFILES`); `start.sh` / `start.ps1` provision it the first time
  such a model is selected (`oep-setup.sh fetch
  common/ovms-export-qwen3-asr`, then `uv sync --project` on it), so nothing
  is installed for users who never pick Qwen3-ASR. Qwen3-ASR transcribes
  without timestamps: `verbose_json`, `srt` and `vtt` get one segment spanning
  the audio. Word timings (`timestamp_granularities[]=word`) come from
  `Qwen/Qwen3-ForcedAligner-0.6B-hf` instead, which `aligner_proc.py` runs in
  that same environment beside OVMS (exported to
  `<repo>/models/stt/forced-aligner` on first use). The aligner starts on the
  first word-timestamp request, or at boot with `--warm-start-aligner` (the
  `alignerWarmStart` service metadata field). If it cannot start, that request
  fails; if a single alignment fails, the transcript is returned with empty
  `words`.

Re-running the pull for a model that is already there is cheap: OVMS keeps
the weights and regenerates `graph.pbtxt` for the requested device.

## Models on disk

`list_models.py --models <id> [<id> ...]` reports which ASR presets already
have a `graph.pbtxt` under `<repo>/models/stt/ovms/<model id>/` or one of
the `ovms-<precision>` repositories, without
starting the worker or OVMS. OVMS itself decides completeness inside its own
binary; `graph.pbtxt` presence is the same signal
`engines/multiserve/modules/ovms/ov_downloader.py` already relies on for
this pull mechanism elsewhere in this codebase.

## API

The batch routes mirror the OEP backend so callers do not care which one
answers.

| Route | Notes |
|---|---|
| `POST /v1/audio/transcriptions` | `file`, `language` (default `en`; `auto` leaves it out of the OVMS request so the model detects it, and `verbose_json` then says `"language": null`, since OVMS does not report the detected one), `response_format` = `json` (default) / `text` / `verbose_json` (adds `duration` and `segments` of `{id, start, end, text}`; `timestamp_granularities[]=word` adds `words` of `{word, start, end}`, from the forced aligner on Qwen3-ASR, and empty if OVMS has no word timings for the model) / `srt` / `vtt`; `use_denoise=true` runs the OMZ `noise-suppression-poconetlike-0001` model over the audio first (fetched through `model_downloader.fetch_omz_ir` into `models/stt/omz` on first use); `return_timestamps=true` is the pre-OEP spelling of `verbose_json`'s segments. `stream=true` answers 400 — response streaming is an OEP-backend feature. |
| `POST /v1/audio/translations` | Translate to English; `{ "text": ... }`. 400 on Whisper large-v3-turbo and Qwen3-ASR: they only transcribe (turbo was fine-tuned on transcription data only, Qwen3-ASR has no translate task), so OVMS would answer with the original-language text. OVMS returns no timings for translations: `verbose_json`/`srt`/`vtt` carry one segment over the whole file. `prompt` is accepted on both routes and ignored by OVMS. |
| `WS /v1/audio/stream` | Live microphone transcription (the demo's Live mode and the medical-scribe sample on this backend). See below. |
| `GET /v1/model-info` | Model, provider `ovms`, device, weight format and capabilities |
| `GET /healthcheck` | 503 while OVMS pulls/loads the model, then 200 with `backend: "ovms"`, `active_model`, `device`, `startup_seconds` |

Uploads are converted to 16 kHz mono WAV (`modules/audio.py`: soundfile,
then pydub/ffmpeg from `<repo>/thirdparty/ffmpeg` or `PATH`) before they are
posted to OVMS's `/v3/audio/*` endpoints over one pooled connection to
`127.0.0.1` (never `localhost`: on Windows it resolves to `::1` first and
OVMS listens on IPv4 only).

### Live audio stream

`/v1/audio/stream` is pseudo-streaming: the worker loads no second model, it
segments the microphone into utterances with Silero VAD
([`common/audio-input-stream`](../../../common/audio-input-stream)) and posts
each finished utterance to OVMS as an in-memory WAV. Browsers connect to the
worker port directly (the app's `/api/speech-to-text` proxy only forwards
HTTP).

- Client → server: binary frames of 16 kHz mono little-endian int16 PCM;
  `{"event": "stop"}` flushes the pending utterance.
- Server → client: `{"type": "ready"}`, `{"type": "speech_start"}` when the
  VAD hears speech, `{"type": "speech_end", "queued"}` when it cuts the
  utterance (`queued` is false when it was too short to transcribe),
  `{"type": "transcript", "text", "start", "end", "latency"}` per queued
  utterance (`text` empty when nothing was recognised; seconds of received
  audio; `latency` = `endpoint_ms`, `queue_ms`, `stt_ms`, `e2e_ms`),
  `{"type": "error", "message"}`, and `{"type": "done"}` after a stop.
- Query parameters: `language` (`auto` to detect it per utterance), `latency_log`, and the segmentation tuning
  values of `audio_input_stream.DEFAULT_CONFIG` (`pause_duration`, the
  silence in seconds that ends an utterance; `vad_threshold`, Silero's speech
  probability; `max_continuous_speech_s`, `preroll_duration`,
  `min_utterance_duration`, ...). The demo's Live mode sets `pause_duration`
  and `vad_threshold` from its Pause length and Speech sensitivity.

```bash
./start.sh --port 8023 --model openai/whisper-tiny --device CPU --precision int8
./start.sh --port 8023 --model Qwen/Qwen3-ASR-1.7B-hf --device GPU --precision fp16
curl -X POST http://127.0.0.1:8023/v1/audio/transcriptions \
  -F file=@recording.wav -F language=en -F response_format=verbose_json -F use_denoise=true
```

Flags: `--port`, `--model` (alias `--stt-model-id`), `--device` (alias
`--stt-device`), `--source huggingface|modelscope`, `--precision`,
`--denoise-model-id`, `--denoise-device` (default: `--device`), `--ovms-port`.
