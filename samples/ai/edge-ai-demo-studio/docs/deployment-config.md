<!-- THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY. -->
<!-- Source of truth: frontend/src/lib/deployment/deployment-docs.ts and deployment-schema.ts (regenerated on app startup) -->

# Deployment Presets (`deployment.json`)

Place a `deployment.json` file in the project root (next to `setup.sh`) to define the
services the app runs instead of adding them by hand. Start from
`deployment.example.json`: the repository ships no `deployment.json`, and without one
nothing is applied — services are added and configured in the UI and kept as they are.

When the file exists it is the **whole setup**, applied every time the app starts: the
services it lists get exactly the instances it lists — a service nobody added is
added from its defaults — and **everything else is removed**: an instance that is not
listed is deleted like Delete on the Services page (its data directory goes with it),
and a service that is not listed goes back to not added. Changes made in the UI
therefore last only until the next start unless the deployment is saved again (see
below). A file that fails validation is ignored as a whole and changes nothing.

Services marked `"status": "online"` are started automatically (internally moved to
`prepare`, so the worker/engine boots and health checks promote it to `active`).

The file location can be overridden with the `DEPLOYMENT_CONFIG_PATH` environment variable.
Add `"$schema": "./docs/deployment.schema.json"` for editor validation and autocompletion.

You do not have to write the file by hand: **Settings → Deployment → Save current
deployment…** in the web UI snapshots every instance's name, id, engine, model,
device and metadata into this format (ports are allocated when a service starts
and are not saved), marks the services that are running as `"online"`, and lets
you either download the file or save it straight to the location the app reads
on startup.

## Packaged (Electron) builds

The packaging scripts (`scripts/bash/package.sh` / `scripts/win/package.ps1`)
bundle the project-root `deployment.json`, when there is one, and
`deployment.example.json` (plus `docs/deployment.schema.json`)
into the Electron package automatically, so presets set before packaging ship
with the app. Inside the packaged app the file lives in the `resources`
directory next to the bundled frontend:

- Linux (zip): `EdgeAIDemoStudio/linux-unpacked/resources/deployment.json`
- Windows (installer): `<install dir>\resources\deployment.json`

To change the presets of an already packaged build, edit that file and
restart the app; delete it to stop applying presets. Copy the bundled
`deployment.example.json` next to it to start one. Setting
the `DEPLOYMENT_CONFIG_PATH` environment variable before launching the app
overrides the bundled file.

## Example

```json
{
  "$schema": "./docs/deployment.schema.json",
  "services": {
    "text-generation": [
      {
        "label": "Text Generation",
        "status": "online",
        "models": {
          "default": {
            "name": "OpenVINO/Qwen3.5-4B-int4-ov",
            "device": "GPU",
            "backend": "openvino"
          }
        }
      }
    ],
    "speech-to-text": [
      {
        "status": "online",
        "models": {
          "default": {
            "device": "NPU"
          }
        }
      }
    ],
    "text-to-speech": [
      {
        "status": "offline",
        "metadata": {
          "languageCode": "en-us"
        }
      }
    ]
  }
}
```

