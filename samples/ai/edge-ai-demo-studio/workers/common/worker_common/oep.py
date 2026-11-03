# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Helpers for workers that wrap an Open Edge Platform (OEP) microservice from edge-ai-libraries.

``workers/oep-setup.sh`` copies the microservice, at the pinned tag, into the worker's ``thirdparty/<name>/``;
the wrapper imports upstream's app unmodified and adds the worker contract through upstream's configuration.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from worker_common.instance import async_shared_model_lock
from worker_common.paths import workers_root

#: The catalogue of OEP microservices, next to oep-setup.sh.
CATALOG_JSON_NAME = "oep-services.json"
#: Overrides the pinned tag for one run, in step with workers/oep-setup.sh.
REF_ENV = "EDGE_AI_LIBRARIES_REF"
#: Written by oep-setup.sh into every copy with the tag it was made from.
REF_FILE_NAME = ".demo-studio-edge-ai-libraries-ref"


def catalog_path() -> Path:
    return workers_root() / CATALOG_JSON_NAME


def _catalog() -> dict[str, Any]:
    try:
        with catalog_path().open(encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def catalog_entry(worker: str) -> dict[str, Any] | None:
    """The catalogue record whose ``worker`` is ``worker`` (a dir under workers/)."""
    wanted = worker.strip("/")
    for svc in _catalog().get("services", []):
        if str(svc.get("worker", "")).strip("/") == wanted:
            return svc
    return None


def pinned_tag(worker: str) -> str:
    """Release tag of edge-ai-libraries the worker is pinned to, read as ``workers/oep-setup.sh`` does.

    ``EDGE_AI_LIBRARIES_REF``, else the entry's ``tag``, else the catalogue's; ``"unknown"`` if unreadable.
    """
    override = os.environ.get(REF_ENV, "").strip()
    if override:
        return override
    entry = catalog_entry(worker)
    if entry and entry.get("tag"):
        return str(entry["tag"])
    return str(_catalog().get("tag") or "unknown")


def upstream_app_dir(worker_dir: Path, worker: str) -> Path:
    """The upstream microservice's directory for ``worker``; mirrors ``oep_load_record`` in oep-setup.sh."""
    entry = catalog_entry(worker)
    if entry is None:
        raise RuntimeError(
            f"{worker!r} is not in {catalog_path()}; "
            "add it to the catalogue so oep-setup.sh can fetch it."
        )
    home_env = entry.get("home_env")
    if home_env and os.environ.get(home_env):
        return Path(os.environ[home_env]).expanduser().resolve()
    configured = entry.get("dir")
    if configured:
        path = Path(configured)
        return (path if path.is_absolute() else worker_dir / path).resolve()
    name = str(entry.get("name") or "").strip() or Path(str(entry.get("subdir", "")).strip("/")).name
    return worker_dir / "thirdparty" / name


def checked_out_tag(app_dir: Path) -> str | None:
    """Tag the copy at ``app_dir`` was made from, or None without a marker (usual under ``home_env``)."""
    try:
        return (app_dir / REF_FILE_NAME).read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def utf8_console() -> None:
    """Windows consoles default to cp1252 and upstream logs plenty of Unicode."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def load_upstream_main(app_dir: Path, module_name: str, entry: str = "main.py"):
    """Import upstream's entrypoint by path under ``module_name``, so it cannot collide with ``main``.

    Upstream imports its modules as top-level packages and resolves config relative to its directory (the
    container's WORKDIR), so ``app_dir`` goes first on ``sys.path`` and becomes the working directory.
    """
    entry_path = app_dir / entry
    if not entry_path.is_file():
        raise FileNotFoundError(
            f"OEP upstream source not found at {app_dir}. Run the worker's "
            "start script (or start the service from the app) so "
            "workers/oep-setup.sh fetches it at the pinned tag."
        )
    sys.path.insert(0, str(app_dir))
    os.chdir(app_dir)
    spec = importlib.util.spec_from_file_location(module_name, entry_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {entry_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def enter_upstream_dir(app_dir: Path, sentinel: str) -> None:
    """Make an upstream *package* importable (``import src.app``) and run from its dir."""
    if not (app_dir / sentinel).is_file():
        raise FileNotFoundError(
            f"OEP upstream source not found at {app_dir}. Run the worker's "
            "start script (or start the service from the app) so "
            "workers/oep-setup.sh fetches it at the pinned tag."
        )
    sys.path.insert(0, str(app_dir))
    os.chdir(app_dir)


def redirect_storage_root(path: str | os.PathLike[str]) -> None:
    """Point upstream's session storage (``utils/app_paths.STORAGE_ROOT``) at ``path``.

    Upstream keeps session folders under the copy every instance shares and clears them on startup. Its
    readers look the global up at call time, so setting it after ``load_upstream_main`` and before the
    app starts gives each instance its own folder.
    """
    importlib.import_module("utils.app_paths").STORAGE_ROOT = os.fspath(path)


@dataclass
class UpstreamState:
    """Readiness of the wrapped upstream app, flipped by ``wrap_lifespan``."""

    ready: bool = False
    error: str | None = None
    startup_seconds: float | None = None


def wrap_lifespan(
    app: Any,
    state: UpstreamState,
    logger: Any,
    describe: str,
    model_lock: str | os.PathLike[str] | None = None,
) -> None:
    """Flip ``state.ready`` once upstream's lifespan, where its export and warm-up run, has started.

    Upstream checks for an existing export without a lock, so with ``model_lock`` it starts under
    :func:`shared_model_lock` and a sibling waits, then finds the export done. The lock is released once
    upstream has started.
    """
    original = app.router.lifespan_context

    @asynccontextmanager
    async def _lifespan(scoped_app):
        started = time.monotonic()
        try:
            async with AsyncExitStack() as upstream:
                if model_lock is None:
                    await upstream.enter_async_context(original(scoped_app))
                else:
                    async with async_shared_model_lock(model_lock):
                        await upstream.enter_async_context(original(scoped_app))
                state.startup_seconds = round(time.monotonic() - started, 2)
                state.ready = True
                state.error = None
                logger.info("upstream %s ready in %ss", describe, state.startup_seconds)
                yield
        except Exception as exc:  # noqa: BLE001 - surfaced through /healthcheck
            state.error = f"{type(exc).__name__}: {exc}"
            logger.error("upstream startup failed: %s", exc, exc_info=True)
            raise
        finally:
            state.ready = False

    app.router.lifespan_context = _lifespan


def failed_app(title: str, state: UpstreamState, exc: BaseException, logger: Any):
    """A minimal app whose /healthcheck reports why upstream did not import.

    Dying at import would leave the frontend polling a dead port for the whole startup budget.
    """
    from fastapi import FastAPI

    logger.error("failed to import upstream for %s: %s", title, exc, exc_info=True)
    state.error = f"{type(exc).__name__}: {exc}"
    return FastAPI(title=f"{title} (failed to load)")


def install_healthcheck(app: Any, state: UpstreamState, info: Callable[[], dict[str, Any]]) -> None:
    """Add ``GET /healthcheck``: 503 until ready, then 200; ``info()``'s fields plus readiness and error."""
    from fastapi.responses import JSONResponse

    def healthcheck() -> JSONResponse:
        ready = bool(state.ready)
        body: dict[str, Any] = {"status": "ok" if ready else "starting", **info()}
        body["model_loaded"] = ready
        if state.startup_seconds is not None:
            body["startup_seconds"] = state.startup_seconds
        if state.error:
            body["status"] = "error"
            body["error"] = state.error
        return JSONResponse(body, status_code=200 if ready else 503)

    app.add_api_route("/healthcheck", healthcheck, methods=["GET"], include_in_schema=False)
