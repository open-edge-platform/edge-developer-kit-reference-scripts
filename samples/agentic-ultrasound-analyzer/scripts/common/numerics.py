# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Numeric safety helpers for model outputs used across the pipeline."""

from __future__ import annotations

import numpy as np


def sanitize_vector(values, dtype=np.float32) -> np.ndarray:
    """Return a finite 1D vector by replacing NaN/Inf and flattening."""
    vec = np.asarray(values, dtype=dtype).reshape(-1)
    return np.nan_to_num(vec, nan=0.0, posinf=0.0, neginf=0.0)


def safe_l2_normalize(values, eps: float = 1e-12) -> np.ndarray:
    """L2-normalize a vector with finite guards and zero-norm protection."""
    vec = sanitize_vector(values)
    norm = float(np.linalg.norm(vec))
    if norm <= eps:
        return np.zeros_like(vec)
    return sanitize_vector(vec / norm)
