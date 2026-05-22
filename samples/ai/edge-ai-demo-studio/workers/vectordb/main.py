# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import shutil
import argparse
import logging
import multiprocessing
from contextlib import asynccontextmanager

import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI, UploadFile, Depends, Query, APIRouter
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException

from glob import glob
from pathlib import Path
from sqlmodel import Field, Session, SQLModel, select
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from utils.rag_engine import (
    configure_rag_engine,
    create_data_embedding,
    create_embeddings_for_file,
    search_information,
    search_by_vector,
    get_all_chunks,
    add_chunk_to_kb,
    add_vectors_to_kb,
    delete_chunks_from_kb,
    delete_chunks_by_source,
)
from utils.database import create_db_and_tables, get_session

os.makedirs("data", exist_ok=True)

logger = logging.getLogger("uvicorn.error")

CONFIG = {
    "embedding_url": None,
    "embedding_model": None,
    "reranker_url": None,
    "reranker_model": None,
}


class KnowledgeBase(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    db: str = Field(default="")


class KnowledgeFile(BaseModel):
    name: str


class ConfigureRequest(BaseModel):
    """Request model for configuring external embedding/reranker services."""

    embedding_url: str = Field(
        ..., description="Base URL of the external embedding service (e.g. http://localhost:8001/v1)"
    )
    embedding_model: str = Field(
        ..., description="Model name to use for embeddings"
    )
    reranker_url: Optional[str] = Field(
        None, description="Base URL of the external reranker service (e.g. http://localhost:8002/v1)"
    )
    reranker_model: Optional[str] = Field(
        None, description="Model name to use for reranking"
    )


class SearchRequest(BaseModel):
    """Request model for knowledge base search."""

    query: str = Field(..., description="Search query string")
    search_type: str = Field(
        "similarity",
        description="Type of search: 'similarity', 'mmr', or 'similarity_score_threshold'",
    )
    top_k: int = Field(
        4, description="Number of documents to retrieve from vector search"
    )
    top_n: int = Field(3, description="Number of documents to return after reranking")
    score_threshold: Optional[float] = Field(
        None,
        description="Minimum relevance threshold (only for similarity_score_threshold)",
    )
    fetch_k: int = Field(
        20, description="Amount of documents to pass to MMR algorithm (only for mmr)"
    )
    lambda_mult: float = Field(
        0.5,
        description="Diversity of results returned by MMR (only for mmr, 1=min diversity, 0=max diversity)",
    )
    filter: Optional[Dict[str, Any]] = Field(
        None, description="Filter by document metadata"
    )


class SearchByVectorRequest(BaseModel):
    """Request model for searching by a pre-computed embedding vector."""

    embedding: List[float] = Field(
        ..., description="Pre-computed query embedding vector"
    )
    top_k: int = Field(4, description="Number of results to return")
    filter: Optional[Dict[str, Any]] = Field(
        None, description="Filter by document metadata"
    )


class CreateEmbeddingsRequest(BaseModel):
    """Request model for creating knowledge base embeddings."""

    splitter_name: str = Field(
        "RecursiveCharacter",
        description="Type of text splitter: 'Character', 'RecursiveCharacter', or 'Markdown'",
    )
    chunk_size: int = Field(
        512, description="Size of each text chunk (default: 512)", gt=0
    )
    chunk_overlap: int = Field(
        200, description="Overlap between chunks (default: 200)", ge=0
    )


class CreateFileEmbeddingsRequest(BaseModel):
    """Request model for creating embeddings for a single file."""

    filename: str = Field(
        ..., description="Name of the file to create embeddings for", min_length=1
    )
    splitter_name: str = Field(
        "RecursiveCharacter",
        description="Type of text splitter: 'Character', 'RecursiveCharacter', or 'Markdown'",
    )
    chunk_size: int = Field(
        512, description="Size of each text chunk (default: 512)", gt=0
    )
    chunk_overlap: int = Field(
        200, description="Overlap between chunks (default: 200)", ge=0
    )


class AddChunkRequest(BaseModel):
    """Request model for manually adding a text chunk to knowledge base."""

    content: str = Field(..., description="Text content of the chunk", min_length=1)
    metadata: Optional[Dict[str, Any]] = Field(
        None, description="Optional metadata for the chunk"
    )


class AddVectorsRequest(BaseModel):
    """Request model for adding pre-computed embedding vectors to knowledge base."""

    vectors: List[Dict[str, Any]] = Field(
        ...,
        description="List of objects with 'embedding' (list of floats), 'content' (str), and optional 'metadata' (dict)",
        min_length=1,
    )


class DeleteChunksRequest(BaseModel):
    """Request model for deleting chunks from knowledge base by document IDs."""

    doc_ids: List[str] = Field(
        ...,
        description="List of document IDs to delete from the knowledge base",
        min_length=1,
    )


class DeleteChunksBySourceRequest(BaseModel):
    """Request model for deleting chunks from knowledge base by source."""

    source: str = Field(
        ...,
        description="Filename (e.g., 'document.pdf') or special identifier (e.g., 'manual_chunk')",
        min_length=1,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    logger.info("Vector DB storage service starting...")
    logger.info(f"CONFIG: {CONFIG}")

    # If embedding URL is already configured via CLI args, configure the RAG engine
    if CONFIG.get("embedding_url") and CONFIG.get("embedding_model"):
        logger.info("Configuring RAG engine from CLI args...")
        configure_rag_engine(
            embedding_url=CONFIG["embedding_url"],
            embedding_model=CONFIG["embedding_model"],
            reranker_url=CONFIG.get("reranker_url"),
            reranker_model=CONFIG.get("reranker_model"),
        )

    yield


allowed_cors = json.loads(os.getenv("ALLOWED_CORS", '["http://localhost"]'))
app = FastAPI(lifespan=lifespan)
v1_router = APIRouter(prefix="/v1")
app.mount("/static", StaticFiles(directory="data", html=True), name="static")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthcheck", status_code=200)
def get_healthcheck():
    return "OK"


@v1_router.post("/configure", name="Configure Embedding Services")
def configure_services(request: ConfigureRequest):
    """Configure the external embedding and reranker service URLs and models.

    This must be called before using embedding-dependent operations
    (create embeddings, search, add chunks via text).
    """
    CONFIG["embedding_url"] = request.embedding_url
    CONFIG["embedding_model"] = request.embedding_model
    CONFIG["reranker_url"] = request.reranker_url
    CONFIG["reranker_model"] = request.reranker_model

    configure_rag_engine(
        embedding_url=request.embedding_url,
        embedding_model=request.embedding_model,
        reranker_url=request.reranker_url,
        reranker_model=request.reranker_model,
    )

    logger.info(
        f"Configured embedding service: url={request.embedding_url} model={request.embedding_model}"
    )
    if request.reranker_url:
        logger.info(
            f"Configured reranker service: url={request.reranker_url} model={request.reranker_model}"
        )

    return {"status": "ok", "config": CONFIG}


@v1_router.get("/config", name="Get Current Config")
def get_config():
    """Get the current embedding/reranker configuration."""
    return CONFIG


@v1_router.get("/kb", name="Get KB List")
def get_kb_list(session: Session = Depends(get_session)) -> list[KnowledgeBase]:
    kbs = session.exec(select(KnowledgeBase)).all()
    return kbs


@v1_router.get("/kb/{id}")
def get_kb(id, session: Session = Depends(get_session)):
    kb = session.get(KnowledgeBase, id)
    if not kb:
        raise HTTPException(status_code=404, detail="Kb not found")
    return kb


@v1_router.post("/kb", name="Create New KB")
def create_kb(kb: KnowledgeBase, session: Session = Depends(get_session)):
    session.add(kb)
    session.commit()
    session.refresh(kb)
    return kb


@v1_router.delete("/kb/{id}", name="Delete KB")
def delete_kb(id: int, session: Session = Depends(get_session)):
    kb = session.get(KnowledgeBase, id)
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge Not Found")

    if os.path.exists(f"./data/{id}"):
        shutil.rmtree(f"./data/{id}")

    session.delete(kb)
    session.commit()
    kbs = session.exec(select(KnowledgeBase)).all()
    return kbs


@v1_router.get("/kb/{id}/files")
def get_file_list(id: int):
    files = []
    for file in glob(f"./data/{id}/*"):
        if os.path.isfile(file):
            files.append({"id": id, "name": os.path.basename(file), "ext": ""})

    return JSONResponse(files)


@v1_router.delete("/kb/{id}/files")
def delete_file(id: int, file: KnowledgeFile):
    if os.path.exists(f"./data/{id}/{file.name}"):
        os.remove(f"./data/{id}/{file.name}")
    return JSONResponse({"message": f"Successfully deleted {file.name}"})


@v1_router.post("/kb/{id}/files")
def upload_file(id: int, file: UploadFile, session: Session = Depends(get_session)):
    kb = session.get(KnowledgeBase, id)
    if not kb:
        raise HTTPException(status_code=400, detail=f"Knowledge base does not exist")

    allowed_extensions = [".pdf", ".docx", ".html", ".txt", ".csv", ".json"]
    file_extension = os.path.splitext(file.filename)[1].lower()
    if file_extension not in allowed_extensions:
        raise HTTPException(status_code=400, detail=f"Only accept {allowed_extensions}")

    tmp_file_path = f"tmp_{file.filename}"
    folder_path = f"./data/{id}"
    try:
        if not Path(folder_path).exists():
            Path(folder_path).mkdir(parents=True, exist_ok=True)

        with open(f"{folder_path}/{file.filename}", "wb") as infile:
            shutil.copyfileobj(file.file, infile)

        return JSONResponse({"message": f"Successfully uploaded {file.filename}"})

    finally:
        if os.path.exists(tmp_file_path):
            os.remove(tmp_file_path)


@v1_router.post("/kb/{id}/create")
def create_kb_embeddings(id: int, request: Optional[CreateEmbeddingsRequest] = None):
    """Create embeddings for documents in the knowledge base.

    Args:
        id: Knowledge base ID
        request: Optional configuration for text splitting (uses defaults if not provided)
    """

    try:
        # Use defaults if no request body is provided for backward compatibility
        if request is None:
            request = CreateEmbeddingsRequest()

        # Validate chunk_overlap is not greater than chunk_size
        if request.chunk_overlap >= request.chunk_size:
            raise HTTPException(
                status_code=400, detail="chunk_overlap must be less than chunk_size"
            )

        if create_data_embedding(
            id,
            f"./data/{id}",
            splitter_name=request.splitter_name,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
        ):
            return JSONResponse(
                {
                    "status": True,
                    "message": f"Successfully created embeddings for {id}",
                    "config": {
                        "splitter_name": request.splitter_name,
                        "chunk_size": request.chunk_size,
                        "chunk_overlap": request.chunk_overlap,
                    },
                }
            )
        else:
            return JSONResponse(
                {
                    "status": False,
                    "message": f"Failed to create embeddings for {id}",
                }
            )
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@v1_router.post("/kb/{id}/files/embed", name="Create Embeddings for File")
def create_file_embeddings(
    id: int,
    request: CreateFileEmbeddingsRequest,
    session: Session = Depends(get_session),
):
    """Create embeddings for a single file in the knowledge base.

    Args:
        id: Knowledge base ID
        request: Request containing filename and embedding configuration
        session: Database session for checking KB existence

    Returns:
        Success status and processing information
    """
    try:
        # Check if the knowledge base exists in the database
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        # Validate chunk_overlap is not greater than chunk_size
        if request.chunk_overlap >= request.chunk_size:
            raise HTTPException(
                status_code=400, detail="chunk_overlap must be less than chunk_size"
            )

        # Construct the file path
        file_path = f"./data/{id}/{request.filename}"
        file_path = os.path.abspath(file_path)

        # Check if file exists
        if not os.path.exists(file_path):
            raise HTTPException(
                status_code=404,
                detail=f"File '{request.filename}' not found in knowledge base.",
            )

        result = create_embeddings_for_file(
            kb_id=id,
            file_path=file_path,
            splitter_name=request.splitter_name,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
        )

        return JSONResponse(result)

    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error creating embeddings: {str(e)}"
        )


@v1_router.get("/kb/{id}/chunks", name="Get All KB Chunks")
def get_kb_chunks(
    id: int,
    include_embeddings: bool = Query(
        False, description="Include embedding vectors in the response"
    ),
    session: Session = Depends(get_session),
):
    """Retrieve all embedding chunks from the knowledge base.

    Args:
        id: Knowledge base ID
        include_embeddings: Whether to include embedding vectors (default: False)
        session: Database session for checking KB existence

    Returns:
        A list of objects with `content`, `metadata`, and `chunk_id` keys.
        If include_embeddings=True, also includes `embedding` key with vector data.
    """
    try:
        # Check if the knowledge base exists in the database
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        # Check if FAISS database exists
        faiss_path = f"./data/{id}/faissdb"
        if not os.path.exists(faiss_path):
            # Return empty chunks if no FAISS database exists yet
            return JSONResponse({"kb_id": id, "total_chunks": 0, "chunks": []})

        chunks = get_all_chunks(id, include_embeddings=include_embeddings)

        return JSONResponse(
            {"kb_id": id, "total_chunks": len(chunks), "chunks": chunks}
        )

    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving chunks: {str(e)}"
        )


