# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Locate, verify and import the upstream OEP ``model-download`` source.

``workers/oep-setup.sh`` (``.ps1`` on Windows) copies ``microservices/model-download`` of
edge-ai-libraries, at the tag pinned in ``workers/oep-services.json``, into this package's
gitignored ``thirdparty/model-download``. This module puts the copy on ``sys.path`` so upstream's
``src`` package imports unchanged, defaults ``ENABLED_PLUGINS`` to ``huggingface`` (other plugins
need dependencies no worker installs) and swaps ``src.utils.logging`` for a stdlib adapter.
Nothing in the copy is modified.
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import subprocess  # nosec B404 - oep-setup is invoked with a fixed argument list
import sys
import threading
from pathlib import Path

from ..errors import UpstreamMissingError
from ._logging import make_logging_module

logger = logging.getLogger("model_downloader.oep")

UPSTREAM_REPO = "https://github.com/open-edge-platform/edge-ai-libraries.git"
UPSTREAM_SUBDIR = "microservices/model-download"
#: Name of this package's entry in ``workers/oep-services.json``.
CATALOG_WORKER = "common/downloader"

#: Names a directory already holding the microservice (used as is, never
#: fetched) instead of ``common/downloader/thirdparty/model-download``.
HOME_ENV = "OEP_MODEL_DOWNLOAD_HOME"
#: ``0`` disables fetching on demand when the copy is missing.
AUTO_CLONE_ENV = "OEP_MODEL_DOWNLOAD_AUTO_CLONE"
#: Overrides the pinned tag for one run, in step with ``workers/oep-setup.sh``.
REF_ENV = "EDGE_AI_LIBRARIES_REF"
#: Written by oep-setup.sh into the copy with the tag it was made from.
REF_FILE_NAME = ".demo-studio-edge-ai-libraries-ref"

#: ``workers/common/downloader`` -- the catalogue's ``worker`` directory, under
#: which oep-setup makes the copy (``thirdparty/<name>``, the default ``dir``).
PACKAGE_DIR = Path(__file__).resolve().parents[2]

# Present only at workers/ (the sentinel worker_common.paths uses). Found without importing
# worker_common: this package is also installed by path into the excluded workers and kokoro's
# export virtualenv, where that library is unavailable.
_WORKERS_SENTINEL = Path("scripts") / "worker-common.sh"


def _workers_root() -> Path:
    here = PACKAGE_DIR
    for candidate in (here, *here.parents):
        if (candidate / _WORKERS_SENTINEL).is_file():
            return candidate
    raise RuntimeError(
        f"Could not locate the workers/ root above {here}: no {_WORKERS_SENTINEL.as_posix()} found."
    )


_WORKERS_ROOT = _workers_root()
#: The catalogue: pinned tag plus one record per OEP microservice.
CATALOG_JSON = _WORKERS_ROOT / "oep-services.json"
#: The scripts that fetch what the catalogue lists.
CATALOG_SH = _WORKERS_ROOT / "oep-setup.sh"
CATALOG_PS1 = _WORKERS_ROOT / "oep-setup.ps1"

_lock = threading.Lock()
_bootstrapped = False


def upstream_tag() -> str:
    """Release tag of edge-ai-libraries this adapter is pinned to.

    ``"tag"`` in ``workers/oep-services.json`` is the pin (a per-service
    ``"tag"`` on this package's entry wins over it); ``EDGE_AI_LIBRARIES_REF``
    overrides both for one run, the same way ``workers/oep-setup.sh`` reads it.
    """
    override = os.environ.get(REF_ENV, "").strip()
    if override:
        return override
    with CATALOG_JSON.open(encoding="utf-8") as fh:
        doc = json.load(fh)
    for svc in doc.get("services", []):
        if svc.get("worker") == CATALOG_WORKER and svc.get("tag"):
            return str(svc["tag"])
    tag = str(doc.get("tag", "")).strip()
    if not tag:
        raise UpstreamMissingError(f'"tag" not found in {CATALOG_JSON}')
    return tag


def upstream_root() -> Path:
    """Root of the upstream ``model-download`` microservice (contains ``src/``).

    ``OEP_MODEL_DOWNLOAD_HOME`` wins when set; otherwise the copy oep-setup
    makes at ``common/downloader/thirdparty/model-download`` (the catalogue's
    default ``dir`` for this package's entry).
    """
    override = os.environ.get(HOME_ENV)
    if override:
        return Path(override).expanduser().resolve()
    return PACKAGE_DIR / "thirdparty" / "model-download"


def _is_checkout(path: Path) -> bool:
    return (path / "src" / "core" / "plugin_registry.py").is_file()


