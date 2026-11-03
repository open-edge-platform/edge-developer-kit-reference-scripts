# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Demo Studio plugins registered next to the upstream ones.

``HuggingFaceDownloader`` replaces the upstream HuggingFace plugin under the same name, adding
partial downloads, single-file fetches (with ``progress``) and an explicit ``local_dir``; without
those keyword arguments it behaves exactly like upstream.
"""

from __future__ import annotations

import inspect
import logging
import os
from typing import Any, Callable

from .._locks import download_lock_path, model_lock
from ._upstream import bootstrap

bootstrap()

from src.core.interfaces import ModelDownloadPlugin  # noqa: E402
from src.plugins.huggingface_plugin import HuggingFacePlugin  # noqa: E402

logger = logging.getLogger("model_downloader.oep")


def _hub_dir(output_dir: str, hub: str, model_name: str) -> str:
    """Upstream's default layout: ``<output_dir>/<hub>/<owner>_<repo>``."""
    return os.path.join(output_dir, hub, model_name.replace("/", "_"))


def _progress_bars(progress: Callable[[int, int | None], None]) -> type:
    """A ``tqdm_class`` for ``hf_hub_download`` that hands its byte counts to ``progress``.

    A Xet download opens two bars (received, and written, which only moves at the end), so the
    furthest bar is what has arrived. The size is the first opening total: Xet grows it as it goes.
    """
    bars: list[Any] = []
    size: list[int | None] = [None]

    class _Bar:
        def __init__(self, *_args: Any, total: int | None = None, initial: int = 0, **_kwargs: Any) -> None:
            self.total, self.n = total, initial
            size[0] = size[0] or total
            bars.append(self)

        def update(self, n: int = 1) -> None:
            self.n += n
            progress(max(bar.n for bar in bars), size[0])

        def set_postfix_str(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        def refresh(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        def close(self) -> None:
            pass

        def __enter__(self) -> "_Bar":
            return self

        def __exit__(self, *_exc: Any) -> None:
            return None

    return _Bar


class HuggingFaceDownloader(HuggingFacePlugin):
    """Upstream HuggingFace plugin plus partial/single-file/explicit-dir downloads."""

    _EXTENDED_KWARGS = ("local_dir", "allow_patterns", "ignore_patterns", "filename")

    def download(self, model_name: str, output_dir: str, **kwargs: Any) -> dict:
        if not any(kwargs.get(key) for key in self._EXTENDED_KWARGS):
            return super().download(model_name, output_dir, **kwargs)

        from huggingface_hub import hf_hub_download, snapshot_download

        resolved_config = kwargs.get("resolved_config") or {}
        token = (
            resolved_config.get("HF_TOKEN")
            or kwargs.get("token")
            or kwargs.get("hf_token")
            or os.environ.get("HF_TOKEN")
            or None
        )
        revision = kwargs.get("revision")
        dest = kwargs.get("local_dir") or _hub_dir(output_dir, "huggingface", model_name)

        # Same pre-flight as upstream: a gated/private repo otherwise surfaces
        # as a misleading "check your internet connection" error.
        self._check_access(model_name, token)
        os.makedirs(dest, exist_ok=True)
        kwargs.get("_model_download_dir", []).append(dest)

        filename = kwargs.get("filename")
        # huggingface_hub checks `local_dir` before taking its own lock, then re-fetches under it,
        # deleting a file another process may be reading. So one fetch per folder at a time; a
        # waiter then finds the files already there.
        with model_lock(download_lock_path(dest)):
            if filename:
                logger.info("Downloading %s:%s from Hugging Face to %s", model_name, filename, dest)
                progress = kwargs.get("progress")
                # hf_hub_download takes tqdm_class from huggingface_hub 1.x on; the
                # export venvs that pin 0.x get the file without progress.
                extra: dict[str, Any] = {}
                if progress and "tqdm_class" in inspect.signature(hf_hub_download).parameters:
                    extra["tqdm_class"] = _progress_bars(progress)
                path = hf_hub_download(
                    repo_id=model_name,
                    filename=filename,
                    local_dir=dest,
                    revision=revision,
                    token=token,
                    **extra,
                )
            else:
                logger.info("Downloading %s from Hugging Face to %s", model_name, dest)
                path = snapshot_download(
                    repo_id=model_name,
                    local_dir=dest,
                    revision=revision,
                    token=token,
                    allow_patterns=kwargs.get("allow_patterns"),
                    ignore_patterns=kwargs.get("ignore_patterns"),
                )

        return {
            "model_name": model_name,
            "source": "huggingface",
            "download_path": dest,
            "local_path": str(path),
            "success": True,
        }


DEMO_STUDIO_PLUGINS: tuple[type[ModelDownloadPlugin], ...] = (HuggingFaceDownloader,)
