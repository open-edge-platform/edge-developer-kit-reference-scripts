# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import json
import queue
import threading
from typing import List, Optional, Callable, Any, Dict
from glob import glob
import requests

import numpy as np
from langchain_openai import OpenAIEmbeddings
from langchain_classic.retrievers import ContextualCompressionRetriever
from langchain_core.embeddings import Embeddings as LCEmbeddings
from langchain_text_splitters import (
    CharacterTextSplitter,
    RecursiveCharacterTextSplitter,
    MarkdownTextSplitter,
)
from langchain_community.document_loaders import (
    CSVLoader,
    EverNoteLoader,
    PyPDFLoader,
    TextLoader,
    UnstructuredEPubLoader,
    UnstructuredHTMLLoader,
    UnstructuredMarkdownLoader,
    UnstructuredODTLoader,
    UnstructuredPowerPointLoader,
    UnstructuredWordDocumentLoader,
)

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_cohere import CohereRerank
import cohere

TEXT_SPLITTERS = {
    "Character": CharacterTextSplitter,
    "RecursiveCharacter": RecursiveCharacterTextSplitter,
    "Markdown": MarkdownTextSplitter,
}

LOADERS = {
    ".csv": (CSVLoader, {}),
    ".doc": (UnstructuredWordDocumentLoader, {}),
    ".docx": (UnstructuredWordDocumentLoader, {}),
    ".enex": (EverNoteLoader, {}),
    ".epub": (UnstructuredEPubLoader, {}),
    ".html": (UnstructuredHTMLLoader, {}),
    ".json": ("JSONLoader", {}),  # Custom handler
    ".md": (UnstructuredMarkdownLoader, {}),
    ".odt": (UnstructuredODTLoader, {}),
    ".pdf": (PyPDFLoader, {}),
    ".ppt": (UnstructuredPowerPointLoader, {}),
    ".pptx": (UnstructuredPowerPointLoader, {}),
    ".txt": (TextLoader, {"encoding": "utf8"}),
}

# Global variables to store configuration - will be initialized by configure_rag_engine()
COHERE_CLIENT = None
EMBEDDINGS = None
CONFIG = None

# Queue-based synchronization for knowledge base operations
# Prevents race conditions when multiple requests update the same KB simultaneously
_kb_operation_queues: Dict[Any, queue.Queue] = {}
_kb_worker_threads: Dict[Any, threading.Thread] = {}
_kb_queues_lock = threading.Lock()


class _DummyEmbeddings(LCEmbeddings):
    """Minimal embeddings wrapper used to load FAISS DBs for vector-only operations.

    When callers provide pre-computed vectors, we don't need a real embedding model
    — but FAISS.load_local requires an Embeddings instance.
    """

    def __init__(self, dimension: int):
        self._dimension = dimension

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [list(np.zeros(self._dimension)) for _ in texts]

    def embed_query(self, text: str) -> List[float]:
        return list(np.zeros(self._dimension))


def _kb_worker(kb_id, op_queue: queue.Queue):
    """Worker thread that processes KB operations sequentially from a queue.

    This ensures that all operations on a KB happen one at a time,
    preventing race conditions from concurrent requests.
    """
    while True:
        try:
            # Get operation from queue (blocks until available)
            operation = op_queue.get(timeout=1)

            if operation is None:  # Sentinel value to stop worker
                break

            func, args, kwargs, result_queue, error_queue = operation

            try:
                # Execute the operation
                result = func(*args, **kwargs)
                result_queue.put(result)
            except Exception as e:
                error_queue.put(e)
            finally:
                op_queue.task_done()

        except queue.Empty:
            continue
        except Exception as e:
            print(f"KB worker error for kb_id={kb_id}: {e}", flush=True)


