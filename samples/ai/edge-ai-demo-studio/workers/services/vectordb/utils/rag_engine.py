# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Knowledge-base operations, independent of where the vectors are stored.

Owns the embedding/reranker config, the per-KB operation queue and search post-processing; the
vectors live in the ``VectorStoreBackend`` (FAISS or pgvector) that ``init_backend`` starts.
"""

from __future__ import annotations

import os
import queue
import threading
from concurrent.futures import Future
from glob import glob
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

import cohere
import requests
from langchain_classic.retrievers import ContextualCompressionRetriever
from langchain_cohere import CohereRerank
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings

from utils.backends import BACKENDS, VectorStoreBackend, create_backend
from utils.backends.base import ProgressFn, no_progress
from utils.loaders import (  # noqa: F401 - re-exported for callers/tests
    LOADERS,
    TEXT_SPLITTERS,
    load_json_documents,
    load_single_document,
)
from worker_common import instance_data_dir, studio_address

# This instance's data directory: knowledge bases, the sqlite catalogue and any embedded DB server.
DATA_DIR = instance_data_dir("data")

# Set by configure_rag_engine().
COHERE_CLIENT = None
EMBEDDINGS = None
CONFIG = None

# Set by init_backend().
_BACKEND: Optional[VectorStoreBackend] = None

# One queue and worker thread per KB, so concurrent requests never update a KB at once.
_kb_operation_queues: Dict[Any, queue.Queue] = {}
_kb_worker_threads: Dict[Any, threading.Thread] = {}
# Operations submitted per KB and not finished yet (the running one included).
_kb_pending: Dict[Any, int] = {}
_kb_queues_lock = threading.Lock()


# Backend lifecycle


def init_backend(name: str = "faiss", **options) -> VectorStoreBackend:
    """Create and start the storage backend. Called once from the app lifespan."""
    global _BACKEND
    if _BACKEND is not None:
        return _BACKEND
    backend = create_backend(name, DATA_DIR, **options)
    backend.startup()
    _BACKEND = backend
    return backend


def shutdown_backend() -> None:
    global _BACKEND
    if _BACKEND is not None:
        _BACKEND.shutdown()
        _BACKEND = None


def get_backend() -> VectorStoreBackend:
    if _BACKEND is None:
        raise RuntimeError("Vector DB backend not initialised. Call init_backend() first.")
    return _BACKEND


def backend_info() -> dict:
    if _BACKEND is None:
        return {"backend": None, "available": list(BACKENDS)}
    return {**_BACKEND.info(), "available": list(BACKENDS)}


def kb_exists(kb_id) -> bool:
    """True when the store holds vectors for ``kb_id``."""
    return get_backend().kb_exists(kb_id)


def delete_kb_data(kb_id) -> None:
    """Drop every vector of ``kb_id`` from the store (files on disk are the caller's)."""
    get_backend().delete_kb(kb_id)


# Per-KB operation queue


def _kb_worker(kb_id, op_queue: queue.Queue):
    """Run ``kb_id``'s queued operations one at a time, settling each caller's ``Future``."""
    while True:
        operation = op_queue.get()

        if operation is None:  # Sentinel value to stop worker
            break

        future, func, args, kwargs = operation
        try:
            if not future.set_running_or_notify_cancel():
                continue
            try:
                result = func(*args, **kwargs)
            except Exception as e:
                future.set_exception(e)
            else:
                future.set_result(result)
        except Exception as e:
            print(f"KB worker error for kb_id={kb_id}: {e}", flush=True)
        finally:
            with _kb_queues_lock:
                _kb_pending[kb_id] = max(_kb_pending.get(kb_id, 1) - 1, 0)


def _get_or_create_kb_queue(kb_id) -> queue.Queue:
    """Get or create an operation queue (and its worker thread) for a knowledge base."""
    with _kb_queues_lock:
        if kb_id not in _kb_operation_queues:
            _kb_operation_queues[kb_id] = queue.Queue()

            worker = threading.Thread(
                target=_kb_worker,
                args=(kb_id, _kb_operation_queues[kb_id]),
                daemon=True,
                name=f"KB-Worker-{kb_id}",
            )
            worker.start()
            _kb_worker_threads[kb_id] = worker

        return _kb_operation_queues[kb_id]


def _submit_kb_operation(kb_id, func: Callable, *args, **kwargs) -> Future:
    """Queue a KB operation; the returned ``Future`` settles once it has run.

    Operations on the same KB run one at a time, in submission order.
    """
    op_queue = _get_or_create_kb_queue(kb_id)
    future: Future = Future()
    with _kb_queues_lock:
        _kb_pending[kb_id] = _kb_pending.get(kb_id, 0) + 1
    op_queue.put((future, func, args, kwargs))
    return future


def _execute_kb_operation(kb_id, func: Callable, *args, **kwargs) -> Any:
    """Run a KB operation through its queue and wait for the result."""
    return _submit_kb_operation(kb_id, func, *args, **kwargs).result()


def _report_queued(kb_id, progress: ProgressFn) -> None:
    """Tell ``progress`` how many operations will run on ``kb_id`` first."""
    with _kb_queues_lock:
        ahead = _kb_pending.get(kb_id, 0)
    if ahead:
        progress("queued", {"ahead": ahead})


class ProgressStream:
    """Progress a queued operation reports, read back in order as it comes.

    Pass ``report`` as its ``progress``, submit it, then iterate ``follow(future)`` until it
    finishes. Reading blocks, so iterate it off the event loop.
    """

    _END = object()

    def __init__(self) -> None:
        self._events: queue.Queue = queue.Queue()

    def report(self, stage: str, data: Dict[str, Any]) -> None:
        self._events.put((stage, data))

    def follow(self, future: Future) -> Iterator[Tuple[str, Dict[str, Any]]]:
        # The worker thread reports before it settles the future, and a done
        # callback runs after that, so the end marker is always queued last.
        future.add_done_callback(lambda _future: self._events.put(self._END))
        while True:
            item = self._events.get()
            if item is self._END:
                return
            yield item


# Embedding / reranker configuration


def configure_rag_engine(
    embedding_url: str,
    embedding_model: str,
    reranker_url: str = None,
    reranker_model: str = None,
):
    """Configure the embedding and optional reranker services.

    URLs are an instance's path on the app (``/api/embeddings@<id>/v1``, see
    ``worker_common.studio_address``) or full URLs.
    """
    global COHERE_CLIENT, EMBEDDINGS, CONFIG

    embedding_url = studio_address(embedding_url)
    reranker_url = studio_address(reranker_url)

    CONFIG = {
        "embedding_url": embedding_url,
        "embedding_model": embedding_model,
        "reranker_url": reranker_url,
        "reranker_model": reranker_model,
        "use_custom_reranker": False,
    }

    if reranker_url and reranker_model:
        # Multiserve Rerank instances name models "<provider>:<model>" and serve only POST
        # /v1/rerank, not the Cohere client's /v2/rerank, so they get the plain HTTP reranker.
        if _is_multiserve_model(reranker_model):
            CONFIG["use_custom_reranker"] = True
            COHERE_CLIENT = None
        else:
            # The Cohere client takes the base URL without /v1.
            cohere_base = reranker_url.rstrip("/")
            if cohere_base.endswith("/v1"):
                cohere_base = cohere_base[:-3]
            COHERE_CLIENT = cohere.ClientV2(
                api_key="-",
                base_url=cohere_base,
            )

    EMBEDDINGS = OpenAIEmbeddings(
        model=embedding_model,
        api_key="-",
        tiktoken_enabled=False,
        base_url=embedding_url,
        embedding_ctx_length=8190,
        check_embedding_ctx_length=False,
    )


# Model name prefixes of the multiserve engine's backends.
_MULTISERVE_PROVIDERS = ("openvino:", "llamacpp:")


def _is_multiserve_model(model: str) -> bool:
    name = model.lower()
    return name.startswith(_MULTISERVE_PROVIDERS) or "openvino" in name


def _require_embeddings():
    if EMBEDDINGS is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )


