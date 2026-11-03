# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import base64
import json
import logging
import math
import multiprocessing
import asyncio
import os
import re
import shutil
import threading
import uuid
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Callable, Literal, Optional
import httpx
import openai
import requests
import time
from enum import Enum
from urllib.parse import urlparse

from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Request
from pydantic import BaseModel, Field
from openai import OpenAI
from starlette.concurrency import run_in_threadpool

from worker_common import (
    CANCELLED,
    CancelToken,
    JobCancelled,
    base_parser,
    create_app,
    install_models_routes,
    install_openai_errors,
    instance_data_dir,
    instance_key,
    serve,
    server_timing,
    sse_response,
    startup_timeout,
    timed,
    watch_status,
)

from utils.image_generation_ovms import (
    serve_lock as ovms_serve_lock,
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
    # Set in main() from --ovms-port or --port + 1: a fixed default could collide across instances.
    "ovms_port": None,
}

# A generation runs for as long as its steps take (minutes on a CPU), so a
# call to OVMS has no read timeout; a dead OVMS closes the connection instead.
OVMS_TIMEOUT = httpx.Timeout(None, connect=10.0)
# Seconds to wait for OVMS's /v1/config.
OVMS_CONFIG_TIMEOUT = 10

# This instance's own writable directory: the worker's `data/` when it runs
# on its own.
DATA_DIR = instance_data_dir(Path(__file__).resolve().parent / "data")
# Finished images, as `<job id>/<index>.png`; emptied on every start.
JOBS_DIR = DATA_DIR / "jobs"
# Seconds per denoising step measured on this instance, kept across starts.
STEP_TIMES_FILE = DATA_DIR / "step-times.json"

# Finished jobs stay readable (status and images) this long ...
JOB_TTL_SECONDS = 30 * 60
# ... and at most this many of them are kept, since each keeps its images
# on disk.
MAX_FINISHED_JOBS = 16
FINAL_STATUSES = ("completed", "failed", CANCELLED)
# How often a request answered at once checks whether its job is done and
# its client still there.
ANSWER_WAIT_SECONDS = 0.25

ResponseFormat = Literal["b64_json", "url"]


class TaskType(Enum):
    IMAGE_GENERATION = "image-generation"
    IMAGE_EDIT = "image-edit"


def _pixels(size: str) -> Optional[int]:
    """Pixel count of a ``WxH`` size, or None for ``auto`` and the like."""
    match = re.fullmatch(r"\s*(\d+)\s*[xX]\s*(\d+)\s*", size)
    return int(match[1]) * int(match[2]) if match else None


class StepTimes:
    """Seconds per denoising step measured on this instance, as a moving average per image size.

    OVMS reports no progress within an image, so this estimates it. An unmeasured size scales the
    nearest measured one by pixel count. Rates persist per model and device in ``STEP_TIMES_FILE``.
    """

    DEFAULT_SECONDS = 2.0
    # Weight of the newest measurement: steps or device load can change
    # between requests, so the estimate follows quickly.
    ALPHA = 0.5

    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.Lock()
        # Held while writing the file, so status reads never wait on disk.
        self._save_lock = threading.Lock()
        self._key = ""
        self._all: dict[str, dict[str, float]] = {}

    def load(self, key: str):
        """Reads the saved rates and uses those of ``key`` (model and device)."""
        try:
            saved = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            saved = {}
        with self._lock:
            self._key = key
            self._all = {
                model: {
                    size: float(rate)
                    for size, rate in rates.items()
                    if isinstance(rate, (int, float)) and rate > 0
                }
                for model, rates in (saved if isinstance(saved, dict) else {}).items()
                if isinstance(rates, dict)
            }

    def record(self, size: str, seconds_per_step: float):
        if not seconds_per_step > 0:
            return
        with self._lock:
            rates = self._all.setdefault(self._key, {})
            previous = rates.get(size)
            rates[size] = (
                seconds_per_step
                if previous is None
                else self.ALPHA * seconds_per_step + (1 - self.ALPHA) * previous
            )
            saved = json.dumps(self._all, indent=2)
        with self._save_lock:
            try:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                partial = self._path.with_suffix(".tmp")
                partial.write_text(saved, encoding="utf-8")
                os.replace(partial, self._path)
            except OSError as exc:
                logger.warning(f"Could not save the measured step times: {exc}")

    def estimate(self, size: str) -> float:
        """Seconds one denoising step of a ``size`` image should take."""
        with self._lock:
            rates = self._all.get(self._key) or {}
            if size in rates:
                return rates[size]
            pixels = _pixels(size)
            known = [(p, rate) for s, rate in rates.items() if (p := _pixels(s))]
            if pixels and known:
                nearest, rate = min(known, key=lambda k: abs(math.log(k[0] / pixels)))
                return rate * pixels / nearest
            if rates:
                return sum(rates.values()) / len(rates)
            return self.DEFAULT_SECONDS


