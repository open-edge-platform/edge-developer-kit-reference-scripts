<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Indonesian text-to-speech: [Pocket TTS Indonesian](https://huggingface.co/anak10thn/pocket-tts-indonesian)
(CC-BY-4.0), Kyutai's [Pocket TTS](https://github.com/kyutai-labs/pocket-tts)
fine-tuned on 502 hours of Indonesian speech, the 6-layer model the card
recommends, on OpenVINO.

## Model and voices

The first start downloads `indonesian_6l.yaml`, the weights and tokenizer it
pins (each at its own revision) and the four voice prompts into
`<repo>/models/tts/pocket-tts/anak10thn/pocket-tts-indonesian/`, and writes
`indonesian_6l.local.yaml` pointing at them. No Hugging Face token is needed.

Pocket TTS clones the voice of a short recording. The voices are the four
CC0 Common Voice clips the repository ships; `female_1`, `female_2`,
`male_1` and `male_2` are named by the pitch of the speech generated from
them. The worker uses the card's end-of-speech threshold, -6.0 (pocket-tts
defaults to -4.0, which the card measured dropping words), and the model's
temperature, 0.3. The model has no speed control, so `speed` is applied
afterwards with ffmpeg's `atempo` (`worker_common.speech.retime`). Digits are
not in the model's vocabulary: spell numbers out.

## OpenVINO

`ov_pocket.py` exports the PyTorch model once, into `openvino/` beside it,
and the worker then loads no PyTorch model:

- `flow_lm.xml`: one step of the 6-layer transformer, int8 weights (NNCF),
  its K/V caches held as OpenVINO state in the infer request;
- `mimi_decoder.xml`: the Mimi codec decoder, a whole chunk of latents at once;
- `tables.npz` and `voices/*.npy`: the embedding tables the loop applies in
  numpy, and the voice prompts already Mimi-encoded.

Text is split and prepared by pocket-tts' own functions and generated chunk by
chunk (at most 50 tokens, about a sentence), so a streamed answer sends a
chunk at a time. With zero noise and before the int8 compression, the export
matched pocket-tts to within 0.002 per sample. `export.json` records the
export version; a change to the export bumps `EXPORT_VERSION` in
`ov_pocket.py` and the next start redoes it.

`--device` takes an OpenVINO device and defaults to the CPU. `AUTO` goes to
OpenVINO as it is, which selects a GPU when there is one (the Arc Pro B60
row below). Measured 2026-10-19 on a Core Ultra 9 285K, six sentences:

| Runtime | Real-time factor |
|---|---|
| OpenVINO, CPU, int8 weights | 18x |
| OpenVINO, CPU, fp32 | 8.2x |
| PyTorch, CPU (8 threads) | 8.0x |
| PyTorch, Arc Pro B60 (XPU) | 7.2x |
| OpenVINO, Arc Pro B60 | 3.8x |

Every 80 ms frame is one transformer step, which on the CPU reads all of the
weights; int8 weights read a quarter of the bytes. On a GPU the step is too
small to pay for its dispatch.

## Models on disk

`list_models.py --models pocket-tts` reports the model downloaded once the
local config, the weights, the tokenizer and the four prompts are there; the
export needs no download.
