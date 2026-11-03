<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Vendored sources

Neither `mesolitica/malaya` nor `mesolitica/malaya-speech` has a release with
the VITS code this worker uses. `start.sh` copies both at the commits pinned
in `workers/oep-services.json` (`sources`) into `malaya/` and `malaya_speech/`
beside `main.py`, which imports them from there; `pyproject.toml` lists their
requirements. The copies are not changed. Instead, the `overrides/` package replaces three functions at
call time: `malaya_speech.tts.load_text_ids`, `malaya.normalizer.rules.load`
and `malaya.preprocessing.demoji`. Upstream fetches its emoji dictionary from
GitHub on every load; the overrides take a local directory so the worker runs
offline after the first download.

## OpenVINO

The worker runs the VITS model on OpenVINO. The first start converts the
PyTorch checkpoint to `openvino/malaya.xml` beside it (`ov_malaya.py`); later
starts compile that. The trace fixes the noise scales at 0, as the worker
always ran them, and keeps the input length, speaker and length scale as
inputs. Upstream's relative-attention padding branches on the input length in
Python, which a trace would freeze, so the export swaps in an equivalent
without the branch. The IR matches PyTorch (correlation 1.0, same length) at
every input length tested: 1 to 12, 57 and 240 ids.

`--device` takes an OpenVINO device and defaults to the CPU. `AUTO` goes to
OpenVINO as it is, which selects a GPU when there is one (the Arc Pro B60
row below). On unseen sentences, measured 2026-10-19 on a Core Ultra 9
285K:

| Runtime | Real-time factor |
|---|---|
| OpenVINO, CPU | 9.5x |
| PyTorch, CPU | 4.6x |
| PyTorch, Arc Pro B60 (XPU) | 3.4x (each new input length builds kernels for about a second) |
| OpenVINO, Arc Pro B60 | 1.1x (each new input length recompiles) |

## Models on disk

`list_models.py --models malaya` reports whether the Malaya VITS checkpoint
(`config.json` + `model.pth` under
`<repo>/models/tts/malaya/malaysia-ai/malay-VITS-multispeaker/`, via
`worker_common.models_dir("tts", "malaya", ...)`) is already downloaded,
without starting the worker. The IR the first start converts from it needs no
download.

Older checkouts may still have the model at the legacy location this worker
used before it called `models_dir()`:
`<repo>/models/huggingface/malaysia-ai/malay-VITS-multispeaker/`. `main.py`
moves it into the new location itself the first time it starts (logging a
single line either way); `list_models.py` never touches disk, so it checks
both locations and reports whichever one is actually complete.

## Streaming

`POST /v1/audio/speech` takes OpenAI's request fields. With `"stream": true`
(the default here) the audio is sent as it is synthesized, one sentence per model call:
`wav` opens with a header whose RIFF and `data` sizes are `0xFFFFFFFF`
(read to the end of the body) followed by 16-bit PCM, `pcm` is the bare
samples, `mp3`/`aac` are encoded piece by piece, and `opus`/`flac` are sent
once complete. `"stream_format": "sse"` sends OpenAI's event stream instead:
`speech.audio.delta` events (`audio`: base64 of the next bytes of that same
file) and a final `speech.audio.done` with the audio's `duration` and a
`perf` block (`seconds`, `audio_seconds`). `"stream": false` answers the
whole file with the model time in `Server-Timing`. The shared logic is
`worker_common.speech`, used by every text-to-speech worker.
