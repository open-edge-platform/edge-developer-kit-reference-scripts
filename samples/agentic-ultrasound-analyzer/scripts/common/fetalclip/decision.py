# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Lightweight decision helpers for FetalCLIP-driven prompt gating."""

import math
from typing import Any


def safe_float(value: Any, default: float = 0.0) -> float:
    """Return float(value) when possible, otherwise default."""
    try:
        out = float(value)
        return out if math.isfinite(out) else default
    except (TypeError, ValueError):
        return default


def should_use_enriched_prompt(classification: dict | None, min_confidence: float = 0.6) -> bool:
    """Gate enriched prompt usage on classification presence and confidence threshold."""
    if not classification:
        return False
    return safe_float(classification.get("plane_confidence"), 0.0) >= min_confidence