def _get_or_create_kb_queue(kb_id) -> queue.Queue:
    """Get or create an operation queue for a specific knowledge base.

    Also ensures a worker thread is running for this KB.
    """
    with _kb_queues_lock:
        if kb_id not in _kb_operation_queues:
            # Create new queue for this KB
            _kb_operation_queues[kb_id] = queue.Queue()

            # Start worker thread for this KB
            worker = threading.Thread(
                target=_kb_worker,
                args=(kb_id, _kb_operation_queues[kb_id]),
                daemon=True,
                name=f"KB-Worker-{kb_id}",
            )
            worker.start()
            _kb_worker_threads[kb_id] = worker

        return _kb_operation_queues[kb_id]


def _execute_kb_operation(kb_id, func: Callable, *args, **kwargs) -> Any:
    """Execute a KB operation through the queue system.

    This ensures operations on the same KB are serialized,
    preventing race conditions when multiple requests arrive simultaneously.

    Args:
        kb_id: Knowledge base identifier
        func: Function to execute
        *args: Positional arguments for the function
        **kwargs: Keyword arguments for the function

    Returns:
        Result from the function execution

    Raises:
        Any exception raised by the function
    """
    op_queue = _get_or_create_kb_queue(kb_id)
    result_queue = queue.Queue()
    error_queue = queue.Queue()

    # Submit operation to the queue
    op_queue.put((func, args, kwargs, result_queue, error_queue))

    # Wait for result or error
    while True:
        try:
            # Check for error first
            error = error_queue.get_nowait()
            raise error
        except queue.Empty:
            pass

        try:
            # Check for result
            result = result_queue.get(timeout=0.1)
            return result
        except queue.Empty:
            continue


def configure_rag_engine(
    embedding_url: str,
    embedding_model: str,
    reranker_url: str = None,
    reranker_model: str = None,
):
    """Configure the RAG engine with external embedding/reranker service URLs.

    Args:
        embedding_url: Base URL of the embedding service (e.g. http://localhost:8001/v1)
        embedding_model: Model name to use for embeddings
        reranker_url: Base URL of the reranker service (optional)
        reranker_model: Model name to use for reranking (optional)
    """
    global COHERE_CLIENT, EMBEDDINGS, CONFIG

    CONFIG = {
        "embedding_url": embedding_url,
        "embedding_model": embedding_model,
        "reranker_url": reranker_url,
        "reranker_model": reranker_model,
        "use_custom_reranker": False,
    }

    if reranker_url and reranker_model:
        # If the provided reranker model looks like an OpenVINO/local model,
        # don't create a Cohere client — use a simple HTTP reranker instead.
        if (
            reranker_model.lower().startswith("openvino:")
            or "openvino" in reranker_model.lower()
        ):
            # Keep reranker_url/model in CONFIG and mark custom reranker usage
            CONFIG["use_custom_reranker"] = True
            # COHERE_CLIENT remains None when using custom HTTP reranker
            COHERE_CLIENT = None
        else:
            # Strip /v1 suffix from reranker_url for the cohere client base_url
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


