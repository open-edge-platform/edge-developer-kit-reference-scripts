# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Runs the Wan networks as OpenVINO IR (``ov_export``), each on its own device."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterator, Optional

import numpy as np
import torch

from .ov_export import IRPaths
from .presets import Preset
from .tiny_vae import FRAMES_TO_TRIM, TIME_UPSCALE

logger = logging.getLogger(__name__)

#: Latent frames the tiny decoder takes per call. Its convolutions run on the GPU's dynamic-shape
#: fallback at 60x the static kernels' time (7.9 s against 0.13 s for 4 latent frames at 480p on an
#: Arc Pro B60), so it is compiled for one chunk size per video size. At 8 a 480p chunk's
#: activations pass the GPU's 4 GB single-allocation limit and the device resets.
DECODE_CHUNK = 4
#: The latent frame area (h x w) ``DECODE_CHUNK`` was measured at: 480p's. A larger frame gets a
#: smaller chunk, so a chunk's activations stay within that (720p's 4 would be 2.3x).
DECODE_AREA = 60 * 104
#: Frames the tiny encoder takes per call (a multiple of 4); at 480p its first layer's output is
#: then 0.8 GB, at 720p 1.9 GB, under the same allocation limit.
ENCODE_CHUNK = 16
#: Memory blocks of the tiny decoder: three per stage, each stage at twice the last one's size.
MEMORY_SCALES = (1, 1, 1, 2, 2, 2, 4, 4, 4)
#: Room for activations beside the weights on a GPU: what decides whether a two-transformer preset
#: keeps both compiled (Wan2.2 A14B at int8 is 2 x 14 GB: one at a time on a 24 GB card), and whether
#: the text encoder (6 GB at int8) shares the GPU.
ACTIVATION_HEADROOM = 6 * 2**30
#: Kept free beside the weights and ``Preset.gpu_bytes_per_token`` when sizing the longest video: the
#: activations' fixed part (0.8 GiB for A14B) and a margin.
GPU_RESERVE = 2 * 2**30


def decode_chunk(h: int, w: int) -> int:
    """Latent frames the tiny decoder takes per call for latents of ``h`` x ``w``: ``DECODE_CHUNK``,
    halved until a chunk is no larger than ``DECODE_CHUNK`` at ``DECODE_AREA``."""
    chunk = DECODE_CHUNK
    while chunk > 1 and chunk * h * w > DECODE_CHUNK * DECODE_AREA:
        chunk //= 2
    return chunk


def _is_gpu(device: str) -> bool:
    return device.upper().startswith("GPU")


def prune_cache(cache_dir: Path, budget_bytes: int) -> None:
    """Deletes the oldest compiled blobs until ``cache_dir`` fits ``budget_bytes``."""
    try:
        files = sorted((f for f in cache_dir.iterdir() if f.is_file()), key=lambda f: f.stat().st_mtime)
    except OSError:
        return
    total = sum(f.stat().st_size for f in files)
    for f in files:
        if total <= budget_bytes:
            break
        total -= f.stat().st_size
        f.unlink(missing_ok=True)


