# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Worker-facing hub fetches, dispatched on ``source``.

Hugging Face goes through the OEP model-download microservice (:mod:`.oep`), ModelScope through
its SDK (:mod:`.modelscope`). Existing files are reused, so calling these on every start is intended.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable, Iterable

from ._startup import hub_reason, startup_stage
from .sources import Source, normalize_source

__all__ = ["fetch_file", "fetch_snapshot", "file_size"]


def _hub_failure(what: str):
    """The startup failure summary of a hub fetch of ``what``."""
    return lambda exc: f"Could not download {what}: {hub_reason(exc)}"


def fetch_snapshot(
    repo_id: str,
    local_dir: str | os.PathLike[str],
    *,
    source: Any = Source.HUGGINGFACE,
    allow_patterns: Iterable[str] | None = None,
    ignore_patterns: Iterable[str] | None = None,
    revision: str | None = None,
    token: str | None = None,
) -> Path:
    """Mirror a hub repository (or the files matching ``allow_patterns``) into ``local_dir``.

    Reported to the app's startup panel as Downloading ``repo_id``, without
    progress: the hub clients do not say how much is left.
    """
    with startup_stage("downloading", repo_id, failure=_hub_failure(repo_id)):
        if normalize_source(source) is Source.MODELSCOPE:
            from . import modelscope

            return modelscope.snapshot(
                repo_id, local_dir,
                allow_patterns=allow_patterns, ignore_patterns=ignore_patterns, revision=revision,
            )
        from . import oep

        return oep.snapshot(
            repo_id, local_dir,
            allow_patterns=allow_patterns, ignore_patterns=ignore_patterns, revision=revision, token=token,
        )


def fetch_file(
    repo_id: str,
    filename: str,
    local_dir: str | os.PathLike[str],
    *,
    source: Any = Source.HUGGINGFACE,
    revision: str | None = None,
    token: str | None = None,
    progress: Callable[[int, int | None], None] | None = None,
) -> Path:
    """Fetch one file from a hub repository into ``local_dir/<filename>``.

    ``progress(received, size_or_None)`` is called as the download runs, for Hugging Face only: its
    Xet transfers leave the file on disk empty until they finish, so the file size cannot stand in.
    """
    name = os.path.basename(filename) or filename
    with startup_stage("downloading", name, failure=_hub_failure(name)):
        if normalize_source(source) is Source.MODELSCOPE:
            from . import modelscope

            return modelscope.file(repo_id, filename, local_dir, revision=revision)
        from . import oep

        return oep.file(repo_id, filename, local_dir, revision=revision, token=token, progress=progress)


def file_size(
    repo_id: str,
    filename: str,
    *,
    source: Any = Source.HUGGINGFACE,
    revision: str | None = None,
    token: str | None = None,
) -> int | None:
    """Size in bytes of one hub file without downloading it, or None when unknown.

    What a progress bar needs before :func:`fetch_file` starts. Never raises:
    a hub that cannot be asked (offline, gated repo, ModelScope) yields None
    and the caller shows an indeterminate progress instead.
    """
    if normalize_source(source) is Source.MODELSCOPE:
        from . import modelscope

        return modelscope.file_size(repo_id, filename, revision=revision)
    try:
        from huggingface_hub import get_hf_file_metadata, hf_hub_url

        url = hf_hub_url(repo_id=repo_id, filename=filename, revision=revision)
        return get_hf_file_metadata(url=url, token=token).size
    except Exception:  # noqa: BLE001 - best effort by design
        return None
