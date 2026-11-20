<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Video Generation worker

Text-to-video and image-to-video with the Wan family, behind OpenAI's Videos API
(`POST /v1/videos`, `GET /v1/videos/{id}`, `/events`, `/content`, `DELETE`).

## Models

Every model and decoder here is Apache-2.0, weights included.

| Preset (`--model`) | What it is | Native output |
|---|---|---|
| `FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers` | Wan2.2 TI2V 5B distilled (DMD) to 3 steps, no guidance | 1280x704, 121 frames, 24 fps; text or start image |
| `Wan-AI/Wan2.2-TI2V-5B-Diffusers` | Wan2.2 TI2V 5B, 50 UniPC steps with guidance | 1280x704, 121 frames, 24 fps; text or start image |
| `Wan-AI/Wan2.2-T2V-A14B-Diffusers` | Wan2.2 T2V A14B: two 14B transformers, one for the high-noise steps and one for the rest, 40 UniPC steps with guidance 4 / 3 | 1280x720 or 832x480, 81 frames, 16 fps; text only |
| `Wan-AI/Wan2.1-T2V-1.3B-Diffusers` | Wan2.1 T2V 1.3B | 832x480, 81 frames, 16 fps; text only |
| `Wan-AI/Wan2.1-VACE-1.3B-diffusers` | Wan2.1 VACE 1.3B: Wan2.1 plus 15 control blocks | 832x480, 81 frames, 16 fps (up to 1280x720 and 30 s, in windows); follows a driving video's poses, optionally as the subject of an image |

