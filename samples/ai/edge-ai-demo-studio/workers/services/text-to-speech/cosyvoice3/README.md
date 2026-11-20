<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Multilingual text-to-speech with cloned voices:
[Fun-CosyVoice3-0.5B-2512](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512)
(FunAudioLLM, Apache-2.0) on OpenVINO. CosyVoice 3 also reads Japanese,
Korean, German, Spanish, French, Italian and Russian, mixes languages within
a sentence, and reads Chinese in 17 dialects on request (see Dialects).
Whisper large-v3 heard `zh_female` read a sentence in each of the nine
languages back word for word (2026-11-04; cloned cross-lingually instead,
without its transcript, "Jurong" became "Yerong"), except Japanese written
with kanji, which come out with Chinese readings (今日は as "珍獣は"); the
same sentence in kana was read right. The demo says so under Japanese.

## Model and voices

The first start downloads the model (5.4 GB) into
`<repo>/models/tts/cosyvoice3/FunAudioLLM/Fun-CosyVoice3-0.5B-2512/` and
exports to `openvino/` beside it (about a minute, once). Upstream's code is
vendored by `upstream-setup.sh` (pinned in `workers/upstream.json`: `cosyvoice`
from FunAudioLLM/CosyVoice and `matcha` from Matcha-TTS) and runs unmodified.
This worker has its own lock and `.venv`: that code imports a training stack
(Lightning, Hydra, rich, gdown, wget, matplotlib, diffusers) no other worker
needs.

Every voice is cloned from a recording in `<repo>/models/tts/cosyvoice3/voices/`:
drop in `<name>.wav` (3-10 s, one speaker, 16 kHz or more) and, if you have
it, `<name>.txt` with what is said. With a transcript the voice is cloned
zero-shot (closest likeness); without one, cross-lingually (the recording's
language does not matter). New files are picked up when the voice list is
next read, a replaced recording is encoded again, and a voice whose recording
is deleted is dropped. The built-in `zh_female` is upstream's own sample
speaker, a woman speaking Mandarin: `asset/zero_shot_prompt.wav` from the
CosyVoice repository at the pinned commit (Apache-2.0; `cosyvoice-asset` in
`workers/upstream.json`, fetched by `start.sh` beside the code), with
upstream's transcript, so it is cloned zero-shot. It replaced `sg_female`,
MERaLiON-OmniVoice-Hokkien-TTS's reference recording, whose licence the app
no longer takes: a start removes that file when it is unchanged.

The demo's "Clone a voice" panel, or any client, adds voices over HTTP:

