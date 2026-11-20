# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""The super-resolution models this worker serves, and where each one lives on disk.

Standard library only: ``list_models.py`` loads this file by path, outside the worker's environment.
Every model is pinned by sha256, under a license that allows commercial use, and is its authors'
own release (a GitHub release asset, a Hugging Face file at a pinned revision, or Intel's Open
Model Zoo storage), except SeedVR2's weights: the FP16 conversion its pipeline's maintainer
publishes (see README.md). Models left out, and why, are listed in README.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

PRECISIONS = ("fp16", "int8")
DEFAULT_PRECISION = "fp16"


@dataclass(frozen=True)
class Preset:
    id: str
    url: str
    sha256: str
    scale: int
    license: str
    # Converted at the tile size and never run at another shape: Swin-style transformers bake the
    # window attention mask for one input size into the graph, and global attention (AuraSR)
    # costs the square of the image's size, so only tiles keep it linear.
    static: bool = False
    # Exported at INT8 too (the Real-ESRGAN models). Attention is not quantized (Swin2SR, DAT2,
    # AuraSR); SPAN and the Open Model Zoo model are fast enough at FP16.
    int8: bool = True
    # An Open Model Zoo IR: `url` is its .xml, and this is the sha256 of the .bin beside it.
    bin_sha256: str | None = None
    # Runs with PyTorch on an Intel GPU (seedvr2.py) instead of OpenVINO: a diffusion model with no
    # OpenVINO export. Still images only: no video, no live frames, no INT8.
    torch_xpu: bool = False
    # More files the model needs beside `url`, as (url, sha256), downloaded into the same folder.
    extra_files: tuple[tuple[str, str], ...] = ()

    @property
    def filename(self) -> str:
        return self.url.rsplit("/", 1)[-1]

    @property
    def omz(self) -> bool:
        return self.bin_sha256 is not None

    @property
    def image_only(self) -> bool:
        return self.torch_xpu


_REAL_ESRGAN = "https://github.com/xinntao/Real-ESRGAN/releases/download"
# Philip Hofmann's models (CC-BY-4.0), retrained on real-world degradations.
_PHHOFM = "https://github.com/Phhofm/models/releases/download"
# model_downloader.http.OMZ_STORAGE_URL
_OMZ = "https://storage.openvinotoolkit.org/repositories/open_model_zoo/temp"
# numz's FP16 safetensors of ByteDance's SeedVR2 weights (Apache-2.0), the files numz's pipeline
# loads: half the size of ByteDance's own FP32 .pth (13.6 GB for the 3B transformer).
_SEEDVR2 = "https://huggingface.co/numz/SeedVR2_comfyUI/resolve/09ced71023636e9bc8cdf9cdecfb2625d1e691e8"