@v1_router.post("/kb/{id}/chunks", name="Add Chunk to KB")
def add_chunk_to_kb_endpoint(
    id: int, request: AddChunkRequest, session: Session = Depends(get_session)
):
    """Manually add a text chunk to the knowledge base.

    Args:
        id: Knowledge base ID
        request: Request containing the text content and optional metadata
        session: Database session for checking KB existence

    Returns:
        Success status and chunk information
    """
    try:
        # Check if the knowledge base exists in the database
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        # Check if FAISS database exists, create if it doesn't
        faiss_path = f"./data/{id}/faissdb"
        data_dir = f"./data/{id}"

        # Ensure data directory exists
        if not os.path.exists(data_dir):
            os.makedirs(data_dir, exist_ok=True)

        result = add_chunk_to_kb(
            kb_id=id, content=request.content, metadata=request.metadata
        )

        return JSONResponse(result)

    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error adding chunk: {str(e)}")


@v1_router.delete("/kb/{id}/chunks", name="Delete Chunks from KB")
def delete_chunks_from_kb_endpoint(
    id: int, request: DeleteChunksRequest, session: Session = Depends(get_session)
):
    """Delete chunks from the knowledge base by document IDs.

    Args:
        id: Knowledge base ID
        request: Request containing the list of document IDs to delete
        session: Database session for checking KB existence

    Returns:
        Success status and deletion information
    """
    try:
        # Check if the knowledge base exists in the database
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        # Check if FAISS database exists
        faiss_path = f"./data/{id}/faissdb"
        if not os.path.exists(faiss_path):
            # Return success with no deletions if no FAISS database exists
            return JSONResponse(
                {
                    "success": True,
                    "message": "No chunks to delete - knowledge base is empty",
                    "deletion_info": {
                        "requested_ids": request.doc_ids,
                        "initial_count": 0,
                        "final_count": 0,
                        "deleted_count": 0,
                    },
                }
            )

        result = delete_chunks_from_kb(kb_id=id, doc_ids=request.doc_ids)

        return JSONResponse(result)

    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting chunks: {str(e)}")


