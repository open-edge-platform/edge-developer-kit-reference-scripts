# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Calls into the upstream plugin registry.

Everything funnels through :func:`download`, which resolves a plugin the way the upstream service
does and runs it in the calling thread. :func:`snapshot` and :func:`file` are the Hugging Face shapes.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import threading
from pathlib import Path
from typing import Any, Callable, Iterable

from ..errors import ModelDownloadError
from ._upstream import bootstrap

__all__ = ["download", "file", "manager", "registry", "snapshot"]

_registry = None
_registry_lock = threading.Lock()


def registry():
    """The process-wide ``PluginRegistry``: upstream plugins plus Demo Studio's."""
    global _registry
    with _registry_lock:
        if _registry is None:
            bootstrap()
            import src.plugins as upstream_plugins
            from src.core.plugin_registry import PluginRegistry

            from .plugins import DEMO_STUDIO_PLUGINS

            reg = PluginRegistry()
            reg.discover_plugins(upstream_plugins)
            for plugin_cls in DEMO_STUDIO_PLUGINS:
                plugin = plugin_cls()
                # Same name as an upstream plugin replaces it (HuggingFace).
                reg.plugins.setdefault(plugin.plugin_type, {})[plugin.plugin_name] = plugin
            _registry = reg
        return _registry


def manager(default_dir: str | os.PathLike[str] | None = None):
    """An upstream ``ModelManager`` over the shared registry, for job-style use."""
    bootstrap()
    from src.core.model_manager import ModelManager

    return ModelManager(registry(), default_dir=str(default_dir or Path("models")))


def _run(func, *args: Any, **kwargs: Any) -> Any:
    """Call a plugin method that may be sync or async, from any context."""
    if not inspect.iscoroutinefunction(func):
        return func(*args, **kwargs)
    coro = func(*args, **kwargs)
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    # Called from inside an event loop (a FastAPI lifespan, say): block on a
    # private loop in a helper thread rather than nesting loops.
    box: dict[str, Any] = {}

    def _worker() -> None:
        try:
            box["result"] = asyncio.run(coro)
        except BaseException as exc:  # noqa: BLE001 - re-raised below
            box["error"] = exc

    thread = threading.Thread(target=_worker, name="model-downloader-oep", daemon=True)
    thread.start()
    thread.join()
    if "error" in box:
        raise box["error"]
    return box["result"]


def download(name: str, hub: str, output_dir: str | os.PathLike[str] | None = None, **kwargs: Any) -> dict:
    """Download ``name`` from ``hub`` and return the plugin's result dict.

    ``hub`` is ``huggingface`` or any hub ``ENABLED_PLUGINS`` adds. Extra keyword arguments go to the
    plugin unchanged (see :mod:`.plugins` for the ones Demo Studio adds).
    """
    hub = hub.lower()
    reg = registry()
    plugin = reg.find_plugin_for_model("downloader", name, hub, **kwargs)
    if plugin is None:
        available = ", ".join(reg.supported_hubs()) or "(none)"
        raise ModelDownloadError(
            f"no downloader plugin handles hub {hub!r} (available: {available}); "
            f"set ENABLED_PLUGINS to widen the upstream set"
        )

    overrides = kwargs.pop("override_credentials", None) or {}
    try:
        kwargs["resolved_config"] = plugin.resolve_config(overrides, hub=hub)
    except ValueError as exc:
        raise ModelDownloadError(str(exc)) from exc
    kwargs.setdefault("hub", hub)
    kwargs.setdefault("_model_download_dir", [])

    out_dir = str(output_dir) if output_dir is not None else str(Path("models"))
    try:
        result = _run(plugin.download, name, out_dir, **kwargs)
    except ModelDownloadError:
        raise
    except Exception as exc:  # noqa: BLE001 - normalise every plugin failure
        raise ModelDownloadError(f"{hub}:{name}: {exc}") from exc

    if isinstance(result, dict) and result.get("success") is False:
        raise ModelDownloadError(f"{hub}:{name}: {result.get('error', 'download failed')}")
    return result if isinstance(result, dict) else {"success": True, "details": result}


def snapshot(
    repo_id: str,
    local_dir: str | os.PathLike[str],
    *,
    allow_patterns: Iterable[str] | None = None,
    ignore_patterns: Iterable[str] | None = None,
    revision: str | None = None,
    token: str | None = None,
) -> Path:
    """Mirror a Hugging Face repository (or the files matching ``allow_patterns``) into ``local_dir``."""
    local_dir = Path(local_dir)
    result = download(
        repo_id,
        "huggingface",
        output_dir=local_dir.parent,
        local_dir=str(local_dir),
        allow_patterns=list(allow_patterns) if allow_patterns else None,
        ignore_patterns=list(ignore_patterns) if ignore_patterns else None,
        revision=revision,
        token=token,
    )
    return Path(result.get("local_path") or local_dir)


def file(
    repo_id: str,
    filename: str,
    local_dir: str | os.PathLike[str],
    *,
    revision: str | None = None,
    token: str | None = None,
    progress: Callable[[int, int | None], None] | None = None,
) -> Path:
    """Fetch one file from a Hugging Face repository into ``local_dir/<filename>``."""
    local_dir = Path(local_dir)
    result = download(
        repo_id,
        "huggingface",
        output_dir=local_dir.parent,
        local_dir=str(local_dir),
        filename=filename,
        revision=revision,
        token=token,
        progress=progress,
    )
    return Path(result.get("local_path") or local_dir / filename)