def _custom_rerank_candidates(
    reranker_url: str,
    reranker_model: str,
    query: str,
    candidates: List[Document],
    top_n: int = 3,
) -> List[Document]:
    """Call a custom HTTP reranker service to reorder candidate documents.

    The function is intentionally permissive about response shape:
    - If the service returns a list of scores (floats) matching candidates order, those are used.
    - If the service returns a list of dicts with `score` and optionally `index`/`text`, those are used.
    - Otherwise, falls back to the original order and returns the top_n candidates.
    """
    if not reranker_url:
        return candidates[:top_n]

    base = reranker_url.rstrip("/")
    # ensure endpoint points at /v1/rerank (common pattern)
    if base.endswith("/v1"):
        endpoint = f"{base}/rerank"
    else:
        endpoint = f"{base}/v1/rerank"

    payload = {
        "model": reranker_model,
        "query": query,
        "candidates": [d.page_content for d in candidates],
    }

    try:
        resp = requests.post(endpoint, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        scores = None
        # If response is a plain list of numbers
        if isinstance(data, list) and all(isinstance(x, (int, float)) for x in data):
            scores = [float(x) for x in data]
        elif isinstance(data, dict):
            # common keys: 'scores', 'results', 'ranked'
            if "scores" in data and isinstance(data["scores"], list):
                scores = [float(x) for x in data["scores"]]
            elif "results" in data and isinstance(data["results"], list):
                # results may be list of {index, score}
                entries = data["results"]
                if all(isinstance(e, dict) and "score" in e for e in entries):
                    # build score list aligned by candidate index if provided
                    if all("index" in e for e in entries):
                        idx_map = {int(e["index"]): float(e["score"]) for e in entries}
                        scores = [idx_map.get(i, 0.0) for i in range(len(candidates))]
                    else:
                        scores = [float(e["score"]) for e in entries]
            elif "ranked" in data and isinstance(data["ranked"], list):
                # ranked: list of indices in preferred order
                ranked = data["ranked"]
                ordered = []
                for r in ranked:
                    try:
                        ordered.append(candidates[int(r)])
                    except Exception:
                        continue
                return ordered[:top_n]

        # If we have scores, sort candidates by score descending
        if scores and len(scores) >= len(candidates):
            scored = list(zip(candidates, scores))
            scored.sort(key=lambda x: x[1], reverse=True)
            return [d for d, s in scored][:top_n]

    except Exception as e:
        print(f"Custom reranker call failed ({endpoint}): {e}", flush=True)

    # Fallback: return top_n original candidates
    return candidates[:top_n]


def load_json_documents(file_path: str) -> List[Document]:
    """Load JSON file and create a document for each object in the array.

    If the JSON file contains:
    - An array of objects: Each object becomes a separate document
    - A single object: The object becomes one document

    Args:
        file_path: Path to the JSON file

    Returns:
        List of Document objects, one per JSON object
    """
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    documents = []

    # Handle both single object and array of objects
    if isinstance(data, list):
        for idx, obj in enumerate(data):
            content = json.dumps(obj, indent=2, ensure_ascii=False)
            metadata = {
                "source": file_path,
                "json_index": idx,
                "object_type": type(obj).__name__,
            }
            documents.append(Document(page_content=content, metadata=metadata))
    else:
        # Single JSON object
        content = json.dumps(data, indent=2, ensure_ascii=False)
        metadata = {
            "source": file_path,
            "json_index": 0,
            "object_type": type(data).__name__,
        }
        documents.append(Document(page_content=content, metadata=metadata))

    return documents


def load_single_document(file_path: str) -> List[Document]:
    ext = "." + file_path.rsplit(".", 1)[-1]
    if ext in LOADERS:
        loader_class, loader_args = LOADERS[ext]

        # Handle custom JSON loader
        if loader_class == "JSONLoader":
            return load_json_documents(file_path)

        loader = loader_class(file_path, **loader_args)
        return loader.load()
    raise ValueError(f"File does not exist '{ext}'")


def _create_embeddings_for_file_internal(
    kb_id,
    file_path: str,
    splitter_name: str = "RecursiveCharacter",
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
):
    """Internal function that performs the actual embedding creation.

    This is called by the queue worker thread to ensure serialized access.
    """
    # First, delete any existing chunks from this source
    faiss_path = f"./data/{kb_id}/faissdb"
    if os.path.exists(faiss_path):
        try:
            _delete_chunks_by_source_internal(kb_id, file_path)
            print(f"Deleted existing chunks from {file_path}", flush=True)
        except Exception as e:
            print(f"No existing chunks to delete: {e}", flush=True)

    # Load the document
    print(f"Reading document {file_path}...", flush=True)
    documents = load_single_document(file_path)

    # Split the documents
    text_splitter = TEXT_SPLITTERS[splitter_name](
        chunk_size=chunk_size, chunk_overlap=chunk_overlap
    )
    texts = text_splitter.split_documents(documents)

    data_dir = f"./data/{kb_id}"

    # Ensure data directory exists
    if not os.path.exists(data_dir):
        os.makedirs(data_dir, exist_ok=True)

    # Check if FAISS database already exists
    if os.path.exists(faiss_path):
        # Load existing FAISS database and add new documents
        db = FAISS.load_local(
            faiss_path, EMBEDDINGS, allow_dangerous_deserialization=True
        )
        # Add the new documents to the existing vector store
        db.add_documents(texts)
    else:
        # Create new FAISS database from documents
        db = FAISS.from_documents(texts, EMBEDDINGS)

    # Save the database (whether new or updated)
    db.save_local(faiss_path)

    return {
        "success": True,
        "message": f"Successfully created embeddings for {os.path.basename(file_path)}",
        "file_info": {
            "file_path": file_path,
            "chunks_created": len(texts),
            "splitter_name": splitter_name,
            "chunk_size": chunk_size,
            "chunk_overlap": chunk_overlap,
        },
    }


def create_embeddings_for_file(
    kb_id,
    file_path: str,
    splitter_name: str = "RecursiveCharacter",
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
):
    """Create embeddings for a single file and add to existing knowledge base.

    This function uses a queue-based system to ensure that operations on the same
    knowledge base are executed sequentially, preventing race conditions when
    multiple requests arrive simultaneously.

    Args:
        kb_id: Knowledge base ID
        file_path: Full path to the file to process
        splitter_name: Name of the text splitter ("Character", "RecursiveCharacter", "Markdown")
        chunk_size: Size of each text chunk (default: 1000)
        chunk_overlap: Overlap between chunks (default: 200)

    Returns:
        dict: Success status and processing information
    """
    if EMBEDDINGS is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )

    # Validate splitter name
    if splitter_name not in TEXT_SPLITTERS:
        raise ValueError(
            f"Invalid splitter_name. Must be one of: {list(TEXT_SPLITTERS.keys())}"
        )

    # Check if file exists
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    # Execute through queue to prevent race conditions
    return _execute_kb_operation(
        kb_id,
        _create_embeddings_for_file_internal,
        kb_id,
        file_path,
        splitter_name,
        chunk_size,
        chunk_overlap,
    )


