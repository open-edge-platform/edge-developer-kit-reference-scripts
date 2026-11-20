# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""A tiny decoder for Wan latents: the decoder half of madebyollin's TAEHV architecture (MIT).

Written here from the published architecture; it loads only ``.safetensors`` weights, the
``decoder.*`` tensors of LightX2V's distilled ``lighttaew2_1`` / ``lighttaew2_2`` (Apache-2.0,
``lightx2v/Autoencoders``). It is all 2-D convolutions over frames, which every OpenVINO device runs
well, where the official VAE's causal 3-D convolutions are slow on the GPU plugin. On an Arc Pro B60
it decodes a 5 s 720p Wan2.2 clip in about a second instead of a minute, at a small cost in detail.

LightX2V trained these on the VAE's own latent scale, so they take the latents the full VAE would
decode (normalisation undone), not the diffusion-space ones madebyollin's ``taew2_*`` take: fed the
wrong scale they come out over-contrasted (17 dB PSNR against the full VAE instead of 27.7 dB on a
FastWan2.2 720p clip). ``[T, C, h, w]`` for one video, to frames in [0, 1]. Each memory block mixes a frame with the one before it, so a video can be
decoded in chunks of latent frames by carrying each block's last input across chunks; the result is
the same as decoding it whole.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator, Optional

import torch
import torch.nn as nn
import torch.nn.functional as F

#: Hugging Face repository and file of the weights, per Wan family.
WEIGHTS = {
    "wan2.1": ("lightx2v/Autoencoders", "lighttaew2_1.safetensors"),
    "wan2.2": ("lightx2v/Autoencoders", "lighttaew2_2.safetensors"),
}
#: Latent frame -> video frames, and the frames the first latent frame adds that are dropped.
TIME_UPSCALE = 4
FRAMES_TO_TRIM = TIME_UPSCALE - 1


def _conv(n_in: int, n_out: int, bias: bool = True) -> nn.Conv2d:
    return nn.Conv2d(n_in, n_out, 3, padding=1, bias=bias)


class _Clamp(nn.Module):
    def forward(self, x):
        return torch.tanh(x / 3) * 3


class _MemBlock(nn.Module):
    def __init__(self, n: int):
        super().__init__()
        self.conv = nn.Sequential(_conv(n * 2, n), nn.ReLU(), _conv(n, n), nn.ReLU(), _conv(n, n))
        self.act = nn.ReLU()

    def forward(self, x, past):
        return self.act(self.conv(torch.cat([x, past], 1)) + x)


class _TGrow(nn.Module):
    """Each frame becomes ``stride`` frames."""

    def __init__(self, n: int, stride: int):
        super().__init__()
        self.stride = stride
        self.conv = nn.Conv2d(n, n * stride, 1, bias=False)

    def forward(self, x):
        t, c, h, w = x.shape
        return self.conv(x).reshape(t * self.stride, c, h, w)


class TinyWanDecoder(nn.Module):
    def __init__(self, latent_channels: int, patch_size: int):
        super().__init__()
        self.patch_size = patch_size
        n = [256, 128, 64, 64]
        self.decoder = nn.Sequential(
            _Clamp(), _conv(latent_channels, n[0]), nn.ReLU(),
            _MemBlock(n[0]), _MemBlock(n[0]), _MemBlock(n[0]), nn.Upsample(scale_factor=2), _TGrow(n[0], 1), _conv(n[0], n[1], bias=False),
            _MemBlock(n[1]), _MemBlock(n[1]), _MemBlock(n[1]), nn.Upsample(scale_factor=2), _TGrow(n[1], 2), _conv(n[1], n[2], bias=False),
            _MemBlock(n[2]), _MemBlock(n[2]), _MemBlock(n[2]), nn.Upsample(scale_factor=2), _TGrow(n[2], 2), _conv(n[2], n[3], bias=False),
            nn.ReLU(), _conv(n[3], 3 * patch_size**2),
        )  # fmt: skip
        self.memory_blocks = [m for m in self.decoder if isinstance(m, _MemBlock)]

    @classmethod
    def from_safetensors(cls, path: Path, family: str) -> "TinyWanDecoder":
        from safetensors.torch import load_file

        model = cls(48 if family == "wan2.2" else 16, 2 if family == "wan2.2" else 1)
        weights = {k: v for k, v in load_file(str(path)).items() if k.startswith("decoder.")}
        own = model.state_dict()
        for key, value in weights.items():
            # The first time-grow layer is trained at stride 2 and run at stride 1: keep the
            # last-timestep output channels, as TAEHV does.
            if key in own and value.shape[0] > own[key].shape[0]:
                weights[key] = value[-own[key].shape[0] :]
        model.load_state_dict(weights)
        return model.eval()

    def forward(self, x: torch.Tensor, memory: Optional[list[torch.Tensor]] = None):
        """``x``: ``[T, C, h, w]`` latents. ``memory``: each memory block's last input from the chunk
        before (None for the first). Returns ``[4T, 3, H, W]`` frames in [0, 1] and the new memory."""
        carried: list[torch.Tensor] = []
        k = 0
        for block in self.decoder:
            if isinstance(block, _MemBlock):
                first = torch.zeros_like(x[:1]) if memory is None else memory[k]
                carried.append(x[-1:])
                x = block(x, torch.cat([first, x[:-1]], 0))
                k += 1
            else:
                x = block(x)
        if self.patch_size > 1:
            x = F.pixel_shuffle(x, self.patch_size)
        return x.clamp(0, 1), carried

    @torch.inference_mode()
    def decode_frames(self, latents: torch.Tensor, chunk: int = 8) -> Iterator[torch.Tensor]:
        """``latents``: ``[1, C, T, h, w]``, on the full VAE's scale. Yields ``[1, 3, t, H, W]`` chunks in [-1, 1], the same
        layout the full VAE decodes to, with the leading frames TAEHV adds already dropped."""
        x = latents[0].transpose(0, 1)
        memory = None
        for start in range(0, x.shape[0], chunk):
            frames, memory = self(x[start : start + chunk], memory)
            if start == 0:
                frames = frames[FRAMES_TO_TRIM:]
            yield (frames * 2 - 1).transpose(0, 1)[None]


