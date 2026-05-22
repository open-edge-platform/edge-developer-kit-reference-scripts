# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import cv2
import numpy as np

from PIL import ImageFont, ImageDraw, Image
from modules.base.logger import getLogger


def text_wrapper(cv_image, text, language_code="en-US", image_width=868):
    image_ratio = cv_image.shape[1] / image_width
    image_width_actual = cv_image.shape[1]
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

    offset = 50 * len(final_lines) * image_ratio
    for i, line in enumerate(final_lines):
        left, top, right, bottom = font.getbbox(line)
        textsize = [right - left, bottom - top]

        gap = textsize[1] + 15 * image_ratio
        y = int((cv_image.shape[0] - textsize[1]) - offset) + i * gap
        x = max(
            margin, int((cv_image.shape[1] - textsize[0]) / 2)
        )  # Ensure x doesn't go below margin

        # Ensure text doesn't overflow right edge
        if x + textsize[0] > image_width_actual - margin:
            x = image_width_actual - margin - textsize[0]

        img_pil = Image.fromarray(cv_image)
        draw = ImageDraw.Draw(img_pil)
        draw.text(
            (x, y),
            line,
            font=font,
            fill=(255, 255, 255),
            stroke_width=font_stroke_width,
            stroke_fill="white",
        )
        cv_image = np.array(img_pil)

    return cv_image


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
