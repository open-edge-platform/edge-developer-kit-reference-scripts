# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Locate, verify and import the upstream OEP ``document-ingestion/pgvector`` pipeline.

``workers/oep-setup.sh`` copies it into ``thirdparty/document-ingestion`` at the tag pinned in
``workers/oep-services.json``; this module puts it on ``sys.path`` and adapts it in memory only
(logger, settings, embeddings client, progress hooks), never modifying the copy.
"""

from __future__ import annotations

import importlib
import logging
import math
import os
import secrets
import subprocess  # nosec B404 - oep-setup is invoked with a fixed argument list
import sys
import threading
import types
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Callable, Iterator

from worker_common.oep import REF_ENV, pinned_tag, upstream_app_dir

_UNUSED_VALUE = secrets.token_urlsafe(16)
from worker_common.oep import checked_out_tag as _marker_tag
from worker_common.paths import workers_root

logger = logging.getLogger("uvicorn.error")

UPSTREAM_REPO = "https://github.com/open-edge-platform/edge-ai-libraries.git"
UPSTREAM_SUBDIR = "microservices/document-ingestion/pgvector"
#: Name of this worker's entry in ``workers/oep-services.json``.
CATALOG_WORKER = "services/vectordb"

#: Names a directory already holding the microservice (used as is, never
#: fetched) instead of ``workers/services/vectordb/thirdparty/document-ingestion``.
HOME_ENV = "OEP_DOCUMENT_INGESTION_HOME"
#: ``0`` disables fetching on demand when the copy is missing.
AUTO_CLONE_ENV = "OEP_DOCUMENT_INGESTION_AUTO_CLONE"

WORKER_DIR = Path(__file__).resolve().parents[1]  # workers/services/vectordb
# Found by sentinel, never by counting ``..`` (see worker_common.paths).
WORKERS_ROOT = workers_root()
#: The catalogue: pinned tag plus one record per OEP microservice.
CATALOG_JSON = WORKERS_ROOT / "oep-services.json"
#: The scripts that fetch what the catalogue lists.
CATALOG_SH = WORKERS_ROOT / "oep-setup.sh"
CATALOG_PS1 = WORKERS_ROOT / "oep-setup.ps1"

_lock = threading.Lock()
_document_module: types.ModuleType | None = None


class UpstreamMissingError(RuntimeError):
    """The upstream source is absent and could not be fetched."""


def upstream_tag() -> str:
    """The pinned edge-ai-libraries tag (``workers/oep-services.json``; ``EDGE_AI_LIBRARIES_REF`` wins)."""
    tag = pinned_tag(CATALOG_WORKER)
    if tag == "unknown":
        raise UpstreamMissingError(f'"tag" not found in {CATALOG_JSON}')
    return tag


def upstream_root() -> Path:
    """Root of the upstream microservice (contains ``app/``)."""
    return upstream_app_dir(WORKER_DIR, CATALOG_WORKER)


def _is_checkout(root: Path) -> bool:
    return (root / "app" / "document.py").is_file()


def checked_out_tag(path: Path | None = None) -> str | None:
    """Tag the copy was made from, or ``None`` when it carries no marker."""
    return _marker_tag(path or upstream_root())


def _setup_command(action: str, worker: str) -> list[str]:
    """Command line that runs ``oep-setup`` on this platform."""
    if os.name == "nt":
        return [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", str(CATALOG_PS1), "-Mode", action, "-Target", worker,
        ]
    return ["bash", str(CATALOG_SH), action, worker]


def clone_upstream(tag: str | None = None) -> Path:
    """Fetch ``document-ingestion/pgvector`` by running ``workers/oep-setup``, which owns the logic.

    Lets ``uv run main.py --db-backend pgvector`` work without ``start.sh``; ``tag`` goes through the
    script's ``EDGE_AI_LIBRARIES_REF`` override.
    """
    env = dict(os.environ)
    if tag:
        env[REF_ENV] = tag
    if not CATALOG_SH.is_file():
        raise UpstreamMissingError(f"{CATALOG_SH} not found; cannot fetch the OEP document-ingestion microservice")
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
            f"{CATALOG_SH.name} fetch {CATALOG_WORKER} did not produce {UPSTREAM_SUBDIR}/app at {root}"
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
            f"OEP document-ingestion source not found at {root}. "
            f"Start the worker through start.sh (or set {HOME_ENV})."
        )
    logger.warning(
        "OEP document-ingestion source not found at %s; fetching it now. "
        "start.sh (workers/oep-setup.sh fetch services/vectordb) does this ahead of time.",
        root,
    )
    try:
        clone_upstream()
    except (subprocess.SubprocessError, OSError) as exc:
        raise UpstreamMissingError(
            f"could not fetch {UPSTREAM_REPO}@{upstream_tag()}: {exc}. "
            f"Start the worker through start.sh, or set {HOME_ENV} to a directory holding the microservice."
        ) from exc
    return upstream_root()


# Upstream ``app.config.Settings`` fields without a default (Docker Compose supplies them upstream).
# Per-request values are overwritten on the settings object before each ingestion call.
def _settings_environment(pg_connection_string: str, store_dir: Path) -> dict[str, str]:
    return {
        "PG_CONNECTION_STRING": pg_connection_string,
        "TEI_ENDPOINT_URL": "http://127.0.0.1:0/v1",
        "EMBEDDING_MODEL_NAME": "unconfigured",
        "INDEX_NAME": "vectordb",
        "CHUNK_SIZE": "512",
        "CHUNK_OVERLAP": "200",
        "BATCH_SIZE": "32",
        "LOCAL_STORE_PREFIX": str(store_dir),
        # Placeholders: uploaded files stay on disk and ``app.store`` is never imported.
        "DEFAULT_BUCKET": "vectordb",
        "OBJECT_PREFIX": "vectordb",
        "MINIO_HOST": "127.0.0.1",
        "MINIO_API_PORT": "9000",
        "MINIO_ACCESS_KEY": _UNUSED_VALUE,
        "MINIO_SECRET_KEY": _UNUSED_VALUE,
    }


def _install_logger_stub(app_pkg: types.ModuleType) -> None:
    """Serve ``app.logger`` from the stdlib instead of upstream's structlog setup."""
    if "app.logger" in sys.modules:
        return
    module = types.ModuleType("app.logger")
    module.logger = logging.getLogger("uvicorn.error").getChild("oep.document-ingestion")  # type: ignore[attr-defined]
    sys.modules["app.logger"] = module
    setattr(app_pkg, "logger", module)


