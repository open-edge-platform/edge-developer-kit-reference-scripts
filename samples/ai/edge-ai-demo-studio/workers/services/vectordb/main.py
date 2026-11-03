# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import shutil
import logging
import multiprocessing
from concurrent.futures import Future
from contextlib import asynccontextmanager

from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI, UploadFile, Depends, Query, APIRouter, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import HTTPException

from glob import glob
from pathlib import Path
from sqlmodel import Field, Session, SQLModel, select
from pydantic import BaseModel
from typing import Optional, List, Dict, Any, Callable, Iterator

# Before utils/ pulls in the upstream OEP code: worker_common exempts loopback from any exported
# http_proxy, and the embedding sibling is reached through the app on 127.0.0.1.
from worker_common import base_parser, create_app, serve, sse_event, sse_response

from utils.rag_engine import (
    DATA_DIR,
    ProgressStream,
    configure_rag_engine,
    create_data_embedding,
    create_embeddings_for_file,
    submit_data_embedding,
    submit_file_embeddings,
    search_information,
    search_by_vector,
    get_all_chunks,
    add_chunk_to_kb,
    add_vectors_to_kb,
    delete_chunks_from_kb,
    delete_chunks_by_source,
    init_backend,
    shutdown_backend,
    backend_info,
    kb_exists,
    delete_kb_data,
)
from utils.backends import BACKENDS
from utils.database import create_db_and_tables, get_session

logger = logging.getLogger("uvicorn.error")

