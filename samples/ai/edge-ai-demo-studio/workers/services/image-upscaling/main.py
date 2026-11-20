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
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image, ImageOps
from worker_common import (
    AUTO_DEVICE,
    CANCELLED,
    CancelToken,
    JobCancelled,
    base_parser,
    get_logger,
    instance_data_dir,
    models_dir,
    serve,
    server_timing,
    sse_response,
    watch_status,
)
from worker_common.startup import startup_stage

from calibration import calibration_tiles
from presets import DEFAULT_PRECISION, DEFAULT_PRESET, PRECISIONS, PRESETS
from upscaler import Upscaler
from video import output_size, probe_video, upscale_video_file

logger = get_logger("image-upscaling")

MODELS_ROOT = models_dir("upscaling")
DATA_DIR = instance_data_dir("data")
UPLOAD_DIR = DATA_DIR / "uploads"
OUTPUT_DIR = DATA_DIR / "outputs"
# An upscaled image may hold at most this many pixels (64 MP: 8000x8000), so a 4x job on a 2000x2000
# photo fits and the result stays within what a browser decodes.
MAX_OUTPUT_PIXELS = 64_000_000
# A video frame may come out at most 4K UHD.
MAX_VIDEO_OUTPUT_PIXELS = 3840 * 2160
IMAGE_FORMATS = {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}
TASK_ID_RE = re.compile(r"^[a-f0-9]{8}$")
# A finished (or failed) task's status and output are kept this long for the client to download
# the result, then deleted.
RESULT_TTL_SECONDS = 60 * 60
# How often the idle job thread looks for expired results.
SWEEP_INTERVAL_SECONDS = 5 * 60
TERMINAL_TASK_STATUSES = frozenset({"finished", "error", CANCELLED, "not_found"})
# Decoding a 64 MP output's input is fine; PIL's own bomb check would stop at 89 MP of input.
Image.MAX_IMAGE_PIXELS = MAX_OUTPUT_PIXELS

# Task id -> status. Entries are replaced, never changed in place, and the event loop iterates a
# snapshot: the job thread updates and evicts entries while requests read them.
tasks = {}
_INTERNAL_TASK_KEYS = frozenset({"seq", "finished_at", "output"})

# Task id -> its queued job until the task ends, for DELETE. `_task_start_lock` makes a queued
# task either start or be cancelled, never both.
unfinished_jobs = {}
_task_start_lock = Lock()

# The upscaler, and a lock because its infer requests are not thread-safe: jobs take it per image
# or per video frame, so a live /frame request waits for at most one of those.
state = {"upscaler": None, "lock": Lock(), "device": AUTO_DEVICE}

# Jobs run one at a time on a dedicated thread: an upload returns a task id at once and queues
# behind the running job instead of competing for the model.
jobs = queue.Queue()
_job_seq = count()


def _job_worker():
    sweep_expired_results()
    while True:
        try:
            job = jobs.get(timeout=SWEEP_INTERVAL_SECONDS)
        except queue.Empty:
            sweep_expired_results()
            continue
        if job is None:
            break
        run_job(job)
        jobs.task_done()
        sweep_expired_results()


def sweep_expired_results(now=None):
    """Forget tasks that ended over RESULT_TTL_SECONDS ago, deleting their output, then any file
    that old no task knows about (from an earlier run)."""
    now = time.time() if now is None else now
    for task_id, task in list(tasks.items()):
        finished_at = task.get("finished_at")
        if finished_at is not None and now - finished_at > RESULT_TTL_SECONDS:
            tasks.pop(task_id, None)
            if task.get("output"):
                _unlink_quietly(Path(task["output"]))
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
        # e.g. Windows, while the file is still being downloaded; the next sweep tries again for a
        # file no task knows about.
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
    """Cancel a task: a queued one ends at once (its upload deleted), a running one stops at its
    next tile or frame; an ended one is left as it is."""
    with _task_start_lock:
        task = tasks.get(task_id)
        job = unfinished_jobs.get(task_id)
        if task is None or job is None:
            return
        job["cancel"].cancel()
        if task["status"] == "queued":
            # The job thread skips it when it comes out of the queue; the other queued tasks'
            # positions stop counting it right away.
            tasks[task_id] = {"status": CANCELLED, "finished_at": time.time()}
            unfinished_jobs.pop(task_id, None)
            _unlink_quietly(Path(job["input_path"]))


