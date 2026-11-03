# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""pgvector backend via ``langchain_postgres``: one ``langchain_pg_collection`` named ``kb_<id>`` per
knowledge base, the schema the upstream OEP document-ingestion service uses. The database is embedded
(default) or ``--pg-connection-string``. PDF, DOCX and TXT go through upstream's own pipeline
(``utils.oep_upstream``); other formats use the LangChain loaders.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url

from utils import oep_upstream
from utils.embedded_postgres import EmbeddedPostgres

from .base import (
    NullEmbeddings,
    ProgressFn,
    VectorStoreBackend,
    no_progress,
    source_matches,
)

#: Formats the upstream pipeline parses itself (``config.SUPPORTED_FORMATS``).
UPSTREAM_FORMATS = {".pdf", ".docx", ".txt"}

# The upstream module reads its settings from one module-level object, so
# calls into it are serialised regardless of which knowledge base they target.
_UPSTREAM_LOCK = threading.Lock()


def _normalise_url(url: str) -> str:
    """Accept libpq-style URLs and pin them to the psycopg (v3) dialect."""
    url = url.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class PgVectorBackend(VectorStoreBackend):
    name = "pgvector"

    def __init__(self, data_dir: Path, connection_string: Optional[str] = None):
        super().__init__(data_dir)
        self.connection_string = (connection_string or "").strip() or None
        self.mode = "external" if self.connection_string else "embedded"
        self.url: Optional[str] = None
        self.engine: Optional[Engine] = None
        self.postgres_version: Optional[str] = None
        self._embedded: Optional[EmbeddedPostgres] = None
        self._document: Any = None  # upstream ``app.document`` module

    # Lifecycle
    def startup(self) -> None:
        if self.connection_string:
            self.url = _normalise_url(self.connection_string)
        else:
            self._embedded = EmbeddedPostgres(self.data_dir / "pgdata")
            self.url = self._embedded.start()

        self.engine = create_engine(self.url, pool_pre_ping=True)
        with self.engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            self.postgres_version = conn.execute(text("SHOW server_version")).scalar()

        # Upstream builds its settings from the environment at import, so the connection string
        # must be known before this import (which clones the pipeline if needed).
        self._document = oep_upstream.bootstrap(self.url, self.data_dir / "upstream-store")

    def shutdown(self) -> None:
        if self.engine is not None:
            self.engine.dispose()
            self.engine = None
        if self._embedded is not None:
            self._embedded.stop()
            self._embedded = None

    def info(self) -> Dict[str, Any]:
        connection = None
        if self.url:
            connection = make_url(self.url).render_as_string(hide_password=True)
        return {
            "backend": self.name,
            "mode": self.mode,
            "connection": connection,
            "postgres_version": self.postgres_version,
            "upstream": oep_upstream.upstream_info(),
        }

    # Helpers
    @staticmethod
    def _collection(kb_id: Any) -> str:
        return f"kb_{kb_id}"

    def _store(self, kb_id: Any, embeddings: Optional[Embeddings]):
        from langchain_postgres import PGVector

        assert self.engine is not None, "backend not started"
        return PGVector(
            embeddings=embeddings or NullEmbeddings(),
            connection=self.engine,
            collection_name=self._collection(kb_id),
            use_jsonb=True,
        )

    def _tables_exist(self, conn) -> bool:
        return bool(
            conn.execute(
                text(
                    "SELECT to_regclass('langchain_pg_collection') IS NOT NULL "
                    "AND to_regclass('langchain_pg_embedding') IS NOT NULL"
                )
            ).scalar()
        )

    # Knowledge bases
    def kb_exists(self, kb_id: Any) -> bool:
        assert self.engine is not None
        with self.engine.connect() as conn:
            if not self._tables_exist(conn):
                return False
            return (
                conn.execute(
                    text("SELECT 1 FROM langchain_pg_collection WHERE name = :name"),
                    {"name": self._collection(kb_id)},
                ).first()
                is not None
            )

    def delete_kb(self, kb_id: Any) -> None:
        assert self.engine is not None
        with self.engine.begin() as conn:
            if not self._tables_exist(conn):
                return
            # Embeddings reference the collection with ON DELETE CASCADE.
            conn.execute(
                text("DELETE FROM langchain_pg_collection WHERE name = :name"),
                {"name": self._collection(kb_id)},
            )

    def count(self, kb_id: Any) -> int:
        assert self.engine is not None
        with self.engine.connect() as conn:
            if not self._tables_exist(conn):
                return 0
            return int(
                conn.execute(
                    text(
                        "SELECT count(*) FROM langchain_pg_embedding e "
                        "JOIN langchain_pg_collection c ON e.collection_id = c.uuid "
                        "WHERE c.name = :name"
                    ),
                    {"name": self._collection(kb_id)},
                ).scalar()
                or 0
            )

    # Writes
    def add_documents(
        self, kb_id: Any, documents: List[Document], embeddings: Embeddings
    ) -> List[str]:
        return self._store(kb_id, embeddings).add_documents(documents)

    def add_embeddings(
        self,
        kb_id: Any,
        texts: List[str],
        vectors: List[List[float]],
        metadatas: List[dict],
        embeddings: Optional[Embeddings],
    ) -> List[str]:
        return self._store(kb_id, embeddings).add_embeddings(
            texts=texts, embeddings=vectors, metadatas=metadatas
        )

    def delete_ids(self, kb_id: Any, ids: List[str]) -> bool:
        before = self.count(kb_id)
        self._store(kb_id, None).delete(ids=ids)
        return self.count(kb_id) < before

    def ids_for_source(self, kb_id: Any, source: str) -> List[str]:
        assert self.engine is not None
        # Upstream records ``source`` and ``filename`` (basename), the generic path ``source`` only.
        # Collections are small, so match in Python with the shared rule.
        with self.engine.connect() as conn:
            if not self._tables_exist(conn):
                return []
            rows = conn.execute(
                text(
                    "SELECT e.id, e.cmetadata ->> 'source', e.cmetadata ->> 'filename' "
                    "FROM langchain_pg_embedding e "
                    "JOIN langchain_pg_collection c ON e.collection_id = c.uuid "
                    "WHERE c.name = :name"
                ),
                {"name": self._collection(kb_id)},
            ).all()
        wanted_name = Path(source).name if ("/" in source or os.sep in source) else None
        return [
            str(row[0])
            for row in rows
            if source_matches(row[1], source) or (wanted_name and row[2] == wanted_name)
        ]

    # Reads
    def retrieve(
        self,
        kb_id: Any,
        query: str,
        search_type: str,
        search_kwargs: dict,
        embeddings: Embeddings,
    ) -> List[Document]:
        retriever = self._store(kb_id, embeddings).as_retriever(
            search_type=search_type, search_kwargs=search_kwargs
        )
        return retriever.invoke(query)

    def search_by_vector(
        self,
        kb_id: Any,
        vector: List[float],
        k: int,
        filter_dict: Optional[dict],
        embeddings: Optional[Embeddings],
    ) -> List[Tuple[Document, float]]:
        # Cosine distance: lower is closer.
        return self._store(kb_id, embeddings).similarity_search_with_score_by_vector(
            vector, k=k, filter=filter_dict
        )

    def all_chunks(
        self, kb_id: Any, include_embeddings: bool, embeddings: Optional[Embeddings]
    ) -> List[dict]:
        assert self.engine is not None
        columns = "e.id, e.document, e.cmetadata"
        if include_embeddings:
            columns += ", e.embedding::text"
        with self.engine.connect() as conn:
            if not self._tables_exist(conn):
                return []
            rows = conn.execute(
                text(
                    f"SELECT {columns} FROM langchain_pg_embedding e "
                    "JOIN langchain_pg_collection c ON e.collection_id = c.uuid "
                    "WHERE c.name = :name ORDER BY e.id"
                ),
                {"name": self._collection(kb_id)},
            ).all()

        chunks = []
        for i, row in enumerate(rows):
            metadata = row[2]
            if isinstance(metadata, str):
                metadata = json.loads(metadata)
            chunk: dict = {
                "chunk_id": i,
                "doc_id": str(row[0]),
                "content": row[1],
                "metadata": metadata or {},
            }
            if include_embeddings:
                chunk["embedding"] = json.loads(row[3]) if row[3] else None
            chunks.append(chunk)
        return chunks

    # Ingestion
    def ingest_file(
        self,
        kb_id: Any,
        file_path: str,
        splitter_name: str,
        chunk_size: int,
        chunk_overlap: int,
        embeddings: Embeddings,
        embedding_config: Optional[dict] = None,
        progress: ProgressFn = no_progress,
    ) -> int:
        suffix = Path(file_path).suffix.lower()
        if suffix in UPSTREAM_FORMATS and embedding_config and self._document is not None:
            return self._ingest_with_upstream(
                kb_id, file_path, chunk_size, chunk_overlap, embedding_config, progress
            )
        return super().ingest_file(
            kb_id,
            file_path,
            splitter_name,
            chunk_size,
            chunk_overlap,
            embeddings,
            progress=progress,
        )

    def _ingest_with_upstream(
        self,
        kb_id: Any,
        file_path: str,
        chunk_size: int,
        chunk_overlap: int,
        embedding_config: dict,
        progress: ProgressFn = no_progress,
    ) -> int:
        """Run the upstream OEP pipeline for one file.

        Per-call values go on upstream's module-level ``config`` under a lock. Its splitter counts
        ``cl100k_base`` tokens, not characters. It stores as it embeds, so there is no ``storing`` stage.
        """
        from fastapi import HTTPException

        collection = self._collection(kb_id)
        before = self.count(kb_id)
        progress("loading", {})
        with _UPSTREAM_LOCK, oep_upstream.ingestion_progress(progress):
            cfg = self._document.config
            cfg.INDEX_NAME = collection
            cfg.CHUNK_SIZE = int(chunk_size)
            cfg.CHUNK_OVERLAP = int(chunk_overlap)
            cfg.TEI_ENDPOINT_URL = embedding_config["embedding_url"]
            cfg.EMBEDDING_MODEL_NAME = embedding_config["embedding_model"]
            cfg.PG_CONNECTION_STRING = self.url
            try:
                self._document.ingest_to_pgvector(doc_path=Path(file_path), bucket=collection)
            except HTTPException as exc:
                # Upstream logs the real cause and re-raises a generic 500.
                raise RuntimeError(
                    f"upstream document ingestion failed for {Path(file_path).name}: {exc.detail}"
                ) from exc
        return max(self.count(kb_id) - before, 0)
