# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""FastAPI server for the PPT translation worker."""

import uuid
import logging
import os
import re
import multiprocessing
import asyncio
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from worker_common import (
    CANCELLED,
    CancelToken,
    JobCancelled,
    base_parser,
    create_app,
    instance_data_dir,
    serve,
    sse_response,
    watch_status,
)

logger = logging.getLogger("uvicorn.error")

current_dir = Path(__file__).parent

try:
    from ppt_translator import LlamaPPTTranslator
    from config import (
        LLAMA_CONFIG,
        TRANSLATION_CONFIG,
        MODEL_PRESETS,
        FONT_SIZE_ADJUSTMENT,
        fetch_active_model_config,
    )
except ImportError as e:
    logger.error(f"Failed to import required modules: {e}")
    raise

# Directory setup
WORKER_DIR = current_dir
FILE_BASE_DIR = instance_data_dir(WORKER_DIR / "file")
UPLOAD_DIR = FILE_BASE_DIR / "uploads"
OUTPUT_DIR = FILE_BASE_DIR / "outputs"

# In-memory job storage
translation_jobs: dict[str, dict] = {}

#: Statuses a job never leaves.
FINAL_STATUSES = {"completed", "failed", CANCELLED}


# Pydantic models
class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: float
    message: str
    created_at: str
    completed_at: Optional[str] = None
    error: Optional[str] = None
    # Set once DELETE /status/{job_id} asked a job to stop; a running job
    # keeps its status until it reaches the next batch.
    cancel_requested: bool = False


# Lifespan
@asynccontextmanager
async def lifespan(_app: FastAPI):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("PPT Translator service started")
    yield
    logger.info("PPT Translator service shutting down")


# App setup
# The frontend proxies /healthcheck to the browser, which reads the JSON body,
# so the route stays this worker's own.
app = create_app("PPT Translator", lifespan=lifespan, healthcheck=False)


# Path validation
def validate_file_path(file_path: str, base_dir: Path, description: str) -> str:
    """Return ``file_path`` resolved, if it lies within ``base_dir`` (allowlist, against traversal)."""
    try:
        logger.info(f"Validating {description}: {file_path}")
        logger.info(f"Base directory: {base_dir}")

        if ".." in file_path:
            raise ValueError(f"{description} contains path traversal sequence")

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

        safe_pattern = re.compile(r"^[a-zA-Z0-9_\-. ()\[\]/\\]+$")
        if not safe_pattern.match(file_path):
            raise ValueError(f"{description} contains invalid characters: {file_path}")

        full_path = base_dir / file_path
        resolved_path = full_path.resolve()
        resolved_base = base_dir.resolve()

        logger.info(f"Resolved path: {resolved_path}")
        logger.info(f"Resolved base: {resolved_base}")

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


# Background translation task
def run_translation_job(job: dict) -> None:
    """Translate a job's deck, updating its status per batch; blocking, so run in a thread.

    Raises ``JobCancelled`` at the next safe point (before a batch, mid-stream, before saving).
    """
    input_file = job["input_file"]
    output_file = job["output_file"]
    config = job["config"]
    cancel: CancelToken = job["cancel"]

    merged_config = TRANSLATION_CONFIG.copy()
    merged_config.update(config)

    job["message"] = "Connecting to Text Generation..."

    # Re-resolve per job: Text Generation may have started or changed since this worker did.
    current_llama_config = {**LLAMA_CONFIG, **fetch_active_model_config()}

    translator = LlamaPPTTranslator(
        base_url=current_llama_config["base_url"],
        model_preset=merged_config.get("model", "qwen_balanced"),
        target_language=merged_config.get("target_language", "Simplified Chinese"),
        source_language=merged_config.get("source_language", "English"),
        llama_config=current_llama_config,
        translation_config=merged_config,
        file_config={
            "input_file": input_file,
            "output_file": output_file,
            "backup_original": False,
        },
        model_presets=MODEL_PRESETS,
        font_adjustment=FONT_SIZE_ADJUSTMENT,
        cancel=cancel,
    )
    cancel.check()

    def progress_callback(current: int, total: int, message: str = "") -> None:
        progress = current / total if total > 0 else 0
        # Set together so a status read in between never pairs a new
        # message with an old figure.
        job.update(
            progress=progress,
            message=message or f"Processing {current}/{total}",
        )
        logger.info(f"Progress: {progress * 100:.1f}% - {job['message']}")

    translator.translate_presentation(
        input_path=input_file,
        output_path=output_file,
        progress_callback=progress_callback,
    )

    # A cancel that came while the deck was being saved still wins: nobody
    # is waiting for this file any more.
    cancel.check()

    if not os.path.exists(output_file):
        raise FileNotFoundError(f"Output file was not created: {output_file}")


