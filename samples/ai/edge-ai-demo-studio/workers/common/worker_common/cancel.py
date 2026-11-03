# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Cancelling a background job, with ``DELETE`` on its status path.

A queued job is dropped at once; a running one stops at its next safe point, where
``CancelToken.check()`` raises ``JobCancelled``; a finished one is left alone. ``cancelled`` is a final
status with no ``perf`` block, so Live metrics do not count it.
"""

from __future__ import annotations

import threading

#: The final status of a cancelled job, the same on every worker.
CANCELLED = "cancelled"


class JobCancelled(Exception):
    """Raised at a safe point of a job whose cancellation was requested."""


class CancelToken:
    """A cancellation request, set from a request handler and checked by the job's thread."""

    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def check(self) -> None:
        """Raises ``JobCancelled`` once cancellation has been requested."""
        if self._event.is_set():
            raise JobCancelled()