def create_data_embedding(
    kb_id,
    input_path: str,
    splitter_name: str = "RecursiveCharacter",
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
):
    """Create embeddings for documents in the knowledge base.

    Args:
        kb_id: Knowledge base ID
        input_path: Path to the directory containing documents
        splitter_name: Name of the text splitter ("Character", "RecursiveCharacter", "Markdown")
        chunk_size: Size of each text chunk (default: 1000)
        chunk_overlap: Overlap between chunks (default: 200)
    """
    if EMBEDDINGS is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )

    # Validate splitter name
    if splitter_name not in TEXT_SPLITTERS:
        raise ValueError(
            f"Invalid splitter_name. Must be one of: {list(TEXT_SPLITTERS.keys())}"
        )

    documents = []
    for file in glob(f"{input_path}/*"):
        if os.path.isfile(file):
            print(f"Reading document {file}...", flush=True)
            documents.extend(load_single_document(file))

    text_splitter = TEXT_SPLITTERS[splitter_name](
        chunk_size=chunk_size, chunk_overlap=chunk_overlap
    )
    texts = text_splitter.split_documents(documents)

    faiss_path = f"./data/{kb_id}/faissdb"
    data_dir = f"./data/{kb_id}"

    # Ensure data directory exists
    if not os.path.exists(data_dir):
        os.makedirs(data_dir, exist_ok=True)

    # Check if FAISS database already exists
    if os.path.exists(faiss_path):
        # Load existing FAISS database and add new documents
        db = FAISS.load_local(
            faiss_path, EMBEDDINGS, allow_dangerous_deserialization=True
        )
        # Add the new documents to the existing vector store
        db.add_documents(texts)
    else:
        # Create new FAISS database from documents
        db = FAISS.from_documents(texts, EMBEDDINGS)

    # Save the database (whether new or updated)
    db.save_local(faiss_path)

    return True


