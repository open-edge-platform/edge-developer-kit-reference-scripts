# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import json
import queue
import threading
from typing import List, Optional, Callable, Any, Dict
from glob import glob

from langchain_openai import OpenAIEmbeddings
from langchain.retrievers.contextual_compression import ContextualCompressionRetriever
from langchain.text_splitter import (
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
from langchain.docstore.document import Document
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


def configure_rag_engine(serving_port: int, embedding_model: str, rerank_model: str):
    """Configure the RAG engine with the specified parameters."""
    global COHERE_CLIENT, EMBEDDINGS, CONFIG

    api_url = f"http://localhost:{serving_port}/v1"
    CONFIG = {
        "api_url": api_url,
        "embedding_model": embedding_model,
        "rerank_model": rerank_model,
    }

    COHERE_CLIENT = cohere.ClientV2(
        api_key="-",
        base_url=f"http://localhost:{serving_port}",
    )

    EMBEDDINGS = OpenAIEmbeddings(
        model=embedding_model,
        api_key="-",
        tiktoken_enabled=False,
        base_url=api_url,
        embedding_ctx_length=8190,
        check_embedding_ctx_length=False,
    )


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
        retriever_kwargs: Keyword arguments for the retriever. Relevant parameters depend on search_type:
            - similarity: k, filter
            - mmr: k, fetch_k, lambda_mult, filter
            - similarity_score_threshold: k, score_threshold, filter
    """
    if EMBEDDINGS is None or COHERE_CLIENT is None or CONFIG is None:
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
            # Filter kwargs based on search type to include only relevant parameters
            if search_type == "similarity":
                # Only k and filter are relevant for similarity search
                for key in ["k", "filter"]:
                    if key in retriever_kwargs:
                        search_kwargs[key] = retriever_kwargs[key]
            elif search_type == "mmr":
                # k, fetch_k, lambda_mult, filter are relevant for MMR
                for key in ["k", "fetch_k", "lambda_mult", "filter"]:
                    if key in retriever_kwargs:
                        search_kwargs[key] = retriever_kwargs[key]
            elif search_type == "similarity_score_threshold":
                # k, score_threshold, filter are relevant for similarity_score_threshold
                for key in ["k", "score_threshold", "filter"]:
                    if key in retriever_kwargs:
                        search_kwargs[key] = retriever_kwargs[key]
            else:
                # For unknown search types, include all provided kwargs
                search_kwargs.update(retriever_kwargs)

        retriever = db.as_retriever(
            search_type=search_type, search_kwargs=search_kwargs
        )
        compressor = CohereRerank(
            model=CONFIG["rerank_model"], client=COHERE_CLIENT, top_n=top_n
        )
        compression_retriever = ContextualCompressionRetriever(
            base_compressor=compressor, base_retriever=retriever
        )

        result = compression_retriever.invoke(query)
    except Exception as err:
        print(err)
        result = []

    return result


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
