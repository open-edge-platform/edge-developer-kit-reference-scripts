from fastapi import (
    APIRouter,
    Query,
    UploadFile,
    Form,
    Depends,
    File,
    HTTPException,
    status,
)
from fastapi.responses import StreamingResponse
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, ConfigDict, Field, field_validator, ValidationError
import os
import shutil
from pathlib import Path
from enum import Enum

from modules.llamacpp.gguf_downloader import GGUFDownloader
from modules.ovms.ov_downloader import OVDownloader, ModelSource
from modules.utils import get_resource_path, validate_and_sanitize_dir
from .utils import (
    check_model_exists,
    save_chunk,
    assemble_chunks,
    clear_chunks,
    extract_and_validate_zip,
)


class DeleteModelRequest(BaseModel):
    repo_id: str


class UnverifiedModelRequest(BaseModel):
    repo_id: str
    task: str
    target_device: Optional[str] = None
    extra_params: Optional[str] = None
    source: Optional[ModelSource] = ModelSource.HUGGINGFACE


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
            return cls(
                repo_id=repo_id,
                task=task,
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


def create_general_router(models_dir: str = "models"):
    router = APIRouter(prefix="/v1/api", tags=["General"])

    models_dir = validate_and_sanitize_dir(models_dir) if models_dir else "models"
    verified_path = get_resource_path("verified.yaml")

    gguf_models_dir = os.path.join(models_dir, "GGUF")
    ov_models_dir = os.path.join(models_dir, "OV")

    gguf_downloader = GGUFDownloader(
        models_base_dir=gguf_models_dir, verified_model_file=verified_path
    )

    ov_downloader = OVDownloader(
        models_base_dir=ov_models_dir, verified_model_file=verified_path
    )

    @router.get("/models")
    def get_all_models(
        backend: Optional[str] = Query(
            None, description="Filter by backend: 'llamacpp' or 'openvino'"
        )
    ):
        models = {}

        if backend is None or backend.lower() == "llamacpp":
            try:
                llamacpp_models = gguf_downloader.list_models()
                models["llamacpp"] = llamacpp_models
            except Exception as e:
                print(f"Error listing llamacpp models: {e}")

        if backend is None or backend.lower() == "openvino":
            try:
                ov_models = ov_downloader.list_models()
                models["openvino"] = ov_models
            except Exception as e:
                print(f"Error listing openvino models: {e}")

        return models

    @router.delete("/model/delete")
    def delete_model(
        request: DeleteModelRequest,
        backend: str = Query(..., description="Backend: 'llamacpp' or 'openvino'"),
    ):
        if backend == "llamacpp":
            if gguf_downloader.delete_downloaded_model(request.repo_id):
                return "OK"
        elif backend == "openvino":
            if ov_downloader.delete_downloaded_model(request.repo_id):
                return "OK"

        raise HTTPException(status_code=500, detail=f"Failed to delete model")

    @router.post("/model/download/unverified")
    def download_unverified_model(
        request: UnverifiedModelRequest,
        backend: str = Query(..., description="Backend: 'llamacpp' or 'openvino'"),
    ):
        if backend == "llamacpp":
            return StreamingResponse(
                gguf_downloader.download_unverified_model(
                    hf_repo_with_tag=request.repo_id,
                    task=request.task,
                ),
                media_type="text/plain",
            )
        elif backend == "openvino":
            return StreamingResponse(
                ov_downloader.download_unverified_model(
                    source_model=request.repo_id,
                    task=request.task,
                    target_device=request.target_device,
                    extra_params=request.extra_params,
                    source=request.source,
                ),
                media_type="text/plain",
            )
        else:
            raise HTTPException(status_code=400, detail="Invalid backend")

    def _get_target_dir(backend: str, task: str, repo_id: str) -> Path:
        if backend == "llamacpp":
            return Path(gguf_models_dir) / task / repo_id
        elif backend == "openvino":
            return Path(ov_models_dir) / task / repo_id
        else:
            raise ValueError("Invalid backend")

    def _get_chunks_dir(backend: str, task: str, repo_id: str, filename: str) -> Path:
        if backend == "llamacpp":
            base = Path(gguf_models_dir)
        elif backend == "openvino":
            base = Path(ov_models_dir)
        else:
            raise ValueError("Invalid backend")
        return base / task / ".chunks" / repo_id / filename

    @router.post("/model/upload")
    def upload_folder(
        model_request: UploadModelRequest = Depends(UploadModelRequest.as_form),
        files: List[UploadFile] = File(...),
        backend: str = Query(..., description="The backend (llamacpp or openvino)"),
    ):
        saved_count = 0
        try:
            model_storage_path = _get_target_dir(
                backend, model_request.task, model_request.repo_id
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid backend")

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

        # Register user upload for llamacpp if needed?
        # GGUFDownloader list_models scans directory so it should be fine.

        return {
            "message": f"Successfully uploaded {saved_count} files",
            "repo_id": model_request.repo_id,
            "internal_path": str(model_storage_path),
            "task": model_request.task,
            "backend": backend,
        }

    @router.post("/model/upload/chunk")
    def upload_model_chunk(
        chunk_request: ChunkUploadRequest = Depends(ChunkUploadRequest.as_form),
        file: UploadFile = File(...),
        backend: str = Query(..., description="The backend (llamacpp or openvino)"),
    ):
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided.")

        repo_id = chunk_request.repo_id
        task = chunk_request.task
        safe_filename = os.path.basename(file.filename)

        try:
            model_storage_path = _get_target_dir(backend, task, repo_id)
            chunks_dir = _get_chunks_dir(backend, task, repo_id, safe_filename)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid backend")

        check_model_exists(model_storage_path, chunk_request.force_override)

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
            "backend": backend,
        }

    @router.delete("/model/upload/chunk")
    def delete_upload_chunks(
        cleanup_request: ChunkCleanupRequest = Depends(ChunkCleanupRequest.as_form),
        backend: str = Query(..., description="The backend (llamacpp or openvino)"),
    ):
        try:
            chunks_dir = _get_chunks_dir(
                backend,
                cleanup_request.task,
                cleanup_request.repo_id,
                os.path.basename(cleanup_request.filename),
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid backend")

        if chunks_dir.exists():
            clear_chunks(chunks_dir)
            return {"message": "Chunks deleted successfully"}
        else:
            return {"message": "No chunks found or already deleted"}

    return router
