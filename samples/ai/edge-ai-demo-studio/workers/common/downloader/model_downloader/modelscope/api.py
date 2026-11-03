# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Snapshot and single-file downloads from ModelScope, through its SDK.

The OEP model-download microservice has no ModelScope plugin, so nothing here needs the upstream
checkout. The SDK (this package's ``modelscope`` extra) is imported lazily.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Iterable

from ..errors import ModelDownloadError

__all__ = ["file", "snapshot"]

logger = logging.getLogger("model_downloader.modelscope")


def _sdk():
    try:
        from modelscope import snapshot_download
        from modelscope.hub.file_download import model_file_download
    except ImportError as exc:
        raise ModelDownloadError(
            "modelscope is not installed in this worker's environment; add "
            "'modelscope' to its pyproject dependencies to use source=modelscope"
        ) from exc

    # Pin the endpoint: multi-endpoint discovery in recent modelscope releases can answer 405.
    # Older releases (and the workers' start scripts) read MODELSCOPE_DOMAIN instead.
    os.environ.setdefault("MODELSCOPE_ENDPOINT", "https://www.modelscope.cn")
    os.environ.setdefault("MODELSCOPE_DOMAIN", "www.modelscope.cn")
    return snapshot_download, model_file_download


def snapshot(
    repo_id: str,
    local_dir: str | os.PathLike[str],
    *,
    allow_patterns: Iterable[str] | None = None,
    ignore_patterns: Iterable[str] | None = None,
    revision: str | None = None,
) -> Path:
    """Mirror a ModelScope repository (or the files matching ``allow_patterns``) into ``local_dir``."""
    snapshot_download, _ = _sdk()
    dest = Path(local_dir)
    dest.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading %s from ModelScope to %s", repo_id, dest)
    try:
        path = snapshot_download(
            repo_id,
            revision=revision,
            local_dir=str(dest),
            allow_patterns=list(allow_patterns) if allow_patterns else None,
            ignore_patterns=list(ignore_patterns) if ignore_patterns else None,
        )
    except Exception as exc:  # noqa: BLE001 - normalise every SDK failure
        raise ModelDownloadError(f"modelscope:{repo_id}: {exc}") from exc
    return Path(path or dest)


def file(
    repo_id: str,
    filename: str,
    local_dir: str | os.PathLike[str],
    *,
    revision: str | None = None,
) -> Path:
    """Fetch one file from a ModelScope repository into ``local_dir/<filename>``."""
    _, model_file_download = _sdk()
    dest = Path(local_dir)
    dest.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading %s:%s from ModelScope to %s", repo_id, filename, dest)
    try:
        path = model_file_download(
            model_id=repo_id,
            file_path=filename,
            revision=revision,
            local_dir=str(dest),
        )
    except Exception as exc:  # noqa: BLE001 - normalise every SDK failure
        raise ModelDownloadError(f"modelscope:{repo_id}:{filename}: {exc}") from exc
    return Path(path or dest / filename)


def file_size(repo_id: str, filename: str, *, revision: str | None = None) -> int | None:
    """Size in bytes of one file of a ModelScope repository, or None when unknown."""
    try:
        from modelscope.hub.api import HubApi

        for entry in HubApi().get_model_files(repo_id, revision=revision, recursive=True) or []:
            if entry.get("Path") == filename:
                size = entry.get("Size")
                return int(size) if size is not None else None
    except Exception:  # noqa: BLE001 - best effort by design
        pass
    return None
