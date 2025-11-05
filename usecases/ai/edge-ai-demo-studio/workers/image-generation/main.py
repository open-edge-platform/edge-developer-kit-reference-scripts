# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import argparse
import logging
import multiprocessing
import asyncio
from contextlib import asynccontextmanager
from typing import Optional
import requests
import asyncio
import time
from enum import Enum
from urllib.parse import urlparse

import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAI

from utils.image_generation_ovms import (
    start_ovms_background,
    wait_for_model_ready,
    cleanup_ovms_process,
)

logger = logging.getLogger("uvicorn.error")

OVMS_PROCESS = None  # Store the OVMS process for cleanup

CONFIG = {
    "model_id": "OpenVINO/stable-diffusion-v1-5-int8-ov",
    "device": "CPU",
    "precision": "int8",
    "ovms_port": 5007,
}

# Keep track of long running task
IMAGE_GENERATION_TASK = None
IMAGE_EDIT_TASK = None


class TaskType(Enum):
    IMAGE_GENERATION = "image-generation"
    IMAGE_EDIT = "image-edit"


class Task:
    def __init__(
        self, status="pending", start_time=time.time(), estimated_time=None, result=None
    ):
        self.status = status
        self.start_time = start_time
        self.estimated_time = estimated_time
        self.result = result


def set_task(type: str, task: Task):
    if type == TaskType.IMAGE_GENERATION.value:
        global IMAGE_GENERATION_TASK
        IMAGE_GENERATION_TASK = task
    elif type == TaskType.IMAGE_EDIT.value:
        global IMAGE_EDIT_TASK
        IMAGE_EDIT_TASK = task


def update_task(type: str, status=None, estimated_time=None, result=None):
    def update(task: Task):
        if task is not None:
            if status is not None:
                task.status = status
            if estimated_time is not None:
                task.estimated_time = estimated_time
            if result is not None:
                task.result = result

    if type == TaskType.IMAGE_GENERATION.value:
        global IMAGE_GENERATION_TASK
        update(IMAGE_GENERATION_TASK)
    elif type == TaskType.IMAGE_EDIT.value:
        global IMAGE_EDIT_TASK
        update(IMAGE_EDIT_TASK)


class ImageGenerationRequest(BaseModel):
    """Request model for image generation."""

    model: str = Field(..., description="Model to use for generation")
    prompt: str = Field(..., description="Text prompt describing the desired image")
    size: Optional[str] = Field("512x512", description="Image size in WxH format")
    n: Optional[int] = Field(1, description="Number of images to generate", ge=1, le=10)
    prompt_2: Optional[str] = Field(
        None, description="Second prompt for multi-encoder models"
    )
    prompt_3: Optional[str] = Field(
        None, description="Third prompt for multi-encoder models"
    )
    negative_prompt: Optional[str] = Field(None, description="Negative prompt")
    negative_prompt_2: Optional[str] = Field(None, description="Second negative prompt")
    negative_prompt_3: Optional[str] = Field(None, description="Third negative prompt")
    num_inference_steps: Optional[int] = Field(
        50, description="Number of denoising steps", ge=1, le=200
    )
    guidance_scale: Optional[float] = Field(
        7.5, description="Guidance scale", ge=0.0, le=20.0
    )
    rng_seed: Optional[int] = Field(None, description="Random seed")
    max_sequence_length: Optional[int] = Field(
        None, description="Max sequence length for T5 encoder"
    )
    is_polling: Optional[bool] = Field(
        False, description="Whether the client is polling for task status"
    )


def run_image_generation_task(request: ImageGenerationRequest):
    try:
        # Estimate time based on number of inference steps (each step 2 seconds) and number of images to generate
        estimated_time = (
            (request.num_inference_steps or 50)
            * (request.n if request.n is not None else 1)
            * 2
        )
        update_task(
            type=TaskType.IMAGE_GENERATION.value,
            status="in_progress",
            estimated_time=estimated_time,
        )

        extra_body = {}

        for field_name, value in dict(request).items():
            if (
                field_name
                in [
                    "prompt_2",
                    "prompt_3",
                    "negative_prompt",
                    "negative_prompt_2",
                    "negative_prompt_3",
                    "num_inference_steps",
                    "guidance_scale",
                    "rng_seed",
                    "max_sequence_length",
                ]
                and value is not None
            ):
                extra_body[field_name] = value

        client = OpenAI(
            base_url=f"http://localhost:{CONFIG['ovms_port']}/v3", api_key="-"
        )
        response = client.images.generate(
            model=request.model,
            prompt=request.prompt,
            n=request.n,
            size=request.size,
            extra_body=extra_body,
        )

        update_task(
            type=TaskType.IMAGE_GENERATION.value, status="completed", result=response
        )
        return response
    except Exception as e:
        update_task(
            type=TaskType.IMAGE_GENERATION.value, status="failed", result=str(e)
        )
        if request.is_polling:
            raise e