@v1_router.delete("/kb/{id}/chunks/source", name="Delete Chunks by Source")
def delete_chunks_by_source_endpoint(
    id: int,
    request: DeleteChunksBySourceRequest,
    session: Session = Depends(get_session),
):
    """Delete all chunks from the knowledge base that match a specific source.

    Args:
        id: Knowledge base ID
        request: Request containing the source to match
        session: Database session for checking KB existence

    Returns:
        Success status and deletion information
    """
    try:
        # Check if the knowledge base exists in the database
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        # Check if FAISS database exists
        faiss_path = f"./data/{id}/faissdb"
        if not os.path.exists(faiss_path):
            # Return success with no deletions if no FAISS database exists
            return JSONResponse(
                {
                    "success": True,
                    "message": "No chunks to delete - knowledge base is empty",
                    "deletion_info": {
                        "source": request.source,
                        "initial_count": 0,
                        "final_count": 0,
                        "deleted_count": 0,
                    },
                }
            )

        # Construct full source path from filename if it's not a special identifier
        source = request.source
        if (
            not source.startswith("./data/")
            and source != "manual_chunk"
            and source != "manual_entry"
        ):
            source = f"./data/{id}/{source}"

        result = delete_chunks_by_source(kb_id=id, source=source)

        return JSONResponse(result)

    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except FileNotFoundError as fe:
        raise HTTPException(status_code=404, detail=str(fe))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error deleting chunks by source: {str(e)}"
        )


