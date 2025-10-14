# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import shutil
import argparse
import logging
import multiprocessing
import asyncio
import subprocess  # nosec -- used as a catch exception type only
from contextlib import asynccontextmanager

import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI, UploadFile, Depends, Query
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException

import cohere

from glob import glob
from pathlib import Path
from sqlmodel import Field, Session, SQLModel, select
from openai import OpenAI
from openai.types import EmbeddingCreateParams
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from utils.embedding_ovms import (
    start_ovms_background,
    wait_for_model_ready,
)
from utils.rag_engine import (
    configure_rag_engine,
    create_data_embedding,
    search_information,
    get_all_chunks,
    add_chunk_to_kb,
    delete_chunks_from_kb,
)
from utils.database import create_db_and_tables, get_session

os.makedirs("data", exist_ok=True)

logger = logging.getLogger("uvicorn.error")

OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "http://localhost:5951/v1")
OVMS_PROCESS = None  # Store the OVMS process for cleanup
VECTORDB_DIR = "../../data/embeddings"
DOCSTORE_DIR = "../../data/embeddings/documents"

CONFIG = {
    "embedding_model_id": "OpenVINO/bge-base-en-v1.5-int8-ov",
    "embedding_device": "CPU",
    "reranker_model_id": "OpenVINO/bge-reranker-base-int8-ov",
    "reranker_device": "CPU",
    "ovms_port": 5951,
}


class RerankParams(BaseModel):
    """Type definition for rerank parameters."""

    model: str
    query: str
    documents: List[str]
    top_n: Optional[int] = None
    return_documents: Optional[bool] = None


