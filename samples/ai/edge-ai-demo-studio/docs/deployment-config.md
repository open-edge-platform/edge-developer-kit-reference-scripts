<!-- THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY. -->
<!-- Source of truth: frontend/src/lib/deployment-docs.ts (regenerated on app startup) -->

# Deployment Presets (`deployment.json`)

Place a `deployment.json` file in the project root (next to `setup.sh`) to preset
service configuration instead of using the built-in defaults. It is read every time
the app starts: the default services are seeded first, then the presets in this file
overwrite them. Services marked `"status": "online"` are started automatically
(internally moved to `prepare`, so the worker/engine boots and health checks promote
it to `active`).

The file location can be overridden with the `DEPLOYMENT_CONFIG_PATH` environment variable.
Add `"$schema": "./docs/deployment.schema.json"` for editor validation and autocompletion.

## Example

```json
{
  "$schema": "./docs/deployment.schema.json",
  "services": {
    "text-generation": {
      "status": "online",
      "models": {
        "default": {
          "name": "OpenVINO/Qwen3.5-4B-int4-ov",
          "device": "GPU",
          "backend": "openvino"
        }
      }
    },
    "speech-to-text": {
      "status": "online",
      "models": {
        "default": {
          "device": "NPU"
        }
      }
    },
    "text-to-speech": {
      "status": "offline",
      "metadata": {
        "languageCode": "en-us"
      }
    }
  }
}
```

Model overrides are merged over the seeded defaults, which vary by OS: on
Windows the default `text-generation`/`embeddings`/`rerank` backend is
`llamacpp`, on Linux it is `openvino` (OVMS). When overriding `models.default.name`,
always set `models.default.backend` to match the model — otherwise the inherited
backend is kept and may fail to load the new model (e.g. llama.cpp cannot run
an OpenVINO model).

## Fields

Every entry under `services` is keyed by the service type (see the reference below) and supports:

| Field | Type | Description |
| --- | --- | --- |
| `status` | `"online"` \| `"offline"` | `online` auto-starts the service on boot; `offline` (default) leaves it stopped |
| `engine` | string | Execution engine — only for services listing more than one engine |
| `port` | integer | Overrides the default port |
| `models` | object | Partial per-model overrides merged over the defaults; `models.default` is the primary model (`name`, `device`, `source`, `quant`, `params`, `backend`, `type`) |
| `metadata` | object | Merged over the existing service metadata |

Metadata keys:

| Key | Description |
| --- | --- |
| `clientIceServerUrl` | Client-side ICE server URL (default: STUN) |
| `serverIceServerUrl` | Server-side ICE server URL (default: TURN) |
| `turnServerIp` | Deprecated: Use clientIceServerUrl / serverIceServerUrl instead |
| `languageCode` | Language Code for TTS |
| `vadThreshold` | VAD Threshold for Wake Word Detection |
| `cpuAffinity` | CPU cores to pin this service to (numactl -C format, e.g. "0-7" or "0,2,4"). Empty / missing = all cores. Linux only. |

## Service reference

### `diarization` — Speaker Diarization

Identify and label speakers in audio recordings using pyannote.audio speaker diarization models.

| Field | Value |
| --- | --- |
| Default port | 8026 |
| Engines | `worker` |
| Default model | `pyannote/speaker-diarization-community-1` on `CPU` |
| Devices | `CPU`, `XPU` |
| Custom models | no |
| Model sources | `huggingface`, `modelscope` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `pyannote/speaker-diarization-community-1` | `CPU`, `XPU` | `pytorch` |

### `embeddings` — Text Embedding

Generate dense vector embeddings for semantic search and RAG pipelines.

| Field | Value |
| --- | --- |
| Default port | 8007 |
| Engines | `multiserve` |
| Default model | `OpenVINO/Qwen3-Embedding-0.6B-int8-ov` on `CPU` |
| Devices | `CPU`, `GPU`, `NPU` |
| Custom models | yes |
| Weight formats (`quant`) | `int4`, `int8`, `fp16`, `fp32`, `nf4`, `int4_sym_g128`, `int4_asym_g128`, `int4_sym_g64`, `int4_asym_g64`, `int8_sym`, `int8_asym` |
| Model sources | `huggingface`, `modelscope`, `custom` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `OpenVINO/Qwen3-Embedding-0.6B-int8-ov` | `CPU`, `GPU`, `NPU` | — |
| `Qwen/Qwen3-Embedding-0.6B-GGUF` | `CPU`, `GPU` | — |

