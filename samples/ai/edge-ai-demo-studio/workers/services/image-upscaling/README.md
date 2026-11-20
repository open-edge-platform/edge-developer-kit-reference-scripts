# Image Upscaling Worker

Super-resolution on OpenVINO (CPU, GPU, NPU): images, whole videos and live frames, 2x-4x.
SeedVR2, a diffusion model, runs with PyTorch on an Intel GPU (XPU), for still images only.

- **Images** (`POST /v1/image-upscaling/image`) and **videos**
  (`POST /v1/image-upscaling/video`) are queued and run one at a time on a
  job thread, like the frame-generation worker's videos: the upload answers
  with a `taskId`, `GET /v1/tasks/{taskId}` (or `/events`, as Server-Sent
  Events) reports the queue position and progress (tiles for an image, or
  SeedVR2's phase as `stage`; frames for a video), `DELETE /v1/tasks/{taskId}` cancels, and the result downloads
  from `GET /v1/image-upscaling/{image|video}/{taskId}` for an hour.
  `outscale` (1 to the model's scale) resizes the model's output with Lanczos;
  a video keeps its frame rate and audio. An image may come out at most
  64 megapixels (SeedVR2 takes at most 800x600 in), a video frame at most
  3840x2160.
- **Live frames** (`POST /v1/image-upscaling/frame`, the image as the body)
  skip the queue and answer with the upscaled frame, `Server-Timing` and
  `X-Image-Width` / `X-Image-Height`. The demo's webcam view sends them one at
  a time. SeedVR2 answers video and frames with 400.

`GET /healthcheck` answers 503 until the model is converted, compiled and
warmed, then `{"status": "ok", "device", "model", "scale", "precision"}`.

## Models

`--model` picks one preset (`presets.py`). Each is its authors' own release (a
GitHub release asset, a Hugging Face file at a pinned revision, or Intel's Open
Model Zoo storage), except SeedVR2's weights (below), fetched with
`model_downloader.fetch_url` and checked against a pinned sha256 into
`<repo>/models/upscaling/<id>/`.

| Preset | Network | Scale | For | License |
|---|---|---|---|---|
| `realesr-general-x4v3` (default) | SRVGGNetCompact, 1.2M | 4 | photos, live video | BSD-3-Clause ([Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)) |
| `realesr-animevideov3` | SRVGGNetCompact, 0.6M | 4 | anime video, live video | BSD-3-Clause |
| `RealESRGAN_x4plus` | RRDBNet, 16.7M | 4 | photos, most detail | BSD-3-Clause |
| `RealESRGAN_x2plus` | RRDBNet, 16.7M | 2 | photos | BSD-3-Clause |
| `RealESRGAN_x4plus_anime_6B` | RRDBNet, 4.5M | 4 | anime illustrations | BSD-3-Clause |
| `Swin2SR_RealworldSR_X4_64_BSRGAN_PSNR` | Swin Transformer V2, 12M | 4 | faithful (PSNR-trained, invents no texture) | Apache-2.0 ([Swin2SR](https://github.com/mv-lab/swin2sr)) |
| `4xNomosUni_span_multijpg` | SPAN, 2.2M | 4 | photos and drawings with JPEG, live on every device | CC-BY-4.0, Philip Hofmann ([models](https://github.com/Phhofm/models/releases/tag/4xNomosUni_span_multijpg)) |
| `4xBHI_dat2_real` | DAT2 transformer, 11.2M | 4 | degraded real photos (noise, blur, JPEG/WebP): the most natural detail | CC-BY-4.0, Philip Hofmann ([models](https://github.com/Phhofm/models/releases/tag/4xBHI_dat2_real)) |
| `AuraSR-v2` | GigaGAN, 618M | 4 | clean and AI-generated images: the richest texture | CC-BY-SA-4.0, fal ([AuraSR-v2](https://huggingface.co/fal/AuraSR-v2)) |
| `single-image-super-resolution-1032` | Intel's CNN, 30K | 4 | fine texture, live on a CPU | Apache-2.0 ([Open Model Zoo](https://github.com/openvinotoolkit/open_model_zoo/tree/master/models/intel/single-image-super-resolution-1032)) |
| `seedvr2-3b` | SeedVR2 one-step diffusion: 3B transformer + video VAE | 4 | degraded photos and faces, the most restored detail; still images up to 800x600, XPU only | Apache-2.0, ByteDance ([SeedVR](https://github.com/ByteDance-Seed/SeedVR)) |

CC-BY-4.0 asks for credit: the demo names the author in each model's summary.
AuraSR v2's model card says Apache-2.0 while its repository's `LICENSE.md` is
CC-BY-SA-4.0; both allow commercial use, and the stricter one is shown. Its
ShareAlike terms cover the model itself (the converted IR stays on the
machine that made it), not the images it produces.

SeedVR2's weights are the FP16 safetensors that numz, the maintainer of the
pipeline this worker runs, publishes ([numz/SeedVR2_comfyUI](https://huggingface.co/numz/SeedVR2_comfyUI),
Apache-2.0 like ByteDance's release): the files that pipeline loads, at half
the size of ByteDance's own FP32 `.pth` (13.6 GB for the transformer, plus a
1 GB VAE). Together 7.3 GB.

Considered and left out:

| Model | Why |
|---|---|
| SwinIR-M real-world x4 GAN (Apache-2.0) | Same look as Real-ESRGAN x4plus at 5-10x the time; NaN in FP16 on the GPU unless `ACTIVATIONS_SCALE_FACTOR` is set |
| BSRGAN (Apache-2.0) | Same network as x4plus, no visible gain |
| The papers' own HAT, DAT, SPAN, DRCT, Real-CUGAN weights (Apache-2.0 / MIT) | Only on Google Drive / Baidu: nothing `model_downloader` can fetch and pin; and trained on bicubic downscaling, not real degradations. Philip Hofmann's real-world DAT2 and SPAN on GitHub are used instead |
| `4xBHI_small_hat-l` (HAT-L, CC-BY-4.0, 2025) | Too slow: 2.2 s per 256-pixel tile on an Arc Pro B60, and a CPU compile plus four tiles did not finish in 30 minutes. NaN in FP16 on a GPU unless `ACTIVATIONS_SCALE_FACTOR` is 32. Trained for clean input only |
| `4xRealWebPhoto_v4_drct-l` (DRCT-L, CC-BY-4.0) | Same purpose as DAT2, 1.3x slower per tile and 70 s per GPU compile |
| `4xBHI_realplksr_dysample_real` (RealPLKSR, CC-BY-4.0) | DySample bakes the traced input size into the graph (any other size comes out garbled), so it would need an export per shape; slower than x4plus on the iGPU and NPU |
| `4xNomos2_hq_mosr` (MoSR, CC-BY-4.0) | Trained for clean input only: blotches on JPEG-compressed photos |
| SeedVR2 7B (ByteDance, Apache-2.0) | A 16.5 GB FP16 transformer: with the VAE and activations, past a 24 GB card. The 3B is offered |
| SeedVR2 for video | On a 24 GB card its batches stay short (9 frames at most at 1080p, with 512-pixel VAE tiles) and the picture jumps at every batch boundary; frame by frame, DAT2 was steadier and closer to the original (Measurements) |
| HYPIR (XPixel) | Non-commercial license |
| FlashVSR v1.1 (video, Apache-2.0) | Runs on XPU through lihaoyun6's ComfyUI-FlashVSR_Ultra_Fast (whose `src/` and Triton sparse-attention kernel are Apache-2.0; only its ComfyUI node is GPL-3.0), but below SeedVR2 on photos at 3x its time (a still is a 25-frame pass), and on video it shifted skin tones and needed tiling at 1080p (Measurements). Its Triton kernel also needs `triton-xpu`, which the workspace leaves out |
| 4x-UltraSharp V2 (DAT, 2025) | CC-BY-NC-SA-4.0 |
| APISR | GPL-3.0 |
| StableSR, SUPIR | Non-commercial licenses |
| Omni-SR, SAFMN | No license file (all rights reserved) |
| GFPGAN face restoration | Its StyleGAN2 and DFDNet parts are under non-commercial licenses (NVIDIA Source Code License, CC BY-NC-SA 4.0) |
| Open Model Zoo `single-image-super-resolution-1033` | 1032's 3x sibling; 1032's output resized covers 3x |

## How it runs

On first start the model is exported to OpenVINO IR, then cached:

1. [spandrel](https://github.com/chaiNNer-org/spandrel) (MIT) builds the
   PyTorch network from the `.pth` alone, so no architecture code is vendored.
2. `ov.convert_model` exports it with dynamic height and width and
   `ov.save_model` compresses the weights to FP16: `openvino-fp16/model.xml`.
   Swin2SR, DAT2 and AuraSR are exported at one 256x256 shape instead
   (`model-256.xml`) and only ever run in tiles of it: the transformers'
   window attention mask is computed for one size, and AuraSR's global
   attention costs the square of the image's size (one 1024x768 call took over
   10 minutes on the iGPU; 20 tiles take 55 s). AuraSR's network gets its
   training sizes set first, which spandrel leaves unset and tracing reads.
3. `--precision int8` instead quantizes weights and activations with NNCF
   (`openvino-int8/`). The calibration tiles are generated, not shipped or
   downloaded (`calibration.py`): "dead leaves" images (overlapping discs
   with power-law radii, the scale-invariant statistics of photos), blurred,
   downscaled, JPEG-compressed and noised like a real low-resolution input.
   On a held-out photo they calibrate as well as real photos do (40.1 dB
   against FP32 either way). Only the Real-ESRGAN models have an INT8 export;
   the others start FP16 (attention is not quantized, and SPAN and the Open
   Model Zoo model are fast enough without).
4. The Open Model Zoo model is OpenVINO IR already, but takes the image twice
   (as is, and bicubic-upscaled, both BGR in 0..255). `_single_input` moves
   that upscale (OpenCV's bicubic, which it was trained with) and the colour
   order into the graph, so it takes one RGB input of any size like the
   others; its output is identical to the original two-input model's.

Every compile is static (`upscaler.py`): the NPU needs it and the GPU plugin is
faster with it.

- An image up to the device's whole-image budget (1024x1024 input pixels on a
  GPU, 640x512 on the CPU and NPU) runs in one call at its size rounded up to
  64; each new size compiles once and stays cached. The NPU takes seconds per
  compile, so there only video and live frames, whose size repeats, run whole.
  One call skips the tiles' overlap and partial edge tiles: a 320x240 webcam
  frame upscales 3-5x faster than as four tiles on the CPU and NPU.
- A larger image is cut into tiles of 512 (GPU) or 256 (CPU, NPU) pixels that
  overlap by 16 pixels on every side, the overlap cropped from each output, so
  no seam shows. The CPU runs its tiles in parallel (`THROUGHPUT` hint,
  `AsyncInferQueue`, +30-45%); a GPU or NPU runs one at a time.
- Models compile with uint8 NHWC input and output (`PrePostProcessor`: the
  scaling, clamping, rounding and layout change run in the graph, and a
  transfer moves a quarter of the bytes), except on the NPU, where the float
  graph is faster.
- Start-up runs every request twice: a request's first inference is about 10x
  slower on the CPU, and the first image would otherwise pay for it.
- An NPU compile is cached in `openvino-<precision>/.ov_cache`.

`--device AUTO` (the default) lets OpenVINO pick: a discrete GPU, then an
integrated GPU, then the CPU. Swin2SR, DAT2 and AuraSR are not offered on the
NPU: its compiler rejects them or does not finish.

### SeedVR2 (PyTorch XPU)

SeedVR2 has no OpenVINO export, so `seedvr2.py` runs numz's standalone
pipeline ([ComfyUI-SeedVR2_VideoUpscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler),
Apache-2.0, no ComfyUI needed) with PyTorch on an Intel GPU (`--device XPU`).

- `workers/upstream.json` pins it at a commit of its `main` and copies `src/`,
  the top-level files and `configs_3b/` into `thirdparty/seedvr2/`
  (gitignored). `start.sh` / `start.ps1` fetch it only when `--model` is
  `seedvr2-3b`, so the OpenVINO presets still start without a network.
- `seedvr2-xpu.patch` is upstream pull request #590 ("Add experimental Intel
  XPU backend support", open, not merged) at its head commit, without its
  README hunks. A copy is remade only when the pinned ref changes: after
  editing the patch, delete `thirdparty/seedvr2/`.
- Each image runs the pipeline's four phases as its CLI runs them for one
  image: VAE encode, one transformer step, VAE decode, LAB colour correction.
  The progress reports the phase as `stage`; a cancel stops at the next phase.
  The transformer and VAE stay in system memory between phases and images, the
  VAE works in 1024-pixel tiles overlapping by 128, and attention is PyTorch
  SDPA (no flash-attn on XPU).
- Inputs are capped at 800x600 (0.48 MP): that size peaked at 10.9 GiB of
  PyTorch allocations (15.7 GiB reserved) on an Arc Pro B60. PyTorch may take
  85% of the GPU's memory, so an overflow fails with an out-of-memory error
  instead of spilling into system memory.
- Start-up loads both models and upscales a 64x64 image (7 s on a B60).
- Output is the same as the pipeline's own CLI at the same settings (bit for
  bit on the test photos).

## Measurements

Core Ultra 9 285K (CPU), its Arc integrated GPU (iGPU) and NPU, and an Arc Pro
B60 (dGPU), November 2026. Milliseconds per 256x256 input tile (1024x1024
output at 4x), median, one tile at a time.

| Preset | PyTorch CPU FP32 | PyTorch XPU (B60) FP16 | OpenVINO CPU | OpenVINO iGPU | OpenVINO B60 | OpenVINO NPU |
|---|---|---|---|---|---|---|
| realesr-general-x4v3 | 1077 | 5.4 | 220 | 46 | 4.3 | 45 |
| realesr-animevideov3 | 118 | 2.9 | 113 | 24 | 4.2 | 28 |
| RealESRGAN_x4plus | 4335 | 137 | 3347 | 825 | 66 | 555 |
| RealESRGAN_x2plus | 589 | 35 | 862 | 209 | 13 | 138 |
| RealESRGAN_x4plus_anime_6B | 2073 | 43 | 1012 | 262 | 21 | 196 |
| Swin2SR (FP32 on XPU) | 9287 | 1152 | - | 5033 | 419 | fails |
| single-image-super-resolution-1032 | - | - | 27 | 14 | - | 93 |
| 4xNomosUni_span_multijpg | 2386* | 5.2 | 95 | 69 | 3.6 | 28 |
| 4xBHI_dat2_real (FP32 on XPU) | 23460 | 1088 | 6298 | 8409 | 755 | fails |
| AuraSR-v2 (FP32 on XPU) | 16894 | 944 | 5803 | 2699 | 105 | fails |

\* Measured while another workload loaded the CPU.

OpenVINO's output matches PyTorch FP32 to 68-82 dB PSNR on the CPU, B60 and
NPU and 49-62 dB on the iGPU (FP16 accumulation); 40 dB is already invisible.
PyTorch XPU needs FP32 for the Swin models (FP16 overflows), which is why they
are 3x slower there than OpenVINO's FP16; DAT2 and AuraSR are not FP16-safe in
PyTorch either, yet run at FP16 in OpenVINO at 65 and 48 dB of PyTorch FP32.

A whole 1024x768 photo, upscaled to 4096x3072 (FP16, through `Upscaler`,
including any compile its size needs):

| Preset | B60 | iGPU | CPU | NPU |
|---|---|---|---|---|
| 4xNomosUni_span_multijpg | 0.2 s | 1.1 s | 0.6 s | 0.7 s |
| AuraSR-v2 | 2.1 s | 55 s | 69 s | - |
| 4xBHI_dat2_real | 15 s | 171 s | 113 s | - |

Time grows with the input's area, so DAT2 and AuraSR stay within a few minutes
per photo off a discrete GPU but are no choice for video there; the demo says
so on its video and live tabs.

INT8 against FP16 on the same device:

| Preset | CPU | iGPU | NPU | PSNR vs FP32 |
|---|---|---|---|---|
| realesr-general-x4v3 | 4.5x faster | 1.4x | no gain | 40 dB |
| RealESRGAN_x4plus | 2.5x | 1.6x | - | 38 dB |
| RealESRGAN_x4plus_anime_6B | 3.8x | 1.5x | - | 39 dB |

INT8 adds a little visible grain on smooth areas such as skin, so FP16 is the
default; INT8 is for a CPU or an integrated GPU that needs the speed.

Live frames (`/frame`, model time per frame, FP16, 4x):

| Preset | Device | 320x240 -> 1280x960 | 640x480 -> 2560x1920 |
|---|---|---|---|
| single-image-super-resolution-1032 | CPU | 34 ms | 141 ms |
| single-image-super-resolution-1032 | iGPU | 16 ms | 75 ms |
| single-image-super-resolution-1032 | NPU | 120 ms | 506 ms |
| realesr-general-x4v3 | CPU | 276 ms | 983 ms |
| realesr-general-x4v3 | iGPU | 55 ms | 217 ms |
| realesr-general-x4v3 | NPU | 72 ms | 511 ms |
| 4xNomosUni_span_multijpg | B60 | 31 ms | 56 ms |
| 4xNomosUni_span_multijpg | CPU | 114 ms | 412 ms |
| 4xNomosUni_span_multijpg | iGPU | 85 ms | 351 ms |
| 4xNomosUni_span_multijpg | NPU | 43 ms | 196 ms |

SPAN is 2.4x faster than realesr-general-x4v3 live on the CPU and 1.7-2.6x on
the NPU, and slower on the iGPU. The other models could not be measured live on
the B60: another workload held it. From its 4.3 ms per 256x256 tile, an estimate
for realesr-general-x4v3 is 20-25 ms per 640x480 frame there.

### SeedVR2 and FlashVSR against the OpenVINO models

Arc Pro B60, November 2026. Inputs are the originals shrunk 4x (bicubic) and
compressed, so each output is scored against its original: LPIPS (AlexNet;
lower is closer). Photos: a street photo (`coco_bike.jpg`, 200x150 in) and a
face (`frontend/tests/assets/face-person-a.jpg`, 96x96 in), JPEG quality 80.
Clip: a 54-frame 1080p presenter video, 480x270 H.264 CRF 23 in. tLP
(TecoGAN) scores frame-to-frame change unlike the original's: lower is steadier.

| Model | Bike LPIPS | Face LPIPS | Bike time | 800x600 to 3200x2400 | Clip LPIPS | Clip tLP | Clip time per frame |
|---|---|---|---|---|---|---|---|
| bicubic | 0.735 | 0.348 | - | - | 0.064 | 0.157 | - |
| realesr-general-x4v3 | 0.416 | 0.208 | 3 ms | 0.03 s | 0.044 | 0.167 | 0.01 s |
| 4xBHI_dat2_real | 0.308 | 0.132 | 0.7-1.0 s | 8.6-11.5 s | **0.032** | 0.156 | 4.5-5.3 s |
| AuraSR-v2 | 0.343 | 0.190 | 0.1 s | 1.2-1.5 s | 0.040 | **0.120** | 0.6-0.7 s |
| SeedVR2 3B | **0.209** | **0.077** | 6.0 s | 24 s, 10.9 GiB | 0.049 (5-frame batches), 0.046 (9) | 0.359 (5), 0.192 (9) | 3.2 s (5), 5.7 s (9) |
| FlashVSR v1.1 | 0.294 | 0.097 | 20 s | predicted ~61 GiB untiled: not run | 0.060 (tiled) | 0.140 | 2.7 s |

- SeedVR2 restores what the others smear: teeth, a dog's collar, eyes, beard
  and skin texture.
- On video, SeedVR2 jumps at every batch boundary (after frames 4, 9, 14 ...
  with 5-frame batches). 9-frame batches soften it but fit only with 512-pixel
  VAE tiles; with 1024 they ran out of memory at a 19 GiB cap, and 21-frame
  batches would need about 21 GiB at 1080p.
- FlashVSR streams frames and is steady, but at 1080p it fits only with its
  DiT tiled (256-pixel tiles, 12.1 GiB) and it shifted skin tones warmer (red
  -9, blue -16 of 255 on the face), even with its colour fix.
- The clip is clean, AI-generated and nearly static, which suits frame-by-frame
  models; real handheld footage was not measured.

## Run

The worker is a member of the `workers/` uv workspace (see
[`workers/README.md`](../../README.md)).

```bash
./start.sh --port 8035 --model realesr-general-x4v3 --device AUTO --precision fp16
./start.sh --port 8035 --model seedvr2-3b --device XPU
```

`list_models.py --models <id> [<id> ...]` reports which presets are converted
(a checkpoint plus an IR at any precision; for SeedVR2, both weight files),
without starting the worker;
each preset's whole folder is what deleting it removes.
