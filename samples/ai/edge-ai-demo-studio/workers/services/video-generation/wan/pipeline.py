# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""The Wan text/image-to-video loop, written once over a backend that runs the four networks.

A backend (``torch_backend`` on XPU, ``ov_backend`` on OpenVINO devices) only answers
``encode_text``, ``transformer``, ``vae_encode`` and ``vae_decode_frames``; everything around them
(prompt cleaning, latents, scheduler, guidance, first-frame conditioning) lives here, so both run
the same maths. It follows diffusers' ``WanPipeline`` / ``WanImageToVideoPipeline`` (0.40) and, for
the distilled preset, FastVideo's ``DmdDenoisingStage``.
"""

from __future__ import annotations

import html
import json
import re
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, Optional, Protocol

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from .presets import DEFAULT_NEGATIVE_PROMPT, Preset

#: Wan's text length: embeddings are zero-padded to it, which the transformer was trained on.
MAX_SEQUENCE_LENGTH = 512
#: FastVideo trains DMD with this flow shift; its sigma table maps the distilled timesteps.
DMD_TRAINING_NOISE_SHIFT = 8.0

#: ``progress(phase, done, total)``; phases are ``prepare`` (a static-shape backend compiling for a
#: new video size), ``text``, ``denoise``, ``decode``.
Progress = Callable[[str, int, int], None]
#: ``preview(step, frames)``: after denoising step ``step`` (from 1), the video the model expects at
#: the end, as ``[frames, h, w, 3]`` uint8 at ``preview_size``. Not called after the last step, whose
#: result is the video itself.
Preview = Callable[[int, np.ndarray], None]
#: Longest side of a step preview: the app shows it in a player about this wide.
PREVIEW_MAX_SIDE = 640


def preview_size(width: int, height: int) -> tuple[int, int]:
    """``width`` x ``height`` scaled to fit ``PREVIEW_MAX_SIDE`` (never up), even for H.264."""
    scale = min(1.0, PREVIEW_MAX_SIDE / max(width, height))
    return max(2, round(width * scale / 2) * 2), max(2, round(height * scale / 2) * 2)


class Backend(Protocol):
    #: Where latents live between calls (``xpu`` for torch, ``cpu`` for OpenVINO).
    device: torch.device

    def encode_text(self, input_ids: torch.Tensor) -> torch.Tensor:
        """``[1, n]`` token ids with no padding -> ``[1, n, 4096]`` float32."""

    def transformer(
        self,
        latents: torch.Tensor,
        timestep: torch.Tensor,
        context: torch.Tensor,
        control: Optional[torch.Tensor] = None,
        control_scale: float = 1.0,
        expert: int = 0,
    ) -> torch.Tensor:
        """One denoising call: flow prediction shaped like ``latents``. ``control``: VACE's context.
        ``expert``: which of the preset's transformers (``Preset.experts``) runs it."""

    def vae_encode(self, pixels: torch.Tensor) -> torch.Tensor:
        """``[1, 3, 1, H, W]`` in [-1, 1] -> the latent mean (not normalised)."""

    def encode_control(self, video: torch.Tensor) -> torch.Tensor:
        """``[1, 3, T, H, W]`` in [-1, 1] -> latents (not normalised), by the tiny encoder."""

    def vae_decode_frames(self, latents: torch.Tensor) -> Iterator[torch.Tensor]:
        """Not-normalised latents -> pixel chunks ``[1, 3, t, H, W]`` in [-1, 1], one per latent frame."""

    def prepare(self, width: int, height: int, latent_frames: int) -> None:
        """Called before a run with its shape (static-shape backends reshape here)."""

    def release(self) -> None:
        """Called after denoising, and before a step preview is decoded: frees the transformers'
        activations for the decoder."""


class Cancelled(Exception):
    """Raised between network calls once ``should_stop`` says so."""