_step_times = StepTimes(STEP_TIMES_FILE)


def _image_url(job_id: str, index: int) -> str:
    """Where an image of a job is served: through the app's instance proxy
    when the app runs this worker, else on the worker itself."""
    path = f"/v1/images/jobs/{job_id}/images/{index}"
    key = instance_key()
    return f"/api/{key}{path}" if key else path


class Job:
    """One generation or edit request, run from the queue.

    Statuses: ``pending`` (waiting for its turn, with its ``position``) ->
    ``in_progress`` -> ``completed``, ``failed`` or ``cancelled``. Each image
    is written to ``JOBS_DIR/<id>/<index>.png`` as soon as its OVMS call
    returns, so it is readable while the job goes on.
    """

    def __init__(
        self,
        task_type: str,
        make_images: Callable[[int], Any],
        *,
        n: int,
        steps_per_image: Optional[int],
        size: Optional[str],
        strength: Optional[float] = None,
        batch: bool = False,
        response_format: ResponseFormat = "b64_json",
    ):
        self.id = uuid.uuid4().hex
        self.type = task_type
        self.n = n
        self.steps_per_image = steps_per_image
        self.size = size or "auto"
        # Steps an image really runs: an edit starts part of the way in.
        steps = steps_per_image or 50
        if strength is not None:
            scale = min(max(strength, 0.0), 1.0)
            steps = int(steps * (scale or 1.0))
        self._steps_run = max(steps, 1)
        self.response_format = response_format
        self._make_images = make_images
        # A request answered at once makes its images in one OVMS call; a
        # background job makes one image per call, so each is readable as
        # soon as it is done and a cancel stops it before the next.
        self._calls = 1 if batch else n
        self.token = CancelToken()
        self.status = "pending"
        self.created = time.time()
        self.started: Optional[float] = None
        self.finished: Optional[float] = None
        self.image_started: Optional[float] = None
        self.images_done = 0
        # Everything OVMS answered but the image data, per image and for the
        # response, so the answer read from disk has the same shape.
        self._image_fields: list[dict] = []
        self._response_fields: dict = {}
        self.error: Optional[str] = None
        self.error_status: Optional[int] = None
        # Seconds spent in OVMS calls, for `Server-Timing`.
        self.inference_seconds = 0.0
        # Set once nothing will read the images: they go when the job ends.
        self._discard = False
        self._lock = threading.Lock()

    @property
    def folder(self) -> Path:
        return JOBS_DIR / self.id

    def image_path(self, index: int) -> Path:
        return self.folder / f"{index}.png"

    @property
    def is_final(self) -> bool:
        return self.status in FINAL_STATUSES

    def start(self):
        with self._lock:
            self.started = time.time()
            self.status = "in_progress"

    def drop(self):
        """Cancels the job before it started."""
        self.token.cancel()
        self._finish(CANCELLED)

    def run(self):
        """Makes the job's images, on the queue's thread."""
        try:
            for index in range(self._calls):
                self.token.check()
                with self._lock:
                    self.image_started = time.time()
                with timed() as clock:
                    response = jsonable_encoder(self._make_images(index))
                made = self._save_images(response)
                with self._lock:
                    self.inference_seconds += clock.seconds
                if made:
                    _step_times.record(self.size, clock.seconds / (self._steps_run * made))
        except JobCancelled:
            logger.info(f"{self.type} job {self.id} cancelled")
            self._finish(CANCELLED)
        except Exception as exc:
            status, message = _ovms_error(exc)
            logger.error(f"{self.type} job {self.id} failed ({status}): {message}")
            self._finish("failed", error=message, error_status=status)
        else:
            self._finish("completed")

    def _save_images(self, response: dict) -> int:
        """Writes the images of one OVMS answer to disk. Returns how many."""
        written: list[dict] = []
        for item in response.get("data") or []:
            encoded = item.get("b64_json")
            if not encoded:
                continue
            self.folder.mkdir(parents=True, exist_ok=True)
            self.image_path(self.images_done + len(written)).write_bytes(
                base64.b64decode(encoded)
            )
            written.append({k: v for k, v in item.items() if k != "b64_json"})
        with self._lock:
            if not self._response_fields:
                self._response_fields = {k: v for k, v in response.items() if k != "data"}
            self._image_fields.extend(written)
            self.images_done += len(written)
        return len(written)

    def _finish(self, status: str, error: Optional[str] = None, error_status: Optional[int] = None):
        with self._lock:
            self.finished = time.time()
            self.status = status
            self.error = error
            self.error_status = error_status
            discard = self._discard
        if discard:
            shutil.rmtree(self.folder, ignore_errors=True)

    def discard_images(self):
        """Deletes the job's images: now if it has ended, else when it does."""
        with self._lock:
            self._discard = True
            final = self.is_final
        if final:
            shutil.rmtree(self.folder, ignore_errors=True)

    def summary(self, position: Optional[int] = None) -> dict:
        """The job's status without its images: what the event stream sends.

        ``position`` is the job's place in the queue while it waits.
        """
        with self._lock:
            now = time.time()
            begin = self.started or self.created
            elapsed = (self.finished or now) - begin
            body: dict[str, Any] = {
                "id": self.id,
                "type": self.type,
                "status": self.status,
                "n": self.n,
                "images_done": self.images_done,
                "elapsed_time": round(elapsed, 1),
            }
            if self.is_final:
                body["estimated_time"] = round(elapsed, 1)
            else:
                # For the app's progress bar: OVMS reports no steps, so the
                # time an image takes comes from this instance's own images.
                per_image = _step_times.estimate(self.size) * self._steps_run
                body["seconds_per_image"] = round(per_image, 2)
                if self.status == "pending":
                    body["position"] = position
                    body["estimated_time"] = round(self.n * per_image, 1)
                else:
                    image_started = self.image_started or begin
                    body["started"] = begin
                    body["image_started"] = image_started
                    body["estimated_time"] = round(
                        image_started - begin + (self.n - self.images_done) * per_image, 1
                    )
                if self.token.cancelled:
                    body["cancel_requested"] = True
            if self.error is not None:
                body["error"] = self.error
            if self.status == "completed":
                # For the app's Live metrics; `started` keys the job so polls count it once.
                done = self.images_done
                body["perf"] = {
                    "seconds": elapsed,
                    "items": done,
                    "started": begin,
                    **(
                        {"steps": self.steps_per_image * done}
                        if self.steps_per_image and done
                        else {}
                    ),
                }
            return body

    def response(self, offset: int = 0, limit: Optional[int] = None, full: bool = False) -> dict:
        """The images done so far, in the OpenAI images response shape:
        ``b64_json`` read from disk, or ``url`` when the request asked for
        it. ``full`` adds every other field OVMS answered with."""
        with self._lock:
            done = self.images_done if limit is None else min(limit, self.images_done)
            fields = list(self._image_fields[:done])
            created = self._response_fields.get("created") or int(self.created)
            extra = dict(self._response_fields) if full else {}
        data = []
        for index in range(max(offset, 0), done):
            item = dict(fields[index])
            if self.response_format == "url":
                item["url"] = _image_url(self.id, index)
            else:
                item["b64_json"] = base64.b64encode(
                    self.image_path(index).read_bytes()
                ).decode("ascii")
            data.append(item)
        return {**extra, "created": created, "data": data}