@v1_router.post("/kb/{id}/search", name="Search KB")
def search_kb(id: int, request: SearchRequest):
    """Search the knowledge base `id` for the query and return matching documents.

    Requires embedding/reranker services to be configured via /v1/configure or CLI args.

    Args:
        id: Knowledge base ID
        request: Search request containing query and parameters

    Returns a list of objects with `content` and `metadata` keys.
    """
    try:
        # Validate search_type
        valid_search_types = ["similarity", "mmr", "similarity_score_threshold"]
        if request.search_type not in valid_search_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid search_type. Must be one of: {valid_search_types}",
            )

        # Build retriever_kwargs from request parameters
        retriever_kwargs = {"k": request.top_k}

        if request.score_threshold is not None:
            retriever_kwargs["score_threshold"] = request.score_threshold
        if request.fetch_k != 20:  # Only add if different from default
            retriever_kwargs["fetch_k"] = request.fetch_k
        if request.lambda_mult != 0.5:  # Only add if different from default
            retriever_kwargs["lambda_mult"] = request.lambda_mult
        if request.filter is not None:
            retriever_kwargs["filter"] = request.filter

        docs = search_information(
            id,
            request.query,
            top_n=request.top_n,
            search_type=request.search_type,
            retriever_kwargs=retriever_kwargs,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    results = []
    if not docs:
        return JSONResponse(results)

    for doc in docs:
        content = getattr(doc, "page_content", None)
        metadata = getattr(doc, "metadata", None)

        if content is None:
            try:
                content = doc.get("page_content") if isinstance(doc, dict) else str(doc)
            except Exception:
                content = str(doc)

        if metadata is None:
            try:
                metadata = doc.get("metadata") if isinstance(doc, dict) else {}
            except Exception:
                metadata = {}

        results.append({"content": content, "metadata": metadata})

    return JSONResponse(results)


@v1_router.post("/kb/{id}/vectors", name="Add Vectors to KB")
def add_vectors_endpoint(
    id: int, request: AddVectorsRequest, session: Session = Depends(get_session)
):
    """Add pre-computed embedding vectors directly to the knowledge base.

    Each item in the `vectors` list must have:
    - `embedding`: list of floats (the pre-computed vector)
    - `content`: str (the text content associated with this vector)
    - `metadata`: dict (optional metadata)

    This does NOT require embedding services to be configured.
    """
    try:
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        # Validate each vector entry
        for i, entry in enumerate(request.vectors):
            if "embedding" not in entry:
                raise HTTPException(
                    status_code=400,
                    detail=f"Vector entry {i} missing required 'embedding' field",
                )
            if "content" not in entry:
                raise HTTPException(
                    status_code=400,
                    detail=f"Vector entry {i} missing required 'content' field",
                )
            if not isinstance(entry["embedding"], list) or not all(
                isinstance(v, (int, float)) for v in entry["embedding"]
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"Vector entry {i} 'embedding' must be a list of numbers",
                )

        embeddings_list = [entry["embedding"] for entry in request.vectors]
        contents = [entry["content"] for entry in request.vectors]
        metadatas = [entry.get("metadata", {}) for entry in request.vectors]

        result = add_vectors_to_kb(
            kb_id=id,
            embeddings=embeddings_list,
            contents=contents,
            metadatas=metadatas,
        )

        return JSONResponse(result)

    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error adding vectors: {str(e)}"
        )


