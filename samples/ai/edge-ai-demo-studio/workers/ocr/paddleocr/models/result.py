# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Common OCR result types returned by every model implementation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class OCRRegion:
    """One recognised text region.

    ``box`` is a list of four ``[x, y]`` corner points (clockwise from
    top-left) in pixel coordinates, or ``None`` for models that return text
    without explicit geometry (e.g. the VL model in plain-OCR mode).
    """

    text: str
    confidence: float
    box: list[list[int]] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "confidence": round(float(self.confidence), 4),
            "box": self.box,
        }


@dataclass
class OCRResult:
    """The full result of an OCR pass over a single image."""

    model: str
    regions: list[OCRRegion] = field(default_factory=list)
    full_text: str = ""
    elapsed_ms: float = 0.0
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "full_text": self.full_text,
            "regions": [r.to_dict() for r in self.regions],
            "num_regions": len(self.regions),
            "elapsed_ms": round(self.elapsed_ms, 1),
            "extra": self.extra,
        }