CONFIG = {
    "embedding_url": None,
    "embedding_model": None,
    "reranker_url": None,
    "reranker_model": None,
    # Storage backend: "faiss" (on-disk index per KB) or "pgvector"
    # (PostgreSQL + pgvector, embedded unless pg_connection_string is set).
    "db_backend": "faiss",
    "pg_connection_string": None,
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
        ..., description="Base URL of the external embedding service (e.g. http://127.0.0.1:8001/v1)"
    )
    embedding_model: str = Field(
        ..., description="Model name to use for embeddings"
    )
    reranker_url: Optional[str] = Field(
        None, description="Base URL of the external reranker service (e.g. http://127.0.0.1:8002/v1)"
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


def _wants_stream(http_request: Request, stream: bool) -> bool:
    """True when the caller asked for progress events instead of one JSON body."""
    return stream or "text/event-stream" in http_request.headers.get("accept", "").lower()


def _stream_query():
    return Query(
        False,
        description=(
            "Answer with Server-Sent Events reporting progress, ending with `done` "
            "(the usual JSON body) or `error`. Same as sending `Accept: text/event-stream`."
        ),
    )


def _progress_events(
    progress: ProgressStream,
    future: Future,
    result_body: Callable[[Any], dict],
    http_error: Callable[[Exception], HTTPException],
) -> Iterator[bytes]:
    """The events of a queued ingestion: its progress, then ``done`` or ``error``.

    ``done`` carries exactly the JSON the endpoint answers without streaming;
    ``error`` carries the ``detail`` and ``status_code`` it would have failed with.
    """
    for stage, data in progress.follow(future):
        yield sse_event(data, event=stage)
    try:
        body = result_body(future.result())
    except Exception as exc:
        error = exc if isinstance(exc, HTTPException) else http_error(exc)
        yield sse_event(
            {"detail": error.detail, "status_code": error.status_code}, event="error"
        )
        return
    yield sse_event(body, event="done")


def _public_config() -> dict:
    """CONFIG with the database password hidden, plus live backend details."""
    public = {k: v for k, v in CONFIG.items() if k != "pg_connection_string"}
    public["pg_connection_string"] = (
        "***" if CONFIG.get("pg_connection_string") else None
    )
    public["backend"] = backend_info()
    return public


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    logger.info("Vector DB storage service starting...")
    logger.info(f"CONFIG: {_public_config()}")

    # Before serving, so pgvector's database and upstream pipeline fail here rather than per request.
    init_backend(
        CONFIG["db_backend"], pg_connection_string=CONFIG.get("pg_connection_string")
    )
    logger.info(f"Vector store backend ready: {backend_info()}")

    if CONFIG.get("embedding_url") and CONFIG.get("embedding_model"):
        logger.info("Configuring RAG engine from CLI args...")
        configure_rag_engine(
            embedding_url=CONFIG["embedding_url"],
            embedding_model=CONFIG["embedding_model"],
            reranker_url=CONFIG.get("reranker_url"),
            reranker_model=CONFIG.get("reranker_model"),
        )

    try:
        yield
    finally:
        shutdown_backend()


app = create_app("Vector DB Storage Worker", lifespan=lifespan)
v1_router = APIRouter(prefix="/v1")
app.mount("/static", StaticFiles(directory=str(DATA_DIR), html=True), name="static")


@v1_router.post("/configure", name="Configure Embedding Services")
def configure_services(request: ConfigureRequest):
    """Configure the embedding and reranker services; needed before embedding, search or text chunks."""
    configure_rag_engine(
        embedding_url=request.embedding_url,
        embedding_model=request.embedding_model,
        reranker_url=request.reranker_url,
        reranker_model=request.reranker_model,
    )
    # Published only once the engine uses it: the app skips configuring when GET /v1/config
    # already matches, so a racing call would otherwise search an unconfigured engine.
    CONFIG["embedding_url"] = request.embedding_url
    CONFIG["embedding_model"] = request.embedding_model
    CONFIG["reranker_url"] = request.reranker_url
    CONFIG["reranker_model"] = request.reranker_model

    logger.info(
        f"Configured embedding service: url={request.embedding_url} model={request.embedding_model}"
    )
    if request.reranker_url:
        logger.info(
            f"Configured reranker service: url={request.reranker_url} model={request.reranker_model}"
        )

    return {"status": "ok", "config": _public_config()}


@v1_router.get("/config", name="Get Current Config")
def get_config():
    """Get the current embedding/reranker configuration and the active storage backend."""
    return _public_config()


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

    delete_kb_data(id)
    if os.path.exists(f"{DATA_DIR}/{id}"):
        shutil.rmtree(f"{DATA_DIR}/{id}")

    session.delete(kb)
    session.commit()
    kbs = session.exec(select(KnowledgeBase)).all()
    return kbs


@v1_router.get("/kb/{id}/files")
def get_file_list(id: int):
    files = []
    for file in glob(f"{DATA_DIR}/{id}/*"):
        if os.path.isfile(file):
            files.append({"id": id, "name": os.path.basename(file), "ext": ""})

    return JSONResponse(files)


@v1_router.delete("/kb/{id}/files")
def delete_file(id: int, file: KnowledgeFile):
    if os.path.exists(f"{DATA_DIR}/{id}/{file.name}"):
        os.remove(f"{DATA_DIR}/{id}/{file.name}")
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

    folder_path = f"{DATA_DIR}/{id}"
    tmp_file_path = f"{folder_path}/tmp_{file.filename}"
    try:
        if not Path(folder_path).exists():
            Path(folder_path).mkdir(parents=True, exist_ok=True)

        with open(f"{folder_path}/{file.filename}", "wb") as infile:
            shutil.copyfileobj(file.file, infile)

        return JSONResponse({"message": f"Successfully uploaded {file.filename}"})

    finally:
        if os.path.exists(tmp_file_path):
            os.remove(tmp_file_path)


def _create_kb_embeddings_body(id: int, request: CreateEmbeddingsRequest, created) -> dict:
    if created:
        return {
            "status": True,
            "message": f"Successfully created embeddings for {id}",
            "config": {
                "splitter_name": request.splitter_name,
                "chunk_size": request.chunk_size,
                "chunk_overlap": request.chunk_overlap,
            },
        }
    return {
        "status": False,
        "message": f"Failed to create embeddings for {id}",
    }


def _create_kb_embeddings_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=500, detail=str(exc))


