# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
FastAPI server for PPT Translation worker
"""

import uuid
import logging
import os
import re
import argparse
import multiprocessing
import asyncio
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# Set up logging
logger = logging.getLogger("uvicorn.error")

# Current directory
current_dir = Path(__file__).parent

try:
    from ppt_translator import LlamaPPTTranslator
    from config import (
        LLAMA_CONFIG,
        TRANSLATION_CONFIG,
        MODEL_PRESETS,
        FONT_SIZE_ADJUSTMENT,
    )
except ImportError as e:
    logger.error(f"Failed to import required modules: {e}")
    raise

# ── Directory setup ──────────────────────────────────────────────────────────
WORKER_DIR = current_dir
FILE_BASE_DIR = WORKER_DIR / "file"
UPLOAD_DIR = FILE_BASE_DIR / "uploads"
OUTPUT_DIR = FILE_BASE_DIR / "outputs"

# ── In-memory job storage ────────────────────────────────────────────────────
translation_jobs: dict[str, dict] = {}


# ── Pydantic models ──────────────────────────────────────────────────────────
class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: float
    message: str
    created_at: str
    completed_at: Optional[str] = None
    error: Optional[str] = None


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(_app: FastAPI):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("PPT Translator service started")
    yield
    logger.info("PPT Translator service shutting down")


# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="PPT Translator", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Path validation ───────────────────────────────────────────────────────────
def validate_file_path(file_path: str, base_dir: Path, description: str) -> str:
    """
    Validate that a file path is within the allowed base directory.
    Uses allowlist-based validation to prevent path traversal attacks.
    """
    try:
        logger.info(f"Validating {description}: {file_path}")
        logger.info(f"Base directory: {base_dir}")

        # Step 1: Check for path traversal sequences before any processing
        if ".." in file_path:
            raise ValueError(f"{description} contains path traversal sequence")

        # Step 2: Check if it's an absolute path - if so, verify it's within base_dir
        if os.path.isabs(file_path):
            abs_path = Path(file_path).resolve()
            abs_base = base_dir.resolve()
            try:
                abs_path.relative_to(abs_base)
                logger.info(f"Absolute path validated: {abs_path}")
                # coverity[tainted_data_return]
                return str(abs_path)
            except ValueError:
                raise ValueError(f"{description} is outside allowed directory")

        # Step 3: Allowlist validation - only allow safe characters
        safe_pattern = re.compile(r"^[a-zA-Z0-9_\-. ()\[\]/\\]+$")
        if not safe_pattern.match(file_path):
            raise ValueError(f"{description} contains invalid characters: {file_path}")

        # Step 4: Convert to Path object and resolve to absolute path
        full_path = base_dir / file_path
        resolved_path = full_path.resolve()
        resolved_base = base_dir.resolve()

        logger.info(f"Resolved path: {resolved_path}")
        logger.info(f"Resolved base: {resolved_base}")

        # Step 5: Verify the resolved path is within the base directory
        try:
            resolved_path.relative_to(resolved_base)
        except ValueError:
            raise ValueError(f"{description} is outside allowed directory")

        validated_path = str(resolved_path)
        logger.info(f"Path validated successfully: {validated_path}")
        # coverity[tainted_data_return]
        return validated_path

    except ValueError as ve:
        logger.error(f"Validation error for {description}: {ve}")
        raise
    except (OSError, RuntimeError) as e:
        logger.error(f"System error validating {description}: {e}")
        raise ValueError(f"Invalid {description}: {e}")


# ── Background translation task ───────────────────────────────────────────────
async def process_translation_job(job_id: str) -> None:
    job = translation_jobs.get(job_id)
    if not job:
        return

    try:
        job["status"] = "processing"
        job["progress"] = 0.0
        job["message"] = "Starting translation..."

        input_file = job["input_file"]
        output_file = job["output_file"]
        config = job["config"]

        # Merge translation config with defaults
        merged_config = TRANSLATION_CONFIG.copy()
        merged_config.update(config)

        translator = LlamaPPTTranslator(
            base_url=LLAMA_CONFIG["base_url"],
            model_preset=merged_config.get("model", "qwen_balanced"),
            target_language=merged_config.get("target_language", "Simplified Chinese"),
            source_language=merged_config.get("source_language", "English"),
            llama_config=LLAMA_CONFIG,
            translation_config=merged_config,
            file_config={
                "input_file": input_file,
                "output_file": output_file,
                "backup_original": False,
            },
            model_presets=MODEL_PRESETS,
            font_adjustment=FONT_SIZE_ADJUSTMENT,
        )

        def progress_callback(current: int, total: int, message: str = "") -> None:
            progress = current / total if total > 0 else 0
            job["progress"] = progress
            job["message"] = message or f"Processing slide {current}/{total}"
            logger.info(f"Progress: {progress * 100:.1f}% - {job['message']}")

        # Run blocking translation in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: translator.translate_presentation(
                input_path=input_file,
                output_path=output_file,
                progress_callback=progress_callback,
            ),
        )

        if not os.path.exists(output_file):
            raise FileNotFoundError(f"Output file was not created: {output_file}")

        job["status"] = "completed"
        job["progress"] = 1.0
        job["message"] = "Translation completed successfully"
        job["completed_at"] = datetime.now(timezone.utc).isoformat()

    except Exception as e:
        logger.error(f"Translation failed for job {job_id}: {e}", exc_info=True)
        job["status"] = "failed"
        job["message"] = "Translation failed"
        job["error"] = str(e)
        job["completed_at"] = datetime.now(timezone.utc).isoformat()


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/healthcheck", status_code=200)
def get_healthcheck():
    return {"status": "ok"}


@app.post("/translate")
async def translate(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source_language: str = Form("English"),
    target_language: str = Form("Simplified Chinese"),
    preserve_proper_nouns: bool = Form(False),
    translate_speaker_notes: bool = Form(False),
    auto_adjust_font_size: bool = Form(False),
    presentation_context: str = Form(""),
    model: str = Form("Qwen3-8B-int4-ov"),
):
    # Validate file type
    if not file.filename or not (
        file.filename.endswith(".pptx") or file.filename.endswith(".ppt")
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only .pptx and .ppt files are supported.",
        )

    # Validate file size (50MB limit)
    contents = await file.read()
    max_size = 50 * 1024 * 1024
    if len(contents) > max_size:
        raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")

    job_id = str(uuid.uuid4())
    input_path = str(UPLOAD_DIR / f"{job_id}_{file.filename}")
    output_path = str(OUTPUT_DIR / f"{job_id}_translated.pptx")

    # Validate paths
    input_path = validate_file_path(input_path, FILE_BASE_DIR, "Input file")
    output_path = validate_file_path(output_path, FILE_BASE_DIR, "Output file")

    # Save uploaded file
    with open(input_path, "wb") as f:
        f.write(contents)

    # Create job entry
    translation_jobs[job_id] = {
        "job_id": job_id,
        "status": "pending",
        "progress": 0.0,
        "message": "Translation job queued",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "completed_at": None,
        "input_file": input_path,
        "output_file": output_path,
        "error": None,
        "config": {
            "source_language": source_language,
            "target_language": target_language,
            "preserve_proper_nouns": preserve_proper_nouns,
            "translate_speaker_notes": translate_speaker_notes,
            "auto_adjust_font_size": auto_adjust_font_size,
            "presentation_context": presentation_context,
            "model": model,
        },
    }

    background_tasks.add_task(process_translation_job, job_id)

    return JSONResponse(
        content={
            "job_id": job_id,
            "status": "pending",
            "message": "Translation job created. Use /status/{job_id} to check progress.",
        }
    )


@app.get("/status/{job_id}", response_model=JobStatus)
async def get_status(job_id: str):
    job = translation_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return JobStatus(
        job_id=job["job_id"],
        status=job["status"],
        progress=job["progress"],
        message=job["message"],
        created_at=job["created_at"],
        completed_at=job.get("completed_at"),
        error=job.get("error"),
    )


@app.get("/download/{job_id}")
async def download(job_id: str):
    job = translation_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Translation not completed. Current status: {job['status']}",
        )

    output_file = job.get("output_file")
    if not output_file or not os.path.exists(output_file):
        raise HTTPException(status_code=404, detail="Output file not found")

    return FileResponse(
        path=output_file,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=f"translated_{job_id}.pptx",
    )


# ── Entry point ───────────────────────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(description="PPT Translator Worker")
    parser.add_argument(
        "--port",
        type=int,
        default=8024,
        help="Port for the worker to listen on (default: 8024)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host=os.environ.get("SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SERVER_PORT", args.port)),
    )


if __name__ == "__main__":
    main()