### `file-watcher` — File Watcher

Watches a folder for new image files and broadcasts them over WebSocket for real-time processing.

| Field | Value |
| --- | --- |
| Default port | 8030 |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `geti-classifier` — Geti Image Classifier

Serves inference from a local Intel Geti deployment and collects feedback for continuous model improvement.

| Field | Value |
| --- | --- |
| Default port | 8028 |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `image-based-video-search` — Image-Based Video Search

Edge AI suite that searches video streams for objects matching a user-supplied reference image.

| Field | Value |
| --- | --- |
| Default port | 7001 |
| Engines | `worker` |
| Default model | `image-based-video-search` on `CPU` |
| Devices | — |
| Custom models | no |
| Supported OS | `linux` |

### `image-generation` — Image Generation

Generate images from text prompts using diffusion models accelerated with OpenVINO.

| Field | Value |
| --- | --- |
| Default port | 8018 |
| Engines | `worker` |
| Default model | `OpenVINO/stable-diffusion-v1-5-int8-ov` on `CPU` |
| Devices | — |
| Custom models | no |
| Model sources | `huggingface`, `modelscope` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `OpenVINO/stable-diffusion-v1-5-int8-ov` | `GPU`, `CPU`, `NPU`, `AUTO` | `openvino` |
| `stabilityai/stable-diffusion-xl` | `GPU`, `CPU`, `NPU`, `AUTO` | `openvino` |
| `stabilityai/sdxl-turbo` | `GPU`, `CPU`, `NPU`, `AUTO` | `openvino` |

### `lipsync` — Lipsync

Real-time avatar lip-syncing with Wav2Lip, streamed over WebRTC.

| Field | Value |
| --- | --- |
| Default port | 8022 |
| Engines | `worker` |
| Default model | `Wav2Lip` on `CPU` |
| Devices | — |
| Custom models | no |
| Model sources | `huggingface`, `modelscope` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `Wav2Lip` | `CPU`, `GPU`, `NPU` | `openvino` |

### `loss-prevention` — Loss Prevention

Retail AI Suite that runs Combined Detection and Classification for loss prevention using GStreamer and OpenVINO.

| Field | Value |
| --- | --- |
| Default port | — |
| Engines | `worker` |
| Default model | `loss-prevention` on `CPU` |
| Devices | — |
| Custom models | no |
| Supported OS | `linux` |

### `mcp` — MCP Manager

Manage Model Context Protocol servers and their tool integrations.

| Field | Value |
| --- | --- |
| Default port | — |
| Engines | — |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `medical-scribe-database` — Medical Scribe Database

Manages and stores data for Medical Scribe using a dedicated medical-scribe database.

| Field | Value |
| --- | --- |
| Default port | 8027 |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `ocr` — OCR

Optical character recognition — extract text and its location from images using OCR models on OpenVINO.

| Field | Value |
| --- | --- |
| Default port | 8029 |
| Engines | `worker` |
| Default model | `ppocrv5` on `CPU` |
| Devices | `CPU`, `GPU`, `NPU` |
| Custom models | no |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `ppocrv5` | `CPU`, `GPU`, `NPU` | `openvino` |
| `ppocrv5-server` | `CPU`, `GPU`, `NPU` | `openvino` |
| `ppocrv3` | `CPU`, `GPU`, `NPU` | `openvino` |
| `paddleocr-vl` | `CPU`, `GPU` | `openvino` |
| `paddleocr-vl-1.5` | `CPU`, `GPU` | `openvino` |

### `pallet-defect-detection` — Pallet Defect Detection

Industrial AI suite that detects pallet defects in real time using DL Streamer Pipeline Server with WebRTC streaming.

| Field | Value |
| --- | --- |
| Default port | 7004 |
| Engines | `worker` |
| Default model | `pallet-defect-detection` on `CPU` |
| Devices | — |
| Custom models | no |
| Supported OS | `linux` |

### `ppt-translator` — PPT Translator

Translates PowerPoint presentations while preserving formatting using a local LLM.

| Field | Value |
| --- | --- |
| Default port | 8024 |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `rerank` — Reranker

Rescore and rerank documents by relevance for improved search and RAG pipelines.

