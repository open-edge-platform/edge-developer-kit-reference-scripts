<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Models on disk

`list_models.py --models piper` reports whether the worker's startup
preload would succeed, without starting the worker: the default voice
(`en_US-lessac-medium.onnx`+`.onnx.json` under `models/tts/piper/`) that
`PiperTTSService.initialize()` loads unguarded at startup. Any other id is
resolved the same way, as a voice stem, since Piper voices are otherwise
chosen per request and downloaded on demand.

## Streaming

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