def run_image_edit_task(
    model: str,
    prompt: str,
    image_data: bytes,
    size: str,
    n: int,
    extra_body: dict,
    is_polling: bool = False,
):
    try:
        # Estimate time based on number of inference steps (each step 2 seconds) and number of images to generate
        num_inference_steps = extra_body.get("num_inference_steps", 50)
        estimated_time = num_inference_steps * n * 2
        update_task(
            type=TaskType.IMAGE_EDIT.value,
            status="in_progress",
            estimated_time=estimated_time,
        )

        client = OpenAI(
            base_url=f"http://localhost:{CONFIG['ovms_port']}/v3", api_key="-"
        )
        response = client.images.edit(
            model=model,
            image=image_data,
            prompt=prompt,
            n=n,
            size=size,
            extra_body=extra_body,
        )

        update_task(type=TaskType.IMAGE_EDIT.value, status="completed", result=response)
        return response
    except Exception as e:
        update_task(type=TaskType.IMAGE_EDIT.value, status="failed", result=str(e))
        if is_polling:
            raise e


@asynccontextmanager
async def lifespan(app: FastAPI):
    global OVMS_PROCESS

    logger.info("Initializing image generation server services ...")

    try:
        # Start the Image Generation OpenVINO Model Server in background
        logger.info("Starting OVMS server...")
        OVMS_PROCESS = await asyncio.to_thread(
            start_ovms_background,
            CONFIG["model_id"],
            CONFIG["device"],
            CONFIG["precision"],
            CONFIG["ovms_port"],
        )

        # Log the process ID for manual management if needed
        if OVMS_PROCESS and hasattr(OVMS_PROCESS, "pid"):
            logger.info(f"OVMS server started with PID: {OVMS_PROCESS.pid}")
        else:
            logger.warning("Could not determine OVMS process ID")

        # Wait for the server to be ready
        logger.info("Waiting for OVMS server to be ready...")

        model_ready = await asyncio.to_thread(
            wait_for_model_ready,
            CONFIG["ovms_port"],
            CONFIG["model_id"],
            timeout=120,  # 2 minutes timeout
        )

        if not model_ready:
            raise RuntimeError("OVMS server failed to start within timeout period")

        logger.info("Image generation server services initialized successfully")

    except Exception as e:
        logger.error(f"Failed to initialize server services: {e}")
        # Clean up if initialization failed
        if OVMS_PROCESS:
            OVMS_PROCESS.terminate()
            OVMS_PROCESS.wait()
        raise e

    yield

    # Cleanup
    logger.info("Stopping image generation server services ...")
    if OVMS_PROCESS:
        logger.info("Terminating OVMS process...")
        cleanup_ovms_process()


allowed_cors = json.loads(os.getenv("ALLOWED_CORS", '["http://localhost"]'))
app = FastAPI(
    title="Image Generation API",
    description="OpenVINO-powered image generation service with OpenAI-compatible endpoints",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthcheck", status_code=200)
def get_healthcheck():
    return {"status": "OK"}


@app.get("/v1/config", status_code=200)
async def get_config():
    """Get OVMS server configuration."""
    try:
        response = requests.get(
            urlparse(f"http://localhost:{CONFIG['ovms_port']}/v1/config")
        )
        return response.json()
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting OVMS config: {str(e)}"
        )


@app.post("/v3/images/generations", status_code=200)
async def generate_images(request: ImageGenerationRequest):
    """Generate images from text prompts."""
    try:
        set_task(TaskType.IMAGE_GENERATION.value, Task(start_time=time.time()))
        if request.is_polling:
            asyncio.create_task(asyncio.to_thread(run_image_generation_task, request))
            return JSONResponse(
                content=jsonable_encoder({"message": "Generate image task started"}),
                status_code=200,
            )
        else:
            result = run_image_generation_task(request)
            return result

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error generating images: {str(e)}"
        )