@dataclass
class GenerateArgs:
    prompt: str
    negative_prompt: Optional[str] = None
    width: int = 832
    height: int = 480
    num_frames: int = 81
    steps: int = 50
    guidance_scale: float = 5.0
    #: The low-noise transformer's guidance (Wan2.2 A14B); the preset's when ``None``.
    guidance_scale_2: Optional[float] = None
    seed: Optional[int] = None
    #: The first frame (Wan2.2 TI2V).
    image: Optional[Image.Image] = None
    #: VACE: the control video, RGB ``[T, H, W, 3]`` at ``width`` x ``height`` (pose maps).
    control: Optional[np.ndarray] = None
    #: VACE: an image of the subject, shown to the model as an extra frame before the video.
    reference: Optional[Image.Image] = None
    #: VACE: how strongly the control steers each layer (1 as trained).
    control_scale: float = 1.0


#: Fewest latent frames (of video, beside a reference) a window may have.
MIN_WINDOW = 2


@dataclass(frozen=True)
class Windows:
    """How a video's ``total`` latent frames are denoised: ``size`` at a time, from each of ``starts``
    (one window from 0 when the whole video fits a call)."""

    total: int
    size: int
    starts: tuple[int, ...]

    @property
    def overlap(self) -> int:
        """Latent frames each window shares with the next (at least; the last may share more)."""
        return 0 if len(self.starts) < 2 else self.size - (self.starts[1] - self.starts[0])

    def weights(self, start: int) -> torch.Tensor:
        """``[size]``: how much the window from ``start`` counts for each of its frames. It fades in
        over the frames it shares with the window before and out over those it shares with the next,
        so neighbouring windows hand over gradually instead of at a seam; 1 elsewhere."""
        w = torch.ones(self.size)
        ramp = torch.arange(1, self.overlap + 1, dtype=torch.float32) / (self.overlap + 1)
        if start > 0:
            w[: self.overlap] = ramp
        if start + self.size < self.total:
            w[self.size - self.overlap :] = ramp.flip(0)
        return w