def _custom_rerank_candidates(
    reranker_url: str,
    reranker_model: str,
    query: str,
    candidates: List[Document],
    top_n: int = 3,
) -> List[Document]:
    """Reorder ``candidates`` with a Jina/Cohere-style ``POST <url>/v1/rerank``.

    Scores are read by ``index`` (``relevance_score`` or ``score``) or as a bare list; on any failure
    the candidates keep the retriever's order.
    """
    if not reranker_url or not candidates:
        return candidates[:top_n]

    base = reranker_url.rstrip("/")
    if base.endswith("/v1"):
        endpoint = f"{base}/rerank"
    else:
        endpoint = f"{base}/v1/rerank"

    payload = {
        "model": reranker_model,
        "query": query,
        "documents": [d.page_content for d in candidates],
        "top_n": len(candidates),
    }

    try:
        resp = requests.post(endpoint, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        scores: Dict[int, float] = {}
        if isinstance(data, list) and all(isinstance(x, (int, float)) for x in data):
            scores = {i: float(x) for i, x in enumerate(data)}
        elif isinstance(data, dict):
            if isinstance(data.get("scores"), list):
                scores = {i: float(x) for i, x in enumerate(data["scores"])}
            elif isinstance(data.get("results"), list):
                for position, entry in enumerate(data["results"]):
                    if not isinstance(entry, dict):
                        continue
                    score = entry.get("relevance_score", entry.get("score"))
                    if score is None:
                        continue
                    scores[int(entry.get("index", position))] = float(score)

        if scores:
            ranked = sorted(
                (i for i in scores if 0 <= i < len(candidates)),
                key=lambda i: scores[i],
                reverse=True,
            )
            return [candidates[i] for i in ranked][:top_n]
        print(
            f"Reranker answered no scores ({endpoint}); keeping the retriever's order",
            flush=True,
        )

    except Exception as e:
        print(f"Custom reranker call failed ({endpoint}): {e}", flush=True)

    return candidates[:top_n]


# Ingestion


def _with_fields(progress: ProgressFn, **fields: Any) -> ProgressFn:
    """``progress`` with ``fields`` added to every report."""
    return lambda stage, data: progress(stage, {**fields, **data})


def _ingest_file_internal(
    kb_id,
    file_path: str,
    splitter_name: str,
    chunk_size: int,
    chunk_overlap: int,
    progress: ProgressFn = no_progress,
) -> int:
    """Replace the chunks of ``file_path`` in ``kb_id``; return the new chunk count.

    Runs on the KB's worker thread.
    """
    backend = get_backend()

    if backend.kb_exists(kb_id):
        try:
            _delete_chunks_by_source_internal(kb_id, file_path)
            print(f"Deleted existing chunks from {file_path}", flush=True)
        except Exception as e:
            print(f"No existing chunks to delete: {e}", flush=True)

    print(f"Reading document {file_path}...", flush=True)
    os.makedirs(DATA_DIR / str(kb_id), exist_ok=True)
    return backend.ingest_file(
        kb_id,
        file_path,
        splitter_name,
        chunk_size,
        chunk_overlap,
        EMBEDDINGS,
        embedding_config=CONFIG,
        progress=progress,
    )


def _create_embeddings_for_file_internal(
    kb_id,
    file_path: str,
    splitter_name: str = "RecursiveCharacter",
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
    progress: ProgressFn = no_progress,
):
    chunks_created = _ingest_file_internal(
        kb_id,
        file_path,
        splitter_name,
        chunk_size,
        chunk_overlap,
        _with_fields(progress, file=os.path.basename(file_path)),
    )
    return {
        "success": True,
        "message": f"Successfully created embeddings for {os.path.basename(file_path)}",
        "file_info": {
            "file_path": file_path,
            "chunks_created": chunks_created,
            "splitter_name": splitter_name,
            "chunk_size": chunk_size,
            "chunk_overlap": chunk_overlap,
        },
    }


def submit_file_embeddings(
    kb_id,
    file_path: str,
    splitter_name: str = "RecursiveCharacter",
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
    progress: ProgressFn = no_progress,
) -> Future:
    """Queue embedding one file; the ``Future`` settles with the result dict.

    Invalid arguments raise before queueing. ``progress`` gets ``queued`` (``{ahead}``) when other
    operations run first, then the ``ProgressFn`` stages, each carrying ``file``.
    """
    _require_embeddings()

    if splitter_name not in TEXT_SPLITTERS:
        raise ValueError(
            f"Invalid splitter_name. Must be one of: {list(TEXT_SPLITTERS.keys())}"
        )

    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    _report_queued(kb_id, progress)
    return _submit_kb_operation(
        kb_id,
        _create_embeddings_for_file_internal,
        kb_id,
        file_path,
        splitter_name,
        chunk_size,
        chunk_overlap,
        progress,
    )


def create_embeddings_for_file(
    kb_id,
    file_path: str,
    splitter_name: str = "RecursiveCharacter",
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
):
    """Embed one file into the knowledge base and return the result dict."""
    return submit_file_embeddings(
        kb_id, file_path, splitter_name, chunk_size, chunk_overlap
    ).result()


def _create_data_embedding_internal(
    kb_id,
    input_path: str,
    splitter_name: str,
    chunk_size: int,
    chunk_overlap: int,
    progress: ProgressFn = no_progress,
) -> bool:
    files = [file for file in sorted(glob(f"{input_path}/*")) if os.path.isfile(file)]
    for index, file in enumerate(files, start=1):
        where = {"file": os.path.basename(file), "index": index, "files": len(files)}
        progress("file_start", where)
        chunks_created = _ingest_file_internal(
            kb_id,
            file,
            splitter_name,
            chunk_size,
            chunk_overlap,
            _with_fields(progress, **where),
        )
        progress("file_done", {**where, "chunks_created": chunks_created})
    return True


def submit_data_embedding(
    kb_id,
    input_path: str,
    splitter_name: str = "RecursiveCharacter",
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
    progress: ProgressFn = no_progress,
) -> Future:
    """Queue embedding every file of a KB directory; the ``Future`` settles with ``True``.

    Invalid arguments raise before queueing. ``progress`` gets ``queued`` (``{ahead}``), then per file
    ``file_start``, its stages and ``file_done`` (``{chunks_created}``), with ``file``/``index``/``files``.
    """
    _require_embeddings()

    if splitter_name not in TEXT_SPLITTERS:
        raise ValueError(
            f"Invalid splitter_name. Must be one of: {list(TEXT_SPLITTERS.keys())}"
        )

    _report_queued(kb_id, progress)
    return _submit_kb_operation(
        kb_id,
        _create_data_embedding_internal,
        kb_id,
        input_path,
        splitter_name,
        chunk_size,
        chunk_overlap,
        progress,
    )


def create_data_embedding(
    kb_id,
    input_path: str,
    splitter_name: str = "RecursiveCharacter",
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
):
    """Embed every document in the knowledge base directory."""
    return submit_data_embedding(
        kb_id, input_path, splitter_name, chunk_size, chunk_overlap
    ).result()


# Search


def search_information(
    kb_id,
    query: str,
    top_n: int = 3,
    search_type: str = "similarity",
    retriever_kwargs: Optional[dict] = None,
):
    """Search the knowledge base, reranked to ``top_n`` when a reranker is configured."""
    if EMBEDDINGS is None or CONFIG is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )

    try:
        backend = get_backend()

        default_kwargs = {"k": 4}
        search_kwargs = default_kwargs.copy()

        if retriever_kwargs:
            if search_type == "similarity":
                for key in ["k", "filter"]:
                    if key in retriever_kwargs:
                        search_kwargs[key] = retriever_kwargs[key]
            elif search_type == "mmr":
                for key in ["k", "fetch_k", "lambda_mult", "filter"]:
                    if key in retriever_kwargs:
                        search_kwargs[key] = retriever_kwargs[key]
            elif search_type == "similarity_score_threshold":
                for key in ["k", "score_threshold", "filter"]:
                    if key in retriever_kwargs:
                        search_kwargs[key] = retriever_kwargs[key]
            else:
                search_kwargs.update(retriever_kwargs)

        def _retrieve(q: str) -> List[Document]:
            return backend.retrieve(kb_id, q, search_type, search_kwargs, EMBEDDINGS)

        # The plain HTTP reranker for multiserve instances, else Cohere's when configured.
        if CONFIG.get("use_custom_reranker"):
            try:
                candidates = _retrieve(query)
                result = _custom_rerank_candidates(
                    CONFIG.get("reranker_url"),
                    CONFIG.get("reranker_model"),
                    query,
                    candidates,
                    top_n,
                )
            except Exception as e:
                print(f"Custom reranker failed: {e}", flush=True)
                result = _retrieve(query)
        elif COHERE_CLIENT is not None and CONFIG.get("reranker_model"):
            compressor = CohereRerank(
                model=CONFIG["reranker_model"], client=COHERE_CLIENT, top_n=top_n
            )
            # ContextualCompressionRetriever needs a retriever object; the
            # backend exposes LangChain's, so wrap it once here.
            from langchain_core.retrievers import BaseRetriever

            class _BackendRetriever(BaseRetriever):
                def _get_relevant_documents(self, q: str, *, run_manager=None):  # type: ignore[override]
                    return _retrieve(q)

            compression_retriever = ContextualCompressionRetriever(
                base_compressor=compressor, base_retriever=_BackendRetriever()
            )
            try:
                result = compression_retriever.invoke(query)
            except Exception as e:
                # A reranker that fails must not cost the answer its context.
                print(f"Cohere reranker failed: {e}", flush=True)
                result = _retrieve(query)[:top_n]
        else:
            result = _retrieve(query)

    except Exception:
        import traceback

        traceback.print_exc()
        result = []

    return result


