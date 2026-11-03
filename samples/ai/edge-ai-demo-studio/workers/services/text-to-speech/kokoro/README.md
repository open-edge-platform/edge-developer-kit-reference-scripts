<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Text-To-Speech Worker

This worker provides a Text-to-Speech (TTS) service using the Kokoro FastAPI server and Intel hardware acceleration.

### Vendored kokoro package

The `kokoro` package is not a uv dependency. `start.sh` copies it from
`hexgrad/kokoro`, at the commit pinned in `workers/oep-services.json`
(`sources`), into `./kokoro` (gitignored) and applies `kokoro.patch`.
`ov_kokoro.py` subclasses its `KModel` and `export.py` converts it to
OpenVINO IR. The patch:

- removes `__main__.py`, the CLI, which pulls in dependencies the worker does not ship
- frees intermediate tensors and adds `cleanup_cache()` in `custom_stft.py`,
  `istftnet.py`, `model.py` and `modules.py`, plus a `util.py` of memory helpers,
  so a long-running worker's memory stays flat and the model exports in pieces
- adds two bounds checks in `CustomSTFT.inverse`

### Usage

To start the Text-to-Speech worker, run:

```bash
uv run main.py --port 5002
```

Replace `--port` with your desired value if needed. See the options below for details.

**Options:**

- `--port`: Port to serve the API (default: 5002)

### What Happens

- Downloads the Kokoro TTS model if not present.
- Starts the FastAPI server with the specified port.

### Streaming

`POST /v1/audio/speech` takes OpenAI's request fields. With `"stream": true`
(the default here) the audio is sent as it is synthesized, one sentence at a time:
`wav` opens with a header whose RIFF and `data` sizes are `0xFFFFFFFF`
(read to the end of the body) followed by 16-bit PCM, `pcm` is the bare
samples, `mp3`/`aac` are encoded piece by piece, and `opus`/`flac` are sent
once complete. `"stream_format": "sse"` sends OpenAI's event stream instead:
`speech.audio.delta` events (`audio`: base64 of the next bytes of that same
file) and a final `speech.audio.done` with the audio's `duration` and a
`perf` block (`seconds`, `audio_seconds`). `"stream": false` answers the
whole file with the model time in `Server-Timing`. The shared logic is
`worker_common.speech`, used by every text-to-speech worker.

### Model Caching

The Kokoro worker implements intelligent model caching to optimize performance and reduce download times:

- **Kokoro Base Model**: Downloaded and cached on first startup in `models/tts/kokoro/` directory
- **Default Voice**: The `af_heart` voice is downloaded during initial setup
- **Other Voices**: Additional voices are downloaded and cached only when first requested/selected
- **Local Model Reuse**: If a voice model already exists in the models directory, the local cached version is used instead of downloading

This approach minimizes initial setup time while ensuring voices are available when needed. All models are stored locally for subsequent use.

### Models on disk

`list_models.py --models kokoro` reports whether the OpenVINO IR
(`models/tts/kokoro/openvino_model.xml`+`.bin`) is already exported *and*
`config.json` is present (opened unconditionally on every load), without
starting the worker. Voices are downloaded lazily per request and are not
part of this check.

### Notes

- For GPU support, make sure your system has the required Intel drivers.