# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os
import re
import shutil
from fastapi import (
    APIRouter,
    HTTPException,
    UploadFile,
    Form,
    Depends,
    File,
    Form,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, ValidationError
from typing import Optional, List
from pathlib import Path

from modules.llamacpp.cli import LlamaManagerCLI
from .utils import (
    model_name_parser,
    check_model_exists,
    save_chunk,
    assemble_chunks,
    clear_chunks,
)

sys.path.append(os.path.dirname(__file__))


class StatusResponse(BaseModel):
    health: str


class ModelRequest(BaseModel):
    repo_id: str = Field(..., example="Qwen/Qwen3-1.7B-GGUF")
    device: Optional[str] = Field(None, example="GPU")

    model_config = ConfigDict(
        json_schema_extra={"example": {"repo_id": "Qwen/Qwen3-1.7B-GGUF:Q8_0"}}
    )


class ModelWithTaskStartRequest(BaseModel):
    repo_id: str = Field(..., example="Qwen/Qwen3-1.7B-GGUF")
    task: str = Field(..., example="text_generation")
    context_size: Optional[int] = Field(0, example=4096)
    device: Optional[str] = Field(None, example="GPU")
    model_path: Optional[str] = Field(
        None,
        example="./models/GGUF/text_generation/ggml-org/Qwen3-8B-GGUF/qwen3-8b-Q8_0.gguf",
    )
    mmproj_path: Optional[str] = Field(
        None, example="./models/GGUF/text_generation/ggml-org/Qwen3-8B-GGUF/mmproj.gguf"
    )
    extra_args: Optional[List[str]] = Field(None, example=["-fa", "1", "-ngl", "33"])
    timeout: Optional[int] = Field(600, example=600)

    @field_validator("task")
    @classmethod
    def validate_task(cls, v: str) -> str:
        allowed_tasks = {"text_generation", "embeddings", "rerank", "multimodal"}
        if v not in allowed_tasks:
            raise ValueError(f"task must be one of: {', '.join(sorted(allowed_tasks))}")
        return v

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "Qwen/Qwen3-1.7B-GGUF",
                "task": "text_generation",
                "context_size": 4096,
                "model_path": "./models/GGUF/text_generation/ggml-org/Qwen3-8B-GGUF/qwen3-8b-Q8_0.gguf",
            }
        }
    )


class ModelWithTaskStopRequest(BaseModel):
    repo_id: str = Field(..., example="Qwen/Qwen3-1.7B-GGUF")
    task: str = Field(..., example="text_generation")

    @field_validator("task")
    @classmethod
    def validate_task(cls, v: str) -> str:
        allowed_tasks = {"text_generation", "embeddings", "rerank", "multimodal"}
        if v not in allowed_tasks:
            raise ValueError(f"task must be one of: {', '.join(sorted(allowed_tasks))}")
        return v

    model_config = ConfigDict(
        json_schema_extra={
            "example": {"repo_id": "Qwen/Qwen3-1.7B-GGUF", "task": "text_generation"}
        }
    )


class DownloadModelRequest(BaseModel):
    repo_id: str = Field(..., example="Qwen/Qwen3-1.7B-GGUF")
    source: Optional[str] = Field(
        "huggingface",
        example="huggingface",
        description="Source for model download: 'huggingface' or 'modelscope'",
    )

    @field_validator("source")
    @classmethod
    def validate_source(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"huggingface", "modelscope"}
        if v not in allowed:
            raise ValueError(f"source must be one of: {', '.join(sorted(allowed))}")
        return v

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "Qwen/Qwen3-1.7B-GGUF:Q8_0",
                "source": "huggingface",
            }
        }
    )


class UnverifiedModelRequest(BaseModel):
    repo_id: str = Field(..., example="Qwen/Qwen3-1.7B-GGUF")
    task: str = Field(..., example="text_generation")
    source: Optional[str] = Field(
        "huggingface",
        example="huggingface",
        description="Source for model download: 'huggingface' or 'modelscope'",
    )

    @field_validator("source")
    @classmethod
    def validate_source(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"huggingface", "modelscope"}
        if v not in allowed:
            raise ValueError(f"source must be one of: {', '.join(sorted(allowed))}")
        return v

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "Qwen/Qwen3-8B-GGUF:Q4_K_M",
                "source": "huggingface",
                "task": "text_generation",
            }
        }
    )


