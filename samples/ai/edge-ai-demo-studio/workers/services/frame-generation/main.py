# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import io
import queue
import re
import shutil
import time
from contextlib import asynccontextmanager
from itertools import count
from pathlib import Path
from threading import Lock, Thread
from uuid import uuid4

import numpy as np
import worker_common
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from worker_common import (
    AUTO_DEVICE,
    CANCELLED,
    CancelToken,
    JobCancelled,
    base_parser,
    get_logger,
    instance_data_dir,
    migrate_legacy_models_dir,
    models_dir,
    serve,
    sse_response,
    watch_status,
)

from modules.frame_generator_ov import (
    OpenVINOFrameGenerator,
    download_rife_model,
    measure_framegen_fps,
)
from modules.video import interpolate_video_file, probe_video

logger = get_logger("frame-generation")

# Holds the legacy models/rife, which startup migrates to the shared <repo>/models/rife.
WORKER_DIR = Path(__file__).resolve().parent

DATA_DIR = instance_data_dir("data")
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "outputs"
MAX_MULTIPLIER = 4
# One gap in a single interpolate request may ask for at most this many
# frames; guards the level-synchronous subdivision from unbounded recursion.
MAX_FRAMES_PER_GAP = 15
TASK_ID_RE = re.compile(r"^[a-f0-9]{8}$")
# A finished (or failed) task's status and output video are kept this long
# for the client to download the result, then deleted.
RESULT_TTL_SECONDS = 60 * 60
# How often the idle job thread looks for expired results.
SWEEP_INTERVAL_SECONDS = 5 * 60
TERMINAL_TASK_STATUSES = frozenset({"finished", "error", CANCELLED, "not_found"})

# Task id -> status. Entries are replaced, never changed in place, and the event loop iterates a
# snapshot: the job thread updates and evicts entries while requests read them.
tasks = {}
_INTERNAL_TASK_KEYS = frozenset({"seq", "finished_at"})

# Task id -> its queued job until the task ends, for DELETE. `_task_start_lock` makes a queued
# task either start or be cancelled, never both.
unfinished_jobs = {}
_task_start_lock = Lock()

# The shared generator, and a lock because its OpenVINO infer request is not thread-safe.
state = {"generator": None, "lock": Lock(), "device": AUTO_DEVICE}

# Video jobs run one at a time on a dedicated thread: an upload returns a task id at once and
# queues behind the running job instead of competing for the generator.
video_jobs = queue.Queue()
_job_seq = count()


def _video_job_worker():
    sweep_expired_results()
    while True:
        try:
            job = video_jobs.get(timeout=SWEEP_INTERVAL_SECONDS)
        except queue.Empty:
            sweep_expired_results()
            continue
        if job is None:
            break
        run_video_interpolation(**job)
        video_jobs.task_done()
        sweep_expired_results()


def sweep_expired_results(now=None):
    """Forget tasks that ended over RESULT_TTL_SECONDS ago, deleting their video, then any file
    that old no task knows about (from an earlier run)."""
    now = time.time() if now is None else now
    for task_id, task in list(tasks.items()):
        finished_at = task.get("finished_at")
        if finished_at is not None and now - finished_at > RESULT_TTL_SECONDS:
            tasks.pop(task_id, None)
            _unlink_quietly(OUTPUT_DIR / f"{task_id}.mp4")
    known = set(list(tasks))
    for directory in (UPLOAD_DIR, OUTPUT_DIR):
        if not directory.is_dir():
            continue
        for path in directory.iterdir():
            if path.stem in known or not path.is_file():
                continue
            try:
                expired = now - path.stat().st_mtime > RESULT_TTL_SECONDS
            except OSError:
                continue
            if expired:
                _unlink_quietly(path)


def _unlink_quietly(path):
    try:
        path.unlink(missing_ok=True)
    except OSError as e:
        # e.g. Windows, while the file is still being downloaded; the next
        # sweep tries again for a file no task knows about.
        logger.warning(f"Could not delete {path}: {e}")