def search_by_vector(
    kb_id,
    embedding: List[float],
    top_k: int = 4,
    filter_dict: Optional[dict] = None,
):
    """Search by a pre-computed query vector (no embedding service needed).

    Returns ``{content, metadata, score}`` dicts; ``score`` is the backend's distance, lower is closer.
    """
    try:
        docs_with_scores = get_backend().search_by_vector(
            kb_id, embedding, top_k, filter_dict, EMBEDDINGS
        )
        return [
            {
                "content": doc.page_content,
                "metadata": doc.metadata,
                "score": float(score),
            }
            for doc, score in docs_with_scores
        ]
    except Exception as err:
        print(f"Error searching by vector: {err}")
        raise err


def get_all_chunks(kb_id, include_embeddings: bool = False):
    """Every chunk of a knowledge base, optionally with its embedding."""
    try:
        return get_backend().all_chunks(kb_id, include_embeddings, EMBEDDINGS)
    except Exception as err:
        print(f"Error retrieving chunks: {err}")
        raise err


# Chunk management


def _add_chunk_to_kb_internal(kb_id, content: str, metadata: dict = None):
    if metadata is None:
        metadata = {}
    if "source" not in metadata:
        metadata["source"] = "manual_chunk"

    os.makedirs(DATA_DIR / str(kb_id), exist_ok=True)
    document = Document(page_content=content.strip(), metadata=metadata)
    get_backend().add_documents(kb_id, [document], EMBEDDINGS)

    return {
        "success": True,
        "message": "Chunk added successfully",
        "chunk_info": {
            "content": content.strip(),
            "metadata": metadata,
            "content_length": len(content.strip()),
        },
    }


