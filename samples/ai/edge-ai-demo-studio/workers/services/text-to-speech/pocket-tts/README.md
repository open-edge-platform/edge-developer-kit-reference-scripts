<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Text-to-speech in eight languages with Kyutai's [Pocket TTS](https://github.com/kyutai-labs/pocket-tts)
on OpenVINO: Kyutai's seven (English, French, German, Italian, Portuguese,
Spanish, Dutch) and [Pocket TTS Indonesian](https://huggingface.co/anak10thn/pocket-tts-indonesian),
a community fine-tune on 502 hours of Indonesian speech. All are CC-BY-4.0
6-layer models, each a checkpoint of its own; the voice picks the language.

## Languages and voices

Pocket TTS speaks in the voice of a short recording; a voice is the model's
state after hearing it. `GET /v1/audio/voices` lists all 54, `true` for the
languages ready to speak and `false` for those that download first.

| Language | Voices | Loaded |
|---|---|---|
| Indonesian | `female_1`, `female_2`, `male_1`, `male_2` | at start (the default) |
| English | `en_alba`, `en_marius`, `en_javert`, `en_jean`, `en_fantine`, `en_cosette`, `en_eponine`, `en_azelma` | on first use |
| French, German, Italian, Portuguese, Spanish, Dutch | `<fr\|de\|it\|pt\|es\|nl>_` + `estelle`, `juergen`, `giovanni`, `rafael`, `lola`, `daan`, `alba`, the language's own voice first | on first use |

**Indonesian.** The first start downloads `indonesian_6l.yaml`, the weights
and tokenizer it pins (each at its own revision) and the four voice prompts
into `<repo>/models/tts/pocket-tts/anak10thn/pocket-tts-indonesian/`, and
writes `indonesian_6l.local.yaml` pointing at them. The voices are the four
CC0 Common Voice clips the repository ships, named by the pitch of the speech
generated from them. The worker uses the card's end-of-speech threshold,
-6.0 (pocket-tts defaults to -4.0, which the card measured dropping words).

**Kyutai's languages.** The first request in one downloads, from
[kyutai/pocket-tts-without-voice-cloning](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning),
the language's weights, tokenizer and voices at the revisions pocket-tts'
own config for it pins, into
`<repo>/models/tts/pocket-tts/kyutai/pocket-tts-without-voice-cloning/languages/<language>/`
(about 250 MB; 430 MB with its export, so 3 GB for all seven), then exports
it. The first chunk came 41 to 49 s after the request (2026-11-10, a Core
Ultra 9 285K on an 8 MB/s link, most of it the download), and the language
then runs as fast as Indonesian. Those are the weights
without voice cloning, as the ones with it are gated on Hugging Face; the
voices are the states Kyutai precomputed for each language from its
[pre-made voices](https://huggingface.co/kyutai/tts-voices), every one of
which speaks every language. No Hugging Face token is needed for any language.

A language stays loaded once used; the worker runs one chunk of one request
at a time, so a language's first request holds up the others while it loads.
The models have no speed control, so `speed` is applied afterwards with
ffmpeg's `atempo` (`worker_common.speech.retime`). Digits are not in the
Indonesian model's vocabulary: spell numbers out.

## OpenVINO

`ov_pocket.py` exports each language's PyTorch model once, into `openvino/`
beside its checkpoint, and the worker then loads no PyTorch model:

- `flow_lm.xml`: one step of the 6-layer transformer, int8 weights (NNCF),
  its K/V caches held as OpenVINO state in the infer request;
- `mimi_decoder.xml`: the Mimi codec decoder, a whole chunk of latents at once;
- `tables.npz`: the embedding tables the loop applies in numpy;
- `voices/*.npz`: each voice's K/V caches, which a chunk starts from by
  setting the infer request's state, so no prompt runs per chunk. Kyutai's are
  its precomputed states; the Indonesian ones are computed at export by
  pocket-tts' own `get_state_for_audio_prompt` from the prompts.

Text is split and prepared by pocket-tts' own functions and generated chunk by
chunk (at most 50 tokens, about a sentence), so a streamed answer sends a
chunk at a time. With zero noise and before the int8 compression, the export
matched pocket-tts to within 0.002 per sample. `export.json` records the
export version and the weights' revision; a change to the export bumps
`EXPORT_VERSION` in `ov_pocket.py`, and either change redoes it on the next
load.

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

The table is the Indonesian model's; Kyutai's 6-layer models are the same
size. Every 80 ms frame is one transformer step, which on the CPU reads all of the
weights; int8 weights read a quarter of the bytes. On a GPU the step is too
small to pay for its dispatch.

## Models on disk

`list_models.py --models pocket-tts` reports the model downloaded once the
Indonesian local config, weights, tokenizer and four prompts are there (what
the start needs; the export needs no download). Its files are both model
folders, so removing the model removes every language downloaded.
