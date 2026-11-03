# speech-to-text — two backends, one service

The Speech to Text service (port `8023`) is served by one of two workers in
this directory. The app picks the directory from the service's
`metadata.sttBackend` (`frontend/src/services/speech-to-text/data.ts`,
`workerSubDir`); the Runtime Settings sheet switches it with the **Backend**
buttons at the top, the same way the Text Generation sheet switches between
OpenVINO and llama.cpp.

| Directory | `sttBackend` | What runs | Environment |
|---|---|---|---|
| [`oep/`](oep/) | `oep` (default) | Open Edge Platform **audio-analyzer** microservice run natively: Whisper on OpenVINO GenAI, OpenAI-compatible batch API with json/text/verbose_json/srt/vtt, SSE and NDJSON streaming, `/v1/realtime` WebSocket for live microphone input | own `.venv` (excluded from the `workers/` workspace, upstream's pins) |
| [`ovms/`](ovms/) | `ovms` | Built-in worker: Whisper or Qwen3-ASR served by **OpenVINO Model Server** (`workers/thirdparty/ovms`) as a `speech2text` graph; batch transcription and translation with optional OMZ noise suppression, `/v1/audio/stream` WebSocket for live microphone input (Silero VAD utterances, each transcribed by OVMS) | shared `workers/.venv` (workspace member); Qwen3-ASR converts in `common/ovms-export-qwen3-asr` |

Both answer the same batch routes the frontend, the samples and the
Playwright tests use, and both stream a live microphone — over different
WebSockets, which `useLiveStream` in
`frontend/src/services/speech-to-text/hooks/use-live-stream.ts` picks from the
backend:

| Route | `oep` | `ovms` |
|---|---|---|
| `POST /v1/audio/transcriptions` (`response_format` json / text / verbose_json / srt / vtt) | ✓ | ✓ |
| `stream=true` (SSE) and `POST /v1/audio/transcriptions/stream` (NDJSON) | ✓ | – |
| `GET /v1/realtime` WebSocket (OpenAI Realtime-style events; Live mode on this backend) | ✓ | – |
| `GET /v1/audio/stream` WebSocket (raw PCM frames, one `transcript` per utterance; Live mode on this backend) | – | ✓ |
| `Qwen/Qwen3-ASR-1.7B-hf` | – | ✓ |
| `use_denoise=true` (OMZ `noise-suppression-poconetlike-0001` before Whisper) | – | ✓ |
| `POST /v1/audio/translations` (to English; not on Whisper large-v3-turbo or Qwen3-ASR) | – | ✓ |
| `GET /v1/model-info`, `GET /healthcheck` (503 until the model is loaded; body names `backend`) | ✓ | ✓ |

Model weights live under `<repo>/models/stt` for both (`ovms/` uses
`models/stt/ovms` for the OVMS repository and `models/stt/omz` for the denoise
model), so the app's "clear model cache" covers either backend.

```bash
./oep/start.sh  --port 8023 --model openai/whisper-base --device CPU     # OEP audio-analyzer
./ovms/start.sh --port 8023 --model openai/whisper-base --device CPU     # OpenVINO Model Server
curl http://127.0.0.1:8023/healthcheck                                    # {"backend": "oep" | "ovms", ...}
```
