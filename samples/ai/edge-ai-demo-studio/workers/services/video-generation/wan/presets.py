# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""The models this worker serves. Every one is Apache-2.0, weights included.

A preset names where each component comes from. The UMT5-XXL text encoder, the tokenizer and the
VAE are byte-identical across these repositories (checked by their LFS hashes; Wan2.1's fp32 text
encoder rounds to Wan2.2's bf16 one exactly), so they are always read from ``base_repo`` and
downloaded once, and only the transformer differs.
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: Wan's recommended negative prompt (the English translation diffusers documents).
DEFAULT_NEGATIVE_PROMPT = (
    "Bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, "
    "static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, "
    "extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, "
    "fused fingers, still picture, messy background, three legs, many people in the background, "
    "walking backwards"
)

WAN22_BASE = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"


@dataclass(frozen=True)
class Preset:
    id: str
    label: str
    #: Repository the transformer weights come from.
    transformer_repo: str
    #: Repository of the scheduler config, tokenizer and VAE.
    base_repo: str
    #: Repository of the text encoder (bf16, shared by every preset).
    text_encoder_repo: str = WAN22_BASE
    #: ``wan2.1``: 16-channel VAE, x8 spatial, one timestep per sample.
    #: ``wan2.2``: 48-channel VAE, x16 spatial, a timestep per token (first-frame conditioning).
    family: str = "wan2.1"
    #: ``unipc``: the scheduler in ``base_repo`` with classifier-free guidance.
    #: ``dmd``: distribution-matching distilled, a few fixed timesteps and no guidance.
    sampler: str = "unipc"
    dmd_timesteps: tuple[int, ...] = ()
    image_to_video: bool = False
    #: VACE: follows a control video (pose maps, drawn by ``pose.py`` from a driving video) and can
    #: take a reference image of the subject; its transformer has the VACE blocks.
    vace: bool = False
    #: Wan2.2 A14B: two transformers (``transformer`` for high noise, ``transformer_2`` for low),
    #: switching at this share of the training timesteps as diffusers' ``WanPipeline`` does.
    boundary_ratio: float | None = None
    width: int = 832
    height: int = 480
    num_frames: int = 81
    fps: int = 16
    steps: int = 50
    guidance_scale: float = 5.0
    #: Guidance of the low-noise transformer (``boundary_ratio`` presets).
    guidance_scale_2: float | None = None
    #: OpenVINO: compile the transformer for each video's exact shape (faster for the 1.3B and 5B
    #: models), else once with dynamic shapes. Wan2.2 A14B on an Arc Pro B60, 832x480x17: static took
    #: 18.4 GiB of GPU memory compiled and 23.3 running, 18.6 GiB of RAM to compile, 6.4 s a pass;
    #: dynamic 13.4, 15.5 and 4.2 GiB, 5.7 s. Static 832x480x81 used 59 GB of RAM compiling.
    static_shapes: bool = True
    #: OpenVINO GPU memory a latent token's activations take (measured); with it, a video too big for
    #: the GPU is refused up front. One that overflows spills into system memory until the host runs out.
    gpu_bytes_per_token: int = 0
    #: Sizes the model was trained at; others work at a quality cost.
    sizes: tuple[str, ...] = field(default=("832x480", "480x832"))
    #: Latent tokens (reference frame included) one transformer call may take: a longer or larger
    #: video is denoised in overlapping windows of at most this many, blended at every step, so its
    #: GPU memory stays that of one window and its time grows with the number of windows. 0: the
    #: whole video in one call, at most ``num_frames`` long and ``width`` x ``height`` large.
    window_tokens: int = 0
    #: With ``window_tokens``: the longest video, and the largest size in either orientation.
    max_frames: int = 0
    max_size: tuple[int, int] | None = None

    @property
    def longest(self) -> int:
        """The most frames a request may ask for."""
        return max(self.num_frames, self.max_frames)

    @property
    def largest(self) -> tuple[int, int]:
        """The largest width x height a request may ask for, landscape (either orientation goes)."""
        return self.max_size or (self.width, self.height)

    @property
    def experts(self) -> tuple[str, ...]:
        """The transformers' subfolders in ``transformer_repo``, in denoising order."""
        return ("transformer", "transformer_2") if self.boundary_ratio is not None else ("transformer",)

    @property
    def vae_scale_spatial(self) -> int:
        return 16 if self.family == "wan2.2" else 8

    @property
    def z_dim(self) -> int:
        return 48 if self.family == "wan2.2" else 16

    @property
    def vae_scale_temporal(self) -> int:
        return 4

    @property
    def size_multiple(self) -> int:
        """Width and height must divide by this: the VAE stride times the 2x2 patch."""
        return self.vae_scale_spatial * 2

    @property
    def per_token_timesteps(self) -> bool:
        return self.family == "wan2.2"

    def latent_frames(self, num_frames: int) -> int:
        return (num_frames - 1) // self.vae_scale_temporal + 1

    def fit_frames(self, num_frames: int) -> int:
        """The nearest frame count the VAE takes (4k + 1), at least 5."""
        k = max(1, round((num_frames - 1) / self.vae_scale_temporal))
        return k * self.vae_scale_temporal + 1


PRESETS: dict[str, Preset] = {
    p.id: p
    for p in (
        Preset(
            id="Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
            label="Wan2.1 T2V 1.3B",
            transformer_repo="Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
            base_repo="Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
            family="wan2.1",
            width=832,
            height=480,
            num_frames=81,
            fps=16,
            steps=50,
            guidance_scale=5.0,
            sizes=("832x480", "480x832"),
        ),
        Preset(
            id="Wan-AI/Wan2.1-VACE-1.3B-diffusers",
            label="Wan2.1 VACE 1.3B",
            transformer_repo="Wan-AI/Wan2.1-VACE-1.3B-diffusers",
            # Its VAE, scheduler and tokenizer are Wan2.1 T2V's, byte for byte.
            base_repo="Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
            family="wan2.1",
            vace=True,
            width=832,
            height=480,
            num_frames=81,
            fps=16,
            steps=50,
            guidance_scale=5.0,
            sizes=("832x480", "480x832"),
            # 832x480x49 and a reference frame (14 x 1560 tokens): 7.6 s a step on an Arc Pro B60 at
            # int8. 81 frames and a reference (22 x 1560) took 43 s a step, its activations spilling
            # 13 GB past the card's 24 GB into system memory, which can take the host down.
            window_tokens=14 * 1560,
            # 30 s at 16 fps; up to 720p (VACE 1.3B was trained at 480p: larger works, less steadily).
            max_frames=481,
            max_size=(1280, 720),
        ),
        Preset(
            id="Wan-AI/Wan2.2-T2V-A14B-Diffusers",
            label="Wan2.2 T2V A14B",
            transformer_repo="Wan-AI/Wan2.2-T2V-A14B-Diffusers",
            # Wan2.1's VAE (same LFS hash) and scheduler (but for its version stamp).
            base_repo="Wan-AI/Wan2.2-T2V-A14B-Diffusers",
            family="wan2.1",
            boundary_ratio=0.875,
            static_shapes=False,
            # 0.168 GiB per 1000 tokens on an Arc Pro B60 at int8 (7.8k to 32.8k tokens), plus 0.8 GiB.
            gpu_bytes_per_token=180_000,
            # Its model card's settings.
            width=1280,
            height=720,
            num_frames=81,
            fps=16,
            steps=40,
            guidance_scale=4.0,
            guidance_scale_2=3.0,
            sizes=("1280x720", "720x1280", "832x480", "480x832"),
        ),
        Preset(
            id="Wan-AI/Wan2.2-TI2V-5B-Diffusers",
            label="Wan2.2 TI2V 5B",
            transformer_repo=WAN22_BASE,
            base_repo=WAN22_BASE,
            family="wan2.2",
            image_to_video=True,
            width=1280,
            height=704,
            num_frames=121,
            fps=24,
            steps=50,
            guidance_scale=5.0,
            sizes=("1280x704", "704x1280"),
        ),
        Preset(
            id="FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers",
            label="FastWan2.2 TI2V 5B (3 steps)",
            transformer_repo="FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers",
            base_repo=WAN22_BASE,
            family="wan2.2",
            sampler="dmd",
            # FastVideo's FastWan2_2_TI2V_5B_Config.
            dmd_timesteps=(1000, 757, 522),
            image_to_video=True,
            width=1280,
            height=704,
            num_frames=121,
            fps=24,
            steps=3,
            guidance_scale=1.0,
            sizes=("1280x704", "704x1280"),
        ),
    )
}


def get_preset(model_id: str) -> Preset:
    try:
        return PRESETS[model_id]
    except KeyError:
        raise ValueError(f"Unknown model {model_id!r}; choose one of {', '.join(PRESETS)}") from None