def plan_windows(total: int, size: int) -> Windows:
    """Windows of ``size`` latent frames over ``total``, a quarter of each shared with the next."""
    if size >= total:
        return Windows(total, total, (0,))
    overlap = max(1, size // 4)
    stride = size - overlap
    starts = list(range(0, total - size, stride)) + [total - size]
    return Windows(total, size, tuple(starts))


def _prompt_clean(text: str) -> str:
    try:
        import ftfy

        text = ftfy.fix_text(text)
    except ImportError:
        pass
    text = html.unescape(html.unescape(text)).strip()
    return re.sub(r"\s+", " ", text).strip()


def _dmd_sigma_table() -> tuple[torch.Tensor, torch.Tensor]:
    """FastVideo's FlowMatchEulerDiscreteScheduler(shift=8) table: timesteps and their sigmas."""
    n = 1000
    sigmas = torch.linspace(1, n, n, dtype=torch.float64).flip(0) / n
    sigmas = DMD_TRAINING_NOISE_SHIFT * sigmas / (1 + (DMD_TRAINING_NOISE_SHIFT - 1) * sigmas)
    return sigmas * n, sigmas


def resize_center_crop(image: Image.Image, width: int, height: int) -> Image.Image:
    """Covers ``width``x``height`` with ``image`` and crops the overflow, keeping the centre."""
    image = image.convert("RGB")
    scale = max(width / image.width, height / image.height)
    resized = image.resize(
        (max(width, round(image.width * scale)), max(height, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def _reference_canvas(image: Image.Image, width: int, height: int) -> torch.Tensor:
    """``[1, 3, 1, H, W]`` in [-1, 1]: ``image`` fitted inside, centred on white (diffusers' VACE)."""
    image = image.convert("RGB")
    scale = min(height / image.height, width / image.width)
    size = (int(image.width * scale), int(image.height * scale))
    canvas = Image.new("RGB", (width, height), (255, 255, 255))
    canvas.paste(image.resize(size, Image.Resampling.BILINEAR), ((width - size[0]) // 2, (height - size[1]) // 2))
    pixels = torch.from_numpy(np.asarray(canvas, dtype=np.float32) / 127.5 - 1.0)
    return pixels.permute(2, 0, 1)[None, :, None]


class WanVideoPipeline:
    def __init__(self, preset: Preset, backend: Backend, base_dir: Path, scheduler_dir: Path | None = None):
        from diffusers import UniPCMultistepScheduler
        from transformers import AutoTokenizer

        self.preset = preset
        self.backend = backend
        self.tokenizer = AutoTokenizer.from_pretrained(base_dir / "tokenizer")
        self.scheduler_config = UniPCMultistepScheduler.load_config(
            (scheduler_dir or base_dir) / "scheduler"
        )
        vae_config = json.loads((base_dir / "vae" / "config.json").read_text(encoding="utf-8"))
        z = preset.z_dim
        self.latents_mean = torch.tensor(vae_config["latents_mean"], dtype=torch.float32).view(1, z, 1, 1, 1)
        self.latents_std = torch.tensor(vae_config["latents_std"], dtype=torch.float32).view(1, z, 1, 1, 1)
        self._embeds: OrderedDict[str, torch.Tensor] = OrderedDict()
        # VACE's inactive part is an all-grey video: its latents depend only on the shape.
        self._inactive: dict[tuple, torch.Tensor] = {}
        #: Overrides ``Preset.window_tokens`` (``VIDEO_GENERATION_WINDOW_TOKENS``, for measuring).
        self.window_budget = 0

    # -- text -----------------------------------------------------------------------------------

    def encode_prompt(self, text: str) -> torch.Tensor:
        """``[1, 512, 4096]``: the prompt's embeddings, zero-padded. The last few are cached."""
        text = _prompt_clean(text)
        cached = self._embeds.get(text)
        if cached is not None:
            self._embeds.move_to_end(text)
            return cached
        ids = self.tokenizer(
            [text],
            padding="max_length",
            max_length=MAX_SEQUENCE_LENGTH,
            truncation=True,
            add_special_tokens=True,
            return_attention_mask=True,
            return_tensors="pt",
        )
        length = max(int(ids.attention_mask.sum()), 1)
        # Only the real tokens go through the encoder: padding is masked out of every attention, so
        # their embeddings come out the same as diffusers' full 512-token pass (which then drops them).
        embeds = self.backend.encode_text(ids.input_ids[:, :length])
        out = torch.zeros(1, MAX_SEQUENCE_LENGTH, embeds.shape[-1], dtype=torch.float32, device=self.backend.device)
        out[:, :length] = embeds[:, :length].to(device=self.backend.device, dtype=torch.float32)
        self._embeds[text] = out
        while len(self._embeds) > 8:
            self._embeds.popitem(last=False)
        return out

    # -- VACE -----------------------------------------------------------------------------------

    def _vace_context(self, args: GenerateArgs, num_frames: int, mean: torch.Tensor, std: torch.Tensor) -> torch.Tensor:
        """``[1, 96, T', h, w]``: the latents of the video's kept and replaced parts and the mask,
        as diffusers' ``WanVACEPipeline`` builds them. A pose video is all "replaced": the kept part is
        an empty (grey) video and the mask is all ones."""
        device = self.backend.device
        if args.control is not None:
            frames = args.control[:num_frames]
            if len(frames) < num_frames:
                frames = np.concatenate([frames, np.repeat(frames[-1:], num_frames - len(frames), 0)])
            video = torch.from_numpy(np.ascontiguousarray(frames)).float().permute(3, 0, 1, 2)[None] / 127.5 - 1
        else:
            video = torch.zeros(1, 3, num_frames, args.height, args.width)
        reactive = (self.backend.encode_control(video).to(device, torch.float32) - mean) / std
        key = tuple(video.shape)
        if key not in self._inactive:
            empty = self.backend.encode_control(torch.zeros_like(video)).to(device, torch.float32)
            self._inactive = {key: (empty - mean) / std}
        latents = torch.cat([self._inactive[key], reactive], 1)
        mask = torch.ones(1, self.preset.vae_scale_spatial**2, *latents.shape[2:], device=device)
        if args.reference is not None:
            pixels = _reference_canvas(args.reference, args.width, args.height).to(device)
            ref = (self.backend.vae_encode(pixels).to(device, torch.float32) - mean) / std
            latents = torch.cat([torch.cat([ref, torch.zeros_like(ref)], 1), latents], 2)
            mask = torch.cat([torch.zeros_like(mask[:, :, :1]), mask], 2)
        return torch.cat([latents, mask], 1)

    # -- generation -----------------------------------------------------------------------------

    def check_size(self, width: int, height: int) -> None:
        m = self.preset.size_multiple
        if width % m or height % m:
            raise ValueError(f"Width and height must be multiples of {m} for {self.preset.label}")

    def window_tokens(self) -> int:
        """Latent tokens one call may take (``Preset.window_tokens``, within the GPU's ``max_tokens``)."""
        budget = self.window_budget or self.preset.window_tokens
        limit = getattr(self.backend, "max_tokens", None)
        return budget if limit is None else min(budget, limit)

    def windows(self, width: int, height: int, num_frames: int, refs: int = 0) -> Windows:
        """The windows a video of this shape is denoised in: one for a preset without
        ``window_tokens``, else as many latent frames each as fit its budget, at most the trained
        length's."""
        p = self.preset
        total = p.latent_frames(p.fit_frames(num_frames))
        if not p.window_tokens:
            return plan_windows(total, total)
        per_frame = (height // p.size_multiple) * (width // p.size_multiple)
        size = min(self.window_tokens() // per_frame - refs, p.latent_frames(p.num_frames))
        if size < MIN_WINDOW:
            raise ValueError(
                f"{p.label} at {width}x{height} needs more GPU memory than this device has; make the video smaller"
            )
        return plan_windows(total, size)

    def check_fits(self, width: int, height: int, num_frames: int, extra_latent_frames: int = 0) -> None:
        """Refuses a video the backend's GPU cannot hold (``max_tokens``), naming the longest that fits."""
        if self.preset.window_tokens:
            # Made in windows as long as fit: only the size can be too large.
            self.windows(width, height, num_frames, extra_latent_frames)
            return
        limit = getattr(self.backend, "max_tokens", None)
        if limit is None:
            return
        p = self.preset
        per_frame = (height // p.size_multiple) * (width // p.size_multiple)
        latent = p.latent_frames(p.fit_frames(num_frames)) + extra_latent_frames
        if latent * per_frame <= limit:
            return
        fit = limit // per_frame - extra_latent_frames
        longest = f"up to {(fit - 1) * p.vae_scale_temporal + 1} frames" if fit >= 2 else "none"
        raise ValueError(
            f"{p.label} at {width}x{height} and {num_frames} frames needs more GPU memory than this "
            f"device has ({longest} at this size); make the video shorter or smaller"
        )

    def __call__(
        self,
        args: GenerateArgs,
        progress: Progress = lambda phase, done, total: None,
        should_stop: Callable[[], bool] = lambda: False,
        preview: Optional[Preview] = None,
    ) -> np.ndarray:
        """The video as ``[frames, H, W, 3]`` uint8. With ``preview``, each step but the last also
        decodes the model's estimate of the finished video (its current latents minus the noise it
        predicts), small, which costs one tiny-decoder pass per step."""
        preset = self.preset
        device = self.backend.device
        self.check_size(args.width, args.height)
        self.check_fits(args.width, args.height, args.num_frames, 1 if args.reference is not None else 0)
        if args.image is not None and not preset.image_to_video:
            raise ValueError(f"{preset.label} takes no start image")
        if (args.control is not None or args.reference is not None) and not preset.vace:
            raise ValueError(f"{preset.label} takes no pose video or reference image")
        num_frames = preset.fit_frames(args.num_frames)
        t_lat = preset.latent_frames(num_frames)
        h_lat = args.height // preset.vae_scale_spatial
        w_lat = args.width // preset.vae_scale_spatial

        def stop_point():
            if should_stop():
                raise Cancelled()

        # A VACE reference image is one more latent frame in front, dropped after denoising.
        refs = 1 if args.reference is not None else 0
        # Every window shows the transformer the reference frame and ``windows.size`` of the video's.
        windows = self.windows(args.width, args.height, num_frames, refs)
        if len(windows.starts) > 1 and (preset.image_to_video or preset.per_token_timesteps):
            raise ValueError(f"{preset.label} cannot be made in windows")
        progress("prepare", 0, 1)
        self.backend.prepare(args.width, args.height, windows.size + refs)
        stop_point()

        dmd = preset.sampler == "dmd"
        # One per transformer: Wan2.2 A14B's low-noise one has its own.
        guidances = [1.0 if dmd else args.guidance_scale]
        if len(preset.experts) > 1:
            second = args.guidance_scale_2 if args.guidance_scale_2 is not None else preset.guidance_scale_2
            guidances.append(args.guidance_scale if second is None else second)
        use_cfg = any(g > 1.0 for g in guidances)
        progress("text", 0, 2 if use_cfg else 1)
        context = self.encode_prompt(args.prompt)
        negative = None
        if use_cfg:
            stop_point()
            progress("text", 1, 2)
            negative = self.encode_prompt(args.negative_prompt or DEFAULT_NEGATIVE_PROMPT)
        stop_point()

        # Noise from a CPU generator, so a seed gives the same video on every backend.
        generator = torch.Generator("cpu")
        generator.manual_seed(args.seed if args.seed is not None else int(torch.seed() % 2**63))
        shape = (1, preset.z_dim, t_lat + refs, h_lat, w_lat)
        latents = torch.randn(shape, generator=generator, dtype=torch.float32).to(device)

        mean = self.latents_mean.to(device)
        std = self.latents_std.to(device)
        condition = None
        # 0 where a token is the given first frame (clean, timestep 0), 1 where it is generated.
        mask = torch.ones(1, 1, t_lat, h_lat, w_lat, dtype=torch.float32, device=device)
        if args.image is not None:
            image = resize_center_crop(args.image, args.width, args.height)
            pixels = torch.from_numpy(np.asarray(image, dtype=np.float32) / 127.5 - 1.0)
            pixels = pixels.permute(2, 0, 1)[None, :, None].to(device)
            condition = (self.backend.vae_encode(pixels).to(device, torch.float32) - mean) / std
            mask[:, :, 0] = 0
        control = self._vace_context(args, num_frames, mean, std) if preset.vace else None
        stop_point()

        def model_input(x: torch.Tensor) -> torch.Tensor:
            return x if condition is None else (1 - mask) * condition + mask * x

        def timestep_for(t: torch.Tensor) -> torch.Tensor:
            if preset.per_token_timesteps:
                return (mask[0, 0, :, ::2, ::2] * t).flatten()[None]
            return t.reshape(1)

        def predict_call(x: torch.Tensor, t: torch.Tensor, expert: int, ctrl: Optional[torch.Tensor]) -> torch.Tensor:
            inp = model_input(x)
            ts = timestep_for(t.to(device=device, dtype=torch.float32))
            guidance = guidances[expert]
            flow = self.backend.transformer(inp, ts, context, ctrl, args.control_scale, expert=expert)
            if guidance > 1.0:
                stop_point()
                uncond = self.backend.transformer(inp, ts, negative, ctrl, args.control_scale, expert=expert)
                flow = uncond + guidance * (flow - uncond)
            return flow

        def predict(x: torch.Tensor, t: torch.Tensor, expert: int = 0) -> torch.Tensor:
            """The flow for all of ``x``: one call, or one per window, blended where they overlap.
            Each window sees its own frames from position 0 (with the reference in front), so the
            transformer only ever runs at a length it was trained at."""
            if len(windows.starts) == 1:
                return predict_call(x, t, expert, control)
            flow = torch.zeros_like(x)
            weight = torch.zeros(x.shape[2], dtype=x.dtype, device=x.device)
            for start in windows.starts:
                stop_point()
                frames = torch.cat([torch.arange(refs), torch.arange(refs + start, refs + start + windows.size)])
                frames = frames.to(x.device)
                ctrl = None if control is None else control.index_select(2, frames.to(control.device))
                part = predict_call(x.index_select(2, frames), t, expert, ctrl).to(x)
                w = torch.cat([torch.ones(refs), windows.weights(start)]).to(x)
                flow.index_add_(2, frames, part * w.view(1, 1, -1, 1, 1))
                weight.index_add_(0, frames, w)
            return flow / weight.view(1, 1, -1, 1, 1)

        def show(step: int, total: int, x0: torch.Tensor) -> None:
            """Decodes step ``step``'s estimate of the clean latents for ``preview``."""
            if preview is None or step >= total:
                return
            stop_point()
            # As before the final decode, so the decoder never shares the GPU with the transformer's
            # activations; the transformer allocates them again on its next call.
            self.backend.release()
            z = model_input(x0)[:, :, refs:] * std + mean
            size = preview_size(args.width, args.height)
            chunks = [_to_uint8(chunk, size) for chunk in self.backend.vae_decode_frames(z)]
            preview(step, np.concatenate(chunks, axis=0)[:num_frames])

        if dmd:
            table_t, table_sigma = _dmd_sigma_table()

            def sigma(t: int) -> float:
                return float(table_sigma[torch.argmin((table_t - t).abs())])

            steps = list(preset.dmd_timesteps)
            progress("denoise", 0, len(steps))
            for i, t in enumerate(steps):
                stop_point()
                flow = predict(latents, torch.tensor(float(t)))
                x0 = latents - sigma(t) * flow
                if i + 1 < len(steps):
                    s = sigma(steps[i + 1])
                    noise = torch.randn(shape, generator=generator, dtype=torch.float32).to(device)
                    latents = (1 - s) * x0 + s * noise
                else:
                    latents = x0
                progress("denoise", i + 1, len(steps))
                show(i + 1, len(steps), x0)
        else:
            from diffusers import UniPCMultistepScheduler

            scheduler = UniPCMultistepScheduler.from_config(self.scheduler_config)
            scheduler.set_timesteps(args.steps, device=device)
            timesteps = scheduler.timesteps
            # As diffusers' WanPipeline: the high-noise transformer from the boundary timestep up.
            boundary = None
            if preset.boundary_ratio is not None:
                boundary = preset.boundary_ratio * scheduler.config.num_train_timesteps
            progress("denoise", 0, len(timesteps))
            for i, t in enumerate(timesteps):
                stop_point()
                flow = predict(latents, t, 0 if boundary is None or t >= boundary else 1)
                # UniPC's own x0 for flow prediction (``convert_model_output``); its sigmas stay on the CPU.
                x0 = latents - float(scheduler.sigmas[i]) * flow if preview is not None else None
                latents = scheduler.step(flow, t, latents, return_dict=False)[0]
                progress("denoise", i + 1, len(timesteps))
                show(i + 1, len(timesteps), x0)

        self.backend.release()
        latents = model_input(latents[:, :, refs:])
        latents = latents * std + mean
        frames: list[np.ndarray] = []
        progress("decode", 0, t_lat)
        for i, chunk in enumerate(self.backend.vae_decode_frames(latents)):
            frames.append(_to_uint8(chunk))
            progress("decode", i + 1, t_lat)
            if i + 1 < t_lat:
                stop_point()
        return np.concatenate(frames, axis=0)[:num_frames]


def _to_uint8(chunk: torch.Tensor, size: Optional[tuple[int, int]] = None) -> np.ndarray:
    """A decoded chunk ``[1, 3, t, H, W]`` in [-1, 1] as ``[t, H, W, 3]`` uint8, scaled down to
    ``size`` (width, height) when given, on the chunk's own device."""
    x = chunk[0].float().clamp(-1, 1).transpose(0, 1)  # t, 3, H, W
    if size is not None and (x.shape[-1], x.shape[-2]) != size:
        x = F.interpolate(x, size=(size[1], size[0]), mode="area")
    return ((x.permute(0, 2, 3, 1) + 1) * 127.5).round().to(torch.uint8).cpu().numpy()