class UploadModelRequest(BaseModel):
    repo_id: str
    task: str
    force_override: bool

    @field_validator("task")
    @classmethod
    def validate_task(cls, v: str) -> str:
        allowed_tasks = {"text_generation", "embeddings", "rerank", "multimodal"}
        if v not in allowed_tasks:
            raise ValueError(f"task must be one of: {', '.join(sorted(allowed_tasks))}")
        return v

    @field_validator("repo_id")
    @classmethod
    def validate_repo_structure(cls, v: str) -> str:
        parts = v.split("/")

        if len(parts) != 2 or not parts[0].strip() or not parts[1].strip():
            raise ValueError(
                "repo_id must follow the '<Org>/<Model Name>' format (e.g., 'ggml-org/Qwen3-8B-GGUF')"
            )

        org, model_name = parts
        valid_suffixes = ["-GGUF"]
        if not ":" in model_name:
            raise ValueError(
                "Model name must end with a valid quantization suffix"
                "(e.g., 'ggml-org/Qwen3-8B-GGUF:Q4_K_M')"
            )

        model_name, _ = model_name.split(":")

        if not any(model_name.endswith(suffix) for suffix in valid_suffixes):
            raise ValueError(
                "Model name must end with a valid quantization suffix: '-GGUF'"
                "(e.g., 'ggml-org/Qwen3-8B-GGUF:Q4_K_M')"
            )

        if "\\" in v or ".." in v:
            raise ValueError("repo_id contains invalid characters")

        return v

    @classmethod
    def as_form(
        cls,
        repo_id: str = Form(
            ...,
            description="Format: <Org>/<Model Name> (e.g., 'OpenVINO/Qwen3-8B-GGUF')",
        ),
        task: str = Form(..., description="The task type"),
        force_override: bool = Form(False, description="Overwrite existing model?"),
    ):
        try:
            return cls(repo_id=repo_id, task=task, force_override=force_override)
        except ValidationError as e:
            error_messages = []
            for error in e.errors():
                msg = error.get("msg", str(error))
                if msg.startswith("Value error, "):
                    msg = msg.replace("Value error, ", "")
                error_messages.append(msg)

            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Validation failed: {'; '.join(error_messages)}",
            )


class ChunkUploadRequest(UploadModelRequest):
    chunk_index: int
    total_chunks: int

    @classmethod
    def as_form(
        cls,
        repo_id: str = Form(
            ...,
            description="Format: <Org>/<Model Name> (e.g., 'OpenVINO/Qwen3-8B-GGUF')",
        ),
        task: str = Form(..., description="The task type"),
        chunk_index: int = Form(..., description="Index of the chunk (0-based)"),
        total_chunks: int = Form(..., description="Total number of chunks"),
        force_override: bool = Form(False, description="Overwrite existing model?"),
    ):
        try:
            return cls(
                repo_id=repo_id,
                task=task,
                chunk_index=chunk_index,
                total_chunks=total_chunks,
                force_override=force_override,
            )
        except ValidationError as e:
            error_messages = []
            for error in e.errors():
                msg = error.get("msg", str(error))
                if msg.startswith("Value error, "):
                    msg = msg.replace("Value error, ", "")
                error_messages.append(msg)

            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Validation failed: {'; '.join(error_messages)}",
            )


class ChunkCleanupRequest(BaseModel):
    repo_id: str
    task: str
    filename: str

    @classmethod
    def as_form(
        cls,
        repo_id: str = Form(..., description="Repo ID used for upload"),
        task: str = Form(..., description="Task type"),
        filename: str = Form(..., description="Filename of the upload"),
    ):
        return cls(repo_id=repo_id, task=task, filename=filename)