def run_job(job):
    task_id = job["task_id"]
    with _task_start_lock:
        if tasks.get(task_id, {}).get("status") != "queued":
            # Cancelled while it waited: already ended, upload deleted.
            return
        tasks[task_id] = {"status": "running", "kind": job["kind"], "progress": 0.0}
    output_path = OUTPUT_DIR / f"{task_id}.{job['extension']}"
    started = time.time()
    try:
        run = _upscale_image_task if job["kind"] == "image" else _upscale_video_task
        info = run(job, output_path)
        # `perf` is read by the app's Live metrics: output megapixels per second of processing.
        # `started` keys the task so repeated polls count it once.
        perf = {"seconds": time.time() - started, "items": info["megapixels"], "started": started}
        tasks[task_id] = {
            "status": "finished",
            "kind": job["kind"],
            "progress": 1.0,
            **info,
            "perf": perf,
            "output": str(output_path),
            "finished_at": time.time(),
        }
    except JobCancelled:
        logger.info(f"Task {task_id} cancelled")
        _unlink_quietly(output_path)
        tasks[task_id] = {"status": CANCELLED, "finished_at": time.time()}
    except Exception as e:
        logger.exception(f"Upscaling task {task_id} failed")
        tasks[task_id] = {"status": "error", "detail": str(e) or repr(e), "finished_at": time.time()}
        _unlink_quietly(output_path)
    finally:
        _unlink_quietly(Path(job["input_path"]))
        unfinished_jobs.pop(task_id, None)


def _load_image(source) -> Image.Image:
    """Decode an upload, upright (EXIF orientation applied), as RGB or RGBA."""
    image = ImageOps.exif_transpose(Image.open(source))
    has_alpha = image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info)
    return image.convert("RGBA" if has_alpha else "RGB")


def _upscale_rgba(image: Image.Image, outscale: float, progress=None, cancel=None, repeated=False) -> Image.Image:
    """The model on the colour channels, Lanczos on any alpha, then resized to ``outscale``."""
    upscaler = state["upscaler"]
    rgb = np.asarray(image.convert("RGB"))
    with state["lock"]:
        out = Image.fromarray(upscaler.upscale(rgb, progress=progress, cancel=cancel, repeated=repeated))
    size = (round(image.width * outscale), round(image.height * outscale))
    if out.size != size:
        out = out.resize(size, Image.Resampling.LANCZOS)
    if image.mode == "RGBA":
        out.putalpha(image.getchannel("A").resize(size, Image.Resampling.LANCZOS))
    return out


def _encode(image: Image.Image, fmt: str) -> bytes:
    buffer = io.BytesIO()
    if fmt == "jpeg":
        image.convert("RGB").save(buffer, "JPEG", quality=95)
    elif fmt == "webp":
        image.save(buffer, "WEBP", quality=95)
    else:
        image.save(buffer, "PNG", compress_level=1)
    return buffer.getvalue()


def _upscale_image_task(job, output_path):
    task_id = job["task_id"]

    def on_progress(done, total, stage=None):
        # OpenVINO counts tiles; SeedVR2 names its phase instead.
        steps = {"stage": stage} if stage else {"tiles_done": done, "tiles_total": total}
        tasks[task_id] = {
            "status": "running",
            "kind": "image",
            "progress": round(done / total, 3),
            **steps,
        }

    image = _load_image(job["input_path"])
    out = _upscale_rgba(image, job["outscale"], progress=on_progress, cancel=job["cancel"])
    output_path.write_bytes(_encode(out, job["format"]))
    return {
        "format": job["format"],
        "input_width": image.width,
        "input_height": image.height,
        "output_width": out.width,
        "output_height": out.height,
        "megapixels": round(out.width * out.height / 1e6, 3),
    }


def _upscale_video_task(job, output_path):
    task_id = job["task_id"]

    def on_progress(fraction, frames_done, frames_total):
        tasks[task_id] = {
            "status": "running",
            "kind": "video",
            "progress": round(fraction, 3),
            "frames_done": frames_done,
            "frames_total": frames_total,
        }

    def upscale_frame(rgb):
        with state["lock"]:
            return state["upscaler"].upscale(rgb, repeated=True)

    info = upscale_video_file(
        upscale_frame,
        job["input_path"],
        output_path,
        job["outscale"],
        progress_cb=on_progress,
        cancel=job["cancel"],
    )
    return {
        **info,
        "input_width": job["width"],
        "input_height": job["height"],
        "megapixels": round(info["frames"] * info["output_width"] * info["output_height"] / 1e6, 3),
    }


def _check_frames_supported():
    """Video and live frames need a model fast and steady from frame to frame: not SeedVR2."""
    upscaler = state["upscaler"]
    if upscaler is not None and getattr(upscaler, "image_only", False):
        raise HTTPException(status_code=400, detail=f"{upscaler.preset.id} upscales still images only")


def _check_outscale(outscale: float | None) -> float:
    scale = state["upscaler"].scale
    if outscale is None:
        return float(scale)
    if not 1 <= outscale <= scale:
        raise HTTPException(status_code=400, detail=f"outscale must be 1..{scale} for this model")
    return outscale