- `POST /v1/audio/voices`, multipart: `name` (1-40 letters, digits, `-`,
  `_`), `file` (any format ffmpeg reads; a browser's WebM recording works)
  and optional `transcript`. The recording is decoded to mono 24 kHz, must be
  1-30 s (upstream's speech tokenizer stops at 30 s), and is encoded before it
  is saved as `<name>.wav` (and `<name>.txt`), so a recording that fails
  leaves a voice of that name as it was. Answers 201 with
  `{"voice", "transcript", "seconds"}`.
- `DELETE /v1/audio/voices/{name}` removes the recording and its transcript;
  `zh_female` cannot be replaced or removed.

## Dialects

`POST /v1/audio/speech` takes `dialect`, one of `cantonese`, `minnan`
(Hokkien), `sichuan`, `shanghai`, `dongbei`, `tianjin`, `shandong`, `henan`,
`hubei`, `hunan`, `jiangxi`, `guizhou`, `yunnan`, `gansu`, `ningxia`, `shanxi`
and `shaanxi` (`DIALECTS` in `ov_cosyvoice.py`); anything else answers 400.
Each is upstream's instruct mode with the instruction the model was trained
on (`请用广东话表达。` and so on, from upstream's `instruct_list`, which the
worker checks at startup), and works with any voice. Upstream's
`frontend_instruct2` drops the instruction for a stored voice (it takes the
voice's prompt as it is), so the worker puts it in place of the voice's
transcript itself, without the LLM's speech prompt, as upstream does for a
recording; the voice's timbre comes from the flow's prompt.

Measured 2026-11-04 with `zh_female`: Whisper large-v3 forced to Cantonese
read `我哋今日去饮茶，你话好唔好呀？呢度嘅点心好好食。` back from `cantonese`
as "我哋今日去飲茶,你話好不好呀?呢度嘅點心好好食。" (as written it came out
garbled: "我的今日去你茶,你话好无好呀? 呢,度个点心…"). Whisper's language
detection still says `zh`, and it cannot judge the other dialects. Every
dialect, with `zh_female` and with a voice cloned from
`frontend/tests/assets/audio.mp3`, read `今天天气很好，我们一起去吃饭吧。` as
2.4-5.4 s of speech.

## OpenVINO

CosyVoice 3 is a Qwen2-0.5B speech-token LLM, a flow-matching DiT (10 Euler
steps with classifier-free guidance) that turns the tokens into a mel
spectrogram, and the HiFT vocoder. `ov_cosyvoice.py` swaps the heavy parts at
upstream's own seams:

- `llm.xml`: one Qwen2 call (inputs_embeds to the last hidden state), the K/V
  cache as OpenVINO state, int8 weights;
- `estimator.xml`: the DiT, read from the repository's ONNX (made for
  TensorRT);
- `hift.xml`: HiFT from mel to just before its iSTFT, always on the CPU (the
  Arc B60 GPU plugin fails to build one of its concats: "could not create a
  primitive descriptor for the concat primitive").

The speech-token head, sampling, the flow's token encoder, the iSTFT and the
frontend (text normalisation, the ONNX speech tokenizer and speaker encoder
for voice prompts, each voice encoded once) stay in PyTorch (CPU build) and
ONNX Runtime. Only the config's inference sections are loaded; the rest would
import pyarrow and pyworld for the training data pipeline.

transformers 5 (the CVE-fixed release) changes two things CosyVoice, written
for 4.51, relies on, both patched in `ov_cosyvoice._compat_patches`:
`Qwen2ForCausalLM.from_pretrained` keeps the checkpoint's bf16 (beside fp32
speech embeddings), and the one-column attention mask upstream passes after
the first decoding step is read as padding, so every token attends only to
itself and the speech comes out as babble.

## Devices and real time

`--device` (`AUTO`, default, picks a discrete GPU first; `CPU`, `GPU`) runs the
DiT. The worker then sets itself up for real time on what it got:

- **Discrete GPU**: the LLM and the DiT run there, 10 Euler steps, the whole
  voice prompt.
- **CPU or integrated GPU**: the LLM runs on the CPU (12 ms a token, against
  20 ms on the 285K's integrated GPU); the DiT takes 5 steps with int8
  activations, and a voice without a transcript is cut to its first ~4 s at a
  pause (the DiT processes the prompt with the speech). The int8 DiT is
  quantized once, on the first start (~1.5 min): NNCF calibrates it on the
  DiT's inputs while synthesizing ten sentences, leaving the timestep
  conditioning, attention scores and input/output layers in floating point
  (quantizing those too left no speech at all). On a GPU the DiT runs at fixed
  lengths (128-frame buckets, padded with its own mask; 256-512 compiled at
  startup), as an integrated GPU otherwise recompiles it for every new length.

`--flow-steps` overrides the step count. The vocoder always runs on the CPU.
Measured 2026-10-29 on a Core Ultra 9 285K and Arc Pro B60 over HTTP, seven
Mandarin, English and colloquial Malaysian Mandarin sentences ("你吃饱了没有？
今天很热啊，我们去喝茶吧。"), cloned from the built-in voice:

| Device | Real-time factor | ASR read-back | Speaker similarity |
|---|---|---|---|
| Arc Pro B60 (AUTO): LLM + DiT, 10 steps, full prompt | 1.9x | exact | 0.68 |
| CPU: LLM + int8 DiT, 5 steps, ~4 s prompt | 1.5x | exact | 0.65 |
| Integrated GPU: int8 DiT there, LLM on the CPU | 1.5x | exact | 0.69 |
| CPU, fp16 DiT, 10 steps, full prompt (before) | 0.41x | exact | 0.69 |
| PyTorch XPU, Arc Pro B60 | 1.3x | exact | |
| PyTorch, CPU | 0.23x | exact | |

Read-back is MERaLiON-3-3B-ASR on five of the sentences; similarity is the
cosine of CosyVoice's own CAM++ speaker embeddings against the reference
recording. The NPU is not offered: neither the LLM's dynamic-shape state nor
the DiT (`ConvertShapeTo4D` pass) compiles for it.

## Models on disk

`list_models.py --models cosyvoice3` reports the model downloaded once the
checkpoint files and the built-in voice are there; the export needs no
download.