def create_llamacpp_api_router(llmcpp_manager: LlamaManagerCLI) -> APIRouter:
    router = APIRouter(prefix="/v1")

    @router.get("/health", response_model=StatusResponse, tags=["Server Control"])
    def get_server_health():
        return {
            "health": (
                "OK" if llmcpp_manager.get_is_server_ready() == True else "NOT READY"
            )
        }

    @router.get("/status", tags=["Server Control"])
    def get_server_status():
        return {"status": llmcpp_manager.get_server_status()}

    @router.post("/start", tags=["Server Control"])
    def start_model_server(request: ModelWithTaskStartRequest):
        context_size = request.context_size or 0
        if context_size < 0:
            raise HTTPException(
                status_code=500, detail=f"Context Size cannot be negative."
            )

        try:
            _, repo_id = model_name_parser(request.repo_id)
            if request.model_path == None:
                if llmcpp_manager.start_or_swap_model(
                    repo_id, request.device, request.timeout
                ):
                    # Report what the server actually negotiated -- with no
                    # requested size there is nothing to echo back.
                    try:
                        running_ctx = llmcpp_manager.get_task_metadata(
                            request.task
                        ).get("context_size", context_size)
                    except Exception:
                        running_ctx = context_size

                    return {"context_size": running_ctx}
                else:
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed to start model {request.repo_id}.",
                    )
            else:
                recommended_ctx = llmcpp_manager.start_local_model(
                    repo_id,
                    request.task,
                    context_size,
                    request.device,
                    request.model_path,
                    request.mmproj_path,
                    request.extra_args,
                    request.timeout,
                )
                if recommended_ctx != context_size:
                    return recommended_ctx
                return "OK"

        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=f"{e}")
        except:
            raise HTTPException(status_code=500, detail=f"Internal Server Error.")

    @router.post("/stop", tags=["Server Control"])
    def stop_model_server(request: ModelWithTaskStopRequest):
        _, repo_id = model_name_parser(request.repo_id)

        if request.task == None:
            if llmcpp_manager.stop_model(request.repo_id):
                return "OK"

        if llmcpp_manager.stop_local_model(repo_id, request.task):
            return "OK"

        raise HTTPException(
            status_code=400, detail=f"Model {request.repo_id} not running."
        )

    @router.get("/model", tags=["Model Management"])
    def list_models():
        return llmcpp_manager.list_models()

    @router.post("/model/download", tags=["Model Management"])
    def download_model(request: DownloadModelRequest):
        return StreamingResponse(
            llmcpp_manager.download_model(request.repo_id, source=request.source),
            media_type="text/plain",
        )

    @router.post("/model/download/unverified", tags=["Model Management"])
    def download_unverified_model(request: UnverifiedModelRequest):
        return StreamingResponse(
            llmcpp_manager.download_unverified_model(
                hf_repo_with_tag=request.repo_id, task=request.task, source=request.source
            ),
            media_type="text/plain",
        )

    @router.patch("/model/download/cancel", tags=["Model Management"])
    def cancel_download_model(request: ModelRequest):
        return llmcpp_manager.download_model_cancel()

    @router.delete("/model/delete", tags=["Model Management"])
    def delete_model(request: ModelRequest):
        if llmcpp_manager.delete_model(request.repo_id):
            return "OK"

        raise HTTPException(status_code=500, detail=f"Internal Server Error")

    @router.post("/model/upload", tags=["Model Management"])
    def upload_model_file(
        model_request: UploadModelRequest = Depends(UploadModelRequest.as_form),
        file: UploadFile = File(...),
    ):
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided.")

        pattern = r"^.+-[A-Z0-9_]+\.gguf$"

        if not re.match(pattern, file.filename):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid filename '{file.filename}'. "
                    "File must be a GGUF file and follow the format: '<model_name>-<QUANT>.gguf' "
                    "(e.g., 'qwen3-8b-Q4_K_M.gguf')."
                ),
            )

        model_name, quant = model_request.repo_id.split(":")

        model_storage_path = (
            Path(llmcpp_manager.get_model_dir()) / model_request.task / model_name
        )
        model_path = model_storage_path / file.filename

        check_model_exists(
            model_path,
            model_request.force_override,
            cleanup_callback=shutil.rmtree,
        )

        model_storage_path.mkdir(parents=True, exist_ok=True)

        safe_filename = os.path.basename(file.filename)
        file_path = model_storage_path / safe_filename

        with file_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        llmcpp_manager.downloader.add_user_upload_model(
            model_request.repo_id, file.filename
        )

        return {
            "message": "Successfully uploaded model file",
            "repo_id": model_request.repo_id,
            "filename": safe_filename,
            "internal_path": str(model_storage_path),
            "task": model_request.task,
        }

    @router.post("/model/upload/chunk", tags=["Model Management"])
    def upload_model_chunk(
        chunk_request: ChunkUploadRequest = Depends(ChunkUploadRequest.as_form),
        file: UploadFile = File(...),
    ):
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided.")

        pattern = r"^.+-[A-Z0-9_]+\.gguf$"

        if not re.match(pattern, file.filename):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid filename '{file.filename}'. "
                    "File must be a GGUF file and follow the format: '<model_name>-<QUANT>.gguf' "
                    "(e.g., 'qwen3-8b-Q4_K_M.gguf')."
                ),
            )

        model_name, quant = chunk_request.repo_id.split(":")
        task = chunk_request.task

        manager_dir = Path(llmcpp_manager.get_model_dir())
        model_storage_path = manager_dir / task / model_name

        check_model_exists(model_storage_path, chunk_request.force_override)

        safe_filename = os.path.basename(file.filename)
        chunks_dir = manager_dir / task / ".chunks" / model_name / safe_filename

        is_complete = save_chunk(
            file, chunk_request.chunk_index, chunk_request.total_chunks, chunks_dir
        )

        internal_path_str = ""

        if is_complete:
            check_model_exists(
                model_storage_path,
                chunk_request.force_override,
                cleanup_callback=shutil.rmtree,
            )

            final_file_path = model_storage_path / safe_filename
            assemble_chunks(chunks_dir, chunk_request.total_chunks, final_file_path)

            internal_path_str = str(model_storage_path)
            llmcpp_manager.downloader.add_user_upload_model(chunk_request.repo_id)

        return {
            "message": (
                "Chunk uploaded"
                if not is_complete
                else "Upload complete and model assembled"
            ),
            "completed": is_complete,
            "repo_id": model_name,
            "filename": safe_filename,
            "chunk_index": chunk_request.chunk_index,
            "internal_path": internal_path_str,
            "task": task,
        }

    @router.delete("/model/upload/chunk", tags=["Model Management"])
    def delete_upload_chunks(
        cleanup_request: ChunkCleanupRequest = Depends(ChunkCleanupRequest.as_form),
    ):
        manager_dir = Path(llmcpp_manager.get_model_dir())
        chunks_dir = (
            manager_dir
            / cleanup_request.task
            / ".chunks"
            / cleanup_request.repo_id
            / os.path.basename(cleanup_request.filename)
        )

        if chunks_dir.exists():
            clear_chunks(chunks_dir)
            return {"message": "Chunks deleted successfully"}
        else:
            return {"message": "No chunks found or already deleted"}

    return router