def add_chunk_to_kb(kb_id, content: str, metadata: dict = None):
    """Add a single text chunk to a knowledge base, creating the store if needed."""
    _require_embeddings()

    if not content or not content.strip():
        raise ValueError("Content cannot be empty")

    return _execute_kb_operation(
        kb_id,
        _add_chunk_to_kb_internal,
        kb_id,
        content,
        metadata,
    )


def _delete_chunks_from_kb_internal(kb_id, doc_ids: list):
    backend = get_backend()
    if not backend.kb_exists(kb_id):
        raise FileNotFoundError(f"Knowledge base {kb_id} not found")

    initial_count = backend.count(kb_id)
    deleted = backend.delete_ids(kb_id, doc_ids)

    if deleted:
        final_count = backend.count(kb_id)
        return {
            "success": True,
            "message": f"Successfully deleted {initial_count - final_count} chunks",
            "deletion_info": {
                "requested_ids": doc_ids,
                "initial_count": initial_count,
                "final_count": final_count,
                "deleted_count": initial_count - final_count,
            },
        }
    return {
        "success": False,
        "message": "No chunks were deleted (IDs may not exist)",
        "deletion_info": {
            "requested_ids": doc_ids,
            "initial_count": initial_count,
            "final_count": initial_count,
            "deleted_count": 0,
        },
    }


