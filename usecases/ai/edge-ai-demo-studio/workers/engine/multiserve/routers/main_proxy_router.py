from fastapi import (
    Request,
    HTTPException,
    APIRouter,
    Query,
    UploadFile,
    Form,
    Depends,
    File,
    status,
)
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, ValidationError
from typing import Optional, List
import os
import shutil
from pathlib import Path

from routers.llamacpp_api_router import (
    create_llamacpp_api_router,
    ModelWithTaskStartRequest as LlamaCPPModelTaskRequest,
    ModelWithTaskStopRequest as LlamaCPPModelTaskStopRequest,
)
from routers.llamacpp_openai_proxy_router import create_llamacpp_openai_proxy_router

from routers.ovms_api_router import (
    create_ovms_api_router,
    ModelWithTaskStartRequest as OVMSModelTaskRequest,
    ModelWithTaskStopRequest as OVMSModelTaskStopRequest,
)
from routers.ovms_openai_proxy_router import create_ovms_openai_proxy_router

from modules.llamacpp.cli import LlamaManagerCLI
from modules.ovms.cli import OVMSManagerCLI
from modules.utils import ModelSource
from modules.model_schema import StatusResponse, HybridModelRequest, TokenizeRequest
from .utils import (
    model_name_parser,
    check_model_exists,
    save_chunk,
    assemble_chunks,
    clear_chunks,
    extract_and_validate_zip,
)

INFER_SERVICE_PROVIDERS = {"llamacpp": True, "openvino": True}


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
    provider: str = ""

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
            description="Format: <provider>:<Org>/<Model Name> (e.g., 'llamacpp:OpenVINO/Qwen3-8B-int4-ov')",
        ),
        task: str = Form(..., description="The task type"),
        force_override: bool = Form(False, description="Overwrite existing model?"),
    ):
        parts = repo_id.split(":", 1)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid model format. Expected '<provider>:<Org>/<Model Name>' (e.g., 'llamacpp:OpenVINO/Qwen3-8B-int4-ov')",
            )
        provider, actual_repo_id = parts
        if not INFER_SERVICE_PROVIDERS.get(provider):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Provider '{provider}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
            )
        try:
            return cls(
                repo_id=actual_repo_id,
                task=task,
                force_override=force_override,
                provider=provider,
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
            description="Format: <provider>:<Org>/<Model Name> (e.g., 'llamacpp:OpenVINO/Qwen3-8B-int4-ov')",
        ),
        task: str = Form(..., description="The task type"),
        chunk_index: int = Form(..., description="Index of the chunk (0-based)"),
        total_chunks: int = Form(..., description="Total number of chunks"),
        force_override: bool = Form(False, description="Overwrite existing model?"),
    ):
        parts = repo_id.split(":", 1)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid model format. Expected '<provider>:<Org>/<Model Name>' (e.g., 'llamacpp:OpenVINO/Qwen3-8B-int4-ov')",
            )
        provider, actual_repo_id = parts
        if not INFER_SERVICE_PROVIDERS.get(provider):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Provider '{provider}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
            )
        try:
            return cls(
                repo_id=actual_repo_id,
                task=task,
                chunk_index=chunk_index,
                total_chunks=total_chunks,
                force_override=force_override,
                provider=provider,
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
    provider: str = ""

    @classmethod
    def as_form(
        cls,
        repo_id: str = Form(
            ...,
            description="Format: <provider>:<Org>/<Model Name> (e.g., 'llamacpp:OpenVINO/Qwen3-8B-int4-ov')",
        ),
        task: str = Form(..., description="Task type"),
        filename: str = Form(..., description="Filename of the upload"),
    ):
        parts = repo_id.split(":", 1)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid model format. Expected '<provider>:<Org>/<Model Name>' (e.g., 'llamacpp:OpenVINO/Qwen3-8B-int4-ov')",
            )
        provider, actual_repo_id = parts
        if not INFER_SERVICE_PROVIDERS.get(provider):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Provider '{provider}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
            )
        return cls(
            repo_id=actual_repo_id, task=task, filename=filename, provider=provider
        )