@v1_router.post("/kb/{id}/create")
def create_kb_embeddings(
    id: int,
    http_request: Request,
    request: Optional[CreateEmbeddingsRequest] = None,
    stream: bool = _stream_query(),
):
    """Embed every document in the knowledge base; with `stream`, per-file progress as SSE."""

    try:
        # No body: defaults, for older callers.
        if request is None:
            request = CreateEmbeddingsRequest()

        if request.chunk_overlap >= request.chunk_size:
            raise HTTPException(
                status_code=400, detail="chunk_overlap must be less than chunk_size"
            )

        options = dict(
            splitter_name=request.splitter_name,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
        )
        if _wants_stream(http_request, stream):
            progress = ProgressStream()
            future = submit_data_embedding(
                id, f"{DATA_DIR}/{id}", progress=progress.report, **options
            )
            return sse_response(
                _progress_events(
                    progress,
                    future,
                    lambda created: _create_kb_embeddings_body(id, request, created),
                    _create_kb_embeddings_error,
                )
            )

        created = create_data_embedding(id, f"{DATA_DIR}/{id}", **options)
        return JSONResponse(_create_kb_embeddings_body(id, request, created))
    except HTTPException:
        raise
    except Exception as e:
        raise _create_kb_embeddings_error(e)


def _file_embeddings_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=500, detail=f"Error creating embeddings: {str(exc)}")


@v1_router.post("/kb/{id}/files/embed", name="Create Embeddings for File")
def create_file_embeddings(
    id: int,
    request: CreateFileEmbeddingsRequest,
    http_request: Request,
    stream: bool = _stream_query(),
    session: Session = Depends(get_session),
):
    """Embed one file of the knowledge base; with `stream`, progress as SSE."""
    try:
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        if request.chunk_overlap >= request.chunk_size:
            raise HTTPException(
                status_code=400, detail="chunk_overlap must be less than chunk_size"
            )

        file_path = f"{DATA_DIR}/{id}/{request.filename}"
        file_path = os.path.abspath(file_path)

        if not os.path.exists(file_path):
            raise HTTPException(
                status_code=404,
                detail=f"File '{request.filename}' not found in knowledge base.",
            )

        options = dict(
            kb_id=id,
            file_path=file_path,
            splitter_name=request.splitter_name,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
        )
        if _wants_stream(http_request, stream):
            progress = ProgressStream()
            future = submit_file_embeddings(progress=progress.report, **options)
            return sse_response(
                _progress_events(
                    progress, future, lambda result: result, _file_embeddings_error
                )
            )

        result = create_embeddings_for_file(**options)

        return JSONResponse(result)

    except HTTPException:
        raise
    except Exception as e:
        raise _file_embeddings_error(e)


@v1_router.get("/kb/{id}/chunks", name="Get All KB Chunks")
def get_kb_chunks(
    id: int,
    include_embeddings: bool = Query(
        False, description="Include embedding vectors in the response"
    ),
    session: Session = Depends(get_session),
):
    """Every chunk of the knowledge base (`content`, `metadata`, `chunk_id`, optionally `embedding`)."""
    try:
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        if not kb_exists(id):
            return JSONResponse({"kb_id": id, "total_chunks": 0, "chunks": []})

        chunks = get_all_chunks(id, include_embeddings=include_embeddings)

        return JSONResponse(
            {"kb_id": id, "total_chunks": len(chunks), "chunks": chunks}
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving chunks: {str(e)}"
        )


@v1_router.post("/kb/{id}/chunks", name="Add Chunk to KB")
def add_chunk_to_kb_endpoint(
    id: int, request: AddChunkRequest, session: Session = Depends(get_session)
):
    """Manually add a text chunk to the knowledge base."""
    try:
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        # The store for this KB is created on first write.
        os.makedirs(DATA_DIR / str(id), exist_ok=True)

        result = add_chunk_to_kb(
            kb_id=id, content=request.content, metadata=request.metadata
        )

        return JSONResponse(result)

    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error adding chunk: {str(e)}")


