# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import argparse
import io
import queue
import re
import shutil
from contextlib import asynccontextmanager
from itertools import count
from pathlib import Path
from threading import Lock, Thread
from uuid import uuid4

import numpy as np
import uvicorn
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from modules.frame_generator_ov import (
    OpenVINOFrameGenerator,
    download_rife_model,
    measure_framegen_fps,
)
from modules.logger import getLogger
from modules.video import interpolate_video_file, probe_video

UPLOAD_DIR = Path("data/uploads")
OUTPUT_DIR = Path("data/outputs")
MAX_MULTIPLIER = 4
# One gap in a single interpolate request may ask for at most this many
# frames; guards the level-synchronous subdivision from unbounded recursion.
MAX_FRAMES_PER_GAP = 15
TASK_ID_RE = re.compile(r"^[a-f0-9]{8}$")

tasks = {}

# The single shared generator and the lock serializing its inference request
# (the underlying OpenVINO infer request is not thread-safe).
state = {"generator": None, "lock": Lock(), "device": "CPU"}

# Video jobs run one at a time on a dedicated worker thread, decoupled from
# the request lifecycle: the upload returns immediately with a task id and
# additional uploads queue behind the running job instead of competing for
# the (serialized) generator or tying up the server's request thread pool.
video_jobs = queue.Queue()
_job_seq = count()


def _video_job_worker():
    while True:
        job = video_jobs.get()
        if job is None:
            break
        run_video_interpolation(**job)
        video_jobs.task_done()


def parse_arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--port",
        type=str,
        default="8031",
        help="Server port (default: 8031)",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="CPU",
        help="OpenVINO device for the RIFE model (CPU/GPU/GPU.1/NPU)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="huggingface",
        choices=["huggingface", "modelscope"],
        help="Model source (default: huggingface)",
    )
    return parser.parse_args()


class BenchmarkRequest(BaseModel):
    image_size: int = Field(default=256, ge=32, le=2048)
    gap_sizes: list[int] = Field(default=[1], min_length=1, max_length=64)
    rounds: int = Field(default=3, ge=1, le=10)


def create_app(args):
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        getLogger(__name__).info("Starting lifespan...")
        try:
            download_rife_model(source=args.source)
            generator = OpenVINOFrameGenerator(args.device)
            generator.warm_up(256)
            state["generator"] = generator
            state["device"] = args.device.upper()
            Thread(target=_video_job_worker, daemon=True).start()
            app.state.ready = True
            getLogger(__name__).info("Startup complete; server is ready.")
        except Exception as e:
            getLogger(__name__).error(f"Error in lifespan startup: {e}")
            exit(1)
        yield
        video_jobs.put(None)

    app = FastAPI(lifespan=lifespan)
    # Not ready until lifespan startup (model download/convert/warmup) finishes.
    app.state.ready = False

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    return app


def run_video_interpolation(task_id, video_path, multiplier, mode):
    tasks[task_id] = {"status": "running", "progress": 0.0}

    def on_progress(fraction):
        tasks[task_id]["progress"] = round(fraction, 3)

    output_path = OUTPUT_DIR / f"{task_id}.mp4"
    try:
        info = interpolate_video_file(
            state["generator"],
            state["lock"],
            video_path,
            output_path,
            multiplier,
            mode=mode,
            progress_cb=on_progress,
        )
        tasks[task_id] = {"status": "finished", "progress": 1.0, **info}
    except Exception as e:
        getLogger(__name__).exception("Video interpolation failed")
        tasks[task_id] = {"status": "error", "detail": str(e) or repr(e)}
        output_path.unlink(missing_ok=True)
    finally:
        Path(video_path).unlink(missing_ok=True)


def setup_routes(app: FastAPI, args):
    @app.get("/healthcheck")
    async def healthcheck():
        # Report healthy only after startup (model download/convert) completes.
        if not getattr(app.state, "ready", False):
            return JSONResponse({"status": "initializing"}, status_code=503)
        return JSONResponse({"status": "ok", "device": state["device"]})

    @app.post("/v1/frame-generation/benchmark")
    async def benchmark(req: BenchmarkRequest):
        """Measure interpolation throughput (frames/sec) for a gap schedule.

        Also warms any lazily-compiled static shapes for that schedule, so a
        caller that benchmarks its exact production schedule (as the lipsync
        planner does) gets a ready model afterwards.
        """
        if any(n < 1 or n > MAX_FRAMES_PER_GAP for n in req.gap_sizes):
            raise HTTPException(
                status_code=400,
                detail=f"gap_sizes entries must be 1..{MAX_FRAMES_PER_GAP}",
            )
        fps = measure_framegen_fps(
            state["generator"], req.image_size, req.gap_sizes, req.rounds
        )
        return {"fps": fps, "seconds_per_frame": 1.0 / fps}

    @app.post("/v1/frame-generation/interpolate")
    async def interpolate(request: Request):
        """Fill the frames between keyframe pairs.

        Body: an uncompressed .npz (application/octet-stream) with
            frames_a: [N,H,W,3] uint8 — gap start frames
            frames_b: [N,H,W,3] uint8 — gap end frames
            counts:   [N] int — intermediate frames to generate per gap
        Response: .npz with arrays gap_0..gap_{N-1}, each [counts[i],H,W,3] uint8.
        """
        body = await request.body()
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

        gaps = [
            (frames_a[i], frames_b[i], counts[i]) for i in range(len(counts))
        ]
        with state["lock"]:
            fills = state["generator"].interpolate_gaps(gaps)

        out = io.BytesIO()
        np.savez(
            out,
            **{
                f"gap_{i}": np.stack(fill).clip(0, 255).astype(np.uint8)
                for i, fill in enumerate(fills)
            },
        )
        return Response(
            content=out.getvalue(), media_type="application/octet-stream"
        )

    @app.post("/v1/frame-generation/video")
    async def interpolate_video(
        video: UploadFile = File(...),
        multiplier: int = Form(2),
        mode: str = Form("fps"),
    ):
        """Queue a video interpolation job: FPS upscaling or slow motion.

        mode="fps" multiplies the frame rate (same duration); mode="slowmo"
        keeps the frame rate and stretches the duration. Jobs run one at a
        time on a worker thread; poll /v1/tasks/{taskId} for progress.
        """
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

        with open(video_path, "wb") as f:
            shutil.copyfileobj(video.file, f)

        # Fail fast on files av cannot open instead of erroring in the task.
        try:
            fps, _ = probe_video(str(video_path))
            if not fps:
                raise ValueError("No video frame rate detected")
        except Exception:
            video_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400, detail="Invalid or unsupported video"
            )

        tasks[task_id] = {"status": "queued", "progress": 0.0, "seq": next(_job_seq)}
        video_jobs.put(
            {
                "task_id": task_id,
                "video_path": str(video_path),
                "multiplier": multiplier,
                "mode": mode,
            }
        )
        return JSONResponse({"taskId": task_id})

    @app.get("/v1/tasks/{task_id}")
    async def task_status(task_id: str):
        task = tasks.get(task_id)
        if task is None:
            return {"status": "not_found"}
        status = {k: v for k, v in task.items() if k != "seq"}
        if task["status"] == "queued":
            status["position"] = 1 + sum(
                1
                for other in tasks.values()
                if other["status"] == "queued" and other["seq"] < task["seq"]
            )
        return status

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
    getLogger(__name__).info(f"Frame generation device={args.device}")

    app = create_app(args)
    setup_routes(app, args)

    port = int(args.port)
    getLogger(__name__).info(f"Starting Frame Generation server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