def describe_task(task_id):
    """A task's status as GET /v1/tasks/{task_id} reports it."""
    task = tasks.get(task_id)
    if task is None:
        return {"status": "not_found"}
    status = {k: v for k, v in task.items() if k not in _INTERNAL_TASK_KEYS}
    if task["status"] == "queued":
        status["position"] = 1 + sum(
            1
            for other in list(tasks.values())
            if other["status"] == "queued" and other["seq"] < task["seq"]
        )
    elif task["status"] == "running":
        job = unfinished_jobs.get(task_id)
        if job is not None and job["cancel"].cancelled:
            status["cancel_requested"] = True
    return status


def cancel_task(task_id):
    """Cancel a task: a queued one ends at once (its upload deleted), a
    running one stops at its next chunk; an ended one is left as it is."""
    with _task_start_lock:
        task = tasks.get(task_id)
        job = unfinished_jobs.get(task_id)
        if task is None or job is None:
            return
        job["cancel"].cancel()
        if task["status"] == "queued":
            # The job thread skips it when it comes out of the queue; the
            # other queued tasks' positions stop counting it right away.
            tasks[task_id] = {"status": CANCELLED, "finished_at": time.time()}
            unfinished_jobs.pop(task_id, None)
            _unlink_quietly(Path(job["video_path"]))


def _interpolate_gaps(gaps):
    # The generator's infer request is shared with the video job thread.
    with state["lock"]:
        return state["generator"].interpolate_gaps(gaps)


def _interpolate_npz(body):
    """The /interpolate request body (.npz) -> the response body (.npz)."""
    try:
        data = np.load(io.BytesIO(body), allow_pickle=False)
        frames_a, frames_b = data["frames_a"], data["frames_b"]
        counts = data["counts"].astype(int).tolist()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid npz payload")

    if (
        frames_a.ndim != 4
        or frames_a.shape[-1] != 3
        or frames_a.shape != frames_b.shape
        or len(counts) != len(frames_a)
        or len(counts) == 0
    ):
        raise HTTPException(status_code=400, detail="Invalid frame shapes")
    if any(n < 1 or n > MAX_FRAMES_PER_GAP for n in counts):
        raise HTTPException(
            status_code=400,
            detail=f"counts entries must be 1..{MAX_FRAMES_PER_GAP}",
        )

    gaps = [(frames_a[i], frames_b[i], counts[i]) for i in range(len(counts))]
    fills = _interpolate_gaps(gaps)

    out = io.BytesIO()
    np.savez(
        out,
        **{
            f"gap_{i}": np.stack(fill).clip(0, 255).astype(np.uint8)
            for i, fill in enumerate(fills)
        },
    )
    return out.getvalue()


def _benchmark(req):
    # Under the lock: the video job thread must not use the infer request
    # meanwhile, and its work would skew the timings.
    with state["lock"]:
        return measure_framegen_fps(
            state["generator"], req.image_size, req.gap_sizes, req.rounds
        )


def _save_upload(source, path):
    with open(path, "wb") as f:
        shutil.copyfileobj(source, f)


def parse_arguments():
    return base_parser(
        "Frame Generation Worker",
        default_port=8031,
        default_device=AUTO_DEVICE,
        device_help=(
            "OpenVINO device for the RIFE model: AUTO (OpenVINO selects a "
            "discrete GPU, then an integrated GPU, then the CPU), CPU, GPU, "
            "GPU.1, NPU (default: AUTO)"
        ),
        source=True,
    ).parse_args()


class BenchmarkRequest(BaseModel):
    image_size: int = Field(default=256, ge=32, le=2048)
    gap_sizes: list[int] = Field(default=[1], min_length=1, max_length=64)
    rounds: int = Field(default=3, ge=1, le=10)


