# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Embedded PostgreSQL 16 + pgvector (``pgserver`` wheel), used when no ``--pg-connection-string``
is given. Needs no system package or root; the cluster lives in ``data/pgdata``.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("uvicorn.error")


class EmbeddedPostgres:
    def __init__(self, pgdata: Path):
        self.pgdata = Path(pgdata).resolve()
        self._server: Any = None
        self.sqlalchemy_url: str | None = None

    def start(self) -> str:
        """Initialise (first run) and start the cluster; return a SQLAlchemy URL."""
        try:
            import pgserver
        except ImportError as exc:  # pragma: no cover - depends on the wheel set
            raise RuntimeError(
                "the embedded PostgreSQL server (pgserver) is not installed for this "
                "Python build; pass --pg-connection-string to use an existing "
                "PostgreSQL with the pgvector extension instead."
            ) from exc

        self.pgdata.parent.mkdir(parents=True, exist_ok=True)
        logger.info("Starting embedded PostgreSQL from %s", self.pgdata)
        # cleanup_mode='stop' also registers an atexit hook, so the postmaster
        # goes away even when the worker is terminated without a clean lifespan.
        self._server = pgserver.get_server(self.pgdata, cleanup_mode="stop")
        uri = self._server.get_uri()
        # pgserver reports a libpq URI (unix socket on Linux/macOS, TCP on
        # Windows); langchain_postgres / SQLAlchemy want the psycopg dialect.
        self.sqlalchemy_url = uri.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.sqlalchemy_url

    def stop(self) -> None:
        if self._server is None:
            return
        try:
            self._server.cleanup()
            logger.info("Embedded PostgreSQL stopped")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Embedded PostgreSQL did not stop cleanly: %s", exc)
        finally:
            self._server = None
