# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Fast cv2 overlay for the live MJPEG / stream views.

No PIL/TTF so the capture loop stays fast; Hershey fonts can't draw CJK, but the JSON payload
always carries the text.
"""

from __future__ import annotations

from typing import Iterable

import cv2
import numpy as np

_BOX_COLOR = (0, 200, 0)
_TEXT_COLOR = (0, 0, 255)


def draw_regions(
    bgr: np.ndarray,
    regions: Iterable,
    header: str | None = None,
) -> np.ndarray:
    """Draw detection polygons and text onto a copy of ``bgr``.

    ``regions`` items expose ``box`` (4 ``[x, y]`` points or ``None``) and ``text``.
    """
    out = bgr.copy()
    for region in regions:
        box = getattr(region, "box", None)
        text = getattr(region, "text", "") or ""
        if box:
            pts = np.array(box, dtype=np.int32).reshape(-1, 1, 2)
            cv2.polylines(out, [pts], True, _BOX_COLOR, 2)
            x, y = int(box[0][0]), int(box[0][1])
            cv2.putText(
                out,
                text[:40],
                (x, max(y - 6, 12)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                _TEXT_COLOR,
                1,
                cv2.LINE_AA,
            )

    if header:
        cv2.putText(
            out,
            header,
            (12, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            _TEXT_COLOR,
            2,
            cv2.LINE_AA,
        )
    return out