class JobQueue:
    """Runs jobs (background or answered at once) one at a time, first come first served.

    With one OVMS, two generations at once only make both slower.
    """

    def __init__(self):
        self._cond = threading.Condition()
        self._waiting: deque[Job] = deque()
        self._thread: Optional[threading.Thread] = None

    def submit(self, job: Job):
        with self._cond:
            self._waiting.append(job)
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(
                    target=self._run, name="image-jobs", daemon=True
                )
                self._thread.start()
            self._cond.notify()

    def _run(self):
        while True:
            with self._cond:
                while not self._waiting:
                    self._cond.wait()
                job = self._waiting.popleft()
                job.start()
            job.run()

    def status(self, job: Job) -> dict:
        """``job.summary()`` with its place in the queue (1 = next)."""
        with self._cond:
            position = next(
                (place for place, waiting in enumerate(self._waiting, 1) if waiting is job),
                None,
            )
            return job.summary(position)

    def cancel(self, job: Job):
        """Drops a waiting job at once; asks a running one to stop before its
        next image; leaves a finished one as it is."""
        with self._cond:
            if job in self._waiting:
                self._waiting.remove(job)
                job.drop()
            elif not job.is_final:
                job.token.cancel()


_queue = JobQueue()
_jobs: dict[str, Job] = {}
# Most recent job per task type, for GET /v1/images/tasks/{task_type}.
_latest_job: dict[str, str] = {}
_jobs_lock = threading.Lock()