@app.post("/v3/images/edits", status_code=200)
async def edit_images(
    model: str = Form(..., description="Model to use for editing"),
    prompt: str = Form(..., description="Text prompt for image editing"),
    image: UploadFile = File(..., description="Image file to edit"),
    size: Optional[str] = Form("512x512", description="Image size in WxH format"),
    n: Optional[int] = Form(1, description="Number of images to generate"),
    prompt_2: Optional[str] = Form(None, description="Second prompt"),
    prompt_3: Optional[str] = Form(None, description="Third prompt"),
    negative_prompt: Optional[str] = Form(None, description="Negative prompt"),
    negative_prompt_2: Optional[str] = Form(None, description="Second negative prompt"),
    negative_prompt_3: Optional[str] = Form(None, description="Third negative prompt"),
    num_inference_steps: Optional[int] = Form(
        50, description="Number of denoising steps"
    ),
    guidance_scale: Optional[float] = Form(7.5, description="Guidance scale"),
    strength: Optional[float] = Form(
        0.75, description="Strength for image editing (0.0-1.0)"
    ),
    rng_seed: Optional[int] = Form(None, description="Random seed"),
    max_sequence_length: Optional[int] = Form(
        None, description="Max sequence length for T5 encoder"
    ),
    is_polling: Optional[bool] = Form(
        False, description="Whether the client is polling for task status"
    ),
):
    """Edit images with text prompts."""
    try:
        # Validate image file
        if not image.content_type or not image.content_type.startswith("image/"):
            raise HTTPException(
                status_code=400, detail="Uploaded file must be an image"
            )

        # Read image data
        image_data = await image.read()

        extra_body = {}
        for field_name, value in {
            "prompt_2": prompt_2,
            "prompt_3": prompt_3,
            "negative_prompt": negative_prompt,
            "negative_prompt_2": negative_prompt_2,
            "negative_prompt_3": negative_prompt_3,
            "num_inference_steps": num_inference_steps,
            "guidance_scale": guidance_scale,
            "strength": strength,
            "rng_seed": rng_seed,
            "max_sequence_length": max_sequence_length,
        }.items():
            if value is not None:
                extra_body[field_name] = value

        # Start the long-running task
        set_task(TaskType.IMAGE_EDIT.value, Task(start_time=time.time()))
        if is_polling:
            asyncio.create_task(
                asyncio.to_thread(
                    run_image_edit_task,
                    model,
                    prompt,
                    image_data,
                    size,
                    n,
                    extra_body,
                    is_polling,
                )
            )
        else:
            result = run_image_edit_task(
                model, prompt, image_data, size, n, extra_body, is_polling
            )
            return result

        return JSONResponse(
            content=jsonable_encoder({"message": "Image edit task started"}),
            status_code=200,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error editing image: {str(e)}")


@app.get("/v3/images/tasks/{task_type}", status_code=200)
async def get_task_status(task_type: str):
    """Get the status of a long-running task."""
    try:
        if task_type == TaskType.IMAGE_GENERATION.value:
            task = IMAGE_GENERATION_TASK
        elif task_type == TaskType.IMAGE_EDIT.value:
            task = IMAGE_EDIT_TASK
        else:
            raise HTTPException(status_code=400, detail="Invalid task type")

        if task is None:
            raise HTTPException(status_code=404, detail="No task found")

        return {
            "status": task.status,
            "elapsed_time": time.time() - task.start_time,
            "estimated_time": task.estimated_time,
            "result": task.result,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting task status: {str(e)}"
        )


def parse_args():
    parser = argparse.ArgumentParser(description="Image Generation FastAPI Server")
    parser.add_argument(
        "--port",
        type=int,
        default=5006,
        help="Port for the FastAPI server to listen on",
    )
    parser.add_argument(
        "--ovms-port",
        type=int,
        default=5952,
        help="Port for the OVMS server to listen on",
    )
    parser.add_argument(
        "--model-id",
        type=str,
        required=True,
        help="Hugging Face image generation model name (e.g., OpenVINO/stable-diffusion-v1-5-int8-ov)",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="CPU",
        help="Device to run the model on (e.g., CPU, GPU, NPU) or mixed device configuration (e.g., 'NPU NPU GPU')",
    )
    parser.add_argument(
        "--precision",
        type=str,
        default="int8",
        choices=["fp32", "fp16", "int8", "int4"],
        help="Model precision for quantization (default: int8)",
    )
    return parser.parse_args()


def main():
    global CONFIG

    args = parse_args()
    CONFIG["model_id"] = args.model_id
    CONFIG["device"] = str(args.device).upper().strip()
    CONFIG["precision"] = args.precision
    CONFIG["ovms_port"] = args.ovms_port

    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host=os.environ.get("SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SERVER_PORT", args.port)),
    )


if __name__ == "__main__":
    main()
