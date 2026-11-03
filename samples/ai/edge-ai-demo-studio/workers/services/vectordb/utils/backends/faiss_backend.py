# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""FAISS backend: one on-disk index per knowledge base under ``data/<kb>/faissdb``."""

from __future__ import annotations

import os
import shutil
from typing import Any, Dict, List, Optional, Tuple

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

from .base import NullEmbeddings, VectorStoreBackend, source_matches


class FaissBackend(VectorStoreBackend):
    name = "faiss"

    def _path(self, kb_id: Any) -> str:
        return str(self.data_dir / str(kb_id) / "faissdb")

    def _load(self, kb_id: Any, embeddings: Optional[Embeddings]) -> FAISS:
        path = self._path(kb_id)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Knowledge base {kb_id} not found")
        return FAISS.load_local(
            path, embeddings or NullEmbeddings(), allow_dangerous_deserialization=True
        )

    def _save(self, kb_id: Any, db: FAISS) -> None:
        os.makedirs(self.data_dir / str(kb_id), exist_ok=True)
        db.save_local(self._path(kb_id))

    # Lifecycle
    def info(self) -> Dict[str, Any]:
        return {"backend": self.name, "path": str(self.data_dir)}

    # Knowledge bases
    def kb_exists(self, kb_id: Any) -> bool:
        return os.path.exists(self._path(kb_id))

    def delete_kb(self, kb_id: Any) -> None:
        path = self._path(kb_id)
        if os.path.exists(path):
            shutil.rmtree(path)

    def count(self, kb_id: Any) -> int:
        if not self.kb_exists(kb_id):
            return 0
        return int(self._load(kb_id, None).index.ntotal)

    # Writes
    def add_documents(
        self, kb_id: Any, documents: List[Document], embeddings: Embeddings
    ) -> List[str]:
        if self.kb_exists(kb_id):
            db = self._load(kb_id, embeddings)
            ids = db.add_documents(documents)
        else:
            db = FAISS.from_documents(documents, embeddings)
            ids = list(db.index_to_docstore_id.values())
        self._save(kb_id, db)
        return ids

    def add_embeddings(
        self,
        kb_id: Any,
        texts: List[str],
        vectors: List[List[float]],
        metadatas: List[dict],
        embeddings: Optional[Embeddings],
    ) -> List[str]:
        pairs = list(zip(texts, vectors))
        if self.kb_exists(kb_id):
            db = self._load(kb_id, embeddings)
            ids = db.add_embeddings(text_embeddings=pairs, metadatas=metadatas)
        else:
            db = FAISS.from_embeddings(
                text_embeddings=pairs,
                embedding=embeddings or NullEmbeddings(),
                metadatas=metadatas,
            )
            ids = list(db.index_to_docstore_id.values())
        self._save(kb_id, db)
        return ids

    def delete_ids(self, kb_id: Any, ids: List[str]) -> bool:
        db = self._load(kb_id, None)
        deleted = bool(db.delete(ids))
        if deleted:
            self._save(kb_id, db)
        return deleted

    def ids_for_source(self, kb_id: Any, source: str) -> List[str]:
        db = self._load(kb_id, None)
        docs = db.get_by_ids(list(db.index_to_docstore_id.values()))
        return [doc.id for doc in docs if source_matches(doc.metadata.get("source"), source)]

    # Reads
    def retrieve(
        self,
        kb_id: Any,
        query: str,
        search_type: str,
        search_kwargs: dict,
        embeddings: Embeddings,
    ) -> List[Document]:
        db = self._load(kb_id, embeddings)
        retriever = db.as_retriever(search_type=search_type, search_kwargs=search_kwargs)
        return retriever.invoke(query)

    def search_by_vector(
        self,
        kb_id: Any,
        vector: List[float],
        k: int,
        filter_dict: Optional[dict],
        embeddings: Optional[Embeddings],
    ) -> List[Tuple[Document, float]]:
        db = self._load(kb_id, embeddings)
        kwargs = {"filter": filter_dict} if filter_dict else {}
        # L2 distance: lower is closer.
        return db.similarity_search_with_score_by_vector(vector, k=k, **kwargs)

    def all_chunks(
        self, kb_id: Any, include_embeddings: bool, embeddings: Optional[Embeddings]
    ) -> List[dict]:
        db = self._load(kb_id, embeddings)
        docs = db.get_by_ids(list(db.index_to_docstore_id.values()))
        chunks = []
        for i, doc in enumerate(docs):
            chunk: dict = {
                "chunk_id": i,
                "doc_id": doc.id,
                "content": doc.page_content,
                "metadata": doc.metadata,
            }
            if include_embeddings:
                try:
                    chunk["embedding"] = db.index.reconstruct(i).tolist()
                except Exception:  # noqa: BLE001
                    chunk["embedding"] = None
            chunks.append(chunk)
        return chunks