def _evict_finished_jobs():
    """Forgets finished jobs past their time, or beyond the most kept, and
    deletes their images. The latest job of each type is kept."""
    with _jobs_lock:
        now = time.time()
        latest = set(_latest_job.values())
        finished = sorted(
            (j for j in _jobs.values() if j.is_final and j.id not in latest),
            key=lambda j: j.finished or 0,
        )
        expired = [j for j in finished if (j.finished or 0) < now - JOB_TTL_SECONDS]
        excess = finished[: max(0, len(finished) - MAX_FINISHED_JOBS + 1)]
        evicted = {*expired, *excess}
        for old in evicted:
            _jobs.pop(old.id, None)
    for old in evicted:
        shutil.rmtree(old.folder, ignore_errors=True)


def _clear_jobs_dir():
    """Deletes the images of jobs a previous run left behind."""
    shutil.rmtree(JOBS_DIR, ignore_errors=True)


async def _submit(job: Job, *, listed: bool, latest: bool = False):
    """Queues a job; a ``listed`` one is readable at /v1/images/jobs/{id}."""
    await run_in_threadpool(_evict_finished_jobs)
    # Queued first, so a listed job is never seen without its place.
    _queue.submit(job)
    if listed:
        with _jobs_lock:
            _jobs[job.id] = job
            if latest:
                _latest_job[job.type] = job.id


def _get_job(job_id: str) -> Optional[Job]:
    with _jobs_lock:
        return _jobs.get(job_id)


def _find_job(job_id: str) -> Job:
    job = _get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _ovms_client() -> OpenAI:
    # No retries: a retried generation is run again from the start.
    return OpenAI(
        base_url=f"http://127.0.0.1:{CONFIG['ovms_port']}/v3",
        api_key="-",
        max_retries=0,
        timeout=OVMS_TIMEOUT,
    )


def _ovms_error(exc: Exception) -> tuple[int, str]:
    """Status code and message for a failed OVMS call."""
    if isinstance(exc, openai.APIStatusError):
        body = exc.body
        message = None
        if isinstance(body, dict):
            error = body.get("error", body.get("detail"))
            message = error.get("message") if isinstance(error, dict) else error
        message = str(message or exc.message)
        # OVMS rejected the request: pass its 4xx on; its own failure is a 502.
        status = exc.status_code if 400 <= exc.status_code < 500 else 502
        return status, message
    if isinstance(exc, openai.APIConnectionError):
        return 503, "The image model server (OVMS) is not reachable"
    return 500, str(exc) or exc.__class__.__name__