| Field | Value |
| --- | --- |
| Default port | 8012 |
| Engines | `multiserve` |
| Default model | `OpenVINO/bge-reranker-base-int8-ov` on `CPU` |
| Devices | `CPU`, `GPU`, `NPU` |
| Custom models | yes |
| Weight formats (`quant`) | `int4`, `int8`, `fp16`, `fp32`, `nf4`, `int4_sym_g128`, `int4_asym_g128`, `int4_sym_g64`, `int4_asym_g64`, `int8_sym`, `int8_asym` |
| Model sources | `huggingface`, `modelscope`, `custom` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `OpenVINO/bge-reranker-base-int8-ov` | `CPU`, `GPU`, `NPU` | — |
| `gpustack/bge-reranker-v2-m3-GGUF` | `CPU`, `GPU` | — |

### `robotics-ai` — Robotics AI

A demo showcasing the capabilities of Robotics AI, including real-time object detection and manipulation.

| Field | Value |
| --- | --- |
| Default port | 8025 |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux` |

### `speech-to-text` — Speech to Text

Real-time speech recognition with low-latency transcription using Whisper models optimized for Intel hardware.

| Field | Value |
| --- | --- |
| Default port | 8023 |
| Engines | `worker` |
| Default model | `openai/whisper-base` on `CPU` |
| Devices | — |
| Custom models | no |
| Model sources | `huggingface` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `openai/whisper-large-v3-turbo` | `CPU`, `GPU`, `NPU` | `openvino` |
| `openai/whisper-large-v3` | `CPU`, `GPU`, `NPU` | `openvino` |
| `openai/whisper-medium` | `CPU`, `GPU`, `NPU` | `openvino` |
| `openai/whisper-small` | `CPU`, `GPU`, `NPU` | `openvino` |
| `openai/whisper-tiny` | `CPU`, `GPU`, `NPU` | `openvino` |
| `openai/whisper-base` | `CPU`, `GPU`, `NPU` | `openvino` |

### `synthetic-image-generation` — Synthetic Image Generation

Generate and edit synthetic images from base images for dataset augmentation.

| Field | Value |
| --- | --- |
| Default port | 8021 |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux` |

### `text-generation` — Text Generation

Generate coherent text using large language models optimized for Intel hardware.

| Field | Value |
| --- | --- |
| Default port | 8001 |
| Engines | `multiserve` |
| Default model | `OpenVINO/Qwen3.5-4B-int4-ov` on `CPU` |
| Devices | `CPU`, `GPU`, `NPU` |
| Custom models | yes |
| Weight formats (`quant`) | `int4`, `int8`, `fp16`, `fp32`, `nf4`, `int4_sym_g128`, `int4_asym_g128`, `int4_sym_g64`, `int4_asym_g64`, `int8_sym`, `int8_asym` |
| Model sources | `huggingface`, `modelscope`, `custom` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `OpenVINO/Qwen3.5-4B-int4-ov` | `CPU`, `GPU`, `NPU` | — |
| `OpenVINO/InternVL2-2B-int4-ov` | `CPU`, `GPU`, `NPU` | — |
| `Qwen/Qwen3-1.7B-GGUF` | `CPU`, `GPU` | — |
| `ggml-org/Qwen3-VL-2B-Instruct-GGUF` | `CPU`, `GPU` | — |

### `text-to-speech` — Text to Speech

Natural-sounding speech synthesis with multiple voice options powered by Kokoro TTS.

| Field | Value |
| --- | --- |
| Default port | 8020 |
| Engines | `worker` |
| Default model | `kokoro` on `CPU` |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `kokoro` | `CPU`, `NPU` | `openvino` |
| `malaya` | `CPU`, `XPU` | `pytorch` |
| `piper` | `CPU`, `GPU` | `openvino` |

### `vectordb` — Vector Database

FAISS-based vector storage for knowledge base management, semantic search, and RAG pipelines.

| Field | Value |
| --- | --- |
| Default port | 8017 |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `wake-word-detection` — Wake Word Detection

Detect custom wake words from microphone input and send webhook notifications on detection events.

| Field | Value |
| --- | --- |
| Default port | 8019 |
| Engines | `worker` |
| Default model | `hey_jarvis_v0.1.onnx` on `CPU` |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `hey_jarvis_v0.1.onnx` | `CPU` | `pytorch` |
| `alexa_v0.1.onnx` | `CPU` | `pytorch` |
| `hey_mycroft_v0.1.onnx` | `CPU` | `pytorch` |
| `hey_rhasspy_v0.1.onnx` | `CPU` | `pytorch` |
| `timer_v0.1.onnx` | `CPU` | `pytorch` |
| `weather_v0.1.onnx` | `CPU` | `pytorch` |
