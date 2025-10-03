<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Speech-To-Text Worker

This worker provides a Speech-to-Text (STT) service using OpenVINO-optimized Whisper models and Intel hardware acceleration with optional audio denoising capabilities.

### Setup

To set up the Speech-to-Text worker, you need to install all required dependencies and download the necessary models.

**For Ubuntu/Linux:**
```bash
./setup.sh
```

**For Windows:**
```powershell
.\setup.ps1
```

This will ensure all necessary components are installed before you run the worker.

### Usage

To start the Speech-to-Text worker, run:

```bash
uv run main.py --stt-model-id openai/whisper-tiny --port 5005
```

Replace `--port` and `--stt-model-id` with your desired values if needed. See the options below for details.

**Options:**

- `--port`: Port to serve the API (default: 5005)
- `--stt-model-id`: Path to the STT model directory or Hugging Face model name (required)
- `--stt-device`: Device to run the STT model on - CPU, GPU, or NPU (default: CPU)
- `--denoise-model`: Name of Intel Open Model Zoo denoise model (default: noise-suppression-poconetlike-0001)
- `--denoise-device`: Device to run the denoise model on - CPU, GPU, or NPU (default: CPU)

**Supported Models:**

- Whisper models from Hugging Face (e.g., `openai/whisper-tiny`, `openai/whisper-base`, `openai/whisper-small`, `openai/whisper-medium`)
- OpenVINO-exported Whisper models (e.g., `OpenVINO/whisper-tiny-int8-ov`)

**Supported Denoise Models:**

- `noise-suppression-poconetlike-0001`
- `noise-suppression-denseunet-ll-0001`

### API Endpoints

The worker provides the following REST API endpoints:

#### Health Check
```
GET /healthcheck
```
Returns server status.

#### Audio Transcription
```
POST /v1/audio/transcriptions
```
Converts audio to text in the same language.

**Parameters:**
- `file`: Audio file (webm, wav, mp3, etc.)
- `language`: Source language (optional, default: "en")
- `use_denoise`: Enable audio denoising (optional, default: false)

**Response:**
```json
{
  "text": "Transcribed text",
  "status": true
}
```

#### Audio Translation
```
POST /v1/audio/translations
```
Converts audio from any language to English text.

**Parameters:**
- `file`: Audio file (webm, wav, mp3, etc.)
- `language`: Source language (optional, default: "en")

**Response:**
```json
{
  "text": "Translated text in English",
  "status": true
}
```

### What Happens

**On Startup:**
- Downloads the specified Whisper model if not present locally
- Initializes STT pipeline for immediate use
- Sets up temporary directories and API endpoints

**On First Denoise Request:**
- Downloads Intel denoise model if not present locally (lazy loading)
- Compiles denoise model for the specified device
- Caches model for subsequent requests

### Notes

- **Hardware Acceleration**: For GPU/NPU support, ensure Intel drivers and OpenVINO runtime are installed
- **Audio Format Support**: Supports various input formats (webm, wav, mp3, etc.) with automatic conversion
- **Concurrent Processing**: Supports concurrent requests but processes them sequentially due to shared model resources
- **Model Storage**: Models are cached in `models/` directory structure (huggingface/, ovms/, intel/)
- **Lazy Loading**: Denoise model only loads when first requested with `use_denoise=True`