# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import cv2
import numpy as np

from functools import lru_cache
from PIL import ImageFont, ImageDraw, Image
from modules.base.logger import getLogger


def text_wrapper(cv_image, text, language_code="en-US", image_width=868):
    """Blend ``text`` as a white subtitle onto ``cv_image`` in place; layout is cached per sentence."""
    mask = _subtitle_mask(text, language_code, *cv_image.shape[:2], image_width)
    if mask is None:
        return cv_image
    top, left, alpha = mask
    roi = cv_image[top : top + alpha.shape[0], left : left + alpha.shape[1]]
    roi[:] = np.rint(roi + alpha * (255.0 - roi)).astype(np.uint8)
    return cv_image


@lru_cache(maxsize=16)
def _subtitle_mask(text, language_code, height, width, image_width):
    """(top, left, alpha) of the subtitle strip, alpha (h, w, 1) float32 in [0, 1]; None if empty."""
    canvas = Image.new("L", (width, height), 0)
    _draw_subtitle(canvas, text, language_code, image_width)
    alpha = np.asarray(canvas)
    rows = np.flatnonzero(alpha.any(axis=1))
    cols = np.flatnonzero(alpha.any(axis=0))
    if rows.size == 0:
        return None
    alpha = alpha[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]
    return int(rows[0]), int(cols[0]), (alpha.astype(np.float32) / 255.0)[..., None]


def _draw_subtitle(canvas, text, language_code, image_width):
    image_ratio = canvas.width / image_width
    image_width_actual = canvas.width
    margin = int(20 * image_ratio)
    max_text_width = image_width_actual - 2 * margin

    fontpath = "./data/fonts/simsun.ttc"
    font_size = float(40 * image_ratio)
    font_stroke_width = float(1 * image_ratio)
    font = ImageFont.truetype(fontpath, font_size)

    is_cjk = language_code in ["zh-TW", "zh-CN", "ja-JP"]
    tokens = list(text) if is_cjk else text.split()
    separator = "" if is_cjk else " "

    final_lines = []
    current_line = ""
    for token in tokens:
        candidate = current_line + (separator if current_line else "") + token
        _, _, right, _ = font.getbbox(candidate)
        if right <= max_text_width:
            current_line = candidate
        else:
            if current_line:
                final_lines.append(current_line)
            # Single token too wide — force it onto its own line
            current_line = token
    if current_line:
        final_lines.append(current_line)

    draw = ImageDraw.Draw(canvas)
    offset = 50 * len(final_lines) * image_ratio
    for i, line in enumerate(final_lines):
        left, top, right, bottom = font.getbbox(line)
        textsize = [right - left, bottom - top]

        gap = textsize[1] + 15 * image_ratio
        y = int((canvas.height - textsize[1]) - offset) + i * gap
        x = max(
            margin, int((canvas.width - textsize[0]) / 2)
        )

        if x + textsize[0] > image_width_actual - margin:
            x = image_width_actual - margin - textsize[0]

        draw.text(
            (x, y),
            line,
            font=font,
            fill=255,
            stroke_width=font_stroke_width,
            stroke_fill=255,
        )


class Avatar:
    def __init__(self, avatar_id):
        self.avatar_id = avatar_id
        self.tts = None

    def __del__(self):
        getLogger().info(f"Avatar {self.avatar_id} deleted")

    def reflection(self, size, index):
        res = index % size
        return res if (index // size) % 2 == 0 else size - res - 1

    def stop(self):
        NotImplemented

    def talk(self, message):
        NotImplemented
