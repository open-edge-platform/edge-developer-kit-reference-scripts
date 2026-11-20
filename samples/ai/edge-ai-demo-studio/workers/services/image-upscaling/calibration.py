# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Calibration tiles for INT8 quantization, generated rather than shipped or downloaded.

A "dead leaves" image (opaque discs of random colour with power-law radii, dropped until they cover
the canvas) has the scale-invariant statistics of natural photos: edges at every scale and size,
flat regions, occlusions. Degraded the way a model's real inputs are (blur, a downscale, JPEG
artifacts, sensor noise), the tiles drive the activations through the ranges photos do, so no image
with a license of its own is needed.
"""

from __future__ import annotations

import io
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TILES = 32


def _between(low: float = 0.0, high: float = 1.0, size: int | tuple[int, ...] = ()) -> np.ndarray:
    """Uniform in [low, high)."""
    words = np.frombuffer(os.urandom(8 * int(np.prod(size))), "<u8")
    # The top 53 bits of each 64-bit word: a double in [0, 1), as numpy's own uniform takes.
    unit = (words >> np.uint64(11)) * 2.0**-53
    return (low + (high - low) * unit).reshape(size)


def _bell(loc: float, scale: float, size: int | tuple[int, ...]) -> np.ndarray:
    """Normal with mean ``loc`` and standard deviation ``scale``."""
    # Box-Muller; 1 - u is in (0, 1], so its log is finite.
    u, v = _between(size=size), _between(size=size)
    return loc + scale * np.sqrt(-2 * np.log1p(-u)) * np.cos(2 * np.pi * v)


def _colours(count: int) -> list[tuple[int, ...]]:
    # Photos are mostly muted: a random luminance with a small colour cast, not uniform RGB.
    rgb = _between(0, 255, (count, 1)) + _bell(0, 25, (count, 3))
    return [tuple(c) for c in rgb.clip(0, 255).astype(int).tolist()]


def _dead_leaves(side: int) -> Image.Image:
    r_min, r_max = 1.5, side / 3
    # Radii with density ~ r^-3 (inverse transform sampling), the scale-invariant choice; enough
    # discs that the background no longer shows.
    count = side * side // 12
    radii = 1 / np.sqrt(_between(size=count) * (r_min**-2 - r_max**-2) + r_max**-2)
    # Centres anywhere a disc still overlaps the canvas, [-r, side + r) on each axis.
    centres = _between(size=(count, 2)) * (side + 2 * radii[:, None]) - radii[:, None]
    background, *colours = _colours(count + 1)
    image = Image.new("RGB", (side, side), background)
    draw = ImageDraw.Draw(image)
    for r, (x, y), colour in zip(radii, centres, colours):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=colour)
    return image


def _degrade(image: Image.Image, side: int) -> np.ndarray:
    image = image.filter(ImageFilter.GaussianBlur(float(_between(0.3, 1.5))))
    image = image.resize((side, side), Image.Resampling.BICUBIC)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=int(_between(40, 95)))
    pixels = np.asarray(Image.open(buffer), np.float32)
    pixels = pixels + _bell(0, float(_between(0, 4)), pixels.shape)
    return pixels.clip(0, 255)


def calibration_tiles(side: int, count: int = TILES) -> list[np.ndarray]:
    """``count`` model inputs of ``side`` x ``side``: (1, 3, side, side) float32 in [0, 1]."""
    tiles = []
    for _ in range(count):
        pixels = _degrade(_dead_leaves(side * 2), side)
        tiles.append(np.ascontiguousarray(pixels.transpose(2, 0, 1)[None] / 255.0, dtype=np.float32))
    return tiles
