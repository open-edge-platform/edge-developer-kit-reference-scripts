# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Vector storage backends. ``create_backend`` is the only entry point."""

from __future__ import annotations

from pathlib import Path

from .base import NullEmbeddings, VectorStoreBackend

BACKENDS = ("faiss", "pgvector")


def create_backend(name: str, data_dir: Path, **options) -> VectorStoreBackend:
    """Instantiate (not start) backend ``name``; lazy imports keep FAISS off the PostgreSQL stack."""
    name = (name or "faiss").strip().lower()
    if name == "faiss":
        from .faiss_backend import FaissBackend

        return FaissBackend(data_dir)
    if name == "pgvector":
        from .pgvector_backend import PgVectorBackend

        return PgVectorBackend(data_dir, connection_string=options.get("pg_connection_string"))
    raise ValueError(f"Unknown vector DB backend '{name}'. Choose one of {list(BACKENDS)}")


__all__ = ["BACKENDS", "NullEmbeddings", "VectorStoreBackend", "create_backend"]