class KnowledgeBase(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    db: str = Field(default="")


class KnowledgeFile(BaseModel):
    name: str


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


class CreateEmbeddingsRequest(BaseModel):
    """Request model for creating knowledge base embeddings."""

    splitter_name: str = Field(
        "RecursiveCharacter",
        description="Type of text splitter: 'Character', 'RecursiveCharacter', or 'Markdown'",
    )
    chunk_size: int = Field(
        1000, description="Size of each text chunk (default: 1000)", gt=0
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


class DeleteChunksRequest(BaseModel):
    """Request model for deleting chunks from knowledge base by document IDs."""

    doc_ids: List[str] = Field(
        ...,
        description="List of document IDs to delete from the knowledge base",
        min_length=1,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global OVMS_PROCESS
    create_db_and_tables()

    logger.info("Initializing server services ...")
    logger.info("CONFIG: ", CONFIG)

    try:
        # Start the Embedding OpenVINO Model Server in background
        logger.info("Starting OVMS server...")
        OVMS_PROCESS = await asyncio.to_thread(
            start_ovms_background,
            CONFIG["embedding_model_id"],
            CONFIG["embedding_device"],
            CONFIG["reranker_model_id"],
            CONFIG["reranker_device"],
            CONFIG["ovms_port"],
        )

        # Log the process ID for manual management if needed
        if OVMS_PROCESS and hasattr(OVMS_PROCESS, "pid"):
            logger.info(f"OVMS server started with PID: {OVMS_PROCESS.pid}")
        else:
            logger.warning("Could not determine OVMS process ID")

        # Wait for the server to be ready
        logger.info("Waiting for OVMS server to be ready...")

        # Check both models concurrently for faster startup
        embedding_task = asyncio.to_thread(
            wait_for_model_ready,
            CONFIG["ovms_port"],
            CONFIG["embedding_model_id"],
            timeout=120,  # 2 minutes timeout
        )

        reranker_task = asyncio.to_thread(
            wait_for_model_ready,
            CONFIG["ovms_port"],
            CONFIG["reranker_model_id"],  # Fixed: was using embedding_model_id
            timeout=120,  # 2 minutes timeout
        )

        # Wait for both tasks to complete concurrently
        embedding_ready, reranker_ready = await asyncio.gather(
            embedding_task, reranker_task, return_exceptions=True
        )

        if not embedding_ready or not reranker_ready:
            raise RuntimeError("OVMS server failed to start within timeout period")

        # Configure RAG engine with the same models and port
        logger.info("Configuring RAG engine...")
        configure_rag_engine(
            ovms_port=CONFIG["ovms_port"],
            embedding_model=CONFIG["embedding_model_id"],
            rerank_model=CONFIG["reranker_model_id"],
        )

        logger.info("Server services initialized successfully")

    except Exception as e:
        logger.error(f"Failed to initialize server services: {e}")
        # Clean up if initialization failed
        if OVMS_PROCESS:
            OVMS_PROCESS.terminate()
            OVMS_PROCESS.wait()
        raise e

    yield

    # Cleanup
    logger.info("Stopping server services ...")
    if OVMS_PROCESS:
        logger.info("Terminating OVMS process...")
        OVMS_PROCESS.terminate()
        try:
            OVMS_PROCESS.wait(timeout=10)
        except subprocess.TimeoutExpired:
            logger.warning("OVMS process didn't terminate gracefully, killing it...")
            OVMS_PROCESS.kill()
            OVMS_PROCESS.wait()


allowed_cors = json.loads(os.getenv("ALLOWED_CORS", '["http://localhost"]'))
app = FastAPI(lifespan=lifespan)
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


@app.post("/v1/embeddings", status_code=200)
async def create_text_embedding(params: EmbeddingCreateParams):
    client = OpenAI(base_url=f"http://localhost:{CONFIG['ovms_port']}/v3", api_key="-")
    response = client.embeddings.create(
        input=params.get("input"),
        model=params.get("model"),
        encoding_format=params.get("encoding_format", "float"),
    )
    return response


@app.post("/v1/rerank", status_code=200)
async def rerank(params: RerankParams):
    client = cohere.Client(
        base_url=f"http://localhost:{CONFIG['ovms_port']}/v3", api_key="-"
    )
    response = client.rerank(
        query=params.query,
        documents=params.documents,
        model=params.model,
        top_n=params.top_n,
        return_documents=params.return_documents,
    )
    return response


@app.get("/v1/kb", name="Get KB List")
def get_kb_list(session: Session = Depends(get_session)) -> list[KnowledgeBase]:
    kbs = session.exec(select(KnowledgeBase)).all()
    return kbs


@app.get("/v1/kb/{id}")
def get_kb(id, session: Session = Depends(get_session)):
    kb = session.get(KnowledgeBase, id)
    if not kb:
        raise HTTPException(status_code=404, detail="Kb not found")
    return kb


@app.post("/v1/kb", name="Create New KB")
def create_kb(kb: KnowledgeBase, session: Session = Depends(get_session)):
    session.add(kb)
    session.commit()
    session.refresh(kb)
    return kb


@app.delete("/v1/kb/{id}", name="Delete KB")
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


@app.get("/v1/kb/{id}/files")
def get_file_list(id: int):
    files = []
    for file in glob(f"./data/{id}/*"):
        if os.path.isfile(file):
            files.append({"id": id, "name": os.path.basename(file), "ext": ""})

    return JSONResponse(files)


@app.delete("/v1/kb/{id}/files")
def delete_file(id: int, file: KnowledgeFile):
    if os.path.exists(f"./data/{id}/{file.name}"):
        os.remove(f"./data/{id}/{file.name}")
    return JSONResponse({"message": f"Successfully deleted {file.name}"})


@app.post("/v1/kb/{id}/files")
def upload_file(id: int, file: UploadFile, session: Session = Depends(get_session)):
    kb = session.get(KnowledgeBase, id)
    if not kb:
        raise HTTPException(status_code=400, detail=f"Knowledge base does not exist")

    allowed_extensions = [".pdf", ".docx", ".html", ".txt", ".csv"]
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


@app.post("/v1/kb/{id}/create")
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


@app.get("/v1/kb/{id}/chunks", name="Get All KB Chunks")
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


@app.post("/v1/kb/{id}/chunks", name="Add Chunk to KB")
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


@app.delete("/v1/kb/{id}/chunks", name="Delete Chunks from KB")
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


@app.post("/v1/kb/{id}/search", name="Search KB")
def search_kb(id: int, request: SearchRequest):
    """Search the knowledge base `id` for the query and return matching documents.

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
        # Documents returned by the retriever may be langchain `Document` objects
        # or simple dict-like objects. Normalize to primitives for JSON.
        content = getattr(doc, "page_content", None)
        metadata = getattr(doc, "metadata", None)

        if content is None:
            # Fallback for other shapes
            try:
                # If it's a dict-like object
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


def parse_args():
    parser = argparse.ArgumentParser(description="Embedding Worker")
    parser.add_argument(
        "--port",
        type=int,
        default=5003,
        help="Port for the worker to listen on",
    )
    parser.add_argument(
        "--ovms-port",
        type=int,
        default=5951,
        help="Port for the embedding OpenVINO Model Server to listen on",
    )
    parser.add_argument(
        "--embedding-model-id",
        type=str,
        required=True,
        help="Path to the embedding model directory or Hugging Face model name",
    )
    parser.add_argument(
        "--embedding-device",
        type=str,
        default="CPU",
        help="Device to run the embedding model on (e.g., CPU, GPU, NPU)",
    )
    parser.add_argument(
        "--reranker-model-id",
        type=str,
        required=True,
        help="Path to the reranker model directory or Hugging Face model name",
    )
    parser.add_argument(
        "--reranker-device",
        type=str,
        default="CPU",
        help="Device to run the reranker model on (e.g., CPU, GPU, NPU)",
    )
    return parser.parse_args()


def main():
    global CONFIG

    args = parse_args()
    CONFIG["ovms_port"] = args.ovms_port
    CONFIG["embedding_model_id"] = args.embedding_model_id
    CONFIG["embedding_device"] = str(args.embedding_device).upper()
    CONFIG["reranker_model_id"] = args.reranker_model_id
    CONFIG["reranker_device"] = str(args.reranker_device).upper()

    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host=os.environ.get("SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SERVER_PORT", args.port)),
    )


if __name__ == "__main__":
    main()
