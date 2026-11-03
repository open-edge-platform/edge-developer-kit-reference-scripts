# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Storage backend contract: a backend owns the vectors of every knowledge base.

The registry, embedding/reranker config and per-KB queue live above it in ``rag_engine``, so the
choice of store never changes the public API.
"""

from __future__ import annotations

import math
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

from utils.loaders import load_single_document, split_documents

#: Chunks sent to the embeddings service in one request while a file is
#: ingested. Each batch reports progress, so a large file shows how far it is.
EMBED_BATCH_SIZE = 32

#: ``progress(stage, data)``: ``loading``, ``splitting`` (``{chunks}``, ``documents`` when known),
#: ``embedding`` (``{batch, batches, done, total}``, first with batch 0), ``storing`` (``{chunks}``).
#: A backend may skip a stage it has no hook into; the callback must not block.
ProgressFn = Callable[[str, Dict[str, Any]], None]


def no_progress(stage: str, data: Dict[str, Any]) -> None:
    """A ``ProgressFn`` that reports nowhere."""


def embed_in_batches(
    texts: List[str],
    embeddings: Embeddings,
    progress: ProgressFn = no_progress,
    batch_size: int = EMBED_BATCH_SIZE,
) -> List[List[float]]:
    """Embed ``texts`` ``batch_size`` at a time, reporting each batch."""
    total = len(texts)
    batches = math.ceil(total / batch_size)
    vectors: List[List[float]] = []
    progress("embedding", {"batch": 0, "batches": batches, "done": 0, "total": total})
    for batch, start in enumerate(range(0, total, batch_size), start=1):
        part = texts[start : start + batch_size]
        embedded = embeddings.embed_documents(part)
        if len(embedded) != len(part):
            raise RuntimeError(
                f"The embeddings service returned {len(embedded)} vectors for {len(part)} chunks"
            )
        vectors.extend(embedded)
        progress(
            "embedding",
            {"batch": batch, "batches": batches, "done": len(vectors), "total": total},
        )
    return vectors


def source_matches(stored: Any, requested: str) -> bool:
    """True when a chunk's ``metadata.source`` refers to ``requested``.

    Stored paths are absolute or relative, while callers pass ``./data/<kb>/<name>`` or a bare
    filename; non-path markers (``manual_chunk``, ``direct_vector``) must match exactly.
    """
    if not isinstance(stored, str) or not stored:
        return False
    if stored == requested:
        return True
    if "/" not in requested and os.sep not in requested:
        return False
    candidates = {requested, str(Path(requested)), os.path.abspath(requested)}
    if stored in candidates:
        return True
    # Same file name, different spelling of the directory (only when the
    # stored value is itself a path, never for markers like ``manual_chunk``).
    if "/" not in stored and os.sep not in stored:
        return False
    return Path(stored).name == Path(requested).name


class NullEmbeddings(Embeddings):
    """The ``Embeddings`` LangChain stores require for vector-only operations; any use fails loudly."""

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        raise RuntimeError(
            "RAG engine not configured. Call /v1/configure with an embedding service first."
        )

    def embed_query(self, text: str) -> List[float]:
        raise RuntimeError(
            "RAG engine not configured. Call /v1/configure with an embedding service first."
        )


class VectorStoreBackend(ABC):
    """Everything a store must do for one knowledge base at a time.

    Calls for one ``kb_id`` are serialised (``rag_engine._execute_kb_operation``); different
    knowledge bases may run concurrently.
    """

    name: str = "abstract"

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)

    # Lifecycle
    def startup(self) -> None:  # noqa: B027 - optional hook
        """Open connections / start servers. Called once from the app lifespan."""

    def shutdown(self) -> None:  # noqa: B027 - optional hook
        """Release whatever ``startup`` acquired."""

    @abstractmethod
    def info(self) -> Dict[str, Any]:
        """Diagnostics for ``/v1/config`` (never include secrets)."""

    # Knowledge bases
    @abstractmethod
    def kb_exists(self, kb_id: Any) -> bool:
        """True once the store holds (or has held) vectors for ``kb_id``."""

    @abstractmethod
    def delete_kb(self, kb_id: Any) -> None:
        """Drop every vector of ``kb_id``. Must not fail when there are none."""

    @abstractmethod
    def count(self, kb_id: Any) -> int:
        """Number of stored chunks (0 for an unknown knowledge base)."""

    # Writes
    @abstractmethod
    def add_documents(
        self, kb_id: Any, documents: List[Document], embeddings: Embeddings
    ) -> List[str]:
        """Embed ``documents`` with ``embeddings`` and store them; return their ids."""

    @abstractmethod
    def add_embeddings(
        self,
        kb_id: Any,
        texts: List[str],
        vectors: List[List[float]],
        metadatas: List[dict],
        embeddings: Optional[Embeddings],
    ) -> List[str]:
        """Store pre-computed ``vectors``; return their ids."""

    @abstractmethod
    def delete_ids(self, kb_id: Any, ids: List[str]) -> bool:
        """Delete chunks by id. False when nothing was deleted."""

    @abstractmethod
    def ids_for_source(self, kb_id: Any, source: str) -> List[str]:
        """Ids of every chunk whose ``metadata.source`` matches ``source``."""

    # Reads
    @abstractmethod
    def retrieve(
        self,
        kb_id: Any,
        query: str,
        search_type: str,
        search_kwargs: dict,
        embeddings: Embeddings,
    ) -> List[Document]:
        """Text search through a LangChain retriever (similarity / mmr / threshold)."""

    @abstractmethod
    def search_by_vector(
        self,
        kb_id: Any,
        vector: List[float],
        k: int,
        filter_dict: Optional[dict],
        embeddings: Optional[Embeddings],
    ) -> List[Tuple[Document, float]]:
        """Nearest neighbours of ``vector`` as ``(document, distance)`` pairs."""

    @abstractmethod
    def all_chunks(
        self, kb_id: Any, include_embeddings: bool, embeddings: Optional[Embeddings]
    ) -> List[dict]:
        """Every chunk as ``{chunk_id, doc_id, content, metadata[, embedding]}``."""

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
        """Parse, chunk, embed and store one file; return the number of chunks.

        The default uses ``utils.loaders``, embeds in batches and stores in one write; a backend may
        override it with its own pipeline.
        """
        progress("loading", {})
        documents = load_single_document(file_path)
        chunks = split_documents(documents, splitter_name, chunk_size, chunk_overlap)
        progress("splitting", {"documents": len(documents), "chunks": len(chunks)})
        if not chunks:
            return 0
        texts = [chunk.page_content for chunk in chunks]
        vectors = embed_in_batches(texts, embeddings, progress)
        progress("storing", {"chunks": len(chunks)})
        self.add_embeddings(
            kb_id, texts, vectors, [chunk.metadata for chunk in chunks], embeddings
        )
        return len(chunks)