def delete_chunks_from_kb(kb_id, doc_ids: list):
    """Delete chunks from a knowledge base by document IDs."""
    if not doc_ids:
        raise ValueError("Document IDs list cannot be empty")

    return _execute_kb_operation(
        kb_id,
        _delete_chunks_from_kb_internal,
        kb_id,
        doc_ids,
    )


def _delete_chunks_by_source_internal(kb_id, source: str):
    backend = get_backend()
    if not backend.kb_exists(kb_id):
        raise FileNotFoundError(f"Knowledge base {kb_id} not found")

    initial_count = backend.count(kb_id)
    doc_ids_to_delete = backend.ids_for_source(kb_id, source)

    if not doc_ids_to_delete:
        return {
            "success": True,
            "message": f"No chunks found with source '{source}'",
            "deletion_info": {
                "source": source,
                "initial_count": initial_count,
                "final_count": initial_count,
                "deleted_count": 0,
            },
        }

    deleted = backend.delete_ids(kb_id, doc_ids_to_delete)

    if deleted:
        final_count = backend.count(kb_id)
        return {
            "success": True,
            "message": f"Successfully deleted {initial_count - final_count} chunks from source '{source}'",
            "deletion_info": {
                "source": source,
                "deleted_ids": doc_ids_to_delete,
                "initial_count": initial_count,
                "final_count": final_count,
                "deleted_count": initial_count - final_count,
            },
        }
    return {
        "success": False,
        "message": "Failed to delete chunks",
        "deletion_info": {
            "source": source,
            "initial_count": initial_count,
            "final_count": initial_count,
            "deleted_count": 0,
        },
    }