def _save_upload(source, path):
    with open(path, "wb") as f:
        shutil.copyfileobj(source, f)


def _queue_job(kind, input_path, extension, **fields):
    task_id = input_path.stem
    job = {
        "task_id": task_id,
        "kind": kind,
        "input_path": str(input_path),
        "extension": extension,
        "cancel": CancelToken(),
        **fields,
    }
    unfinished_jobs[task_id] = job
    tasks[task_id] = {"status": "queued", "kind": kind, "progress": 0.0, "seq": next(_job_seq)}
    jobs.put(job)
    return JSONResponse({"taskId": task_id})


async def _receive(upload: UploadFile, default_suffix: str) -> Path:
    """Save an upload under a fresh task id; the file's stem is the id."""
    if not upload or not upload.filename:
        raise HTTPException(status_code=400, detail="Missing file")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    suffix = re.sub(r"[^A-Za-z0-9.]", "", Path(upload.filename).suffix) or default_suffix
    path = UPLOAD_DIR / f"{uuid4().hex[:8]}{suffix.lower()}"
    await asyncio.to_thread(_save_upload, upload.file, path)
    return path


def _upscale_frame_bytes(body: bytes, outscale: float | None, fmt: str):
    try:
        image = _load_image(io.BytesIO(body))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or unsupported image") from None
    scale = _check_outscale(outscale)
    if image.width * image.height * scale * scale > MAX_VIDEO_OUTPUT_PIXELS:
        raise HTTPException(status_code=400, detail="A live frame may upscale to at most 3840x2160")
    started = time.perf_counter()
    # A live stream sends frames of one size.
    out = _upscale_rgba(image, scale, repeated=True)
    seconds = time.perf_counter() - started
    return _encode(out, fmt), seconds, out.size


def parse_arguments():
    parser = base_parser(
        "Image Upscaling Worker",
        default_port=8035,
        default_device=AUTO_DEVICE,
        device_help=(
            "OpenVINO device: AUTO (OpenVINO selects a discrete GPU, then an integrated GPU, then "
            "the CPU), CPU, GPU, GPU.1, NPU (default: AUTO); XPU (PyTorch, an Intel GPU) for seedvr2-3b"
        ),
    )
    parser.add_argument("--model", default=DEFAULT_PRESET, choices=sorted(PRESETS))
    parser.add_argument("--precision", default=DEFAULT_PRECISION, choices=PRECISIONS)
    return parser.parse_args()


def create_app(args):
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            preset = PRESETS[args.model]
            with startup_stage("loading-model", f"{preset.id} on {args.device}"):
                if preset.torch_xpu:
                    # Imported here: it loads numz's pipeline, fetched only for this preset.
                    from seedvr2 import SeedVR2Upscaler

                    if args.precision != "fp16":
                        logger.warning(f"{preset.id} runs at FP16 only; ignoring --precision {args.precision}")
                    upscaler = SeedVR2Upscaler(MODELS_ROOT, preset, args.device)
                else:
                    upscaler = Upscaler(
                        MODELS_ROOT, preset, args.device, args.precision, calibration=calibration_tiles
                    )
                upscaler.warm_up()
            state["upscaler"] = upscaler
            # The device it runs on: under AUTO, the one OpenVINO selected; XPU for SeedVR2.
            state["device"] = upscaler.execution_device
            Thread(target=_job_worker, daemon=True).start()
            app.state.ready = True
            logger.info("Startup complete; server is ready.")
        except Exception as e:
            logger.exception(f"Error in lifespan startup: {e}")
            exit(1)
        yield
        jobs.put(None)

    # /healthcheck is readiness-gated (503 until the model is ready) and reports the device, so
    # it stays this worker's own (setup_routes).
    app = worker_common.create_app("Image Upscaling Worker", lifespan=lifespan, healthcheck=False)
    app.state.ready = False
    return app


