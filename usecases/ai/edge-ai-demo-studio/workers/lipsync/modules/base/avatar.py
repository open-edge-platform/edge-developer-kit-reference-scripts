# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import cv2
import textwrap
import cjk_textwrap
import numpy as np

from PIL import ImageFont, ImageDraw, Image
from modules.base.logger import getLogger


def text_wrapper(cv_image, text, language_code="en-US", image_width=868):
    image_ratio = cv_image.shape[1] / image_width
    image_width_actual = cv_image.shape[1]
    margin = int(20 * image_ratio)  # Add margin to prevent edge overflow
    max_text_width = image_width_actual - 2 * margin

    if language_code in ["zh-TW", "zh-CN"]:
        text_wrap_width = 30 * image_ratio
    elif language_code in ["ja-JP"]:
        text_wrap_width = 20
    else:
        text_wrap_width = 50

    fontpath = "./data/fonts/simsun.ttc"
    font_size = float(40 * image_ratio)
    font_stroke_width = float(1 * image_ratio)
    font = ImageFont.truetype(fontpath, font_size)

    # First pass: wrap text using character count
    wrapped_text = cjk_textwrap.wrap(text, text_wrap_width)

    # Second pass: ensure each line fits within pixel width
    final_lines = []
    for line in wrapped_text:
        left, top, right, bottom = font.getbbox(line)
        line_width = right - left

        # If line is too wide, break it further
        if line_width > max_text_width:
            words = (
                line.split()
                if language_code not in ["zh-TW", "zh-CN", "ja-JP"]
                else list(line)
            )
            current_line = ""

            for word in words:
                test_line = (
                    current_line
                    + (
                        " "
                        if current_line
                        and language_code not in ["zh-TW", "zh-CN", "ja-JP"]
                        else ""
                    )
                    + word
                )
                left, top, right, bottom = font.getbbox(test_line)
                test_width = right - left

                if test_width <= max_text_width:
                    current_line = test_line
                else:
                    if current_line:
                        final_lines.append(current_line)
                        current_line = word
                    else:
                        # Single word/character is too wide, force it anyway
                        final_lines.append(word)

            if current_line:
                final_lines.append(current_line)
        else:
            final_lines.append(line)

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