Every entry under `services` is keyed by the service type and lists that service’s
instances, first instance first. The first entry configures the **first instance**
(the one created with the app); services that support several instances can list
more (see [Multiple instances](#multiple-instances)).

Model overrides are merged over the seeded defaults, which vary by OS: on
Windows the default `text-generation`/`embeddings`/`rerank` backend is
`llamacpp`, on Linux it is `openvino` (OVMS). When overriding `models.default.name`,
always set `models.default.backend` to match the model — otherwise the inherited
backend is kept and may fail to load the new model (e.g. llama.cpp cannot run
an OpenVINO model).

## Fields

Every instance in a `services.<type>` list supports:

| Field | Type | Description |
| --- | --- | --- |
| `label` | string | Display name shown in the UI, unique per service (ignoring case). Optional on the first entry, which keeps its current name without it (the service’s own name when this file adds the service); required on every later entry, which an entry without `instanceId` is found by. A different name renames the instance it matches; its address stays |
| `instanceId` | string | The instance’s id, which its address is built on: `/api/<type>@<instanceId>` (1–32 lowercase letters, digits or dashes, starting and ending with a letter or digit). Optional; saved deployments write it. An entry with an id finds the same instance on every boot even after it was renamed, and a missing instance is created under that id. Without one, a new instance’s id is derived from its name: `"CPU fallback"` → `cpu-fallback` |
| `status` | `"online"` \| `"offline"` | `online` auto-starts the instance on boot; `offline` (default) leaves it stopped |
| `engine` | string | Execution engine — only for services listing more than one engine |
| `models` | object | Partial per-model overrides merged over the current settings; `models.default` is the primary model (`name`, `device`, `source`, `quant`, `params`, `backend`, `type`) |
| `metadata` | object | Merged over the existing instance metadata |

Metadata keys:

| Key | Description |
| --- | --- |
| `clientIceServerUrl` | Client-side ICE server URL (default: STUN) |
| `serverIceServerUrl` | Server-side ICE server URL (default: TURN) |
| `turnServerIp` | Deprecated: Use clientIceServerUrl / serverIceServerUrl instead |
| `languageCode` | Language Code for TTS |
| `vadThreshold` | VAD Threshold for Wake Word Detection |
| `cpuAffinity` | CPU cores to pin this service to (numactl -C format, e.g. "0-7" or "0,2,4"). Empty / missing = all cores. Linux, and Windows for CPUs 0-63. |
| `frameGeneration` | Allow lipsync frame generation (interpolation). Only activates when the accelerator cannot infer enough frames per second on its own. |
| `batchSize` | Frames per lipsync inference. Empty / missing = automatic: 8 on the NPU, 16 on other devices. Smaller batches start talking sooner; larger ones can infer more frames per second. |
| `sttBackend` | Backend of the Speech to Text service: "oep" runs the Open Edge Platform audio-analyzer natively (Whisper on OpenVINO GenAI, streaming and live /v1/realtime); "ovms" runs the built-in OpenVINO Model Server worker (batch transcription and translation, optional noise suppression). |
| `vectorDbBackend` | Vector store for the Vector Database service: "faiss" keeps an index per knowledge base on disk; "pgvector" stores vectors in PostgreSQL + pgvector through the OEP document-ingestion pipeline. |
| `pgConnectionString` | PostgreSQL URL for the pgvector backend. Empty / missing = embedded PostgreSQL managed by the worker. |
| `embeddingBatchSize` | Inputs per inference of the Open Edge Platform embeddings worker (INFER_BATCH_SIZE). Empty / missing = 64 on GPU, 16 on other devices; the NPU keeps its static batch of 16. |
| `performanceMode` | OpenVINO performance hint of the Open Edge Platform embeddings worker (OV_PERFORMANCE_MODE). Empty / missing = THROUGHPUT on GPU, LATENCY on other devices. |
| `compiledModelCache` | Keep the compiled OpenVINO model of the Open Edge Platform embeddings worker on CPU and GPU too (OV_ENABLE_MODEL_CACHE), so restarts skip compiling. The NPU always caches. |
| `denoiseDevice` | Device of the noise suppression model on the OpenVINO Model Server backend of Speech to Text. Empty / missing = models.denoise.device, else the speech model's device. The worker falls back to CPU when the model cannot compile there. |
| `serverArgs` | Extra arguments the model server starts with, as typed (quote values with spaces): llama-server flags, which replace the engine's own, or OpenVINO Model Server graph options (ovms --pull). Flags the engine sets itself (port, host, model) are refused. |

## Multiple instances

A multi-instance service (see the `Instances` row of each service below) can run
several instances at once — for example one Text Generation on the GPU and a
second one on the CPU. Every instance answers at
`/api/<type>@<instanceId>` and has its own model, device, port, process, logs and
data directory. There is no bare `/api/<type>` address; samples use whichever instance
is running. A new instance’s id is derived from its name (Text Generation →
`text-generation`) and never changes after: renaming an instance — in the UI or in
this file — changes only its name, so its address, data directory and sample
bindings stay.

```json
{
  "$schema": "./docs/deployment.schema.json",
  "services": {
    "text-generation": [
      {
        "label": "Text Generation",
        "instanceId": "text-generation",
        "status": "online",
        "models": {
          "default": {
            "name": "OpenVINO/Qwen3.5-4B-int4-ov",
            "device": "GPU",
            "backend": "openvino"
          }
        }
      },
      {
        "label": "CPU fallback",
        "status": "online",
        "models": {
          "default": {
            "device": "CPU"
          }
        }
      },
      {
        "label": "Small model",
        "status": "offline",
        "models": {
          "default": {
            "name": "Qwen/Qwen3-1.7B-GGUF",
            "device": "CPU",
            "backend": "llamacpp"
          }
        }
      }
    ]
  }
}
```

On every startup, for each `services.<type>` list:

- **Every entry is matched to one of the service’s instances by its `instanceId`**,
  when it has one, **then by its `label`** (ignoring case). A matched instance is
  **updated** in place: the overrides are merged over its current settings, and a
  different `label` renames it — only its name: its address, data and sample
  bindings stay, as when it is renamed in the UI.
- The **first entry**, when neither matches, configures the service’s oldest
  remaining instance, so giving the first instance a new name in the file renames
  it rather than replacing it.
- Any other entry that matches nothing is **created**: it copies the first instance’s
  engine, models, health check and metadata — after this file’s presets for the
  first instance have been applied — then its own `models` / `metadata` / `engine`
  overrides are merged on top. It is created under the entry’s `instanceId`, or an id
  derived from its name (`"Small model"` → `/api/text-generation@small-model`). So
  `{ "label": "CPU fallback", "models": { "default": { "device": "CPU" } } }` is enough
  for a second instance of the same model on another accelerator.
- A later entry without an `instanceId` is found by its name alone, so changing its
  `label` in the file creates a new instance under the new name and deletes the old
  one with its data. To rename it and keep everything, add the instance’s
  `instanceId` to the entry — a saved deployment has it — or rename the instance in
  the UI and save the deployment again.
- Instances no entry matches are **deleted**, before anything is created: the file’s
  count is the count you get. Matched instances are updated before new ones are
  created, so a new instance can take a name an existing one gives up.
- `"status": "online"` auto-starts the instance. Instances of one service start one
  after another, in list order; different services start in parallel.
- Names are unique per service (ignoring case) and an id names one instance: a later
  entry without a `label`, an entry naming an `instanceId` an earlier entry already
  names, or a new instance whose name is taken is ignored, and an instance renamed
  onto a sibling’s name keeps its own — each with a warning in the app log. A file
  with an `instanceId` that is not 1–32 lowercase letters, digits or dashes,
  starting and ending with a letter or digit, fails validation.
- Each service has a cap on instances (see its `Instances` row); instances beyond
  the cap are skipped with a warning in the app log. Later entries for a
  single-instance service are ignored with a warning.

### Older files

Files saved before the list form keep working. There, `services.<type>` is an object:
its own fields (plus an ignored `port`) configure the first instance, and
`instances.<instanceId>` declares extra ones keyed by their address id, which never
changes; such an entry’s `label` is optional and defaults to the id. A different
`label` renames an instance; its address stays. Instances and services such a file
does not declare are removed the same way. Saving the deployment from the UI writes
the list form.

## Service reference

### `diarization` — Speaker Diarization

Identify and label speakers in audio recordings using pyannote.audio speaker diarization models.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
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

Generate dense vector embeddings for semantic search and RAG pipelines, with optional image embeddings through the Open Edge Platform multimodal models.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `multiserve`, `worker` |
| Default model | `OpenVINO/Qwen3-Embedding-0.6B-int8-ov` on `AUTO` |
| Devices | `AUTO`, `CPU`, `GPU`, `NPU` |
| Custom models | yes |
| Weight formats (`quant`) | `int4`, `int8`, `fp16`, `fp32`, `nf4`, `int4_sym_g128`, `int4_asym_g128`, `int4_sym_g64`, `int4_asym_g64`, `int8_sym`, `int8_asym` |
| Model sources | `huggingface`, `modelscope`, `custom` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `OpenVINO/Qwen3-Embedding-0.6B-int8-ov` | `AUTO`, `CPU`, `GPU`, `NPU` | — |
| `Qwen/Qwen3-Embedding-0.6B-GGUF` | `CPU`, `GPU` | — |
| `CLIP/clip-vit-b-32` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `CLIP/clip-vit-b-16` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `CLIP/clip-vit-l-14` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `SigLIP/siglip2-vit-b-16` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `SigLIP/siglip2-vit-l-16` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `QwenText/qwen3-embedding-0.6b` | `AUTO`, `CPU`, `GPU` | `openvino` |

### `face-recognition` — Face Recognition

Detect and identify faces against a reference gallery using Open Model Zoo or OpenCV Zoo pipelines.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `worker` |
| Default model | `omz-retail` on `AUTO` |
| Devices | `AUTO`, `CPU`, `GPU` |
| Custom models | no |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `omz-retail` | `AUTO`, `CPU`, `GPU` | `openvino` |
| `omz-adas` | `AUTO`, `CPU`, `GPU` | `openvino` |
| `yunet-sface` | `AUTO`, `CPU`, `GPU` | `openvino` |

### `file-watcher` — File Watcher

Watches a folder for new image files and broadcasts them over WebSocket for real-time processing.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | single instance only (later entries are ignored) |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `frame-generation` — Frame Generation

RIFE video frame interpolation: fill in-between frames or upscale video FPS.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `worker` |
| Default model | `RIFE` on `AUTO` |
| Devices | `AUTO`, `CPU`, `GPU` |
| Custom models | no |
| Model sources | `huggingface` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `RIFE` | `AUTO`, `CPU`, `GPU` | `openvino` |

### `geti-classifier` — Geti Image Classifier

Serves inference from a local Intel Geti deployment and collects feedback for continuous model improvement.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | single instance only (later entries are ignored) |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `image-based-video-search` — Image-Based Video Search

Edge AI suite that searches video streams for objects matching a user-supplied reference image.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | single instance only (later entries are ignored) |
| Engines | `worker` |
| Default model | `image-based-video-search` on `CPU` |
| Devices | — |
| Custom models | no |
| Supported OS | `linux` |

### `image-generation` — Image Generation

Generate images from text prompts using diffusion models accelerated with OpenVINO.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `worker` |
| Default model | `OpenVINO/stable-diffusion-v1-5-int8-ov` on `AUTO` |
| Devices | — |
| Custom models | yes |
| Weight formats (`quant`) | `fp32`, `fp16`, `int8`, `int4` (default `int8`) |
| Model sources | `huggingface`, `modelscope` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `OpenVINO/stable-diffusion-v1-5-int8-ov` | `AUTO`, `GPU`, `CPU`, `NPU` | `openvino` |
| `stabilityai/stable-diffusion-xl` | `AUTO`, `GPU`, `CPU`, `NPU` | `openvino` |
| `Aminfri/sdxl-turbo-openvino` | `AUTO`, `GPU`, `CPU`, `NPU` | `openvino` |

### `lipsync` — Lipsync

Real-time avatar lip-syncing with Wav2Lip or MuseTalk, streamed over WebRTC.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `worker` |
| Default model | `Wav2Lip` on `AUTO` |
| Devices | — |
| Custom models | no |
| Weight formats (`quant`) | `auto`, `fp16`, `int8` (default `auto`) |
| Model sources | `huggingface`, `modelscope` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `Wav2Lip` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `MuseTalk` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |

### `loss-prevention` — Loss Prevention

Retail AI Suite that runs Combined Detection and Classification for loss prevention using GStreamer and OpenVINO.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | single instance only (later entries are ignored) |
| Engines | `worker` |
| Default model | `loss-prevention` on `CPU` |
| Devices | — |
| Custom models | no |
| Supported OS | `linux` |

### `mcp` — MCP Manager

Manage Model Context Protocol servers and their tool integrations.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | single instance only (later entries are ignored) |
| Engines | — |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `medical-scribe-database` — Medical Scribe Database

Manages and stores data for Medical Scribe using a dedicated medical-scribe database.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | single instance only (later entries are ignored) |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `ocr` — OCR

Optical character recognition — extract text and its location from images using OCR models on OpenVINO.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `worker` |
| Default model | `ppocrv5` on `AUTO` |
| Devices | `AUTO`, `CPU`, `GPU`, `NPU` |
| Custom models | no |
| Weight formats (`quant`) | `fp16`, `int8`, `int4` (default `int8`) |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `ppocrv5` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `ppocrv5-server` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `ppocrv3` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `paddleocr-vl` | `AUTO`, `CPU`, `GPU` | `openvino` |
| `paddleocr-vl-1.5` | `AUTO`, `CPU`, `GPU` | `openvino` |

### `pallet-defect-detection` — Pallet Defect Detection

Industrial AI suite that detects pallet defects in real time using DL Streamer Pipeline Server with WebRTC streaming.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | single instance only (later entries are ignored) |
| Engines | `worker` |
| Default model | `pallet-defect-detection` on `CPU` |
| Devices | — |
| Custom models | no |
| Supported OS | `linux` |

### `ppt-translator` — PPT Translator

Translates PowerPoint presentations while preserving formatting using a local LLM.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | single instance only (later entries are ignored) |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `rerank` — Reranker

Rescore and rerank documents by relevance for improved search and RAG pipelines.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `multiserve` |
| Default model | `OpenVINO/bge-reranker-base-int8-ov` on `AUTO` |
| Devices | `AUTO`, `CPU`, `GPU`, `NPU` |
| Custom models | yes |
| Weight formats (`quant`) | `int4`, `int8`, `fp16`, `fp32`, `nf4`, `int4_sym_g128`, `int4_asym_g128`, `int4_sym_g64`, `int4_asym_g64`, `int8_sym`, `int8_asym` |
| Model sources | `huggingface`, `modelscope`, `custom` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `OpenVINO/bge-reranker-base-int8-ov` | `AUTO`, `CPU`, `GPU`, `NPU` | — |
| `gpustack/bge-reranker-v2-m3-GGUF` | `CPU`, `GPU` | — |

### `robotics-ai` — Robotics AI

A demo showcasing the capabilities of Robotics AI, including real-time object detection and manipulation.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | single instance only (later entries are ignored) |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux` |

### `speech-to-text` — Speech to Text

Real-time speech recognition with low-latency transcription using Whisper models optimized for Intel hardware.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `worker` |
| Default model | `openai/whisper-base` on `AUTO` |
| Devices | — |
| Custom models | yes |
| Weight formats (`quant`) | `fp32`, `fp16`, `int8`, `int4` (default `int8`) |
| Model sources | `huggingface` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `Qwen/Qwen3-ASR-1.7B-hf` | `AUTO`, `CPU`, `GPU` | `openvino` |
| `openai/whisper-large-v3-turbo` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `openai/whisper-large-v3` | `AUTO`, `CPU`, `GPU` | `openvino` |
| `openai/whisper-medium` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `openai/whisper-small` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `openai/whisper-tiny` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `openai/whisper-base` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |

### `synthetic-image-generation` — Synthetic Image Generation

Generate and edit synthetic images from base images for dataset augmentation.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | single instance only (later entries are ignored) |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux` |

### `text-generation` — Text Generation

Generate coherent text using large language models optimized for Intel hardware.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `multiserve` |
| Default model | `OpenVINO/Qwen3.5-4B-int4-ov` on `AUTO` |
| Devices | `AUTO`, `CPU`, `GPU`, `NPU` |
| Custom models | yes |
| Weight formats (`quant`) | `int4`, `int8`, `fp16`, `fp32`, `nf4`, `int4_sym_g128`, `int4_asym_g128`, `int4_sym_g64`, `int4_asym_g64`, `int8_sym`, `int8_asym` |
| Model sources | `huggingface`, `modelscope`, `custom` |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `OpenVINO/Qwen3.5-4B-int4-ov` | `AUTO`, `CPU`, `GPU`, `NPU` | — |
| `OpenVINO/InternVL2-2B-int4-ov` | `AUTO`, `CPU`, `GPU`, `NPU` | — |
| `Qwen/Qwen3-1.7B-GGUF` | `CPU`, `GPU` | — |
| `ggml-org/Qwen3-VL-2B-Instruct-GGUF` | `CPU`, `GPU` | — |

### `text-to-speech` — Text to Speech

Natural-sounding speech synthesis with multiple voice options powered by Kokoro, Piper, Malaya, Pocket TTS, VieNeu-TTS, FastSpeech2 HS and SpeechT5 from the Open Edge Platform.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `worker` |
| Default model | `kokoro` on `AUTO` |
| Devices | — |
| Custom models | no |
| Weight formats (`quant`) | `fp32`, `fp16`, `int8`, `int4` (default `int8`) |
| Supported OS | `linux`, `windows` |

Known models:

| Model (`models.default.name`) | Devices | Backend |
| --- | --- | --- |
| `kokoro` | `AUTO`, `CPU`, `GPU`, `NPU` | `openvino` |
| `malaya` | `CPU` | `openvino` |
| `pocket-tts` | `CPU` | `openvino` |
| `vieneu` | `CPU` | — |
| `fastspeech2-hs` | `CPU` | `openvino` |
| `piper` | `AUTO`, `CPU`, `GPU` | `openvino` |
| `microsoft/speecht5_tts` | `AUTO`, `CPU`, `GPU` | `openvino` |

### `vectordb` — Vector Database

Vector storage for knowledge base management, semantic search, and RAG pipelines, backed by FAISS or PostgreSQL + pgvector.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
| Engines | `worker` |
| Default model | — |
| Devices | — |
| Custom models | no |
| Supported OS | `linux`, `windows` |

### `wake-word-detection` — Wake Word Detection

Detect custom wake words from microphone input and send webhook notifications on detection events.

| Field | Value |
| --- | --- |
| Port | allocated from `INSTANCE_PORT_RANGE` when the service starts |
| Instances | up to 5 in total |
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