def search_information(
    kb_id,
    query: str,
    top_n: int = 3,
    search_type: str = "similarity",
    retriever_kwargs: Optional[dict] = None,
):
    """Search information in the knowledge base.

    Args:
        kb_id: Knowledge base ID
        query: Search query string
        top_n: Number of documents to return after reranking (default: 3)
        search_type: Type of search ("similarity", "mmr", "similarity_score_threshold", default: "similarity")
        retriever_kwargs: Keyword arguments for the retriever.
    """
    if EMBEDDINGS is None or CONFIG is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )

    try:
        db = FAISS.load_local(
            f"./data/{kb_id}/faissdb", EMBEDDINGS, allow_dangerous_deserialization=True
        )

        # Set default retriever kwargs based on search type
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

        retriever = db.as_retriever(
            search_type=search_type, search_kwargs=search_kwargs
        )

        # Use reranker if configured. Prefer a custom HTTP reranker for local/OpenVINO
        # deployments; otherwise use the Cohere-based reranker when a Cohere client
        # is available. If no reranker is configured, return retriever results.
        if CONFIG.get("use_custom_reranker"):
            # Get initial candidates from retriever, then call custom reranker
            try:
                candidates = retriever.invoke(query)
                result = _custom_rerank_candidates(
                    CONFIG.get("reranker_url"),
                    CONFIG.get("reranker_model"),
                    query,
                    candidates,
                    top_n,
                )
            except Exception as e:
                print(f"Custom reranker failed: {e}", flush=True)
                result = retriever.invoke(query)
        elif COHERE_CLIENT is not None and CONFIG.get("reranker_model"):
            compressor = CohereRerank(
                model=CONFIG["reranker_model"], client=COHERE_CLIENT, top_n=top_n
            )
            compression_retriever = ContextualCompressionRetriever(
                base_compressor=compressor, base_retriever=retriever
            )
            result = compression_retriever.invoke(query)
        else:
            result = retriever.invoke(query)

    except Exception as err:
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
    """Search the knowledge base using a pre-computed query embedding vector.

    This does NOT require embedding services to be configured.

    Args:
        kb_id: Knowledge base ID
        embedding: Pre-computed query embedding vector
        top_k: Number of results to return
        filter_dict: Optional filter by document metadata

    Returns:
        List of dicts with 'content', 'metadata', and 'score' keys.
    """
    try:
        faiss_path = f"./data/{kb_id}/faissdb"

        # We need EMBEDDINGS to load FAISS, but for vector search we can use a
        # dummy embedding function. If EMBEDDINGS is configured, use it.
        if EMBEDDINGS is not None:
            db = FAISS.load_local(
                faiss_path, EMBEDDINGS, allow_dangerous_deserialization=True
            )
        else:
            # Create a minimal embedding wrapper to satisfy FAISS.load_local
            db = FAISS.load_local(
                faiss_path,
                _DummyEmbeddings(len(embedding)),
                allow_dangerous_deserialization=True,
            )

        kwargs = {}
        if filter_dict:
            kwargs["filter"] = filter_dict

        docs_with_scores = db.similarity_search_by_vector(embedding, k=top_k, **kwargs)

        results = []
        for doc, score in docs_with_scores:
            results.append(
                {
                    "content": doc.page_content,
                    "metadata": doc.metadata,
                    "score": float(score),
                }
            )

        return results

    except Exception as err:
        print(f"Error searching by vector: {err}")
        raise err


def get_all_chunks(kb_id, include_embeddings: bool = False):
    """Retrieve all chunks from a knowledge base.

    Args:
        kb_id: Knowledge base ID
        include_embeddings: Whether to include embedding vectors in the response (default: False)

    Returns:
        List of dictionaries with chunk information, optionally including embeddings
    """
    if EMBEDDINGS is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )

    try:
        faiss_path = f"./data/{kb_id}/faissdb"
        print(f"Loading FAISS database from: {faiss_path}")

        db = FAISS.load_local(
            faiss_path, EMBEDDINGS, allow_dangerous_deserialization=True
        )

        # Get all documents from the vector store
        all_docs = db.get_by_ids(list(db.index_to_docstore_id.values()))

        chunks = []
        for i, doc in enumerate(all_docs):
            chunk_data = {
                "chunk_id": i,
                "doc_id": doc.id,
                "content": doc.page_content,
                "metadata": doc.metadata,
            }

            if include_embeddings:
                try:
                    chunk_data["embedding"] = db.index.reconstruct(i).tolist()
                except Exception:
                    chunk_data["embedding"] = None

            chunks.append(chunk_data)

        return chunks

    except Exception as err:
        print(f"Error retrieving chunks: {err}")
        raise err