@v1_router.post("/kb/{id}/search/vector", name="Search KB by Vector")
def search_kb_by_vector(
    id: int, request: SearchByVectorRequest, session: Session = Depends(get_session)
):
    """Search the knowledge base using a pre-computed query embedding vector.

    This does NOT require embedding services to be configured — the caller
    provides the embedding directly.

    Args:
        id: Knowledge base ID
        request: Request containing the embedding vector and search parameters

    Returns a list of objects with `content`, `metadata`, and `score` keys.
    """
    try:
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        faiss_path = f"./data/{id}/faissdb"
        if not os.path.exists(faiss_path):
            return JSONResponse([])

        results = search_by_vector(
            kb_id=id,
            embedding=request.embedding,
            top_k=request.top_k,
            filter_dict=request.filter,
        )

        return JSONResponse(results)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error searching by vector: {str(e)}"
        )


app.include_router(v1_router)


def parse_args():
    parser = argparse.ArgumentParser(description="Vector DB Storage Worker")
    parser.add_argument(
        "--port",
        type=int,
        default=5004,
        help="Port for the worker to listen on",
    )
    parser.add_argument(
        "--embedding-url",
        type=str,
        default=None,
        help="Base URL of the external embedding service (e.g. http://localhost:8001/v1)",
    )
    parser.add_argument(
        "--embedding-model",
        type=str,
        default=None,
        help="Model name to use for embeddings",
    )
    parser.add_argument(
        "--reranker-url",
        type=str,
        default=None,
        help="Base URL of the external reranker service (e.g. http://localhost:8002/v1)",
    )
    parser.add_argument(
        "--reranker-model",
        type=str,
        default=None,
        help="Model name to use for reranking",
    )
    return parser.parse_args()


def main():
    global CONFIG

    args = parse_args()
    CONFIG["embedding_url"] = args.embedding_url
    CONFIG["embedding_model"] = args.embedding_model
    CONFIG["reranker_url"] = args.reranker_url
    CONFIG["reranker_model"] = args.reranker_model

    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host=os.environ.get("SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SERVER_PORT", args.port)),
    )


if __name__ == "__main__":
    main()
