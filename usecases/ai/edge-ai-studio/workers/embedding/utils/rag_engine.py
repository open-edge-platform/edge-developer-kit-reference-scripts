# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
from typing import List, Optional
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
    PDFMinerLoader,
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
    ".md": (UnstructuredMarkdownLoader, {}),
    ".odt": (UnstructuredODTLoader, {}),
    ".pdf": (PDFMinerLoader, {}),
    ".ppt": (UnstructuredPowerPointLoader, {}),
    ".pptx": (UnstructuredPowerPointLoader, {}),
    ".txt": (TextLoader, {"encoding": "utf8"}),
}

# Global variables to store configuration - will be initialized by configure_rag_engine()
COHERE_CLIENT = None
EMBEDDINGS = None
CONFIG = None


def configure_rag_engine(ovms_port: int, embedding_model: str, rerank_model: str):
    """Configure the RAG engine with the specified parameters."""
    global COHERE_CLIENT, EMBEDDINGS, CONFIG

    ovms_api_url = f"http://localhost:{ovms_port}/v3"

    CONFIG = {
        "ovms_api_url": ovms_api_url,
        "embedding_model": embedding_model,
        "rerank_model": rerank_model,
    }

    COHERE_CLIENT = cohere.ClientV2(
        api_key="-",
        base_url=ovms_api_url,
    )

    EMBEDDINGS = OpenAIEmbeddings(
        model=embedding_model,
        api_key="-",
        tiktoken_enabled=False,
        base_url=ovms_api_url,
        embedding_ctx_length=8190,
    )


def load_single_document(file_path: str) -> List[Document]:
    ext = "." + file_path.rsplit(".", 1)[-1]
    if ext in LOADERS:
        loader_class, loader_args = LOADERS[ext]
        loader = loader_class(file_path, **loader_args)
        return loader.load()
    raise ValueError(f"File does not exist '{ext}'")


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


def add_chunk_to_kb(kb_id, content: str, metadata: dict = None):
    """Add a single text chunk to a knowledge base.
    Creates an empty FAISS database if it doesn't exist.

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

    try:
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

    except Exception as err:
        print(f"Error adding chunk to KB: {err}")
        raise err


def delete_chunks_from_kb(kb_id, doc_ids: list):
    """Delete chunks from a knowledge base by document IDs.

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

    try:
        faiss_path = f"./data/{kb_id}/faissdb"

        # Check if FAISS database exists
        if not os.path.exists(faiss_path):
            raise FileNotFoundError(f"Knowledge base {kb_id} not found")

        # Load the FAISS database
        db = FAISS.load_local(
            faiss_path, EMBEDDINGS, allow_dangerous_deserialization=True
        )

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

    except Exception as err:
        print(f"Error deleting chunks from KB: {err}")
        raise err