def _add_chunk_to_kb_internal(kb_id, content: str, metadata: dict = None):
    """Internal function that performs the actual chunk addition.

    This is called by the queue worker thread to ensure serialized access.
    """
    faiss_path = f"./data/{kb_id}/faissdb"
    data_dir = f"./data/{kb_id}"

    # Ensure data directory exists
    if not os.path.exists(data_dir):
        os.makedirs(data_dir, exist_ok=True)

    # Create a document object first
    if metadata is None:
        metadata = {}

    # Add source information to metadata
    if "source" not in metadata:
        metadata["source"] = "manual_chunk"

    document = Document(page_content=content.strip(), metadata=metadata)

    # Check if FAISS database exists
    if os.path.exists(faiss_path):
        # Load existing FAISS database
        db = FAISS.load_local(
            faiss_path, EMBEDDINGS, allow_dangerous_deserialization=True
        )
        # Add the document to the existing vector store
        db.add_documents([document])
    else:
        # Create new FAISS database from this first document
        db = FAISS.from_documents([document], EMBEDDINGS)

    # Save the database (whether new or updated)
    db.save_local(faiss_path)

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
    """Add a single text chunk to a knowledge base.
    Creates an empty FAISS database if it doesn't exist.

    This function uses a queue-based system to ensure that operations on the same
    knowledge base are executed sequentially, preventing race conditions.

    Args:
        kb_id: Knowledge base ID
        content: Text content of the chunk
        metadata: Optional metadata for the chunk

    Returns:
        dict: Success status and chunk information
    """
    if EMBEDDINGS is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )

    if not content or not content.strip():
        raise ValueError("Content cannot be empty")

    # Execute through queue to prevent race conditions
    return _execute_kb_operation(
        kb_id,
        _add_chunk_to_kb_internal,
        kb_id,
        content,
        metadata,
    )


def _delete_chunks_from_kb_internal(kb_id, doc_ids: list):
    """Internal function that performs the actual chunk deletion by IDs.

    This is called by the queue worker thread to ensure serialized access.
    """
    faiss_path = f"./data/{kb_id}/faissdb"

    # Check if FAISS database exists
    if not os.path.exists(faiss_path):
        raise FileNotFoundError(f"Knowledge base {kb_id} not found")

    # Load the FAISS database
    db = FAISS.load_local(faiss_path, EMBEDDINGS, allow_dangerous_deserialization=True)

    # Get existing document count
    initial_count = db.index.ntotal

    # Delete documents by IDs
    deleted = db.delete(doc_ids)

    if deleted:
        # Save the updated database
        db.save_local(faiss_path)
        final_count = db.index.ntotal
        deleted_count = initial_count - final_count

        return {
            "success": True,
            "message": f"Successfully deleted {deleted_count} chunks",
            "deletion_info": {
                "requested_ids": doc_ids,
                "initial_count": initial_count,
                "final_count": final_count,
                "deleted_count": deleted_count,
            },
        }
    else:
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
    """Delete chunks from a knowledge base by document IDs.

    This function uses a queue-based system to ensure that operations on the same
    knowledge base are executed sequentially, preventing race conditions.

    Args:
        kb_id: Knowledge base ID
        doc_ids: List of document IDs to delete

    Returns:
        dict: Success status and deletion information
    """
    if EMBEDDINGS is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )

    if not doc_ids:
        raise ValueError("Document IDs list cannot be empty")

    # Execute through queue to prevent race conditions
    return _execute_kb_operation(
        kb_id,
        _delete_chunks_from_kb_internal,
        kb_id,
        doc_ids,
    )


