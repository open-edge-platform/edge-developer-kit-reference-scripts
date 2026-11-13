# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Vector safety helpers before Milvus insertion."""

from __future__ import annotations

import numpy as np

from common.numerics import sanitize_vector


def prepare_embedding_for_milvus(embedding) -> tuple[list[float], bool]:
    """Return finite embedding list and whether non-finite values were present."""
    raw = np.asarray(embedding, dtype=np.float32).reshape(-1)
    if raw.size == 0:
        raise ValueError("Embedding is empty; skipping Milvus insert")
    had_non_finite = not np.isfinite(raw).all()
    clean = sanitize_vector(raw)
    return clean.tolist(), had_non_finite