def _seeded(extra_body: dict, index: int) -> dict:
    """``extra_body`` for image ``index`` of a job: a set seed moves on by
    one per image, so the images differ and a rerun gives the same ones."""
    if extra_body.get("rng_seed") is None or index == 0:
        return extra_body
    return {**extra_body, "rng_seed": extra_body["rng_seed"] + index}


def _poll_body(job: Job) -> dict:
    """The status plus ``result``: the images done so far, or a failed job's error message."""
    body = _queue.status(job)
    if body["status"] == "failed":
        body["result"] = job.error
    elif body["images_done"]:
        try:
            body["result"] = job.response(limit=body["images_done"])
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Job not found")
    else:
        body["result"] = None
    return body


async def _answer_now(http: Request, job: Job) -> JSONResponse:
    """Waits for a request's turn in the queue and answers with its images
    in the OpenAI shape, or its error as an HTTP error. A client that goes
    away first cancels it."""
    # Images asked for by URL stay on disk as a job; otherwise they are read
    # into the answer and deleted.
    listed = job.response_format == "url"
    await _submit(job, listed=listed)
    try:
        while not job.is_final:
            if not job.token.cancelled and await http.is_disconnected():
                _queue.cancel(job)
            await asyncio.sleep(ANSWER_WAIT_SECONDS)
    except asyncio.CancelledError:
        _queue.cancel(job)
        if not listed:
            job.discard_images()
        raise
    try:
        if job.token.cancelled:
            raise HTTPException(status_code=499, detail="The request was cancelled")
        if job.status == "failed":
            raise HTTPException(status_code=job.error_status or 500, detail=job.error)
        body = await run_in_threadpool(job.response, full=True)
    finally:
        if not listed:
            await run_in_threadpool(job.discard_images)
    return JSONResponse(body, headers=server_timing(job.inference_seconds))


class ImageGenerationRequest(BaseModel):
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
    response_format: Optional[ResponseFormat] = Field(
        "b64_json",
        description="`b64_json` for the image data, `url` for where the image is served",
    )
    is_polling: Optional[bool] = Field(
        False,
        description="Run as a background job and answer with its job_id at once",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global OVMS_PROCESS

    logger.info("Initializing image generation server services ...")

    try:
        await asyncio.to_thread(_clear_jobs_dir)
        await asyncio.to_thread(
            _step_times.load, f"{CONFIG['model_id']}|{CONFIG['device']}"
        )

        # Another instance of this model (on another device) waits here
        # until this one's OVMS has loaded it; see serve_lock.
        async with ovms_serve_lock(CONFIG["model_id"], CONFIG["precision"]):
            logger.info("Starting OVMS server...")
            OVMS_PROCESS = await asyncio.to_thread(
                start_ovms_background,
                CONFIG["model_id"],
                CONFIG["device"],
                CONFIG["precision"],
                CONFIG["ovms_port"],
                CONFIG["source"],
            )

            if OVMS_PROCESS and hasattr(OVMS_PROCESS, "pid"):
                logger.info(f"OVMS server started with PID: {OVMS_PROCESS.pid}")
            else:
                logger.warning("Could not determine OVMS process ID")

            timeout = startup_timeout()
            logger.info(f"Waiting up to {timeout}s for OVMS server to be ready...")

            model_ready = await asyncio.to_thread(
                wait_for_model_ready,
                CONFIG["ovms_port"],
                CONFIG["model_id"],
                timeout=timeout,
            )

        if not model_ready:
            raise RuntimeError(
                f"OVMS server did not become ready within {timeout}s or exited "
                f"early (device: {CONFIG['device']}); see the worker logs"
            )

        logger.info("Image generation server services initialized successfully")

    except Exception as e:
        logger.error(f"Failed to initialize server services: {e}")
        cleanup_ovms_process()
        raise e

    yield

    logger.info("Stopping image generation server services ...")
    if OVMS_PROCESS:
        logger.info("Terminating OVMS process...")
        cleanup_ovms_process()


app = create_app(
    "Image Generation API",
    description="OpenVINO-powered image generation service with OpenAI-compatible endpoints",
    version="1.0.0",
    lifespan=lifespan,
    healthcheck=False,
)


@app.get("/healthcheck", status_code=200)
def get_healthcheck():
    return {"status": "OK"}


@app.get("/v1/config", status_code=200)
def get_config():
    """Get OVMS server configuration."""
    try:
        response = requests.get(
            urlparse(f"http://127.0.0.1:{CONFIG['ovms_port']}/v1/config").geturl(),
            timeout=OVMS_CONFIG_TIMEOUT,
        )
        return response.json()
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting OVMS config: {str(e)}"
        )