The UMT5-XXL text encoder, tokenizer and VAE are byte-identical across these repositories
(same LFS hashes; Wan2.1's fp32 encoder rounded to bf16 equals Wan2.2's exactly), so they are
always read from `Wan-AI/Wan2.2-TI2V-5B-Diffusers` (Wan2.1's own tokenizer and VAE excepted) and a
second preset downloads only its transformer (VACE's VAE, scheduler and tokenizer are Wan2.1
T2V's, also byte for byte; A14B's are Wan2.1's too, mirrored from its own repository). Decoding uses LightX2V's `lighttaew2_1` / `lighttaew2_2` from
`lightx2v/Autoencoders`. Pose maps are drawn with YOLOX-L and DWPose-L (`yzd-v/DWPose`, the two
`.onnx` files only), both Apache-2.0.

Left out on licence grounds: LTX-Video (v0.9 is RAIL-M, research only; later versions and LTX-2
need a paid licence above USD 10M revenue), the CausVid few-step LoRA (CC BY-NC 4.0), HunyuanVideo
(excludes the EU, UK and South Korea), Stable Video Diffusion (community licence with a revenue
cap), CogVideoX-5B (own licence). Wan2.2-Animate-14B (character animation and replacement) is
Apache-2.0, but its own preprocessing finds people with YOLOv10, which is AGPL-3.0, and retargets
poses with FLUX Kontext, which is non-commercial.

## Backends

`--device` picks the backend:

* `XPU` (`xpu`, `xpu:0`): PyTorch bf16 on an Intel GPU. The text encoder stays on the GPU when
  everything fits beside 6 GiB of activations, else runs on the CPU (4 s per new prompt there; the
  last eight prompts are cached). `--decoder full` decodes with the model's own VAE instead of the
  tiny decoder.
* Anything else is OpenVINO. `GPU` and `AUTO` mean the discrete GPU when there is one (OpenVINO's
  own `GPU` is `GPU.0`, usually the integrated one), `GPU.N` and `CPU` as given.
  `--text-device` and `--decoder-device` (for instance `NPU`) move those networks elsewhere.

**Wan2.2 A14B** is two transformers of the same shape: `transformer` denoises while the timestep
is at least `boundary_ratio` (0.875) x 1000, `transformer_2` after, each with its own guidance
(`guidance_scale` 4, `guidance_scale_2` 3), as diffusers' `WanPipeline` runs them. Each is 14.3B
parameters: 27 GiB in bf16, 14 GB at int8, 8 GB at int4. Where both do not fit beside 6 GiB of
activations they take turns: OpenVINO keeps one compiled at a time (the second is compiled when
the loop reaches it, the first again at the next video), PyTorch keeps the idle one in RAM and
moves them at the switch. So int8 runs on a 24 GB GPU, one transformer at a time, and bf16 needs
about 36 GB (one transformer, the VAE and activations). OpenVINO also moves the text encoder (6 GB
at int8) to the CPU when it does not fit beside the larger transformer; a prompt takes 0.2 s there.

On first start OpenVINO converts each network under `models/video-generation/` (`wan/ov_export.py`):
the transformer and text encoder at `--precision` (int8 default, fp16, int4: NNCF weight
compression), the VAE encoder (image-to-video) and the tiny decoder. Shared pieces are converted
once. Neither optimum-intel nor OpenVINO GenAI export Wan as of 2026.2 (GenAI's
`Text2VideoPipeline` runs LTX-Video only), so this traces each network with `ov.convert_model` as
the OpenVINO notebooks `wan2.1-text-to-video` and `wan2.2-text-image-to-video` do.

What it does differently from those notebooks, and why:

* **The text encoder runs in f32 on a GPU.** UMT5's activations overflow fp16: on the GPU's
  default f16 every output is NaN (B60 and the integrated GPU alike). Weights stay compressed;
  0.12 s for a prompt on the B60.
* **Only the prompt's real tokens are encoded**, not 512 with padding: padding is masked out of
  every attention, so the embeddings match diffusers' (to bf16 noise) at a sixth of the time.
* **The transformer is compiled for each video's exact shape** (`static`). The GPU plugin's
  dynamic-shape kernels took 3.89 s per Wan2.1 step against 2.55 s static. A new size or length
  costs one compile, which the job reports as its `prepare` phase.
* **Compiled transformers are cached on a GPU**, unlike most workers' models: the 5B one takes
  40 s to compile for a 720p shape even with the driver's kernel cache warm, 5 s from a blob.
  Blobs are weightless (`CACHE_MODE=OPTIMIZE_SIZE`) yet still about 9 GB per 5B shape, so
  `models/video-generation/.ov_cache` keeps the newest up to `VIDEO_GENERATION_OV_CACHE_GB`
  (default 20; 0 turns the cache off). A tiny decoder compiled for the NPU is cached beside its IR.
* **The official VAE decoder is not exported.** The notebook's stateful next-frame decoder took
  65 s per latent frame on the B60: the cache slices before each state write run on the GPU
  plugin's reference `StridedSlice` kernel (60 of 65 s), and rewriting them trips a layout check in
  the plugin's CPU-side `Assign`. Unrolling the decode into one model per frame count was correct
  but still 3x PyTorch (23 s for 33 frames at 480p, reference eltwise kernels on 5-D tensors).
* **The tiny decoder decodes instead** (`wan/tiny_vae.py`): TAEHV's architecture, written here,
  with LightX2V's distilled weights. All 2-D convolutions, so every device runs it well. LightX2V
  trained it on the VAE's own latent scale, not the diffusion-space one madebyollin's `taew2_*`
  take (27.7 dB PSNR against the full VAE that way, 17 dB the other). It is exported with each
  memory block's carried frame as an input and output and compiled for 4 latent frames at a time:
  at 8 a 480p chunk passed the GPU's 4 GB single-allocation limit and the device reset.

## Pose to video (VACE)

A request with `input_video` (multipart) runs a `pose` phase first (`wan/pose.py`): the video is read
at the model's 16 fps, fitted inside the size on black (never cropped: a 9:16 dancer covering an
832x480 frame kept only hips and knees, and VACE made a video of legs; the app turns the size to the
driving video's orientation, as VACE's own processor sizes its output from the video), and every
person's body and face are drawn the way VACE's
own `PoseBodyFaceVideoAnnotator` draws them (YOLOX finds people, DWPose places 133 keypoints, OpenPose
colours on black at 1024 px, then scaled down). Matching that drawing matters: it is what the model
learned. The pose video is kept and served as `content?variant=control`; `pose_video` takes one
drawn already. `input_reference` is the subject (diffusers' `reference_images`): fitted on white, it
is one more latent frame in front, dropped after denoising.

The prompt is optional with a driving video: without one VACE 1.3B invents a plausible person and
place. With a subject image and no prompt it keeps the image's clothes and setting but not the person
(a man became the driving video's long-haired woman); a prompt describing them (hair, clothes, place)
keeps the person too.

The pose video's latents come from the tiny encoder, not the VAE's encoder: on pose maps they match
the VAE's to 3.7% (cosine 0.999), while the VAE encoder took 180-250 s for 49 frames on the CPU and
3.9 s on the B60. LightX2V's tiny encoder expects the clip padded at its end, as TAEHV pads, not at
its start (15% then).

| VACE, 832x480, 49 frames | Time |
|---|---|
| Pose maps (YOLOX + DWPose, OpenVINO) | 25 ms a frame on the B60, 82 ms on the NPU, 307 ms on the CPU |
| A step, guidance on | 7.6 s OpenVINO GPU.1 int8, 10.3 s PyTorch XPU |
| Whole request, 20 steps, with a reference image | 197 s on OpenVINO (pose 3 s, steps 179 s) |

### Long and large pose videos: windows

VACE takes up to 30 s (481 frames) and up to 1280x720 in either orientation. One transformer call
never sees more than `Preset.window_tokens` latent tokens (the reference frame included):
832x480 at 49 frames with a reference, 14 x 1560. A video with more is denoised in overlapping
windows of as many latent frames as fit (at most the trained 21), a quarter of each shared with
the next. Every step runs each window (its frames from position 0, the reference in front, its
slice of the pose latents) and blends the windows' flows into one, fading each in and out over the
frames it shares, before the scheduler steps the whole video. So the GPU memory is one window's,
the windows agree with each other at every step rather than being stitched afterwards, and time
grows with the number of windows. `VIDEO_GENERATION_WINDOW_TOKENS` overrides the budget (to
measure another).

Why the budget: 81 frames and a reference (22 x 1560 tokens) in one call took 43 s a step on the
B60, against 7.6 s for 49 frames, because its activations filled the card's 24 GB and spilled
another 13 GB into system memory (the process's `drm-resident-gtt` in `/proc/<pid>/fdinfo`). That
spill is what takes the host down once it grows. At this budget a 5 s 480p video is two windows.

| Size | Window | 5 s | 12 s | 30 s |
|---|---|---|---|---|
| 832x480 | 49 frames | 2 windows | 5 | 12 |
| 640x368 and smaller | 81 frames | 1 | 3 | 8 |
| 960x544 | 33 frames | 3 | 7 | 17 |
| 1280x720 | 17 frames | 5 | 12 | 30 |

VACE 1.3B was trained at 480p: 960x544 and 720p work, less steadily, and at 720p a window is
only 17 frames. The tiny decoder takes fewer latent frames a call as the frame grows (2 at
960x544, 1 at 720p), keeping each call's activations under the GPU's 4 GB single allocation.

## Step previews

A request with `preview: true` also gets a small MP4 of every denoising step but the last (whose
result is the video): the model's estimate of the finished video at that step, `x0 = latents -
sigma * flow` (UniPC's own `convert_model_output` for flow prediction; DMD computes it anyway),
decoded by the tiny decoder, scaled to at most 640 px on its long side and encoded (`veryfast`, CRF
26) on a thread of the job's own while the next step runs. `previews` in the status counts them;
`content?variant=preview&step=n` serves step `n` once made, before the video is done. The app shows
each as it comes and keeps them all to scrub through (its "Show each step" setting, on by default).
Early steps are a blurry layout, the middle ones settle the motion and the last ones add detail.
An instance with `--decoder full` ignores `preview` (`previews: false` in its capabilities): a full
VAE decode per step would take longer than the steps.

A preview costs one tiny-decoder pass over the clip per step, the same as the final decode. On
OpenVINO the transformer's activations are released before it and the decoder's after it (as for the
final decode), so the two never share the GPU; allocating them again costs nothing measurable. The
video does not change: the same seed gives the same MP4 with and without previews.

| Wan2.1 1.3B int8, 480x272, 17 frames, 6 steps | A step | A preview |
|---|---|---|
| CPU (Core Ultra 9 285K) | 10 s | +1.4 s |
| Integrated GPU (GPU.0, Arrow Lake) | 13 s | +3.7 s |

On the B60 the tiny decoder takes 0.09 s for 16 frames at 720p (below), against steps of seconds.

## Measured

Core Ultra 9 285K, Arc Pro B60 24 GB, 2026-11-04, OpenVINO 2026.2.1, PyTorch 2.13 XPU, the tiny
decoder unless noted, warm (OpenVINO compile cached).

| Video | Backend, device | Time |
|---|---|---|
| FastWan2.2, 1280x704, 121 frames (5 s) | PyTorch XPU | 38.5 s (3 steps 36.2 s, decode 1.4 s); 15.9 GiB peak |
| FastWan2.2, 1280x704, 121 frames | OpenVINO GPU.1 int8 | 117 s |
| FastWan2.2, 1280x704, 49 frames | PyTorch XPU | 12.4 s (in the app) |
| FastWan2.2, 1280x704, 33 frames | OpenVINO GPU.1 int8 | 28 s |
| Wan2.1, 832x480, 33 frames, 20 steps | OpenVINO GPU.1 int8 | 52 s (2.55 s/step) |
| Wan2.1, 832x480, 33 frames, 20 steps | PyTorch XPU, full VAE | 80 s (3.3 s/step) |
| Wan2.2, 640x352, 25 frames, 20 steps | OpenVINO GPU.1 int8 / PyTorch XPU | 0.56 / 0.75 s per step |

OpenVINO wins where attention dominates (Wan2.1, small sizes: its fused SDPA kernel is fast) and
loses on the 5B model at 720p, where the matrix multiplies dominate: the GPU plugin runs them on
`jit:gemm:any` kernels at about a third of PyTorch's throughput on this GPU (int8 3.9 s, fp16 5.8 s
for what takes PyTorch 2.1 s per pass). The app therefore offers each model on its faster backend:
the 5B models with PyTorch on XPU, Wan2.1, VACE and A14B on OpenVINO (A14B's bf16 does not fit a
24 GB GPU). The worker still runs any preset on either, by `--device`.

Per network on the other devices (OpenVINO, static shapes):

| | B60 | CPU | Integrated GPU | NPU |
|---|---|---|---|---|
| Wan2.1 transformer pass, 480x272x17 | 0.13 s | 4.9 s | 7.3 s | not supported |
| Tiny decoder, 16 frames of 1280x704 | 0.09 s | 1.6 s | 3.5 s | 0.92 s (67 s first compile) |
| Text encoder, 64 tokens | 0.12 s | 0.22 s | 0.54 s | fails to load |

The integrated GPU of a desktop Arrow Lake is slower than its CPU here, and a Wan2.1 pass at
832x480x33 outlasted the i915 driver's fence timeout: use the CPU, at the preview sizes, when there
is no discrete GPU. The NPU decodes faster than the CPU or integrated GPU (`--decoder-device NPU`).

## Files

```
main.py            the API, job queue and model loading
list_models.py     which presets are on disk (stdlib only)
wan/presets.py     the presets
wan/pipeline.py    the denoising loop over a backend: prompt, UniPC + guidance or DMD, first-frame conditioning
wan/torch_backend.py, wan/ov_backend.py    the two backends
wan/ov_export.py   OpenVINO conversion
wan/tiny_vae.py    the tiny decoder and encoder
wan/pose.py        VACE's pose maps (DWPose on OpenVINO) and reading a driving video
```

`models/video-generation/hf/<org>--<name>/` mirrors the Hugging Face repositories
(`fetch_snapshot`'s `local_dir`); `data/jobs/` holds finished videos for an hour.