class _IngestionProgress:
    """What one ``ingest_to_pgvector`` call has done so far."""

    def __init__(self, report: Callable[[str, dict[str, Any]], None], batch_size: int):
        self.report = report
        self.batch_size = max(int(batch_size), 1)
        self.chunks = 0
        self.batches = 0
        self.batch = 0
        self.done = 0

    def split(self, count: int) -> None:
        self.chunks += count

    def embedding_started(self) -> None:
        # Upstream builds its embeddings client once every chunk exists, just
        # before the first batch.
        self.batches = math.ceil(self.chunks / self.batch_size)
        self.report("splitting", {"chunks": self.chunks})
        self._embedding()

    def batch_stored(self, count: int) -> None:
        self.batch += 1
        self.done += count
        self._embedding()

    def _embedding(self) -> None:
        self.report(
            "embedding",
            {
                "batch": self.batch,
                "batches": max(self.batches, self.batch),
                "done": self.done,
                "total": max(self.chunks, self.done),
            },
        )


_progress: ContextVar[_IngestionProgress | None] = ContextVar(
    "oep_ingestion_progress", default=None
)


@contextmanager
def ingestion_progress(report: Callable[[str, dict[str, Any]], None]) -> Iterator[None]:
    """Report ``splitting`` and ``embedding`` (as ``ProgressFn``) for ``ingest_to_pgvector`` calls here.

    Upstream runs synchronously on the calling thread, so the hooks see this context.
    """
    batch_size = 1
    if _document_module is not None:
        batch_size = int(getattr(_document_module.config, "BATCH_SIZE", 1) or 1)
    token = _progress.set(_IngestionProgress(report, batch_size))
    try:
        yield
    finally:
        _progress.reset(token)