def delete_chunks_by_source(kb_id, source: str):
    """Delete all chunks from a knowledge base that match a specific source."""
    if not source or not source.strip():
        raise ValueError("Source cannot be empty")

    return _execute_kb_operation(
        kb_id,
        _delete_chunks_by_source_internal,
        kb_id,
        source,
    )


def _add_vectors_to_kb_internal(
    kb_id,
    embeddings: List[List[float]],
    contents: List[str],
    metadatas: List[dict],
):
    for meta in metadatas:
        if "source" not in meta:
            meta["source"] = "direct_vector"

    os.makedirs(DATA_DIR / str(kb_id), exist_ok=True)
    get_backend().add_embeddings(kb_id, contents, embeddings, metadatas, EMBEDDINGS)

    return {
        "success": True,
        "message": f"Successfully added {len(embeddings)} vectors",
        "info": {
            "vectors_added": len(embeddings),
            "dimension": len(embeddings[0]),
        },
    }


def add_vectors_to_kb(
    kb_id,
    embeddings: List[List[float]],
    contents: List[str],
    metadatas: List[dict],
):
    """Add pre-computed embedding vectors to a knowledge base (no embedding model needed)."""
    if not embeddings:
        raise ValueError("Embeddings list cannot be empty")
    if len(embeddings) != len(contents):
        raise ValueError("embeddings and contents must have the same length")

    return _execute_kb_operation(
        kb_id,
        _add_vectors_to_kb_internal,
        kb_id,
        embeddings,
        contents,
        metadatas,
    )
