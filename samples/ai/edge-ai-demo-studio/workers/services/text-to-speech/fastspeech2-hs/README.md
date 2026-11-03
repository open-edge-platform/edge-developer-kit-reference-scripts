<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Tamil text-to-speech: [Fastspeech2_HS](https://github.com/smtiitm/Fastspeech2_HS)
(CC-BY-4.0) from the Speech Technology Consortium at IIT Madras, FastSpeech2
models trained on hybrid-segmentation alignments with HiFi-GAN vocoders, on
OpenVINO. The worker serves its Tamil female (`tamil_female`) and male
(`tamil_male`) voices; the male model is Tamil-English bilingual.

## Without ESPnet

Upstream runs the models through ESPnet's `Text2Speech`, which needs a
Python 3.7 era environment (espnet 202209, numpy 1.21) or, in current
releases, a long tail of training dependencies including pyworld, which has
no Linux wheel. `fastspeech2.py` re-implements the parts inference uses
(ESPnet2's FastSpeech2 with transformer encoder and decoder, variance
predictors, length regulator and postnet, and jik876's HiFi-GAN) and loads the
checkpoints unchanged. Its length regulator uses cumsum and comparisons
instead of `repeat_interleave`, so the whole voice converts to one OpenVINO
IR (`ov_fastspeech2.py`), tokens and a duration scale in, 22.05 kHz audio out.
The first start converts both voices to `openvino/tamil_<gender>.xml`; the IR
matches the PyTorch modules to within 0.0002 per sample.

## Text

`tamil_frontend.py` follows upstream's `TTSDurAlignPreprocessor` for Tamil:
numbers become Tamil words (indic-num2words), punctuation splits phrases,
words become phones from `phone_dict/tamil` (148k words; ASCII words from
`phone_dict/english`, which upstream backs with g2p_en and this worker does
not), and each phrase is written `$<phones>.`.

Words missing from the dictionary go through upstream's Tamil parser, which
shells out to a prebuilt Linux binary and edits files with sed.
`tamil_g2p.py` ports it to Python (rules from `ssn_parser_new/lists`, which
come with the model download), with two corrections measured against the
dictionary: the voicing rules' index stops at the last phone, and phones map
to the symbols the models were trained on. It reproduces 98.9% of 20,000
dictionary words exactly. Dictionary entries written with glyphs missing from
a model's token list (U+0909, U+0929, U+0931) are read as the symbol that
model has for the phone.

## Download

The models, dictionaries and parser rules come from the
[Hugging Face mirror](https://huggingface.co/smtiitm/Fastspeech2_HS) at a
pinned revision, except the female vocoder: the mirror serves a different
file than its LFS pointer names for both female vocoder paths, and the hub
client rejects it. That one file comes from the GitHub repository at a pinned
commit, checked against the pointer's sha256.

## Speed

`speed` scales the predicted durations (upstream's `alpha`, its inverse) up
to 1.5x, and ffmpeg's `atempo` stretches the audio for the rest: at 2x the
shortened durations blurred the phones (Whisper small lost most words of both
voices), while 1.5x stayed clean.
Measured 2026-10-19 on a Core Ultra 9 285K, six unseen sentences:

| Runtime | Real-time factor |
|---|---|
| OpenVINO, CPU | 9.3x |
| PyTorch, CPU | 3.8-6.8x |
| PyTorch, Arc Pro B60 (XPU) | 4.0-4.9x (each new input length builds kernels) |
| OpenVINO, Arc Pro B60 | 1.2x (each new input length recompiles) |

`--device` takes an OpenVINO device and defaults to the CPU. `AUTO` goes to
OpenVINO as it is, which selects a GPU when there is one (the Arc Pro B60
row above).

## Models on disk

`list_models.py --models fastspeech2-hs` reports the model downloaded once
both voices' models and vocoders, the Tamil dictionary and the parser rules
are there; the IR needs no download.