def setup_routes(app: FastAPI, args):
    @app.get("/healthcheck")
    async def healthcheck():
        if not getattr(app.state, "ready", False):
            return JSONResponse({"status": "initializing"}, status_code=503)
        upscaler = state["upscaler"]
        return JSONResponse(
            {
                "status": "ok",
                "device": state["device"],
                "model": upscaler.preset.id,
                "scale": upscaler.scale,
                "precision": upscaler.precision,
            }
        )

    @app.post("/v1/image-upscaling/image")
    async def upscale_image(
        image: UploadFile = File(...),
        outscale: float | None = Form(None),
        fmt: str = Form("png", alias="format"),
    ):
        """Queue an image: it comes out `outscale` times larger (default: the model's scale)."""
        if fmt not in IMAGE_FORMATS:
            raise HTTPException(status_code=400, detail="format must be png, jpeg or webp")
        scale = _check_outscale(outscale)
        path = await _receive(image, ".png")
        try:
            # Fails fast on files PIL cannot open, instead of erroring in the task.
            width, height = await asyncio.to_thread(lambda: Image.open(path).size)
        except Exception:
            path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail="Invalid or unsupported image") from None
        if width * height * scale * scale > MAX_OUTPUT_PIXELS:
            path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=f"The result would be over {MAX_OUTPUT_PIXELS // 1_000_000} megapixels: "
                "use a smaller image or outscale",
            )
        # SeedVR2's memory grows with the image: past its measured size it could run out mid-job.
        max_input = getattr(state["upscaler"], "max_input_pixels", None)
        if max_input and width * height > max_input:
            path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=f"{state['upscaler'].preset.id} takes images of at most {max_input / 1e6:.2f} "
                f"megapixels; this one is {width}x{height}",
            )
        return _queue_job("image", path, fmt, outscale=scale, format=fmt)

    @app.post("/v1/image-upscaling/video")
    async def upscale_video(video: UploadFile = File(...), outscale: float | None = Form(None)):
        """Queue a video: every frame comes out `outscale` times larger, same frame rate and audio."""
        _check_frames_supported()
        scale = _check_outscale(outscale)
        path = await _receive(video, ".mp4")
        try:
            width, height, _ = await asyncio.to_thread(probe_video, path)
        except Exception:
            path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail="Invalid or unsupported video") from None
        out_w, out_h = output_size(width, height, scale)
        if out_w * out_h > MAX_VIDEO_OUTPUT_PIXELS:
            path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=f"Frames would come out {out_w}x{out_h}, over 3840x2160: use a smaller video or outscale",
            )
        return _queue_job("video", path, "mp4", outscale=scale, width=width, height=height)

    @app.post("/v1/image-upscaling/frame")
    async def upscale_frame(
        request: Request,
        outscale: float | None = Query(None),
        fmt: str = Query("jpeg", alias="format"),
    ):
        """Upscale one frame (the image file as the body) and answer with it, skipping the queue: for live video."""
        if fmt not in IMAGE_FORMATS:
            raise HTTPException(status_code=400, detail="format must be png, jpeg or webp")
        if not state["upscaler"]:
            raise HTTPException(status_code=503, detail="Model not loaded")
        _check_frames_supported()
        body = await request.body()
        content, seconds, (width, height) = await asyncio.to_thread(_upscale_frame_bytes, body, outscale, fmt)
        headers = {**server_timing(seconds), "X-Image-Width": str(width), "X-Image-Height": str(height)}
        return Response(content=content, media_type=IMAGE_FORMATS[fmt], headers=headers)

    @app.get("/v1/tasks/{task_id}")
    async def task_status(task_id: str):
        """A task's status: queued, running, finished, error, cancelled or not_found."""
        return describe_task(task_id)

    @app.delete("/v1/tasks/{task_id}")
    async def cancel_task_request(task_id: str):
        """Cancel a task and return its status; a running one stops at its next tile or frame."""
        await asyncio.to_thread(cancel_task, task_id)
        return describe_task(task_id)

    @app.get("/v1/tasks/{task_id}/events")
    async def task_status_events(task_id: str):
        """Follow a task's status as Server-Sent Events, ending after its final one."""
        return sse_response(
            watch_status(
                lambda: describe_task(task_id),
                lambda s: s["status"] in TERMINAL_TASK_STATUSES,
            )
        )

    def _result(task_id: str, kind: str):
        if not TASK_ID_RE.fullmatch(task_id):
            raise HTTPException(status_code=400, detail="Invalid task id")
        task = tasks.get(task_id, {})
        output = task.get("output")
        if task.get("kind") != kind or not output:
            raise HTTPException(status_code=404, detail="Result not found")
        path = Path(output).resolve()
        if path.parent != OUTPUT_DIR.resolve() or not path.exists():
            raise HTTPException(status_code=404, detail="Result not found")
        return path

    # Download names come from the result file (its stem is the task id), not from the request:
    # Coverity reads a request value in Content-Disposition as header injection.
    @app.get("/v1/image-upscaling/image/{task_id}")
    async def download_image(task_id: str):
        path = _result(task_id, "image")
        fmt = path.suffix.lstrip(".")
        return FileResponse(path, media_type=IMAGE_FORMATS[fmt], filename=f"upscaled_{path.stem}.{fmt}")

    @app.get("/v1/image-upscaling/video/{task_id}")
    async def download_video(task_id: str):
        path = _result(task_id, "video")
        return FileResponse(path, media_type="video/mp4", filename=f"upscaled_{path.stem}.mp4")


def main():
    args = parse_arguments()
    logger.info(f"Image upscaling model={args.model} device={args.device} precision={args.precision}")
    app = create_app(args)
    setup_routes(app, args)
    serve(app, args)


if __name__ == "__main__":
    main()
