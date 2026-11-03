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
from typing import Any, BinaryIO, Dict, Optional, List, Union
from pathlib import Path

from modules.extra_args import check_extra_args
from modules.llamacpp.cli import LlamaManagerCLI
from modules.llamacpp.gguf_downloader import GGUFDownloader, GGUFUpload
from .utils import (
    model_name_parser,
    check_model_exists,
    chunk_upload_message,
    discard_chunk_upload,
    receive_upload_chunk,
)

sys.path.append(os.path.dirname(__file__))


# GGUF uploads: one .gguf per upload, registered as `<org>/<model>:<QUANT>`. A file of the same name
# is a conflict unless `force_override`; other files are kept.


def plan_gguf_upload(
    downloader: GGUFDownloader,
    model_id: str,
    task: str,
    filename: str,
    force_override: bool,
) -> GGUFUpload:
    """The upload's target, checked before staging: 422 for an invalid name or file, 409 for an id
    already uploaded as another file."""
    try:
        upload = downloader.plan_upload(model_id, task, filename)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    conflict = None if force_override else downloader.upload_conflict(upload)
    if conflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=conflict)
    return upload


def _gguf_upload_response(upload: GGUFUpload) -> Dict[str, Any]:
    return {
        "repo_id": upload.model_id,
        "quant": upload.quant,
        "filename": upload.filename,
        "task": upload.task,
    }


def save_gguf_upload(
    downloader: GGUFDownloader,
    *,
    source: BinaryIO,
    model_id: str,
    task: str,
    filename: str,
    force_override: bool,
) -> Dict[str, Any]:
    """A whole GGUF in one request. Blocking: call it from a sync handler."""
    upload = plan_gguf_upload(downloader, model_id, task, filename, force_override)
    file_path = upload.target_dir / upload.filename
    check_model_exists(file_path, force_override)

    # Written under a name no listing matches, then swapped in, so a cut-off upload never reads as a model.
    upload.target_dir.mkdir(parents=True, exist_ok=True)
    partial = file_path.with_name(file_path.name + ".partial")
    try:
        with partial.open("wb") as buffer:
            shutil.copyfileobj(source, buffer, 8 * 1024 * 1024)
        os.replace(partial, file_path)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise

    downloader.register_upload(upload)
    return {
        **_gguf_upload_response(upload),
        "message": "Successfully uploaded model file",
        "internal_path": str(upload.target_dir),
    }


def receive_gguf_upload_chunk(
    downloader: GGUFDownloader,
    *,
    source: BinaryIO,
    model_id: str,
    staging_repo_id: str,
    task: str,
    filename: str,
    chunk_index: int,
    total_chunks: int,
    total_size: Optional[int],
    upload_id: Optional[str],
    force_override: bool,
    commit: bool,
) -> Dict[str, Any]:
    """One chunk of a GGUF upload (contract: routers/utils.py), registered once committed.
    ``staging_repo_id`` keys the staged chunks and must match `DELETE .../model/upload/chunk`."""
    upload = plan_gguf_upload(downloader, model_id, task, filename, force_override)
    result = receive_upload_chunk(
        source=source,
        models_dir=Path(downloader.get_model_dir()),
        task=task,
        repo_id=staging_repo_id,
        target_dir=upload.target_dir,
        relative_path=upload.filename,
        chunk_index=chunk_index,
        total_chunks=total_chunks,
        total_size=total_size,
        upload_id=upload_id,
        force_override=force_override,
        commit=commit,
        replace_target_dir=False,
    )
    if result["completed"]:
        downloader.register_upload(upload)
    return {
        **result,
        **_gguf_upload_response(upload),
        "message": chunk_upload_message(result),
    }


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
    # llama-server flags, a list or one shell-quoted string; they replace the engine's own.
    extra_args: Optional[Union[List[str], str]] = Field(
        None, example=["-fa", "on", "-ngl", "33"]
    )
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

        # The ':<QUANT>' is optional; without it the file name gives it (GGUFDownloader.plan_upload).
        org, model_name = parts
        valid_suffixes = ["-GGUF"]
        model_name = model_name.split(":", 1)[0]

        if not any(model_name.endswith(suffix) for suffix in valid_suffixes):
            raise ValueError(
                "Model name must end with '-GGUF', optionally followed by the "
                "quantization (e.g., 'ggml-org/Qwen3-8B-GGUF:Q4_K_M')"
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
    total_size: Optional[int] = None
    upload_id: Optional[str] = None
    relative_path: Optional[str] = None
    commit: bool = True

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
            extra_args = check_extra_args(request.extra_args, "llamacpp")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        try:
            _, repo_id = model_name_parser(request.repo_id)
            if request.model_path == None:
                if llmcpp_manager.start_or_swap_model(
                    repo_id, request.device, request.timeout, extra_args
                ):
                    # Report the context the server negotiated, not the (possibly unset) request.
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
                    extra_args,
                    request.timeout,
                )
                if recommended_ctx != context_size:
                    return recommended_ctx
                return "OK"

        except HTTPException:
            raise
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
        try:
            GGUFDownloader.split_model_id(request.repo_id, "Model id")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
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

        return save_gguf_upload(
            llmcpp_manager.downloader,
            source=file.file,
            model_id=model_request.repo_id,
            task=model_request.task,
            filename=file.filename,
            force_override=model_request.force_override,
        )

    @router.post("/model/upload/chunk", tags=["Model Management"])
    def upload_model_chunk(
        chunk_request: ChunkUploadRequest = Depends(ChunkUploadRequest.as_form),
        file: UploadFile = File(...),
    ):
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided.")

        return receive_gguf_upload_chunk(
            llmcpp_manager.downloader,
            source=file.file,
            model_id=chunk_request.repo_id,
            # Keyed as DELETE /model/upload/chunk keys it: without the quant.
            staging_repo_id=chunk_request.repo_id.split(":")[0],
            task=chunk_request.task,
            filename=file.filename,
            chunk_index=chunk_request.chunk_index,
            total_chunks=chunk_request.total_chunks,
            total_size=chunk_request.total_size,
            upload_id=chunk_request.upload_id,
            force_override=chunk_request.force_override,
            commit=chunk_request.commit,
        )

    @router.delete("/model/upload/chunk", tags=["Model Management"])
    def delete_upload_chunks(
        cleanup_request: ChunkCleanupRequest = Depends(ChunkCleanupRequest.as_form),
    ):
        if discard_chunk_upload(
            Path(llmcpp_manager.get_model_dir()),
            cleanup_request.task,
            cleanup_request.repo_id.split(":")[0],
            os.path.basename(cleanup_request.filename),
            cleanup_request.upload_id,
        ):
            return {"message": "Chunks deleted successfully"}
        return {"message": "No chunks found or already deleted"}

    return router
