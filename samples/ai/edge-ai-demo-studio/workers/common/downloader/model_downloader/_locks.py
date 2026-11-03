# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Cross-process model locks, through ``worker_common``.

Instances of a service share one models directory, so ``shared_model_lock`` makes a second
fetch or conversion of the same model wait. ``worker-common`` is not a dependency, so the import
is lazy and the lock is a no-op without it (this package's tests, callers outside the workspace).
"""

from __future__ import annotations

import contextlib
import os
from typing import ContextManager

__all__ = ["download_lock_path", "model_lock"]


def model_lock(path: str | os.PathLike[str]) -> ContextManager[None]:
    """``worker_common.shared_model_lock(path)``, or a no-op without it."""
    try:
        from worker_common import shared_model_lock
    except ImportError:
        return contextlib.nullcontext()
    return shared_model_lock(path)


def download_lock_path(dest: str | os.PathLike[str]) -> str:
    """The lock a hub fetch into ``dest`` holds.

    Under ``dest/.cache``, beside huggingface_hub's own bookkeeping, so nothing listing a models
    directory takes it for a model.
    """
    return os.path.join(os.fspath(dest), ".cache", "edge-ai-studio", "download")
