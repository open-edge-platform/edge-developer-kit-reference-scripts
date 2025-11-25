# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from typing import  Optional

from modules.llamacpp.cli import LlamaManagerCLI

sys.path.append(os.path.dirname(__file__))

class StatusResponse(BaseModel):
    health: str

class ModelRequest(BaseModel):
    repo_id: str = Field(..., example="Qwen/Qwen3-1.7B-GGUF")
    device: Optional[str] = Field(None, example="CPU")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "Qwen/Qwen3-1.7B-GGUF:Q8_0",
                "device": "CPU"
            }
        }
    )

class DownloadModelRequest(BaseModel):
    repo_id: str = Field(..., example="Qwen/Qwen3-1.7B-GGUF")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "Qwen/Qwen3-1.7B-GGUF:Q8_0",
            }
        }
    )

class UnverifiedModelRequest(BaseModel):
    repo_id: str = Field(..., example="Qwen/Qwen3-1.7B-GGUF")
    task: str = Field(..., example="text_generation")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "Qwen/Qwen3-8B-GGUF:Q4_K_M",
                "task": "text_generation"
            }
        }
    )

def create_llamacpp_api_router(llama_manager: LlamaManagerCLI) -> APIRouter:
    router = APIRouter(prefix="/v1")
    
    @router.get("/health", response_model=StatusResponse, tags=["Server Control"])
    def get_server_health():
        return { "health" : "OK" if llama_manager.get_is_server_ready() == True else "NOT READY" }

    @router.get("/status", tags=["Server Control"])
    def get_server_status():
        return { "status": llama_manager.get_server_status() }
    
    @router.post("/start", tags=["Server Control"])
    def start_model_server(request: ModelRequest):
        if llama_manager.start_or_swap_model(request.repo_id, request.device):
            return "OK"
        
        raise HTTPException(status_code=500, detail=f"Model {request.repo_id} not found.")
    
    @router.post("/stop", tags=["Server Control"])
    def stop_model_server(request: ModelRequest):
        if llama_manager.stop_model(request.repo_id):
            return "OK"
        
        raise HTTPException(status_code=500, detail=f"Internal Server Error")
        
    @router.get("/model", tags=["Model Management"])
    def list_models():
        return llama_manager.list_models()

    @router.post("/model/download", tags=["Model Management"])
    def download_model(request: DownloadModelRequest):
        return StreamingResponse(
            llama_manager.download_model(request.repo_id), 
            media_type="text/plain"
        )
    
    @router.post("/model/download/unverified", tags=["Model Management"])
    def download_unverified_model(request: UnverifiedModelRequest):
        return StreamingResponse(
            llama_manager.download_unverified_model(
                hf_repo_with_tag=request.repo_id,
                task=request.task
            ), 
            media_type="text/plain"
        )
    
    @router.patch("/model/download/cancel", tags=["Model Management"])
    def cancel_download_model(request: ModelRequest):
        return llama_manager.download_model_cancel()
    
    @router.delete("/model/delete", tags=["Model Management"])
    def delete_model(request: ModelRequest):
        if llama_manager.delete_model(request.repo_id):
            return "OK"
        
        raise HTTPException(status_code=500, detail=f"Internal Server Error")

    return router