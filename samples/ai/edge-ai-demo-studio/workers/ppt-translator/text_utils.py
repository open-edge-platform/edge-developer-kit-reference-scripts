# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)

_font_cache: dict[str, ImageFont.FreeTypeFont] = {}


def get_text_width(text: str, font_name: str, font_size: float) -> float:
    """Measure rendered width of text using PIL; falls back to heuristic when needed."""
    try:
        cache_key = f"{font_name}_{font_size}"
        font = _font_cache.get(cache_key)
        if not font:
            try:
                font = ImageFont.truetype(font_name, int(font_size))
            except Exception:
                try:
                    font = ImageFont.truetype("arial.ttf", int(font_size))
                except Exception:
                    font = ImageFont.load_default()
            _font_cache[cache_key] = font

        dummy_img = Image.new("RGB", (1, 1))
        draw = ImageDraw.Draw(dummy_img)
        bbox = draw.textbbox((0, 0), text, font=font)
        return float(bbox[2] - bbox[0])
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug(f"Text width fallback: {exc}")
        if any(ord(c) > 0x3000 for c in text):
            return len(text) * font_size * 0.9
        return len(text) * font_size * 0.6