PRESETS = {
    p.id: p
    for p in (
        # SRVGGNetCompact (1.2M parameters): real-world photos, fast enough for live video on a GPU.
        Preset(
            "realesr-general-x4v3",
            f"{_REAL_ESRGAN}/v0.2.5.0/realesr-general-x4v3.pth",
            "8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292",
            4,
            "BSD-3-Clause",
        ),
        # SRVGGNetCompact (0.6M): anime and cartoon video.
        Preset(
            "realesr-animevideov3",
            f"{_REAL_ESRGAN}/v0.2.5.0/realesr-animevideov3.pth",
            "b8a8376811077954d82ca3fcf476f1ac3da3e8a68a4f4d71363008000a18b75d",
            4,
            "BSD-3-Clause",
        ),
        # RRDBNet (16.7M): the Real-ESRGAN paper's model, best detail on photos.
        Preset(
            "RealESRGAN_x4plus",
            f"{_REAL_ESRGAN}/v0.1.0/RealESRGAN_x4plus.pth",
            "4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1",
            4,
            "BSD-3-Clause",
        ),
        Preset(
            "RealESRGAN_x2plus",
            f"{_REAL_ESRGAN}/v0.2.1/RealESRGAN_x2plus.pth",
            "49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb",
            2,
            "BSD-3-Clause",
        ),
        # RRDBNet with 6 blocks (4.5M): anime illustrations.
        Preset(
            "RealESRGAN_x4plus_anime_6B",
            f"{_REAL_ESRGAN}/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
            "f872d837d3c90ed2e05227bed711af5671a6fd1c9f7d7e91c911a61f155e99da",
            4,
            "BSD-3-Clause",
        ),
        # Swin Transformer V2 (12M), trained for fidelity (PSNR), not GAN sharpness: it invents no
        # texture, which suits text and faces. Heavy; no NPU (the compiler gives up on it).
        Preset(
            "Swin2SR_RealworldSR_X4_64_BSRGAN_PSNR",
            "https://github.com/mv-lab/swin2sr/releases/download/v0.0.1/Swin2SR_RealworldSR_X4_64_BSRGAN_PSNR.pth",
            "2b7afb6ba8c076f7a4987001c142b7bc5f23bf229125775eee599faf5bf7c40e",
            4,
            "Apache-2.0",
            static=True,
            int8=False,
        ),
        # SPAN (2.2M), the NTIRE 2024 efficient-SR winner's network: photos and drawings with JPEG
        # compression and resizing. Faster than the compact Real-ESRGAN on a CPU and NPU.
        Preset(
            "4xNomosUni_span_multijpg",
            f"{_PHHOFM}/4xNomosUni_span_multijpg/4xNomosUni_span_multijpg.safetensors",
            "3bedff643a1ba51b12e0174ebca62649a930ae3e7b0868be9706d8659d4d32a2",
            4,
            "CC-BY-4.0",
            int8=False,
        ),
        # DAT2 (11.2M), a dual-aggregation transformer: real photos with noise, blur and JPEG/WebP.
        Preset(
            "4xBHI_dat2_real",
            f"{_PHHOFM}/4xBHI_dat2_real/4xBHI_dat2_real.safetensors",
            "1f651fe8e2b7ad978eee0db9c8de89b7bbfd9d2d671ffababb9baf6e2d5b38f6",
            4,
            "CC-BY-4.0",
            static=True,
            int8=False,
        ),
        # AuraSR v2 (fal, 618M), a GigaGAN upscaler for generated images. The model card says
        # Apache-2.0, the repository's LICENSE.md CC-BY-SA-4.0: both allow commercial use, and the
        # stricter one is shown.
        Preset(
            "AuraSR-v2",
            "https://huggingface.co/fal/AuraSR-v2/resolve/ff452185a7c8b51206dd62c21c292e7baad5c3a3/model.safetensors",
            "8a80b4546f3f49b9095733cb9699030409339e2f4eb0ae9c1ada14c7d21d4dde",
            4,
            "CC-BY-SA-4.0",
            static=True,
            int8=False,
        ),
        # Intel's own OpenVINO model (Open Model Zoo, 30K parameters): keeps texture the GAN
        # models smooth away, at 1/8 of the compact Real-ESRGAN's time on a CPU.
        Preset(
            "single-image-super-resolution-1032",
            f"{_OMZ}/single-image-super-resolution-1032/FP16/single-image-super-resolution-1032.xml",
            "d904663f8b31692a352b1a8416fde5e280c66da3a2c359bd75cca395a5b05b3e",
            4,
            "Apache-2.0",
            int8=False,
            bin_sha256="a52a4549011480d90246bbe6118718ee485c130480bbf5f7befdb3d5a2a1f057",
        ),
        # SeedVR2 3B (ByteDance), one-step diffusion restoration: a 3B transformer and a video VAE,
        # 7.3 GB at FP16. The most restored detail of these models on degraded photos and faces, at
        # seconds per image on a discrete Intel GPU; PyTorch XPU only.
        Preset(
            "seedvr2-3b",
            f"{_SEEDVR2}/seedvr2_ema_3b_fp16.safetensors",
            "2fd0e03a3dad24e07086750360727ca437de4ecd456f769856e960ae93e2b304",
            4,
            "Apache-2.0",
            int8=False,
            torch_xpu=True,
            extra_files=(
                (
                    f"{_SEEDVR2}/ema_vae_fp16.safetensors",
                    "20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1",
                ),
            ),
        ),
    )
}
DEFAULT_PRESET = "realesr-general-x4v3"


def preset_dir(models_root: Path, preset: Preset) -> Path:
    """``<models>/upscaling/<id>``: the checkpoint and every precision's IR."""
    return models_root / preset.id


def checkpoint_path(models_root: Path, preset: Preset) -> Path:
    """The download: a PyTorch .pth, or an Open Model Zoo .xml (its .bin beside it)."""
    return preset_dir(models_root, preset) / preset.filename


def weight_files(models_root: Path, preset: Preset) -> list[tuple[str, str, Path]]:
    """Every file a PyTorch (``torch_xpu``) preset runs from, as (url, sha256, path)."""
    folder = preset_dir(models_root, preset)
    return [
        (url, sha256, folder / url.rsplit("/", 1)[-1])
        for url, sha256 in ((preset.url, preset.sha256), *preset.extra_files)
    ]


def ir_path(models_root: Path, preset: Preset, precision: str, tile: int) -> Path:
    """The OpenVINO IR (.xml): one with dynamic height and width, or one per tile size for a static model."""
    name = f"model-{tile}.xml" if preset.static else "model.xml"
    return preset_dir(models_root, preset) / f"openvino-{precision}" / name