def _delete_chunks_by_source_internal(kb_id, source: str):
    """Internal function that performs the actual chunk deletion by source.

    This is called by the queue worker or internal operations to ensure serialized access.
    """
    faiss_path = f"./data/{kb_id}/faissdb"

    # Check if FAISS database exists
    if not os.path.exists(faiss_path):
        raise FileNotFoundError(f"Knowledge base {kb_id} not found")

    # Load the FAISS database
    db = FAISS.load_local(faiss_path, EMBEDDINGS, allow_dangerous_deserialization=True)

    # Get existing document count
    initial_count = db.index.ntotal

    # Get all documents and find those matching the source
    all_docs = db.get_by_ids(list(db.index_to_docstore_id.values()))
    doc_ids_to_delete = []

    for doc in all_docs:
        if doc.metadata.get("source") == source:
            doc_ids_to_delete.append(doc.id)

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

    # Delete documents by IDs
    deleted = db.delete(doc_ids_to_delete)

    if deleted:
        # Save the updated database
        db.save_local(faiss_path)
        final_count = db.index.ntotal
        deleted_count = initial_count - final_count

        return {
            "success": True,
            "message": f"Successfully deleted {deleted_count} chunks from source '{source}'",
            "deletion_info": {
                "source": source,
                "deleted_ids": doc_ids_to_delete,
                "initial_count": initial_count,
                "final_count": final_count,
                "deleted_count": deleted_count,
            },
        }
    else:
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
    """Delete all chunks from a knowledge base that match a specific source.

    This function uses a queue-based system to ensure that operations on the same
    knowledge base are executed sequentially, preventing race conditions.

    Args:
        kb_id: Knowledge base ID
        source: Source path or identifier to match (e.g., file path or 'manual_chunk')

    Returns:
        dict: Success status and deletion information
    """
    if EMBEDDINGS is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )

    if not source or not source.strip():
        raise ValueError("Source cannot be empty")

    # Execute through queue to prevent race conditions
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
    """Internal function that adds pre-computed vectors to the FAISS DB.

    This is called by the queue worker thread to ensure serialized access.
    """
    faiss_path = f"./data/{kb_id}/faissdb"
    data_dir = f"./data/{kb_id}"

    if not os.path.exists(data_dir):
        os.makedirs(data_dir, exist_ok=True)

    # Ensure all metadata have a source field
    for meta in metadatas:
        if "source" not in meta:
            meta["source"] = "direct_vector"

    documents = [
        Document(page_content=content, metadata=meta)
        for content, meta in zip(contents, metadatas)
    ]

    dimension = len(embeddings[0])
    text_embedding_pairs = list(
        zip([doc.page_content for doc in documents], embeddings)
    )

    if os.path.exists(faiss_path):
        # Load existing and add
        emb_fn = EMBEDDINGS if EMBEDDINGS is not None else _DummyEmbeddings(dimension)
        db = FAISS.load_local(faiss_path, emb_fn, allow_dangerous_deserialization=True)
        db.add_embeddings(
            text_embeddings=text_embedding_pairs,
            metadatas=[doc.metadata for doc in documents],
        )
    else:
        # Create new FAISS DB from vectors
        emb_fn = EMBEDDINGS if EMBEDDINGS is not None else _DummyEmbeddings(dimension)
        db = FAISS.from_embeddings(
            text_embeddings=text_embedding_pairs,
            embedding=emb_fn,
            metadatas=[doc.metadata for doc in documents],
        )

    db.save_local(faiss_path)

    return {
        "success": True,
        "message": f"Successfully added {len(embeddings)} vectors",
        "info": {
            "vectors_added": len(embeddings),
            "dimension": dimension,
        },
    }


def add_vectors_to_kb(
    kb_id,
    embeddings: List[List[float]],
    contents: List[str],
    metadatas: List[dict],
):
    """Add pre-computed embedding vectors to a knowledge base.

    This does NOT require the RAG engine to be configured with an embedding model.

    Args:
        kb_id: Knowledge base ID
        embeddings: List of embedding vectors
        contents: List of text contents
        metadatas: List of metadata dicts

    Returns:
        dict: Success status and info
    """
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