@v1_router.delete("/kb/{id}/chunks", name="Delete Chunks from KB")
def delete_chunks_from_kb_endpoint(
    id: int, request: DeleteChunksRequest, session: Session = Depends(get_session)
):
    """Delete chunks from the knowledge base by document IDs."""
    try:
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        if not kb_exists(id):
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
        raise
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
    """Delete all chunks from the knowledge base that match a specific source."""
    try:
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        if not kb_exists(id):
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

        # A bare filename means this KB's copy; special identifiers stay as they are.
        source = request.source
        if (
            not source.startswith(f"{DATA_DIR}/")
            and source != "manual_chunk"
            and source != "manual_entry"
        ):
            source = f"{DATA_DIR}/{id}/{source}"

        result = delete_chunks_by_source(kb_id=id, source=source)

        return JSONResponse(result)

    except HTTPException:
        raise
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
    """Search the knowledge base (needs /v1/configure or CLI args) for `content`/`metadata` items."""
    try:
        valid_search_types = ["similarity", "mmr", "similarity_score_threshold"]
        if request.search_type not in valid_search_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid search_type. Must be one of: {valid_search_types}",
            )

        retriever_kwargs = {"k": request.top_k}

        if request.score_threshold is not None:
            retriever_kwargs["score_threshold"] = request.score_threshold
        if request.fetch_k != 20:
            retriever_kwargs["fetch_k"] = request.fetch_k
        if request.lambda_mult != 0.5:
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
    """Add pre-computed vectors (`embedding`, `content`, `metadata`); needs no embedding service."""
    try:
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

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
    """Search by a pre-computed query vector; `score` is the backend's distance (lower is closer)."""
    try:
        kb = session.get(KnowledgeBase, id)
        if not kb:
            raise HTTPException(
                status_code=404,
                detail=f"Knowledge base with ID {id} not found in database.",
            )

        if not kb_exists(id):
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
    parser = base_parser("Vector DB Storage Worker", default_port=5004, device=False)
    parser.add_argument(
        "--embedding-url",
        type=str,
        default=None,
        help="Base URL of the external embedding service (e.g. http://127.0.0.1:8001/v1)",
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
        help="Base URL of the external reranker service (e.g. http://127.0.0.1:8002/v1)",
    )
    parser.add_argument(
        "--reranker-model",
        type=str,
        default=None,
        help="Model name to use for reranking",
    )
    parser.add_argument(
        "--db-backend",
        type=str,
        choices=list(BACKENDS),
        default=os.environ.get("VECTORDB_BACKEND", "faiss"),
        help=(
            "Vector store: 'faiss' keeps an index per knowledge base under data/; "
            "'pgvector' stores vectors in PostgreSQL + pgvector using the OEP "
            "document-ingestion pipeline (default: faiss)"
        ),
    )
    parser.add_argument(
        "--pg-connection-string",
        type=str,
        default=os.environ.get("VECTORDB_PG_CONNECTION_STRING") or None,
        help=(
            "PostgreSQL URL for --db-backend pgvector (the 'vector' extension must be "
            "installable). Omit to run an embedded PostgreSQL under data/pgdata."
        ),
    )
    return parser.parse_args()


def main():
    global CONFIG

    args = parse_args()
    CONFIG["embedding_url"] = args.embedding_url
    CONFIG["embedding_model"] = args.embedding_model
    CONFIG["reranker_url"] = args.reranker_url
    CONFIG["reranker_model"] = args.reranker_model
    CONFIG["db_backend"] = args.db_backend
    CONFIG["pg_connection_string"] = args.pg_connection_string

    multiprocessing.freeze_support()
    serve(app, args)


if __name__ == "__main__":
    main()
