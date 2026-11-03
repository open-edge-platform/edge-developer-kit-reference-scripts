# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Reporting a request's model time as ``Server-Timing: inference;dur=<ms>`` for the demos' Live metrics.

Demos prefer it over their own timing, which includes the hop through the app. Background jobs report
a ``perf`` block in their status body instead.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Iterator


def server_timing(inference_seconds: float) -> dict[str, str]:
    """Response headers reporting ``inference_seconds`` of model time."""
    return {"Server-Timing": f"inference;dur={max(0.0, inference_seconds) * 1000:.1f}"}


class Stopwatch:
    """Elapsed wall time of a block, in seconds, read after it ran."""

    seconds: float = 0.0


@contextmanager
def timed() -> Iterator[Stopwatch]:
    """``with timed() as clock: ...`` then ``clock.seconds``."""
    clock = Stopwatch()
    started = time.perf_counter()
    try:
        yield clock
    finally:
        clock.seconds = time.perf_counter() - started
