# speech-to-text — three backends, one service

The Speech to Text service (port `8023`) is served by one of three workers in
this directory. The app picks the directory from the service's
`metadata.sttBackend` (`frontend/src/services/speech-to-text/data.ts`,
`workerSubDir`); the Runtime Settings sheet switches it with the **Backend**
buttons at the top, the same way the Text Generation sheet switches between
OpenVINO and llama.cpp.

| Directory | `sttBackend` | What runs | Environment |
|---|---|---|---|
| [`oep/`](oep/) | `oep` (default) | Open Edge Platform **audio-analyzer** microservice run natively: Whisper on OpenVINO GenAI, OpenAI-compatible batch API with json/text/verbose_json/srt/vtt, SSE and NDJSON streaming, `/v1/realtime` WebSocket for live microphone input | own `.venv` (excluded from the `workers/` workspace, upstream's pins) |
| [`ovms/`](ovms/) | `ovms` | Built-in worker: Whisper or Qwen3-ASR served by **OpenVINO Model Server** (`workers/thirdparty/ovms`) as a `speech2text` graph; batch transcription and translation with optional OMZ noise suppression, `/v1/audio/stream` WebSocket for live microphone input (Silero VAD utterances, each transcribed by OVMS) | shared `workers/.venv` (workspace member); Qwen3-ASR converts in `common/ovms-export-qwen3-asr` |
| [`meralion/`](meralion/) | `meralion` | Built-in worker: **MERaLiON-3-3B-ASR** (A*STAR I2R, MERaLiON Public Licence) on OpenVINO for Singapore and Southeast Asian speech (English incl. Singlish, Mandarin, Malay, Tamil, Indonesian, Thai, Vietnamese, Cantonese, Hokkien, code-switching); it detects the language itself and only transcribes. Batch transcription in the five formats (one segment per 30 s chunk), the same `/v1/audio/stream` WebSocket as `ovms/`. Serves that one model (`--precision int8` default, or `int4`); the first start downloads about 6.6 GB and exports to OpenVINO (about 2 minutes, about 20 GB of RAM) | shared `workers/.venv` (workspace member) |

All three answer the same batch routes the frontend, the samples and the
Playwright tests use, and all stream a live microphone — over one of two
WebSockets, which `LiveSession` in
`frontend/src/services/speech-to-text/lib/live/live-session.ts` picks from the
backend (`oep`: `/v1/realtime`, the others: `/v1/audio/stream`):

| Route | `oep` | `ovms` | `meralion` |
|---|---|---|---|
| `POST /v1/audio/transcriptions` (`response_format` json / text / verbose_json / srt / vtt) | ✓ | ✓ | ✓ (`language` ignored, always detected) |
| `language=auto`: Whisper detects the language | ✓, `verbose_json` names it | ✓, `language: null` | ✓, `language: null` |
| `timestamp_granularities[]=word` | ✓ | ✓ | – (400) |
| `stream=true` (SSE) and `POST /v1/audio/transcriptions/stream` (NDJSON) | ✓ | – | – |
| `GET /v1/realtime` WebSocket (OpenAI Realtime-style events; Live mode on this backend) | ✓ | – | – |
| `GET /v1/audio/stream` WebSocket (raw PCM frames, Silero VAD, one `transcript` per utterance; Live mode on these backends) | – | ✓ | ✓ |
| `Qwen/Qwen3-ASR-1.7B-hf` | – | ✓ | – |
| `MERaLiON/MERaLiON-3-3B-ASR` (the only model of its backend) | – | – | ✓ |
| `use_denoise=true` (OMZ `noise-suppression-poconetlike-0001` before Whisper) | – | ✓ | – |
| `POST /v1/audio/translations` (to English; not on Whisper large-v3-turbo or Qwen3-ASR) | – | ✓ | – (400) |
| `GET /v1/model-info`, `GET /healthcheck` (503 until the model is loaded; body names `backend`) | ✓ | ✓ | ✓ |

MERaLiON-3-3B-ASR measured int8 on a Core Ultra 9 285K with an Arc Pro B60:
about 22x real time on the B60, 1.9x on the CPU, 1.6x on the integrated GPU,
and 1.9x with `--device NPU`, which runs only the speech encoder on the NPU
(about 70 s to compile on the first start, cached after) and the decoder on
the CPU.

Model weights live under `<repo>/models/stt` for all three (`ovms/` uses
`models/stt/ovms` for the OVMS repository and `models/stt/omz` for the denoise
model, `meralion/` uses `models/stt/meralion`), so the app's "clear model
cache" covers any backend.

```bash
./oep/start.sh      --port 8023 --model openai/whisper-base --device CPU          # OEP audio-analyzer
./ovms/start.sh     --port 8023 --model openai/whisper-base --device CPU          # OpenVINO Model Server
./meralion/start.sh --port 8023 --model MERaLiON/MERaLiON-3-3B-ASR --device GPU   # MERaLiON-3 on OpenVINO
curl http://127.0.0.1:8023/healthcheck              # {"backend": "oep" | "ovms" | "meralion", ...}
```