def remove_job_files(job: dict) -> None:
    """Deletes a job's upload and whatever part of its output exists."""
    for key in ("input_file", "output_file"):
        path = job.get(key)
        if not path:
            continue
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning(f"Could not delete {path}: {e}")


def mark_cancelled(job: dict) -> None:
    job.update(
        status=CANCELLED,
        message="Translation cancelled",
        completed_at=datetime.now(timezone.utc).isoformat(),
    )


async def process_translation_job(job_id: str) -> None:
    job = translation_jobs.get(job_id)
    # Gone, or cancelled before it got to start.
    if not job or job["status"] != "pending":
        return

    try:
        job["status"] = "processing"
        job["progress"] = 0.0
        job["message"] = "Starting translation..."

        await asyncio.to_thread(run_translation_job, job)

        job["status"] = "completed"
        job["progress"] = 1.0
        job["message"] = "Translation completed successfully"
        job["completed_at"] = datetime.now(timezone.utc).isoformat()

    except JobCancelled:
        logger.info(f"Translation cancelled for job {job_id}")
        await asyncio.to_thread(remove_job_files, job)
        mark_cancelled(job)

    except Exception as e:
        logger.error(f"Translation failed for job {job_id}: {e}", exc_info=True)
        job["status"] = "failed"
        job["message"] = "Translation failed"
        job["error"] = str(e)
        job["completed_at"] = datetime.now(timezone.utc).isoformat()


def job_status(job_id: str) -> Optional[dict]:
    """The body GET /status/{job_id} answers with, or None for an unknown job."""
    job = translation_jobs.get(job_id)
    if not job:
        return None
    return JobStatus(
        job_id=job["job_id"],
        status=job["status"],
        progress=job["progress"],
        message=job["message"],
        created_at=job["created_at"],
        completed_at=job.get("completed_at"),
        error=job.get("error"),
        cancel_requested="cancel" in job and job["cancel"].cancelled,
    ).model_dump()


MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_UPLOAD_CHUNK_BYTES = 1024 * 1024


class UploadTooLarge(Exception):
    pass


def save_upload(source, destination: str) -> None:
    """Copies an upload to disk in chunks, refusing more than 50 MB."""
    source.seek(0)
    written = 0
    try:
        with open(destination, "wb") as f:
            while chunk := source.read(_UPLOAD_CHUNK_BYTES):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise UploadTooLarge()
                f.write(chunk)
    except BaseException:
        try:
            os.remove(destination)
        except OSError:
            pass
        raise


# Routes
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
    if not file.filename or not (
        file.filename.endswith(".pptx") or file.filename.endswith(".ppt")
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only .pptx and .ppt files are supported.",
        )

    job_id = str(uuid.uuid4())
    input_path = str(UPLOAD_DIR / f"{job_id}_{file.filename}")
    output_path = str(OUTPUT_DIR / f"{job_id}_translated.pptx")

    input_path = validate_file_path(input_path, FILE_BASE_DIR, "Input file")
    output_path = validate_file_path(output_path, FILE_BASE_DIR, "Output file")

    # Off the event loop.
    try:
        await asyncio.to_thread(save_upload, file.file, input_path)
    except UploadTooLarge:
        raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")

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
        "cancel": CancelToken(),
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
            "message": (
                "Translation job created. Follow /status/{job_id}/events "
                "(or poll /status/{job_id}) to check progress."
            ),
        }
    )


@app.get("/status/{job_id}", response_model=JobStatus)
async def get_status(job_id: str):
    status = job_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


# A pending job is cancelled at once; a running one stops before its next batch or mid-stream
# (closing the LLM request), then its files are deleted.
@app.delete("/status/{job_id}", response_model=JobStatus)
async def cancel_translation(job_id: str):
    job = translation_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in FINAL_STATUSES:
        job["cancel"].cancel()
        if job["status"] == "pending":
            mark_cancelled(job)
            await asyncio.to_thread(remove_job_files, job)
    return job_status(job_id)


# GET /status/{job_id} as Server-Sent `status` events until the job finishes.
@app.get("/status/{job_id}/events")
async def get_status_events(job_id: str):
    if job_id not in translation_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return sse_response(
        watch_status(
            lambda: job_status(job_id),
            lambda status: status["status"] in FINAL_STATUSES,
        )
    )


@app.get("/download/{job_id}")
async def download(job_id: str):
    job = translation_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] == CANCELLED:
        raise HTTPException(status_code=409, detail="Translation was cancelled")

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


# Entry point
def parse_args():
    return base_parser("PPT Translator Worker", default_port=8024, device=False).parse_args()


def main():
    args = parse_args()
    multiprocessing.freeze_support()
    serve(app, args)


if __name__ == "__main__":
    main()