def checked_out_tag(path: Path | None = None) -> str | None:
    """Tag the copy was made from, or ``None`` when it carries no marker."""
    path = path or upstream_root()
    try:
        return (path / REF_FILE_NAME).read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def _setup_command(action: str, worker: str) -> list[str]:
    """Command line that runs ``oep-setup`` on this platform."""
    if os.name == "nt":
        return [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", str(CATALOG_PS1), "-Mode", action, "-Target", worker,
        ]
    return ["bash", str(CATALOG_SH), action, worker]


def clone_upstream(tag: str | None = None) -> Path:
    """Fetch ``microservices/model-download`` through ``workers/oep-setup.sh``.

    The script owns the fetch logic and resolves the destination as this module does; running it
    here lets a worker recover when setup has not fetched it. ``tag`` goes through the script's
    ``EDGE_AI_LIBRARIES_REF`` override.
    """
    env = dict(os.environ)
    if tag:
        env[REF_ENV] = tag
    if not CATALOG_SH.is_file():
        raise UpstreamMissingError(f"{CATALOG_SH} not found; cannot fetch the OEP model-download microservice")
    logger.info("Fetching %s via %s", UPSTREAM_SUBDIR, CATALOG_SH.name)
    subprocess.run(  # nosec B603
        _setup_command("fetch", CATALOG_WORKER),
        check=True,
        timeout=900,
        env=env,
    )
    root = upstream_root()
    if not _is_checkout(root):
        raise UpstreamMissingError(
            f"{CATALOG_SH.name} fetch {CATALOG_WORKER} did not produce {UPSTREAM_SUBDIR}/src at {root}"
        )
    return root


def ensure_upstream() -> Path:
    """Return the upstream root, cloning it first if it is missing."""
    root = upstream_root()
    if _is_checkout(root):
        return root

    auto = os.environ.get(AUTO_CLONE_ENV, "1").strip().lower() not in {"0", "false", "no"}
    if not auto:
        raise UpstreamMissingError(
            f"OEP model-download source not found at {root}. "
            f"Run workers/setup.sh (or set {HOME_ENV})."
        )
    logger.warning(
        "OEP model-download source not found at %s; fetching it now. "
        "Run workers/setup.sh (or workers/oep-setup.sh fetch %s) to do this ahead of time.",
        root,
        CATALOG_WORKER,
    )
    try:
        clone_upstream()
    except (subprocess.SubprocessError, OSError) as exc:
        raise UpstreamMissingError(
            f"could not fetch {UPSTREAM_REPO}@{upstream_tag()}: {exc}. "
            f"Run workers/setup.sh, or set {HOME_ENV} to a directory holding the microservice."
        ) from exc
    return upstream_root()


def bootstrap() -> Path:
    """Make the upstream ``src`` package importable. Idempotent, thread-safe."""
    global _bootstrapped
    with _lock:
        if _bootstrapped:
            return upstream_root()

        root = ensure_upstream()

        existing = sys.modules.get("src")
        if existing is not None:
            existing_file = getattr(existing, "__file__", None) or ""
            if not str(Path(existing_file).resolve()).startswith(str(root.resolve())):
                raise RuntimeError(
                    "a different top-level package named 'src' is already imported "
                    f"({existing_file}); the OEP model-download service is itself "
                    "packaged as 'src', so the two cannot share a process."
                )

        root_str = str(root)
        if root_str not in sys.path:
            sys.path.insert(0, root_str)

        # Upstream reads this at `import src.plugins` time. Only the HuggingFace
        # plugin's dependencies are guaranteed to exist in a worker venv.
        os.environ.setdefault("ENABLED_PLUGINS", "huggingface")

        # Install the logging adapter before anything under src/ imports
        # `src.utils.logging`; src/utils/__init__.py is empty so this is safe.
        src_utils = importlib.import_module("src.utils")
        adapter = make_logging_module("src.utils.logging")
        sys.modules["src.utils.logging"] = adapter
        setattr(src_utils, "logging", adapter)

        tag = checked_out_tag(root)
        if tag is not None and tag != upstream_tag():
            logger.warning(
                "OEP model-download copy at %s is at %s, expected %s; "
                "run workers/oep-setup.sh fetch %s to update it.",
                root,
                tag,
                upstream_tag(),
                CATALOG_WORKER,
            )

        _bootstrapped = True
        logger.debug("OEP model-download upstream loaded from %s", root)
        return root


def upstream_info() -> dict[str, str | None]:
    """Where the upstream lives and which release it is, for diagnostics."""
    root = upstream_root()
    return {
        "repository": UPSTREAM_REPO,
        "pinned_tag": upstream_tag(),
        "checked_out_tag": checked_out_tag(root) if _is_checkout(root) else None,
        "path": str(root),
        "present": "yes" if _is_checkout(root) else "no",
    }
