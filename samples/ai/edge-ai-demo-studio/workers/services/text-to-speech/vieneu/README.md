<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Vietnamese text-to-speech: [VieNeu-TTS v3 Turbo](https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo)
(Apache-2.0) with its int8 ONNX graphs on ONNX Runtime.

## Vendored sources

The engine is upstream's (`vieneu._v3_turbo_engine.onnx_runtime_lite`, from
[pnnbao97/VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS)). The `vieneu`
release on PyPI requires gradio for its web UI, so `start.sh` instead copies
`src/vieneu` and `src/vieneu_utils` at the v3.8.3 commit pinned in
`workers/oep-services.json` (`sources`) into this directory, and
`pyproject.toml` lists what the engine and the text front end need. The text
is normalized and phonemized by [sea-g2p](https://github.com/pnnbao97/sea-g2p)
(Rust wheels, no espeak).

## Model and voices

The first start downloads the `onnx_int8` graphs of the model and the decoder
of the [MOSS audio codec](https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX)
(Apache-2.0), at pinned revisions, into `<repo>/models/tts/vieneu/`. The
engine is handed those directories, so it never asks the hub itself.

The 25 voices are upstream's presets (`vieneu/assets/voices_v3_turbo.json`, a
speaker embedding and reference codes each), named as upstream names them;
the old names upstream keeps as aliases (`Minh Quân` for `Hải Đăng`, for
example) are accepted too. Cloning a voice from a recording is not exposed.
Text is split into upstream's chunks (at most 256 characters, at sentence and
clause breaks) with upstream's pauses between them, and a streamed answer
sends a chunk at a time. The model has no speed control, so `speed` is
applied afterwards with ffmpeg's `atempo` (`worker_common.speech.retime`).

Upstream notes that the int8 graphs need a CPU with VNNI (AVX-VNNI or
AVX-512 VNNI); without it the speech comes out garbled.

## Why ONNX Runtime

Each 80 ms of audio is one backbone step and 16 single-layer steps, one per
codebook, with sampling in numpy between them. Measured 2026-10-19 on a Core
Ultra 9 285K, six sentences:

| Runtime | Real-time factor |
|---|---|
| ONNX Runtime, CPU, int8 graphs | 6.3x |
| OpenVINO, CPU, fp32 graphs with int8 weights (NNCF) | 3.0x |
| OpenVINO, CPU, the int8 graphs | 2.3x |
| PyTorch, Arc Pro B60 (XPU) | 3.4x |
| PyTorch, CPU | 1.0x |

OpenVINO's overhead per call outweighs its kernels on graphs this small, and
on the GPU (fp16) the logits overflowed. `main.py` sets
`OPENBLAS_NUM_THREADS=1` before numpy loads: numpy's BLAS threads otherwise
compete with ONNX Runtime's on every codebook, which cut the speed to 2.2x.

## Models on disk

`list_models.py --models vieneu` reports the model downloaded once the int8
graphs and the codec decoder are there.