@app.post("/v1/images/generations", status_code=200, tags=["OpenAI-compatible"])
async def generate_images(request: ImageGenerationRequest, http: Request):
    """Generate images from a text prompt; with ``is_polling``, answer with a background job_id."""
    extra_body = {
        field_name: value
        for field_name, value in dict(request).items()
        if field_name
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
    }
    n = request.n if request.n is not None else 1

    def generate(count: int, body: dict):
        return _ovms_client().images.generate(
            model=request.model,
            prompt=request.prompt,
            n=count,
            size=request.size,
            extra_body=body,
        )

    job_args = dict(
        n=n,
        steps_per_image=request.num_inference_steps,
        size=request.size,
        response_format=request.response_format or "b64_json",
    )
    if not request.is_polling:
        job = Job(
            TaskType.IMAGE_GENERATION.value,
            lambda _index: generate(n, extra_body),
            batch=True,
            **job_args,
        )
        return await _answer_now(http, job)

    job = Job(
        TaskType.IMAGE_GENERATION.value,
        lambda index: generate(1, _seeded(extra_body, index)),
        **job_args,
    )
    await _submit(job, listed=True, latest=True)
    return {"message": "Generate image task started", "job_id": job.id}


@app.post("/v1/images/edits", status_code=200, tags=["OpenAI-compatible"])
async def edit_images(
    http: Request,
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
    response_format: Optional[ResponseFormat] = Form(
        "b64_json",
        description="`b64_json` for the image data, `url` for where the image is served",
    ),
    is_polling: Optional[bool] = Form(
        False,
        description="Run as a background job and answer with its job_id at once",
    ),
):
    """Edit an image with a text prompt; with ``is_polling``, answer with a background job_id."""
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

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
    count = n if n is not None else 1

    def edit(images: int, body: dict):
        return _ovms_client().images.edit(
            model=model,
            image=image_data,
            prompt=prompt,
            n=images,
            size=size,
            extra_body=body,
        )

    job_args = dict(
        n=count,
        steps_per_image=num_inference_steps,
        size=size,
        strength=strength,
        response_format=response_format or "b64_json",
    )
    if not is_polling:
        job = Job(
            TaskType.IMAGE_EDIT.value,
            lambda _index: edit(count, extra_body),
            batch=True,
            **job_args,
        )
        return await _answer_now(http, job)

    job = Job(
        TaskType.IMAGE_EDIT.value,
        lambda index: edit(1, _seeded(extra_body, index)),
        **job_args,
    )
    await _submit(job, listed=True, latest=True)
    return {"message": "Image edit task started", "job_id": job.id}


@app.get("/v1/images/jobs/{job_id}", status_code=200)
def get_job_status(job_id: str):
    """Status of a background job, with the images done so far in ``result``."""
    return _poll_body(_find_job(job_id))


@app.delete("/v1/images/jobs/{job_id}", status_code=200)
def cancel_job(job_id: str):
    """Cancel a job and return its status; a running one stops before its next image."""
    job = _find_job(job_id)
    _queue.cancel(job)
    return _poll_body(job)