def _install_embeddings_adapter(document: types.ModuleType) -> None:
    """Skip upstream's local tokenising (``check_embedding_ctx_length=False``); report embedding start.

    Tokenising locally needs ``transformers`` and a tokenizer download; the embeddings service tokenises.
    """
    upstream_cls = document.OpenAIEmbeddings

    class NativeOpenAIEmbeddings(upstream_cls):  # type: ignore[misc,valid-type]
        def __init__(self, **kwargs: Any):
            kwargs.setdefault("check_embedding_ctx_length", False)
            super().__init__(**kwargs)
            progress = _progress.get()
            if progress is not None:
                progress.embedding_started()

    NativeOpenAIEmbeddings.__name__ = upstream_cls.__name__
    document.OpenAIEmbeddings = NativeOpenAIEmbeddings


def _install_progress_hooks(document: types.ModuleType) -> None:
    """Count what upstream's splitter and batched ``PGVector`` writes produce."""
    splitter_cls = document.TokenTextSplitter
    store_cls = document.PGVector

    class CountingTokenTextSplitter(splitter_cls):  # type: ignore[misc,valid-type]
        def create_documents(self, *args: Any, **kwargs: Any):
            chunks = super().create_documents(*args, **kwargs)
            progress = _progress.get()
            if progress is not None:
                progress.split(len(chunks))
            return chunks

    class CountingPGVector(store_cls):  # type: ignore[misc,valid-type]
        @classmethod
        def from_documents(cls, documents, *args: Any, **kwargs: Any):
            store = super().from_documents(documents, *args, **kwargs)
            progress = _progress.get()
            if progress is not None:
                progress.batch_stored(len(documents))
            return store

    CountingTokenTextSplitter.__name__ = splitter_cls.__name__
    CountingPGVector.__name__ = store_cls.__name__
    document.TokenTextSplitter = CountingTokenTextSplitter
    document.PGVector = CountingPGVector


def bootstrap(pg_connection_string: str, store_dir: Path) -> types.ModuleType:
    """Make the upstream ``app`` package importable and return ``app.document``.

    Idempotent and thread-safe. Must run before anything else imports ``app``:
    upstream builds its settings objects at import time.
    """
    global _document_module
    with _lock:
        if _document_module is not None:
            return _document_module

        root = ensure_upstream()

        existing = sys.modules.get("app")
        if existing is not None:
            existing_file = getattr(existing, "__file__", None) or ""
            if not str(Path(existing_file).resolve()).startswith(str(root.resolve())):
                raise RuntimeError(
                    "a different top-level package named 'app' is already imported "
                    f"({existing_file}); the OEP document-ingestion service is itself "
                    "packaged as 'app', so the two cannot share a process."
                )

        # PG_CONNECTION_STRING always follows the backend that was actually
        # started; everything else stays overridable from the shell.
        env = _settings_environment(pg_connection_string, store_dir)
        os.environ["PG_CONNECTION_STRING"] = env.pop("PG_CONNECTION_STRING")
        for key, value in env.items():
            os.environ.setdefault(key, value)
        # TokenTextSplitter fetches the cl100k_base BPE file once; keep it with
        # the worker's data so it survives restarts and stays out of /tmp.
        os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(store_dir / "tiktoken"))
        Path(os.environ["TIKTOKEN_CACHE_DIR"]).mkdir(parents=True, exist_ok=True)
        store_dir.mkdir(parents=True, exist_ok=True)

        root_str = str(root)
        if root_str not in sys.path:
            sys.path.insert(0, root_str)

        app_pkg = importlib.import_module("app")
        _install_logger_stub(app_pkg)
        _document_module = importlib.import_module("app.document")
        _install_embeddings_adapter(_document_module)
        _install_progress_hooks(_document_module)

        tag = checked_out_tag(root)
        if tag is not None and tag != upstream_tag():
            logger.warning(
                "OEP document-ingestion copy at %s is at %s, expected %s; "
                "restart through start.sh to update it.",
                root,
                tag,
                upstream_tag(),
            )

        logger.info("OEP document-ingestion upstream loaded from %s", root)
        return _document_module


def upstream_info() -> dict[str, Any]:
    """Where the upstream lives and which release it is, for diagnostics."""
    root = upstream_root()
    present = _is_checkout(root)
    return {
        "repository": UPSTREAM_REPO,
        "subdir": UPSTREAM_SUBDIR,
        "pinned_tag": upstream_tag(),
        "checked_out_tag": checked_out_tag(root) if present else None,
        "path": str(root),
        "present": present,
        "loaded": _document_module is not None,
    }