class _TPool(nn.Module):
    """Each ``stride`` frames become one."""

    def __init__(self, n: int, stride: int):
        super().__init__()
        self.stride = stride
        self.conv = nn.Conv2d(n * stride, n, 1, bias=False)

    def forward(self, x):
        t, c, h, w = x.shape
        return self.conv(x.reshape(t // self.stride, self.stride * c, h, w))


class TinyWanEncoder(nn.Module):
    """The encoder half, for the videos pose-to-video conditions on: the full VAE's encoder is the
    same causal 3-D network as its decoder, minutes on a CPU and slow on the GPU plugin."""

    def __init__(self, latent_channels: int, patch_size: int):
        super().__init__()
        self.patch_size = patch_size
        self.encoder = nn.Sequential(
            _conv(3 * patch_size**2, 64), nn.ReLU(),
            _TPool(64, 2), _conv64s2(), _MemBlock(64), _MemBlock(64), _MemBlock(64),
            _TPool(64, 2), _conv64s2(), _MemBlock(64), _MemBlock(64), _MemBlock(64),
            _TPool(64, 1), _conv64s2(), _MemBlock(64), _MemBlock(64), _MemBlock(64),
            _conv(64, latent_channels),
        )  # fmt: skip

    @classmethod
    def from_safetensors(cls, path: Path, family: str) -> "TinyWanEncoder":
        from safetensors.torch import load_file

        model = cls(48 if family == "wan2.2" else 16, 2 if family == "wan2.2" else 1)
        model.load_state_dict({k: v for k, v in load_file(str(path)).items() if k.startswith("encoder.")})
        return model.eval()

    def forward(self, x: torch.Tensor, memory: Optional[list[torch.Tensor]] = None):
        """``x``: ``[T, 3, H, W]`` frames in [0, 1], ``T`` a multiple of 4. ``memory``: as the
        decoder's. Returns latents ``[T / 4, C, h, w]`` on the full VAE's scale and the new memory."""
        if self.patch_size > 1:
            x = F.pixel_unshuffle(x, self.patch_size)
        carried: list[torch.Tensor] = []
        for block in self.encoder:
            if isinstance(block, _MemBlock):
                first = torch.zeros_like(x[:1]) if memory is None else memory[len(carried)]
                carried.append(x[-1:])
                x = block(x, torch.cat([first, x[:-1]], 0))
            else:
                x = block(x)
        return x, carried

    @torch.inference_mode()
    def encode_video(self, video: torch.Tensor, chunk: int = 16) -> torch.Tensor:
        """``video``: ``[1, 3, 4k + 1, H, W]`` in [-1, 1]. Latents ``[1, C, k + 1, h, w]``, as the full
        VAE encodes them (relative error 4% on pose maps). TAEHV pads the end, not the start."""
        x = (video[0].transpose(0, 1) + 1) / 2
        x = torch.cat([x, x[-1:].expand(-x.shape[0] % 4, -1, -1, -1)])
        memory, latents = None, []
        for start in range(0, x.shape[0], chunk):
            z, memory = self(x[start : start + chunk], memory)
            latents.append(z)
        return torch.cat(latents).transpose(0, 1)[None]


def _conv64s2() -> nn.Conv2d:
    return nn.Conv2d(64, 64, 3, stride=2, padding=1, bias=False)
