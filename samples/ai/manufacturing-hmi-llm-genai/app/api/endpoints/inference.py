# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
from fastapi import APIRouter, BackgroundTasks

from app.core import globals
from app.services.inference_service import run_inference

router = APIRouter()

@router.get("/inference_status")
async def inference_status():
    return {"is_inference_in_progress": globals.is_inference_in_progress}

@router.post("/start_inference")
async def start_inference(background_tasks: BackgroundTasks):
    if globals.is_inference_in_progress:
        return {"message": "Inference is already in progress. Please wait."}
    background_tasks.add_task(run_inference)
    return {"message": "Inference started successfully!"}
