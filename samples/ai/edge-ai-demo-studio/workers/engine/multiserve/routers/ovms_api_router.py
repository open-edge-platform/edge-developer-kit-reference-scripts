# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os
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
from typing import Optional, List, Dict
from pathlib import Path

from modules.ovms.cli import OVMSManagerCLI
from modules.utils import ModelSource
from .utils import (
    model_name_parser,
    check_model_exists,
    save_chunk,
    assemble_chunks,
    clear_chunks,
    extract_and_validate_zip,
)

sys.path.append(os.path.dirname(__file__))


class StatusResponse(BaseModel):
    health: str


class ModelRequest(BaseModel):
    repo_id: str = Field(..., example="OpenVINO/Qwen3-8B-int4-ov")
    device: Optional[str] = Field(None, example="CPU")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {"repo_id": "OpenVINO/Qwen3-8B-int4-ov", "device": "CPU"}
        }
    )


class ModelWithTaskStartRequest(BaseModel):
    repo_id: str = Field(..., example="OpenVINO/Qwen3-8B-int4-ov")
    task: str = Field(..., example="text_generation")
    context_size: Optional[int] = Field(None, example=4096)
    device: Optional[str] = Field(None, example="GPU")
    model_path: Optional[str] = Field(None, example="")
    extra_params: Optional[Dict[str, str]] = Field(
        None, example={"weight-format": "int4"}
    )

    @field_validator("task")
    @classmethod
    def validate_task(cls, v: str) -> str:
        allowed_tasks = {
            "text_generation",
            "embeddings",
            "rerank",
            "multimodal",
        }
        if v not in allowed_tasks:
            raise ValueError(f"task must be one of: {', '.join(sorted(allowed_tasks))}")
        return v

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "OpenVINO/Qwen3-8B-int4-ov",
                "task": "text_generation",
                "model_path": "/models/GGUF/text_generation/OpenVINO/Qwen3-8B-int4-ov",
                "device": "CPU",
            }
        }
    )


class ModelWithTaskStopRequest(BaseModel):
    repo_id: str = Field(..., example="OpenVINO/Qwen3-8B-int4-ov")
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
            "example": {
                "repo_id": "OpenVINO/Qwen3-8B-int4-ov",
                "task": "text_generation",
            }
        }
    )


class DownloadModelRequest(BaseModel):
    repo_id: str = Field(..., example="OpenVINO/Qwen3-8B-int4-ov")
    source: Optional[ModelSource] = Field(None, example="huggingface")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "OpenVINO/Qwen3-8B-int4-ov",
            }
        }
    )