class OVBackend:
    """``device`` runs the transformer; the text encoder and decoder default to it too.

    ``static``: reshape the transformer to each run's exact shape before compiling it, which the GPU
    plugin runs faster than dynamic shapes. With ``cache_dir`` set, a shape seen before loads from
    there: unlike most workers' models (``worker_common`` leaves GPU caching to the driver), a 5B
    transformer takes 40 s to compile for a 720p shape with the driver's kernel cache warm, 5 s from
    a blob. Blobs are weightless (``OPTIMIZE_SIZE``) but still about the compressed model's size, so
    the oldest go once the folder passes ``cache_budget`` bytes. Only the transformer is cached (the
    text encoder and decoder compile in seconds), and the decoder on an NPU, which takes a minute.

    A preset with two transformers (Wan2.2 A14B) keeps both compiled when their weights fit the GPU
    beside ``ACTIVATION_HEADROOM`` (always on the CPU), else one at a time: the other is compiled
    when the denoising loop first asks for it, and the first one again at the next video. Without a
    ``text_device``, the text encoder leaves for the CPU when it does not fit beside the largest
    transformer (0.2 s a prompt there).

    ``max_tokens``: with ``Preset.gpu_bytes_per_token`` on a GPU, the most latent tokens a video may
    have; ``release`` frees the transformers' activations before decoding.
    """

    def __init__(
        self,
        ir: IRPaths,
        preset: Preset,
        device: str = "GPU",
        text_device: Optional[str] = None,
        vae_device: Optional[str] = None,
        static: bool = False,
        cache_dir: Optional[Path] = None,
        cache_budget: int = 20 * 2**30,
    ):
        from worker_common import openvino_core, openvino_npu_cache_config

        self.core = openvino_core()
        self.ir = ir
        self.preset = preset
        self.device = torch.device("cpu")
        experts = [path.with_suffix(".bin").stat().st_size for path in ir.experts]
        text_bytes = ir.text_encoder.with_suffix(".bin").stat().st_size
        gpu_memory = self._gpu_memory(device)
        if text_device is None and gpu_memory and max(experts) + text_bytes + ACTIVATION_HEADROOM > gpu_memory:
            text_device = "CPU"
        self.devices = {
            "transformer": device,
            "text_encoder": text_device or device,
            "vae": vae_device or device,
        }
        beside = text_bytes if self.devices["text_encoder"] == device else 0
        self.keep_all_experts = (
            len(experts) == 1 or not _is_gpu(device) or sum(experts) + beside + ACTIVATION_HEADROOM <= (gpu_memory or 0)
        )
        self.max_tokens: Optional[int] = None
        if preset.gpu_bytes_per_token and gpu_memory:
            resident = (sum(experts) if self.keep_all_experts else max(experts)) + beside
            self.max_tokens = max(0, (gpu_memory - resident - GPU_RESERVE) // preset.gpu_bytes_per_token)
        if len(experts) > 1:
            logger.info(
                "%d transformers of %.1f GiB on %s: %s; text encoder on %s; at most %s latent tokens",
                len(experts),
                max(experts) / 2**30,
                device,
                "all kept compiled" if self.keep_all_experts else "one at a time",
                self.devices["text_encoder"],
                self.max_tokens,
            )
        self.static = static
        self.cache_dir = cache_dir
        self.cache_budget = cache_budget
        self._shape: Optional[tuple[int, int, int]] = None

        # UMT5's activations overflow fp16 (every output NaN on the GPU's default f16), so the GPU
        # runs it in f32; its weights stay compressed.
        text = self.devices["text_encoder"]
        text_config = {"INFERENCE_PRECISION_HINT": "f32"} if _is_gpu(text) else {}
        self.text_encoder = self._compile(ir.text_encoder, text, text_config)
        self._text_request = self.text_encoder.create_infer_request()
        self._dit_models = [self.core.read_model(path) for path in ir.experts]
        self._dit_model = self._dit_models[0]
        #: Compiled transformers by expert index, with an infer request each.
        self._dits: dict[int, tuple[object, object]] = {}
        if not static:
            self._load_expert(0)
        vae = self.devices["vae"]
        self._decoder_config = openvino_npu_cache_config(vae, ir.tiny_decoder.parent)
        self._decoder_model = self.core.read_model(ir.tiny_decoder)
        self._decoders: dict[tuple[int, int], object] = {}
        self._encoders: dict[tuple[int, int], object] = {}
        self.vae_encoder = self._compile(ir.vae_encoder, vae) if ir.vae_encoder else None

    def _compile(self, model, device: str, config: Optional[dict] = None):
        return self.core.compile_model(model, device, dict(config or {}))

    def _gpu_memory(self, device: str) -> Optional[int]:
        if not _is_gpu(device):
            return None
        try:
            return int(self.core.get_property(device, "GPU_DEVICE_TOTAL_MEM_SIZE"))
        except Exception:  # noqa: BLE001 - a plugin without the property
            return None

    def _cache_config(self, expert: int) -> dict:
        if self.cache_dir is None:
            return {}
        return {
            "CACHE_DIR": str(self.cache_dir),
            "CACHE_MODE": "OPTIMIZE_SIZE",
            "WEIGHTS_PATH": str(self.ir.experts[expert].with_suffix(".bin")),
        }

    @property
    def execution_device(self) -> str:
        from worker_common import openvino_execution_device

        loaded = next(iter(self._dits.values()), None)
        if loaded is None and self.devices["text_encoder"] != self.devices["transformer"]:
            return self.devices["transformer"]
        return openvino_execution_device(loaded[0] if loaded else self.text_encoder, self.devices["transformer"])

    def prepare(self, width: int, height: int, latent_frames: int) -> None:
        if self.static:
            p = self.preset
            shape = (latent_frames, height // p.vae_scale_spatial, width // p.vae_scale_spatial)
            if self._shape != shape:
                # Release the previous shape's kernels before compiling the next.
                self._dits.clear()
                self._shape = shape
        # The denoising loop starts with the first transformer.
        for expert in range(len(self._dit_models) if self.keep_all_experts else 1):
            self._load_expert(expert)

    def _load_expert(self, expert: int) -> tuple[object, object]:
        """The compiled transformer ``expert`` (for the current shape when static) and its request."""
        loaded = self._dits.get(expert)
        if loaded is not None:
            return loaded
        if not self.keep_all_experts:
            # Its weights must leave the GPU before the next one's arrive.
            self._dits.clear()
        model = self._dit_models[expert]
        if self.static:
            model = self._reshaped(model, *self._shape)
        compiled = self._compile(model, self.devices["transformer"], self._cache_config(expert))
        loaded = self._dits[expert] = (compiled, compiled.create_infer_request())
        if self.static and self.cache_dir is not None:
            prune_cache(self.cache_dir, self.cache_budget)
        return loaded

    def _reshaped(self, model, t: int, h: int, w: int):
        p = self.preset
        model = model.clone()
        tokens = t * (h // 2) * (w // 2)
        shapes = {
            model.inputs[0]: [1, p.z_dim, t, h, w],
            model.inputs[1]: [1, tokens] if p.per_token_timesteps else [1],
            model.inputs[2]: [1, 512, 4096],
        }
        if p.vace:
            shapes[model.inputs[3]] = [1, model.inputs[3].get_partial_shape()[1].get_length(), t, h, w]
            shapes[model.inputs[4]] = [model.inputs[4].get_partial_shape()[0].get_length()]
        model.reshape(shapes)
        return model

    def release(self) -> None:
        for compiled, _ in self._dits.values():
            compiled.release_memory()

    def encode_text(self, input_ids: torch.Tensor) -> torch.Tensor:
        out = self._text_request.infer({0: input_ids.numpy()})[0]
        return torch.from_numpy(np.array(out, dtype=np.float32))

    def transformer(
        self,
        latents: torch.Tensor,
        timestep: torch.Tensor,
        context: torch.Tensor,
        control: Optional[torch.Tensor] = None,
        control_scale: float = 1.0,
        expert: int = 0,
    ) -> torch.Tensor:
        inputs = {0: latents.numpy(), 1: timestep.numpy(), 2: context.numpy()}
        if self.preset.vace:
            inputs[3] = control.numpy()
            inputs[4] = np.full(self._dit_model.inputs[4].get_partial_shape().to_shape(), control_scale, np.float32)
        _, request = self._load_expert(expert)
        out = request.infer(inputs, share_inputs=True)[0]
        return torch.from_numpy(np.array(out, dtype=np.float32))

    def vae_encode(self, pixels: torch.Tensor) -> torch.Tensor:
        return torch.from_numpy(np.array(self.vae_encoder(pixels.numpy())[0], dtype=np.float32))

    def encode_control(self, video: torch.Tensor) -> torch.Tensor:
        """The tiny encoder over ``ENCODE_CHUNK`` frames at a time (static, as the decoder)."""
        x = ((video[0].transpose(0, 1).numpy() + 1) / 2).astype(np.float32)  # T, 3, H, W
        x = np.concatenate([x, np.repeat(x[-1:], -len(x) % 4, 0)])
        latent_frames = len(x) // 4
        x = np.concatenate([x, np.repeat(x[-1:], -len(x) % ENCODE_CHUNK, 0)])
        encoder = self._encoder(*x.shape[2:])
        request = encoder.create_infer_request()
        memory = [np.zeros(encoder.input(i + 1).get_shape(), np.float32) for i in range(len(MEMORY_SCALES))]
        latents = []
        for start in range(0, len(x), ENCODE_CHUNK):
            out = request.infer([x[start : start + ENCODE_CHUNK], *memory])
            latents.append(np.array(out[0]))
            memory = [np.array(out[i]) for i in range(1, len(MEMORY_SCALES) + 1)]
        z = np.concatenate(latents)[:latent_frames]
        return torch.from_numpy(z).transpose(0, 1)[None]

    def _encoder(self, height: int, width: int):
        compiled = self._encoders.get((height, width))
        if compiled is None:
            model = self.core.read_model(self.ir.tiny_encoder)
            shapes = {model.input(0): [ENCODE_CHUNK, 3, height, width]}
            # Its memory blocks run at 1/2, 1/4 and 1/8 of the frame size (after Wan2.2's 2x2 patch), three each.
            patch = 2 if self.preset.family == "wan2.2" else 1
            for i, scale in enumerate(s * patch for s in (2, 2, 2, 4, 4, 4, 8, 8, 8)):
                port = model.input(i + 1)
                shapes[port] = [1, port.get_partial_shape()[1].get_length(), height // scale, width // scale]
            model.reshape(shapes)
            compiled = self._encoders[(height, width)] = self._compile(model, self.devices["vae"], self._decoder_config)
        return compiled

    def _decoder(self, h: int, w: int):
        """The tiny decoder compiled for ``decode_chunk(h, w)`` latent frames of ``h`` x ``w``."""
        compiled = self._decoders.get((h, w))
        if compiled is None:
            model = self._decoder_model.clone()
            shapes = {model.input(0): [decode_chunk(h, w), self.preset.z_dim, h, w]}
            for i, scale in enumerate(MEMORY_SCALES):
                port = model.input(i + 1)
                shapes[port] = [1, port.get_partial_shape()[1].get_length(), h * scale, w * scale]
            model.reshape(shapes)
            compiled = self._decoders[(h, w)] = self._compile(model, self.devices["vae"], self._decoder_config)
        return compiled

    def vae_decode_frames(self, latents: torch.Tensor) -> Iterator[torch.Tensor]:
        x = latents[0].transpose(0, 1).numpy()  # T, C, h, w
        t, _, h, w = x.shape
        decoder = self._decoder(h, w)
        request = decoder.create_infer_request()
        memory = [np.zeros(decoder.input(i + 1).get_shape(), np.float32) for i in range(len(MEMORY_SCALES))]
        size = decode_chunk(h, w)
        try:
            for start in range(0, t, size):
                chunk = x[start : start + size]
                real = chunk.shape[0]
                if real < size:
                    # Padding at the end: memory only looks back, so the real frames come out the same.
                    chunk = np.concatenate([chunk, np.zeros((size - real, *chunk.shape[1:]), chunk.dtype)])
                out = request.infer([chunk, *memory])
                frames = np.array(out[0])[: real * TIME_UPSCALE]
                memory = [np.array(out[i]) for i in range(1, len(MEMORY_SCALES) + 1)]
                if start == 0:
                    frames = frames[FRAMES_TO_TRIM:]
                yield torch.from_numpy(frames * 2 - 1).transpose(0, 1)[None]
        finally:
            # Its activations (GBs at 480p and up) would otherwise stay on the GPU beside the
            # transformer's through the next denoising steps (a step preview decodes between them).
            del request
            try:
                decoder.release_memory()
            except Exception:  # noqa: BLE001 - a plugin that cannot release keeps them, as before
                logger.debug("The decoder on %s did not release its memory", self.devices["vae"], exc_info=True)
