<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

Speech to Text backend for [MERaLiON-3-3B-ASR](https://huggingface.co/MERaLiON/MERaLiON-3-3B-ASR)
(A\*STAR I2R, Singapore) on OpenVINO: English (incl. Singapore English and
Singlish), Mandarin, Malay, Tamil, Indonesian, Thai, Vietnamese, Cantonese
and Hokkien, and code-switching between English and the others. The app runs
it when the service's `metadata.sttBackend` is `meralion`
(see [`../README.md`](../README.md)).

## Model

The first start downloads the checkpoint (6.6 GB, bf16) into
`<repo>/models/stt/meralion/MERaLiON/MERaLiON-3-3B-ASR/` at a pinned revision
and exports it to OpenVINO IR in `openvino-<precision>/` beside it (about two
minutes and ~20 GB of RAM, once). No Hugging Face token is needed.

The model is a Whisper-large-v3 encoder, a LayerNorm, a two-layer adapter that
stacks 5 encoder frames (30 s of audio become 300 embeddings) and Gemma-2-2B,
which writes the transcript. `meralion_export.py` rebuilds it from
transformers' own `WhisperEncoder` and `Gemma2ForCausalLM` and the
safetensors; the repository's `modeling_meralion3.py` (trust_remote_code,
written for transformers 4.50) is not run. transformers 5 scales Gemma-2's
input embeddings inside `embed_tokens`, so the speech embeddings are scaled by
sqrt(2304) before they are spliced in (4.50 scaled the spliced sequence).

- `encoder.xml`: static `[1, 128, 3000]` log-mel to `[1, 300, 2304]`, int8
  weights;
- `decoder.xml`: one Gemma-2 call over (prefix ids, speech embeddings), then
  (suffix ids), then one id per step; the K/V cache is OpenVINO state, only the
  last position's logits are computed (with Gemma-2's soft-capping).

Decoding follows the [`meralion-3-asr`](https://github.com/YingxuH/MERaLiON-3-ASR)
package, the model card's reference: its fixed prompt with no language hint
(the model detects the language, so `language` is accepted and ignored),
greedy decoding with a no-repeat-6-gram guard, at most 512 tokens, and
non-overlapping 30 s chunks, each padded to 30 s and transcribed on its own
(one `verbose_json` segment per chunk; the model gives no finer timestamps).

## API

The OVMS backend's routes: `POST /v1/audio/transcriptions` (json, text,
verbose_json, srt, vtt; `stream=true` and word timestamps answer 400),
`POST /v1/audio/translations` (400: transcription only),
`WS /v1/audio/stream` (live microphone, Silero VAD utterances, the
`audio_input_stream` protocol), `GET /healthcheck` (503 until loaded),
`GET /v1/model-info`, `GET /v1/models`.

```bash
./start.sh --port 8023 --device AUTO --precision int8
curl -F file=@clip.wav -F response_format=verbose_json http://127.0.0.1:8023/v1/audio/transcriptions
```

## Devices and precision

`--device` takes an OpenVINO device; `AUTO` goes to OpenVINO as it is (a
discrete GPU first). On the `NPU` only the static encoder runs there: the
decoder's dynamic-shape state does not compile for the NPU plugin, so it runs
on the CPU; the NPU's first compile takes about 70 s and is cached in
`openvino-<precision>/cache`. `--precision` picks the decoder's weights:
`int8` (default) or `int4`.

Measured 2026-10-29 on a Core Ultra 9 285K, Arc Pro B60 and the AI Boost NPU,
FLEURS test clips (2 per language) plus the model card's four code-switching
samples; error rates are WER (ms, en, ta) and CER (zh, yue), lower is better:

| Runtime | Real-time factor | Decoder tok/s | ms | en | zh | yue | ta | card |
|---|---|---|---|---|---|---|---|---|
| OpenVINO, Arc Pro B60, int8 | 23x | 93 | 4.5 | 13.0 | 2.4 | 1.0 | 11.1 | 11.4 |
| OpenVINO, Arc Pro B60, int4 | 26x | 120 | 9.1 | 13.0 | 7.1 | 1.0 | 17.8 | 14.3 |
| PyTorch XPU, Arc Pro B60, bf16 | 13x | 46 | 4.5 | 13.0 | 2.4 | 1.0 | 14.8 | 11.1 |
| OpenVINO, CPU, int8 | 1.9x | 17 | 4.5 | 13.0 | 2.4 | 1.0 | 13.0 | 9.9 |
| OpenVINO, NPU encoder + CPU decoder, int8 | 1.9x | 17 | 4.5 | 13.0 | 2.4 | 1.0 | 11.1 | 10.9 |
| OpenVINO, integrated GPU, int8 | 1.6x | 14 | 4.5 | 13.0 | 2.4 | 1.0 | 11.1 | 12.3 |
| PyTorch, CPU, fp32 | 0.5x | 2 | 4.5 | 13.0 | 2.4 | 1.0 | 11.1 | 12.0 |

int8 transcribes like PyTorch fp32; int4 is a little faster on a GPU and
loses most on Tamil (on 6 clips per language: 33% WER against 9%). On the B60
a 30 s chunk's encoder pass takes 43 ms; on the CPU, iGPU and NPU about 1.4 s,
so live transcription there waits ~1.5 s plus 60 ms per word. PyTorch XPU on
the 285K's integrated GPU did not finish loading within 3 minutes (no
ahead-of-time kernels for it).

## Licence

MERaLiON Public Licence (MIT terms plus the Gemma Terms of Use it inherits):
keep the attribution, and acknowledge MERaLiON where a product built with it
is described ("The development of this product/service was assisted by
MERaLiON, an AI model developed by the Agency for Science Technology And
Research (A\*STAR)").

## Models on disk

`list_models.py --models MERaLiON/MERaLiON-3-3B-ASR` reports the model
downloaded once the checkpoint files are there; the export needs no download.