def create_app(args):
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info("Starting lifespan...")
        try:
            migration = migrate_legacy_models_dir(
                WORKER_DIR / "models" / "rife", models_dir("rife")
            )
            if migration:
                logger.info(migration)
            download_rife_model(source=args.source)
            generator = OpenVINOFrameGenerator(args.device)
            generator.warm_up(256)
            state["generator"] = generator
            # The device OpenVINO compiled on: under AUTO, the one it selected.
            state["device"] = generator.execution_device
            Thread(target=_video_job_worker, daemon=True).start()
            app.state.ready = True
            logger.info("Startup complete; server is ready.")
        except Exception as e:
            logger.error(f"Error in lifespan startup: {e}")
            exit(1)
        yield
        video_jobs.put(None)

    # /healthcheck is readiness-gated (503 until the model is ready) and
    # reports the device, so it stays this worker's own (setup_routes).
    app = worker_common.create_app(
        "Frame Generation Worker", lifespan=lifespan, healthcheck=False
    )
    # Not ready until lifespan startup (model download/convert/warmup) finishes.
    app.state.ready = False

    return app


def run_video_interpolation(task_id, video_path, multiplier, mode, cancel):
    with _task_start_lock:
        if tasks.get(task_id, {}).get("status") != "queued":
            # Cancelled while it waited: already ended, upload deleted.
            return
        tasks[task_id] = {"status": "running", "progress": 0.0}
    try:
        _interpolate_task(task_id, video_path, multiplier, mode, cancel)
    finally:
        unfinished_jobs.pop(task_id, None)


def _interpolate_task(task_id, video_path, multiplier, mode, cancel):
    def on_progress(fraction, frames_done, frames_total):
        tasks[task_id] = {
            "status": "running",
            "progress": round(fraction, 3),
            "frames_done": frames_done,
            "frames_total": frames_total,
        }

    output_path = OUTPUT_DIR / f"{task_id}.mp4"
    started = time.time()
    try:
        info = interpolate_video_file(
            state["generator"],
            state["lock"],
            video_path,
            output_path,
            multiplier,
            mode=mode,
            progress_cb=on_progress,
            cancel=cancel,
        )
        # `perf` is read by the app's Live metrics: frames per second of
        # processing. `started` keys the task so repeated polls count it once.
        perf = {
            "seconds": time.time() - started,
            "items": info["frames"],
            "started": started,
        }
        tasks[task_id] = {
            "status": "finished",
            "progress": 1.0,
            **info,
            "perf": perf,
            "finished_at": time.time(),
        }
    except JobCancelled:
        logger.info(f"Video task {task_id} cancelled")
        # The encoder is closed by now: drop the half-written video.
        _unlink_quietly(output_path)
        tasks[task_id] = {"status": CANCELLED, "finished_at": time.time()}
    except Exception as e:
        logger.exception("Video interpolation failed")
        tasks[task_id] = {
            "status": "error",
            "detail": str(e) or repr(e),
            "finished_at": time.time(),
        }
        output_path.unlink(missing_ok=True)
    finally:
        Path(video_path).unlink(missing_ok=True)