class UnverifiedModelRequest(BaseModel):
    repo_id: str = Field(..., example="OpenVINO/Qwen3-8B-int4-ov")
    task: str = Field(..., example="text_generation")
    target_device: Optional[str] = Field(None, example="NPU")
    extra_params: Optional[str] = Field(None, example="--weight-format int4")
    source: Optional[ModelSource] = Field(None, example="huggingface")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "OpenVINO/Qwen3-8B-int4-ov",
                "task": "text_generation",
                "target_device": "NPU",
                "extra_params": "--weight-format int4",
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
                "repo_id must follow the '<Org>/<Model Name>' format (e.g., 'OpenVINO/Qwen3-8B-int4-ov')"
            )

        if "\\" in v or ".." in v:
            raise ValueError("repo_id contains invalid characters")

        return v

    @classmethod
    def as_form(
        cls,
        repo_id: str = Form(
            ...,
            description="Format: <Org>/<Model Name> (e.g., 'OpenVINO/Qwen3-8B-int4-ov')",
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
            description="Format: <Org>/<Model Name> (e.g., 'OpenVINO/Qwen3-8B-int4-ov')",
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


def create_ovms_api_router(ovms_manager: OVMSManagerCLI) -> APIRouter:
    router = APIRouter(prefix="/v1")

    @router.get("/health", response_model=StatusResponse, tags=["OVMS Server Control"])
    def get_server_health():
        return {
            "health": (
                "OK" if ovms_manager.get_is_server_ready() == True else "NOT READY"
            )
        }

    @router.get("/status", tags=["OVMS Server Control"])
    def get_server_status():
        return {"status": ovms_manager.get_server_status()}

    @router.post("/start", tags=["OVMS Server Control"])
    def start_model_server(request: ModelWithTaskStartRequest):
        try:
            _, repo_id = model_name_parser(request.repo_id)

            if request.model_path is None or request.model_path == "":
                result = ovms_manager.start_model(
                    repo_id,
                    request.device,
                    task=request.task,
                    extra_params=request.extra_params,
                )
            else:
                result = ovms_manager.start_local_model(
                    repo_id,
                    request.task,
                    request.context_size,
                    request.device,
                    request.model_path,
                    extra_params=request.extra_params,
                )

            if not result:
                raise HTTPException(
                    status_code=500, detail=f"Failed to start model {request.repo_id}."
                )

            return "OK"
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=f"{e}")
        except Exception as e:
            import traceback

            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Internal Server Error.")

    @router.post("/stop", tags=["OVMS Server Control"])
    def stop_model_server(request: ModelWithTaskStopRequest):
        org, repo_id = model_name_parser(request.repo_id)
        if ovms_manager.stop_model(repo_id):
            return "OK"

        raise HTTPException(
            status_code=400, detail=f"Model {request.repo_id} not running."
        )

    @router.get("/model", tags=["OVMS Model Management"])
    def list_models():
        return ovms_manager.list_models()

    @router.post("/model/download", tags=["OVMS Model Management"])
    def download_model(request: DownloadModelRequest):
        return StreamingResponse(
            ovms_manager.download_model(request.repo_id, request.source),
            media_type="text/plain",
        )

    @router.post("/model/download/unverified", tags=["OVMS Model Management"])
    def download_unverified_model(request: UnverifiedModelRequest):
        return StreamingResponse(
            ovms_manager.download_unverified_model(
                model_name=request.repo_id,
                task=request.task,
                target_device=request.target_device,
                extra_params=request.extra_params,
                source=request.source,
            ),
            media_type="text/plain",
        )

    @router.patch("/model/download/cancel", tags=["OVMS Model Management"])
    def cancel_download_model(request: ModelRequest):
        return ovms_manager.download_model_cancel()

    @router.delete("/model/delete", tags=["OVMS Model Management"])
    def delete_model(request: ModelRequest):
        if ovms_manager.delete_model(request.repo_id):
            return "OK"

        raise HTTPException(status_code=500, detail=f"Internal Server Error")

    @router.post("/model/upload", tags=["OVMS Model Management"])
    def upload_folder(
        model_request: UploadModelRequest = Depends(UploadModelRequest.as_form),
        files: List[UploadFile] = File(...),
    ):
        saved_count = 0

        model_storage_path = (
            Path(ovms_manager.get_model_dir())
            / model_request.task
            / model_request.repo_id
        )

        check_model_exists(
            model_storage_path,
            model_request.force_override,
            cleanup_callback=shutil.rmtree,
        )

        model_storage_path.mkdir(parents=True, exist_ok=True)

        for file in files:
            if not file.filename:
                continue

            if file.filename.endswith(".zip"):
                extract_and_validate_zip(file.file, model_storage_path)
                saved_count += 1
                continue

            file_path = model_storage_path / file.filename
            file_path.parent.mkdir(parents=True, exist_ok=True)

            with file_path.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            saved_count += 1

        return {
            "message": f"Successfully uploaded {saved_count} files",
            "repo_id": model_request.repo_id,
            "internal_path": str(model_storage_path),
            "task": model_request.task,
        }

    @router.post("/model/upload/chunk", tags=["OVMS Model Management"])
    def upload_model_chunk(
        chunk_request: ChunkUploadRequest = Depends(ChunkUploadRequest.as_form),
        file: UploadFile = File(...),
    ):
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided.")

        repo_id = chunk_request.repo_id
        task = chunk_request.task
        manager_dir = Path(ovms_manager.get_model_dir())
        model_storage_path = manager_dir / task / repo_id

        check_model_exists(model_storage_path, chunk_request.force_override)

        safe_filename = os.path.basename(file.filename)
        chunks_dir = manager_dir / task / ".chunks" / repo_id / safe_filename

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

            if safe_filename.endswith(".zip"):
                temp_zip_path = chunks_dir.parent / (safe_filename + ".tmp")
                assemble_chunks(chunks_dir, chunk_request.total_chunks, temp_zip_path)

                extract_and_validate_zip(temp_zip_path, model_storage_path)

                os.remove(temp_zip_path)
            else:
                final_file_path = model_storage_path / safe_filename
                assemble_chunks(chunks_dir, chunk_request.total_chunks, final_file_path)

            internal_path_str = str(model_storage_path)

        return {
            "message": (
                "Chunk uploaded"
                if not is_complete
                else "Upload complete and model assembled"
            ),
            "completed": is_complete,
            "repo_id": repo_id,
            "filename": safe_filename,
            "chunk_index": chunk_request.chunk_index,
            "internal_path": internal_path_str,
            "task": task,
        }

    @router.delete("/model/upload/chunk", tags=["OVMS Model Management"])
    def delete_upload_chunks(
        cleanup_request: ChunkCleanupRequest = Depends(ChunkCleanupRequest.as_form),
    ):
        manager_dir = Path(ovms_manager.get_model_dir())
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