@app.get("/v1/images/jobs/{job_id}/events", status_code=200)
async def get_job_events(job_id: str):
    """The job's status (without images) as Server-Sent Events, ending with the final one."""
    _find_job(job_id)

    def read():
        job = _get_job(job_id)
        return _queue.status(job) if job is not None else None

    return sse_response(
        watch_status(read, lambda status: status["status"] in FINAL_STATUSES, interval=0.5)
    )


@app.get("/v1/images/jobs/{job_id}/result", status_code=200)
def get_job_result(
    job_id: str,
    offset: int = Query(0, ge=0, description="Skip the first `offset` images"),
):
    """The job's images done so far, in the OpenAI images response shape."""
    job = _find_job(job_id)
    try:
        return job.response(offset)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")


@app.get(
    "/v1/images/jobs/{job_id}/images/{index}",
    status_code=200,
    response_class=FileResponse,
    responses={200: {"content": {"image/png": {}}}},
)
def get_job_image(job_id: str, index: int):
    """Image ``index`` (from 0) of a job, as PNG."""
    job = _find_job(job_id)
    path = job.image_path(index)
    if not 0 <= index < job.images_done or not path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    # A job's images never change once written.
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": f"private, max-age={JOB_TTL_SECONDS}, immutable"},
    )


@app.get("/v1/images/tasks/{task_type}", status_code=200)
def get_task_status(task_type: str):
    """Status of the most recent job of a type (``image-generation`` or ``image-edit``)."""
    if task_type not in (TaskType.IMAGE_GENERATION.value, TaskType.IMAGE_EDIT.value):
        raise HTTPException(status_code=400, detail="Invalid task type")
    with _jobs_lock:
        job = _jobs.get(_latest_job.get(task_type, ""))
    if job is None:
        raise HTTPException(status_code=404, detail="No task found")
    return _poll_body(job)


# /v3 aliases (OVMS's own OpenAI prefix) for clients still using them, hidden from the schema.

for _alias_path, _endpoint, _methods in (
    ("/v3/images/generations", generate_images, ["POST"]),
    ("/v3/images/edits", edit_images, ["POST"]),
    ("/v3/images/tasks/{task_type}", get_task_status, ["GET"]),
):
    app.add_api_route(
        _alias_path,
        _endpoint,
        methods=_methods,
        status_code=200,
        include_in_schema=False,
    )

# One model is compiled into OVMS at startup, so the list has one entry.
install_models_routes(app, lambda: [CONFIG["model_id"]], owned_by="openvino-model-server")
install_openai_errors(app)


def parse_args():
    parser = base_parser(
        "Image Generation FastAPI Server",
        default_port=5006,
        default_device="CPU",
        device_help="Device to run the model on (e.g., CPU, GPU, NPU) or mixed device configuration (e.g., 'NPU NPU GPU')",
        source=True,
    )
    parser.add_argument(
        "--ovms-port",
        type=int,
        default=None,
        help="Port for the embedded OVMS (default: --port + 1, so two instances never collide)",
    )
    parser.add_argument(
        "--model-id",
        type=str,
        required=True,
        help="Hugging Face image generation model name (e.g., OpenVINO/stable-diffusion-v1-5-int8-ov)",
    )
    parser.add_argument(
        "--precision",
        type=str,
        default="int8",
        choices=["fp32", "fp16", "int8", "int4"],
        help="Weight format OVMS converts a non-OpenVINO model to (default: int8)",
    )
    # --source, --instance-id and --data-dir come from base_parser; re-adding them crashes argparse.
    return parser.parse_args()


def main():
    global CONFIG

    args = parse_args()
    CONFIG["model_id"] = args.model_id
    CONFIG["device"] = str(args.device).upper().strip()
    CONFIG["precision"] = args.precision
    CONFIG["ovms_port"] = args.ovms_port or (args.port + 1)
    CONFIG["source"] = args.source

    multiprocessing.freeze_support()
    serve(app, args)


if __name__ == "__main__":
    main()