def setup_routes(app: FastAPI, args):
    @app.get("/healthcheck")
    async def healthcheck():
        if not getattr(app.state, "ready", False):
            return JSONResponse({"status": "initializing"}, status_code=503)
        return JSONResponse({"status": "ok", "device": state["device"]})

    @app.post("/v1/frame-generation/benchmark")
    async def benchmark(req: BenchmarkRequest):
        """Measure interpolation fps for a gap schedule, also compiling its static shapes."""
        if any(n < 1 or n > MAX_FRAMES_PER_GAP for n in req.gap_sizes):
            raise HTTPException(
                status_code=400,
                detail=f"gap_sizes entries must be 1..{MAX_FRAMES_PER_GAP}",
            )
        # Inference blocks (and may wait for a video job's chunk): keep it
        # off the event loop.
        fps = await asyncio.to_thread(_benchmark, req)
        return {"fps": fps, "seconds_per_frame": 1.0 / fps}

    @app.post("/v1/frame-generation/interpolate")
    async def interpolate(request: Request):
        """Fill the frames between keyframe pairs (.npz frames_a, frames_b, counts -> gap_<i>)."""
        body = await request.body()
        # Decoding, inference (which waits for the lock while a video job's
        # chunk runs) and encoding all block: keep them off the event loop.
        content = await asyncio.to_thread(_interpolate_npz, body)
        return Response(content=content, media_type="application/octet-stream")

    @app.post("/v1/frame-generation/video")
    async def interpolate_video(
        video: UploadFile = File(...),
        multiplier: int = Form(2),
        mode: str = Form("fps"),
    ):
        """Queue a video interpolation job: "fps" raises the frame rate, "slowmo" the duration."""
        if not video or not video.filename:
            raise HTTPException(status_code=400, detail="Missing video file")
        if multiplier < 2 or multiplier > MAX_MULTIPLIER:
            raise HTTPException(
                status_code=400,
                detail=f"multiplier must be 2..{MAX_MULTIPLIER}",
            )
        if mode not in ("fps", "slowmo"):
            raise HTTPException(
                status_code=400, detail="mode must be 'fps' or 'slowmo'"
            )

        task_id = uuid4().hex[:8]
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        suffix = re.sub(r"[^A-Za-z0-9.]", "", Path(video.filename).suffix) or ".mp4"
        video_path = UPLOAD_DIR / f"{task_id}{suffix.lower()}"

        await asyncio.to_thread(_save_upload, video.file, video_path)

        # Fail fast on files av cannot open instead of erroring in the task.
        try:
            fps, _ = await asyncio.to_thread(probe_video, str(video_path))
            if not fps:
                raise ValueError("No video frame rate detected")
        except Exception:
            video_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400, detail="Invalid or unsupported video"
            )

        job = {
            "task_id": task_id,
            "video_path": str(video_path),
            "multiplier": multiplier,
            "mode": mode,
            "cancel": CancelToken(),
        }
        unfinished_jobs[task_id] = job
        tasks[task_id] = {"status": "queued", "progress": 0.0, "seq": next(_job_seq)}
        video_jobs.put(job)
        return JSONResponse({"taskId": task_id})

    @app.get("/v1/tasks/{task_id}")
    async def task_status(task_id: str):
        """A video task's status: queued, running, finished, error, cancelled or not_found."""
        return describe_task(task_id)

    @app.delete("/v1/tasks/{task_id}")
    async def cancel_task_request(task_id: str):
        """Cancel a video task and return its status; a running one stops at its next chunk."""
        # Deleting a cancelled upload is quick, but it is still file I/O.
        await asyncio.to_thread(cancel_task, task_id)
        return describe_task(task_id)

    @app.get("/v1/tasks/{task_id}/events")
    async def task_status_events(task_id: str):
        """Follow a video task's status as Server-Sent Events, ending after its final one."""
        return sse_response(
            watch_status(
                lambda: describe_task(task_id),
                lambda s: s["status"] in TERMINAL_TASK_STATUSES,
            )
        )

    @app.get("/v1/frame-generation/video/{task_id}")
    async def download_video(task_id: str):
        if not TASK_ID_RE.fullmatch(task_id):
            raise HTTPException(status_code=400, detail="Invalid task id")
        output_path = (OUTPUT_DIR / f"{task_id}.mp4").resolve()
        if output_path.parent != OUTPUT_DIR.resolve() or not output_path.exists():
            raise HTTPException(status_code=404, detail="Result not found")
        return FileResponse(
            output_path,
            media_type="video/mp4",
            filename=f"interpolated_{task_id}.mp4",
        )


def main():
    args = parse_arguments()
    logger.info(f"Frame generation device={args.device}")

    app = create_app(args)
    setup_routes(app, args)

    logger.info(f"Starting Frame Generation server on port {args.port}")
    serve(app, args)


if __name__ == "__main__":
    main()
