# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Startup reports for the app's startup panel, through ``worker_common.startup``.

Fetches report Downloading (with byte progress when the size is known) or Preparing, and a short
failure summary. ``worker-common`` is not a dependency, so the import is lazy and every report is
a no-op without it.
"""

from __future__ import annotations

import re
import urllib.error
from typing import Any, Callable

__all__ = ["download_reason", "hub_reason", "startup_stage"]


class _NoStage:
    """Stands in for ``worker_common.startup``'s stage handle."""

    def __enter__(self) -> "_NoStage":
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False

    def progress(self, current: float, total: float | None = None, unit: str = "bytes") -> None:
        pass

    def fail(self, summary: str) -> None:
        pass


def startup_stage(stage: str, detail: str | None = None, *, failure: Callable[[Exception], str] | None = None):
    """``worker_common.startup.startup_stage``, or a no-op without it."""
    try:
        from worker_common.startup import startup_stage as stage_block
    except ImportError:
        return _NoStage()
    return stage_block(stage, detail, failure=failure)


def download_reason(exc: BaseException) -> str:
    """Why a plain HTTPS fetch failed, in a few safe words."""
    cause = exc.__cause__ or exc
    if isinstance(cause, urllib.error.HTTPError):
        return f"HTTP {cause.code}"
    if isinstance(cause, urllib.error.URLError):
        return f"network error ({cause.reason})"
    if "sha256 mismatch" in str(exc):
        return "the file did not match its checksum"
    if isinstance(cause, OSError):
        return cause.strerror or type(cause).__name__
    return type(cause).__name__


def hub_reason(exc: BaseException) -> str:
    """Why a hub fetch failed, by kind -- hub errors are long and may echo
    request ids or URLs, so only the kind is shown."""
    text = f"{exc} {exc.__cause__ or ''}"
    if re.search(r"\b(401|403)\b|gated|private|unauthori[sz]ed|forbidden", text, re.IGNORECASE):
        return "access was denied; the model may be gated or need a Hugging Face token"
    if re.search(r"\b404\b|not found|RepositoryNotFound|EntryNotFound|RevisionNotFound", text, re.IGNORECASE):
        return "the model or file was not found"
    if re.search(r"\b429\b|too many requests", text, re.IGNORECASE):
        return "the hub is limiting requests; try again later or use a Hugging Face token"
    # Name-resolution wording only: hub file URLs contain /resolve/.
    if re.search(
        r"connection|timed? ?out|name resolution|failed to resolve|name or service not known"
        r"|nodename nor servname|getaddrinfo|network|offline|unreachable",
        text,
        re.IGNORECASE,
    ):
        return "the network request failed"
    if re.search(r"modelscope is not installed", text, re.IGNORECASE):
        return "ModelScope support is not installed for this worker"
    return type(exc.__cause__ or exc).__name__