def create_main_proxy_router(
    llmcpp_manager: LlamaManagerCLI, ovms_manager: OVMSManagerCLI
) -> APIRouter:
    main_router = APIRouter(prefix="/v1")

    providers = {
        "llamacpp": create_llamacpp_api_router(llmcpp_manager=llmcpp_manager),
        "llamacpp_openai": create_llamacpp_openai_proxy_router(
            llmcpp_manager=llmcpp_manager
        ),
        "openvino": create_ovms_api_router(ovms_manager=ovms_manager),
        "openvino_openai": create_ovms_openai_proxy_router(ovms_manager=ovms_manager),
    }

    @main_router.get("/health", response_model=StatusResponse, tags=["Server Control"])
    async def get_server_health():
        server_health = {
            "llama.cpp": (
                "OK" if llmcpp_manager.get_is_server_ready() == True else "NOT READY"
            ),
            "ovms": "OK" if ovms_manager.get_is_server_ready() == True else "NOT READY",
        }

        return JSONResponse({"health": server_health})

    @main_router.get("/status", tags=["Server Control"])
    def get_server_status():
        server_statuses = {
            "llama.cpp": llmcpp_manager.get_server_status(),
            "ovms": ovms_manager.get_server_status(),
        }

        return JSONResponse({"status": server_statuses})

    @main_router.post("/start", tags=["Server Control"])
    async def start_model_server(request: HybridModelRequest):
        try:
            repo_id = request.repo_id
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        parts = repo_id.split(":", 1)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise HTTPException(
                status_code=400,
                detail="Invalid model format. Expected '<provider>:<model_id>' (e.g., 'openvino:OpenVINO/Qwen3-8B-int4-ov')",
            )

        provider_name, _ = parts

        if not INFER_SERVICE_PROVIDERS.get(provider_name):
            raise HTTPException(
                status_code=404,
                detail=f"Provider '{provider_name}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
            )

        try:
            selected_router = providers.get(f"{provider_name}")
            for route in selected_router.routes:
                if route.path == "/v1/start":
                    if provider_name == "llamacpp":
                        new_request = LlamaCPPModelTaskRequest(
                            repo_id=request.repo_id,
                            task=request.task,
                            context_size=request.context_size,
                            device=request.device,
                            model_path=request.model_path,
                            mmproj_path=request.mmproj_path,
                            extra_args=request.llamacpp_extra_args,
                            timeout=request.timeout,
                        )
                    elif provider_name == "openvino":
                        new_request = OVMSModelTaskRequest(
                            repo_id=request.repo_id,
                            task=request.task,
                            context_size=request.context_size,
                            device=request.device,
                            model_path=request.model_path,
                            extra_params=request.openvino_extra_params,
                        )

                    return route.endpoint(new_request)
        except Exception as e:
            raise HTTPException(status_code=500, detail="Internal Server Error")

    @main_router.post("/stop", tags=["Server Control"])
    def stop_model_server(request: HybridModelRequest):
        try:
            repo_id = request.repo_id
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        parts = repo_id.split(":", 1)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise HTTPException(
                status_code=400,
                detail="Invalid model format. Expected '<provider>:<model_id>' (e.g., 'openvino:OpenVINO/Qwen3-8B-int4-ov')",
            )

        provider_name, _ = parts

        if not INFER_SERVICE_PROVIDERS.get(provider_name):
            raise HTTPException(
                status_code=404,
                detail=f"Provider '{provider_name}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
            )

        try:
            selected_router = providers.get(f"{provider_name}")
            for route in selected_router.routes:
                if route.path == "/v1/stop":
                    if provider_name == "llamacpp":
                        request = LlamaCPPModelTaskStopRequest(
                            repo_id=request.repo_id, task=request.task
                        )
                    elif provider_name == "ovms":
                        request = OVMSModelTaskStopRequest(
                            repo_id=request.repo_id, task=request.task
                        )

                    return route.endpoint(request)
        except Exception as e:
            raise HTTPException(status_code=500, detail="Internal Server Error")

        raise HTTPException(
            status_code=400, detail=f"Model {request.repo_id} not running."
        )

    @main_router.post("/chat/completions", tags=["OpenAI Compliant API Proxy"])
    async def chat_completions_proxy(request: Request):
        try:
            body = await request.json()
            model_id = body.get("model", "")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        parts = model_id.split(":", 1)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise HTTPException(
                status_code=400,
                detail="Invalid model format. Expected '<provider>:<model_id>' (e.g., 'openvino:OpenVINO/Qwen3-8B-int4-ov')",
            )

        provider_name, _ = parts
        if not INFER_SERVICE_PROVIDERS.get(provider_name):
            raise HTTPException(
                status_code=404,
                detail=f"Provider '{provider_name}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
            )

        selected_router = providers.get(f"{provider_name}_openai")
        for route in selected_router.routes:
            if route.path == "/v1/chat/completions":
                return await route.endpoint(request)

        raise HTTPException(status_code=500, detail="Internal Server Error")

    @main_router.post("/embeddings", tags=["OpenAI Compliant API Proxy"])
    async def embeddings_proxy(request: Request):
        try:
            body = await request.json()
            model_id = body.get("model", "")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        parts = model_id.split(":", 1)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise HTTPException(
                status_code=400,
                detail="Invalid model format. Expected '<provider>:<model_id>' (e.g., 'openvino:OpenVINO/Qwen3-8B-int4-ov')",
            )

        provider_name, _ = parts
        if not INFER_SERVICE_PROVIDERS.get(provider_name):
            raise HTTPException(
                status_code=404,
                detail=f"Provider '{provider_name}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
            )

        selected_router = providers.get(f"{provider_name}_openai")
        for route in selected_router.routes:
            if route.path == "/v1/embeddings":
                return await route.endpoint(request)

        raise HTTPException(status_code=500, detail="Internal Server Error")

    @main_router.post("/rerank", tags=["LlamaCPP API Proxy"])
    async def reranker_proxy(request: Request):
        try:
            body = await request.json()
            model_id = body.get("model", "")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        parts = model_id.split(":", 1)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise HTTPException(
                status_code=400,
                detail="Invalid model format. Expected '<provider>:<model_id>' (e.g., 'openvino:OpenVINO/Qwen3-8B-int4-ov')",
            )

        provider_name, _ = parts
        if not INFER_SERVICE_PROVIDERS.get(provider_name):
            raise HTTPException(
                status_code=404,
                detail=f"Provider '{provider_name}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
            )

        selected_router = providers.get(f"{provider_name}_openai")
        for route in selected_router.routes:
            if route.path == "/v1/rerank":
                return await route.endpoint(request)

        raise HTTPException(status_code=500, detail="Internal Server Error")

    @main_router.post("/tokenize", tags=["LlamaCPP API Proxy"])
    async def tokenize_proxy(tokenize_request: TokenizeRequest):
        try:
            body = tokenize_request.model_dump()
            model_id = body.get("repo_id", "")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        parts = model_id.split(":", 1)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise HTTPException(
                status_code=400,
                detail="Invalid model format. Expected '<provider>:<model_id>' (e.g., 'openvino:OpenVINO/Qwen3-8B-int4-ov')",
            )

        provider_name, _ = parts
        if not INFER_SERVICE_PROVIDERS.get(provider_name):
            raise HTTPException(
                status_code=404,
                detail=f"Provider '{provider_name}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
            )

        selected_router = providers.get(f"{provider_name}_openai")
        for route in selected_router.routes:
            if route.path == "/v1/tokenize":
                return await route.endpoint(tokenize_request)

        raise HTTPException(status_code=500, detail="Internal Server Error")

    # --- Model Management Endpoints ---

    def _parse_provider_repo(repo_id: str):
        parts = repo_id.split(":", 1)
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise HTTPException(
                status_code=400,
                detail="Invalid model format. Expected '<provider>:<model_id>' (e.g., 'llamacpp:OpenVINO/Qwen3-8B-int4-ov')",
            )
        provider_name, actual_repo_id = parts
        if not INFER_SERVICE_PROVIDERS.get(provider_name):
            raise HTTPException(
                status_code=404,
                detail=f"Provider '{provider_name}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
            )
        return provider_name, actual_repo_id

    gguf_downloader = llmcpp_manager.downloader
    ov_downloader = ovms_manager.downloader

    gguf_models_dir = gguf_downloader.models_base_dir
    ov_models_dir = ov_downloader.models_base_dir

    @main_router.get("/models", tags=["Model Management"])
    def get_all_models(
        provider: Optional[str] = Query(
            None, description="Filter by provider: 'llamacpp' or 'openvino'"
        )
    ):
        models = {}

        if provider is None or provider.lower() == "llamacpp":
            try:
                models["llamacpp"] = gguf_downloader.list_models()
            except Exception as e:
                print(f"Error listing llamacpp models: {e}")

        if provider is None or provider.lower() == "openvino":
            try:
                models["openvino"] = ov_downloader.list_models()
            except Exception as e:
                print(f"Error listing openvino models: {e}")

        return models

    @main_router.delete("/model/delete", tags=["Model Management"])
    def delete_model(request: DeleteModelRequest):
        provider, actual_repo_id = _parse_provider_repo(request.repo_id)
        if provider == "llamacpp":
            if gguf_downloader.delete_downloaded_model(actual_repo_id):
                return "OK"
        elif provider == "openvino":
            if ov_downloader.delete_downloaded_model(actual_repo_id):
                return "OK"

        raise HTTPException(status_code=500, detail="Failed to delete model")

    @main_router.post("/model/download/unverified", tags=["Model Management"])
    def download_unverified_model(request: UnverifiedModelRequest):
        provider, actual_repo_id = _parse_provider_repo(request.repo_id)
        if provider == "llamacpp":
            return StreamingResponse(
                gguf_downloader.download_unverified_model(
                    hf_repo_with_tag=actual_repo_id,
                    task=request.task,
                    source=request.source
                ),
                media_type="text/plain",
            )
        elif provider == "openvino":
            return StreamingResponse(
                ov_downloader.download_unverified_model(
                    source_model=actual_repo_id,
                    task=request.task,
                    target_device=request.target_device,
                    extra_params=request.extra_params,
                    source=request.source,
                ),
                media_type="text/plain",
            )

        raise HTTPException(
            status_code=404,
            detail=f"Provider '{provider}' not supported. Available: {list(INFER_SERVICE_PROVIDERS.keys())}",
        )

    def _get_target_dir(provider: str, task: str, repo_id: str) -> Path:
        if provider == "llamacpp":
            return Path(gguf_models_dir) / task / repo_id
        elif provider == "openvino":
            return Path(ov_models_dir) / task / repo_id
        else:
            raise ValueError(f"Invalid provider: {provider}")

    def _get_chunks_dir(provider: str, task: str, repo_id: str, filename: str) -> Path:
        if provider == "llamacpp":
            base = Path(gguf_models_dir)
        elif provider == "openvino":
            base = Path(ov_models_dir)
        else:
            raise ValueError(f"Invalid provider: {provider}")
        return base / task / ".chunks" / repo_id / filename

    @main_router.post("/model/upload", tags=["Model Management"])
    def upload_folder(
        model_request: UploadModelRequest = Depends(UploadModelRequest.as_form),
        files: List[UploadFile] = File(...),
    ):
        saved_count = 0
        try:
            model_storage_path = _get_target_dir(
                model_request.provider, model_request.task, model_request.repo_id
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

        return {
            "message": f"Successfully uploaded {saved_count} files",
            "repo_id": model_request.repo_id,
            "internal_path": str(model_storage_path),
            "task": model_request.task,
            "provider": model_request.provider,
        }

    @main_router.post("/model/upload/chunk", tags=["Model Management"])
    def upload_model_chunk(
        chunk_request: ChunkUploadRequest = Depends(ChunkUploadRequest.as_form),
        file: UploadFile = File(...),
    ):
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided.")

        repo_id = chunk_request.repo_id
        task = chunk_request.task
        safe_filename = os.path.basename(file.filename)

        try:
            model_storage_path = _get_target_dir(chunk_request.provider, task, repo_id)
            chunks_dir = _get_chunks_dir(
                chunk_request.provider, task, repo_id, safe_filename
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid provider")

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
            "provider": chunk_request.provider,
        }

    @main_router.delete("/model/upload/chunk", tags=["Model Management"])
    def delete_upload_chunks(
        cleanup_request: ChunkCleanupRequest = Depends(ChunkCleanupRequest.as_form),
    ):
        try:
            chunks_dir = _get_chunks_dir(
                cleanup_request.provider,
                cleanup_request.task,
                cleanup_request.repo_id,
                os.path.basename(cleanup_request.filename),
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid provider")

        if chunks_dir.exists():
            clear_chunks(chunks_dir)
            return {"message": "Chunks deleted successfully"}
        else:
            return {"message": "No chunks found or already deleted"}

    return main_router
