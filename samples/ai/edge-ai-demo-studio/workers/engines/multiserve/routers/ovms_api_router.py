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
from typing import Optional, List, Dict, Union
from pathlib import Path

from modules.extra_args import check_extra_args
from modules.ovms.cli import OVMSManagerCLI
from modules.utils import ModelSource, check_repo_id
from .utils import (
    model_name_parser,
    check_model_exists,
    chunk_upload_message,
    discard_chunk_upload,
    extract_and_validate_zip,
    receive_upload_chunk,
    remove_path,
    safe_relative_path,
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
    # `ovms --pull` graph options (a list, one shell-quoted string, or {"name": value}), applied
    # on every start: the pull rewrites the model's graph.pbtxt with them.
    extra_params: Optional[Union[List[str], Dict[str, str], str]] = Field(
        None, example=["--max_num_seqs", "8", "--cache_size", "2"]
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

        # Each part is a folder of the model's path.
        return check_repo_id(v)

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
    total_size: Optional[int] = None
    upload_id: Optional[str] = None
    relative_path: Optional[str] = None
    commit: bool = True

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
        total_size: Optional[int] = Form(
            None, description="Size of the whole file in bytes, checked once assembled"
        ),
        upload_id: Optional[str] = Form(
            None,
            description="Client-chosen id grouping the files of one upload; makes chunk requests safe to retry",
        ),
        relative_path: Optional[str] = Form(
            None,
            description="Path of the file inside the model directory (folder uploads); defaults to the filename",
        ),
        commit: bool = Form(
            True,
            description="Move the upload into place once this file is complete; false for all but the last file",
        ),
    ):
        try:
            return cls(
                repo_id=repo_id,
                task=task,
                chunk_index=chunk_index,
                total_chunks=total_chunks,
                force_override=force_override,
                total_size=total_size,
                upload_id=upload_id,
                relative_path=relative_path,
                commit=commit,
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
    upload_id: Optional[str] = None

    @classmethod
    def as_form(
        cls,
        repo_id: str = Form(..., description="Repo ID used for upload"),
        task: str = Form(..., description="Task type"),
        filename: str = Form(..., description="Filename of the upload"),
        upload_id: Optional[str] = Form(None, description="upload_id the chunks were sent with"),
    ):
        return cls(repo_id=repo_id, task=task, filename=filename, upload_id=upload_id)


def _check_model_id(model_id: str) -> None:
    """400 for an id that can't name a model folder, before it is joined into a path."""
    try:
        check_repo_id(model_id, "Model id", exact_parts=None)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


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
        _, repo_id = model_name_parser(request.repo_id)
        try:
            extra_params = check_extra_args(request.extra_params, "openvino")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if request.model_path is None or request.model_path == "":
            # Started by id, the model may be pulled into <task>/<repo_id>.
            _check_model_id(repo_id)

        try:
            if request.model_path is None or request.model_path == "":
                result = ovms_manager.start_model(
                    repo_id,
                    request.device,
                    task=request.task,
                    extra_params=extra_params,
                )
            else:
                result = ovms_manager.start_local_model(
                    repo_id,
                    request.task,
                    request.context_size,
                    request.device,
                    request.model_path,
                    extra_params=extra_params,
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
        _check_model_id(request.repo_id)
        return StreamingResponse(
            ovms_manager.download_model(request.repo_id, request.source),
            media_type="text/plain",
        )

    @router.post("/model/download/unverified", tags=["OVMS Model Management"])
    def download_unverified_model(request: UnverifiedModelRequest):
        _check_model_id(request.repo_id)
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
        _check_model_id(request.repo_id)
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

        # Validated before anything is replaced, so an escaping name can't cost the existing model.
        named_files = [
            (file, safe_relative_path(file.filename)) for file in files if file.filename
        ]

        check_model_exists(
            model_storage_path,
            model_request.force_override,
            cleanup_callback=remove_path,
        )

        model_storage_path.mkdir(parents=True, exist_ok=True)

        try:
            for file, relative_path in named_files:
                if relative_path.endswith(".zip"):
                    extract_and_validate_zip(file.file, model_storage_path)
                    saved_count += 1
                    continue

                file_path = model_storage_path / relative_path
                file_path.parent.mkdir(parents=True, exist_ok=True)

                with file_path.open("wb") as buffer:
                    shutil.copyfileobj(file.file, buffer, 8 * 1024 * 1024)

                saved_count += 1
        except BaseException:
            # A half-written model would read as present and block a retry.
            shutil.rmtree(model_storage_path, ignore_errors=True)
            raise

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
        """One chunk of a model directory upload (contract: routers/utils.py)."""
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided.")

        repo_id = chunk_request.repo_id
        task = chunk_request.task
        manager_dir = Path(ovms_manager.get_model_dir())

        result = receive_upload_chunk(
            source=file.file,
            models_dir=manager_dir,
            task=task,
            repo_id=repo_id,
            target_dir=manager_dir / task / repo_id,
            relative_path=chunk_request.relative_path
            or os.path.basename(file.filename),
            chunk_index=chunk_request.chunk_index,
            total_chunks=chunk_request.total_chunks,
            total_size=chunk_request.total_size,
            upload_id=chunk_request.upload_id,
            force_override=chunk_request.force_override,
            commit=chunk_request.commit,
            replace_target_dir=True,
            extract_zip=True,
        )

        return {
            **result,
            "message": chunk_upload_message(result),
            "repo_id": repo_id,
            "filename": os.path.basename(result["relative_path"]),
            "task": task,
        }

    @router.delete("/model/upload/chunk", tags=["OVMS Model Management"])
    def delete_upload_chunks(
        cleanup_request: ChunkCleanupRequest = Depends(ChunkCleanupRequest.as_form),
    ):
        if discard_chunk_upload(
            Path(ovms_manager.get_model_dir()),
            cleanup_request.task,
            cleanup_request.repo_id,
            cleanup_request.filename,
            cleanup_request.upload_id,
        ):
            return {"message": "Chunks deleted successfully"}
        return {"message": "No chunks found or already deleted"}

    return router
