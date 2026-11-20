# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Video generation worker: Wan2.1 / Wan2.2 text- and image-to-video behind OpenAI's Videos API.

``--device XPU`` runs the networks with PyTorch on an Intel GPU; any OpenVINO device (``GPU``,
``GPU.1``, ``CPU``, ``AUTO``) runs them as OpenVINO IR, converted on first start. A video is a
background job: ``POST /v1/videos`` answers at once with its id, ``GET /v1/videos/{id}/events``
streams its progress, ``GET /v1/videos/{id}/content`` serves the MP4 (and, asked with
``preview``, a small MP4 of each denoising step as it is made).
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess  # nosec B404 - runs the bundled ffmpeg with a fixed argument list
import threading
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from starlette.concurrency import run_in_threadpool

from model_downloader import fetch_file, fetch_snapshot
from worker_common import (
    CANCELLED,
    CancelToken,
    base_parser,
    create_app,
    ffmpeg_binary,
    get_logger,
    install_models_routes,
    install_openai_errors,
    instance_data_dir,
    models_dir,
    normalize_openvino_device,
    openvino_core,
    resolve_torch_device,
    serve,
    shared_model_lock,
    sse_response,
    watch_status,
)
from worker_common.startup import startup_stage

from wan import pose
from wan.pipeline import Cancelled, GenerateArgs, WanVideoPipeline
from wan.presets import PRESETS, Preset, get_preset
from wan.tiny_vae import WEIGHTS as TINY_WEIGHTS

logger = get_logger(__name__)

ARGS = None
PIPELINE: Optional[WanVideoPipeline] = None
STATE: dict[str, Any] = {}

DATA_DIR = instance_data_dir(Path(__file__).resolve().parent / "data")
#: Finished videos, as ``<id>/video.mp4`` and ``<id>/thumbnail.webp`` (and ``<id>/step-<n>.mp4``
#: previews); emptied on every start.
JOBS_DIR = DATA_DIR / "jobs"
#: Seconds per denoising step and per decoded latent frame measured here, kept across starts.
RATES_FILE = DATA_DIR / "rates.json"
#: A finished video stays downloadable this long, and at most this many are kept.
JOB_TTL_SECONDS = 60 * 60
MAX_FINISHED_JOBS = 16
FINAL_STATUSES = ("completed", "failed", CANCELLED)
#: Share of the progress bar each phase fills (denoising is most of the time on every device).
PHASE_SPAN = {
    "queued": (0, 0),
    "pose": (0, 5),
    "prepare": (5, 6),
    "text": (6, 8),
    "denoise": (8, 92),
    "decode": (92, 99),
    "encode": (99, 100),
}


# -- model loading ----------------------------------------------------------------------------


def _repo_dir(repo: str) -> Path:
    return Path(models_dir("video-generation", "hf", repo.replace("/", "--")))


def _openvino_device(requested: str) -> str:
    """An OpenVINO device for the transformer. ``GPU`` and ``AUTO`` mean the discrete GPU when there
    is one (OpenVINO's own ``GPU`` is ``GPU.0``, usually the integrated one), else the first GPU."""
    device = normalize_openvino_device(requested, supported=("AUTO", "CPU", "GPU", "NPU"))
    if device.startswith("NPU"):
        raise ValueError("The transformer cannot run on the NPU; use --decoder-device NPU to decode there")
    if device not in ("AUTO", "GPU"):
        return device
    core = openvino_core()
    gpus = [d for d in core.available_devices if d.startswith("GPU")]
    for name in gpus:
        try:
            if str(core.get_property(name, "DEVICE_TYPE")).lower().endswith("discrete"):
                return name
        except Exception:  # noqa: BLE001 - a plugin without the property
            pass
    if gpus:
        return gpus[0]
    if device == "GPU":
        raise ValueError("No Intel GPU found for OpenVINO")
    return "CPU"


def _fetch_weights(preset: Preset, source: str, *, networks: bool) -> dict[str, Path]:
    """The configs (and with ``networks`` the PyTorch weights) a preset needs, mirrored locally.

    The text encoder, tokenizer and VAE come from ``base_repo``/``text_encoder_repo`` for every
    preset, so a second preset downloads only its transformer.
    """
    dirs = {
        "base": fetch_snapshot(
            preset.base_repo,
            _repo_dir(preset.base_repo),
            source=source,
            allow_patterns=["model_index.json", "scheduler/*", "tokenizer/*", "vae/*"],
        )
    }
    if networks:
        dirs["text_encoder"] = fetch_snapshot(
            preset.text_encoder_repo,
            _repo_dir(preset.text_encoder_repo),
            source=source,
            allow_patterns=["text_encoder/*"],
        )
        dirs["transformer"] = fetch_snapshot(
            preset.transformer_repo,
            _repo_dir(preset.transformer_repo),
            source=source,
            allow_patterns=[f"{subfolder}/*" for subfolder in preset.experts],
        )
    repo, filename = TINY_WEIGHTS[preset.family]
    dirs["tiny"] = fetch_file(repo, filename, _repo_dir(repo), source=source)
    if preset.vace:
        for name in (pose.DETECTOR, pose.POSE_MODEL):
            dirs["pose"] = fetch_file(pose.WEIGHTS_REPO, name, _repo_dir(pose.WEIGHTS_REPO), source=source).parent
    return dirs


def load_pipeline(args) -> WanVideoPipeline:
    preset = get_preset(args.model)
    source = args.source
    device = args.device.strip()
    if device.lower().startswith("xpu"):
        import torch

        from wan.torch_backend import TorchBackend

        torch_device = resolve_torch_device(device)
        dirs = _fetch_weights(preset, source, networks=True)
        with startup_stage("loading-model", f"{preset.label} on {torch_device} (PyTorch)"):
            backend = TorchBackend(
                dirs["transformer"],
                dirs["base"],
                dirs["text_encoder"],
                device=torch_device,
                tiny_decoder=dirs["tiny"] if args.decoder == "tiny" else None,
                family=preset.family,
                vae_dtype=torch.bfloat16,
                tiny_encoder=dirs["tiny"] if preset.vace else None,
                experts=preset.experts,
            )
        STATE.update(backend="pytorch", device=torch_device, precision="bf16")
        ov_device = None
    else:
        from wan.ov_backend import OVBackend
        from wan.ov_export import export_preset, ir_paths

        if args.decoder != "tiny":
            raise ValueError("OpenVINO decodes with the tiny decoder only; the full VAE needs --device XPU")
        ov_device = _openvino_device(device)
        root = Path(models_dir("video-generation"))
        converted = all(p.exists() for p in ir_paths(preset, root, args.precision).all())
        dirs = _fetch_weights(preset, source, networks=not converted)
        with startup_stage("preparing", f"Converting {preset.label} to OpenVINO ({args.precision})"):
            ir = export_preset(
                preset,
                root,
                args.precision,
                dirs["base"],
                dirs.get("transformer"),
                dirs.get("text_encoder"),
                dirs["tiny"],
                lock=shared_model_lock,
            )
        decoder_device = args.decoder_device or ov_device
        # Compiled transformers for the video sizes seen, up to this many GiB (0: none); see OVBackend.
        budget = float(os.environ.get("VIDEO_GENERATION_OV_CACHE_GB", "20"))
        cache = budget > 0 and ov_device.startswith("GPU")
        with startup_stage("loading-model", f"{preset.label} on {ov_device} (OpenVINO)"):
            backend = OVBackend(
                ir,
                preset,
                device=ov_device,
                text_device=args.text_device,
                vae_device=decoder_device,
                static=preset.static_shapes,
                cache_dir=root / ".ov_cache" if cache else None,
                cache_budget=int(budget * 2**30),
            )
        STATE.update(backend="openvino", device=ov_device, precision=args.precision)
    STATE.update(preset=preset, decoder=args.decoder, execution_device=backend.execution_device)
    if preset.vace:
        # On the transformer's OpenVINO device, else the discrete GPU beside PyTorch's: 25 ms a frame
        # on an Arc Pro B60, 82 ms on the NPU, 0.3 s on a Core Ultra 9 285K.
        pose_device = args.pose_device or ov_device
        if pose_device is None:
            try:
                pose_device = _openvino_device("GPU")
            except ValueError:
                pose_device = "CPU"
        with startup_stage("loading-model", f"Pose estimation on {pose_device}"):
            STATE["pose"] = pose.PoseExtractor(dirs["pose"], normalize_openvino_device(pose_device))
        STATE["pose_device"] = pose_device
    return WanVideoPipeline(preset, backend, dirs["base"])


# -- rates (for the progress estimate) ----------------------------------------------------------


class Rates:
    """Seconds per denoising step and per decoded latent frame, an average per video shape."""

    ALPHA = 0.5

    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.Lock()
        try:
            self._all = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self._all = {}

    @staticmethod
    def key(job: "VideoJob") -> str:
        return f"{STATE.get('preset').id}|{STATE.get('device')}|{job.args.width}x{job.args.height}x{job.num_frames}"

    def get(self, key: str, name: str) -> Optional[float]:
        with self._lock:
            return (self._all.get(key) or {}).get(name)

    def record(self, key: str, name: str, seconds: float) -> None:
        if not seconds > 0:
            return
        with self._lock:
            entry = self._all.setdefault(key, {})
            previous = entry.get(name)
            entry[name] = seconds if previous is None else self.ALPHA * seconds + (1 - self.ALPHA) * previous
            text = json.dumps(self._all, indent=2)
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            partial = self._path.with_suffix(".tmp")
            partial.write_text(text, encoding="utf-8")
            os.replace(partial, self._path)
        except OSError as exc:
            logger.warning("Could not save the measured rates: %s", exc)


_rates = Rates(RATES_FILE)


# -- jobs ---------------------------------------------------------------------------------------


class VideoJob:
    """One video. Statuses: ``queued`` -> ``in_progress`` -> ``completed``, ``failed`` or
    ``cancelled``; while in progress ``phase`` is ``pose`` (drawing a driving video's poses, VACE),
    ``prepare`` (compiling for a new video size), ``text``, ``denoise``, ``decode`` or ``encode``.

    ``driving``: a VACE request's uploaded video, poses drawn from it, or used as they are with
    ``drawn``; the pose video is kept beside the result (``content?variant=control``).

    ``preview``: each denoising step but the last is decoded small and encoded, on a thread of its
    own while the next step runs, to ``step-<n>.mp4`` (``content?variant=preview&step=n``);
    ``previews`` counts the ones written, which are steps 1 to ``previews``."""

    def __init__(
        self,
        args: GenerateArgs,
        *,
        model: str,
        fps: int,
        num_frames: int,
        has_image: bool,
        driving: Optional[Path] = None,
        drawn: bool = False,
        preview: bool = False,
    ):
        self.id = f"video_{uuid.uuid4().hex}"
        self.args = args
        self.model = model
        self.fps = fps
        self.num_frames = num_frames
        self.has_image = has_image
        self.driving = driving
        self.drawn = drawn
        self.token = CancelToken()
        self.status = "queued"
        self.phase = "queued"
        self.done = 0
        self.total = 0
        self.created = time.time()
        self.started: Optional[float] = None
        self.phase_started: Optional[float] = None
        self.finished: Optional[float] = None
        self.error: Optional[str] = None
        self.timings: dict[str, float] = {}
        self.preview = preview
        self.previews = 0
        self._preview_writer: Optional[ThreadPoolExecutor] = None
        self._lock = threading.Lock()

    @property
    def folder(self) -> Path:
        return JOBS_DIR / self.id

    @property
    def video_path(self) -> Path:
        return self.folder / "video.mp4"

    @property
    def thumbnail_path(self) -> Path:
        return self.folder / "thumbnail.webp"

    @property
    def control_path(self) -> Path:
        return self.folder / "control.mp4"

    def preview_path(self, step: int) -> Path:
        return self.folder / f"step-{step}.mp4"

    def previews_made(self) -> int:
        with self._lock:
            return self.previews

    @property
    def is_final(self) -> bool:
        return self.status in FINAL_STATUSES

    def progress(self, phase: str, done: int, total: int) -> None:
        now = time.time()
        with self._lock:
            if phase != self.phase:
                if self.phase_started is not None and self.phase in ("pose", "prepare", "text", "denoise", "decode"):
                    self.timings[self.phase] = now - self.phase_started
                self.phase, self.phase_started = phase, now
            self.done, self.total = done, total

    def run(self, pipeline: WanVideoPipeline) -> None:
        with self._lock:
            self.status, self.started = "in_progress", time.time()
        try:
            if self.driving is not None:
                self._poses()
            key = Rates.key(self)
            if self.preview:
                self._preview_writer = ThreadPoolExecutor(1, thread_name_prefix="video-preview")
            frames = pipeline(
                self.args,
                self.progress,
                should_stop=lambda: self.token.cancelled,
                preview=self._write_preview if self.preview else None,
            )
            self.progress("encode", 0, 1)
            _write_video(frames, self.fps, self.video_path, self.thumbnail_path)
            # The last previews are written before the video is reported done.
            self._stop_previews()
            self.progress("encode", 1, 1)
        except Cancelled:
            logger.info("Video %s cancelled", self.id)
            self._stop_previews()
            self._finish(CANCELLED)
            return
        except Exception as exc:  # noqa: BLE001 - reported on the job
            logger.exception("Video %s failed", self.id)
            self._stop_previews()
            self._finish("failed", str(exc) or exc.__class__.__name__)
            return
        steps = max(self.args.steps if STATE["preset"].sampler != "dmd" else len(STATE["preset"].dmd_timesteps), 1)
        if "denoise" in self.timings:
            _rates.record(key, "step", self.timings["denoise"] / steps)
        if "decode" in self.timings:
            _rates.record(key, "decode", self.timings["decode"])
        self._finish("completed")

    def _write_preview(self, step: int, frames) -> None:
        """Called by the pipeline after step ``step``: encodes its preview off the denoising thread."""
        writer = self._preview_writer
        if writer is None or self.token.cancelled:
            return

        def write():
            if self.token.cancelled:
                return
            try:
                _write_video(frames, self.fps, self.preview_path(step), preset="veryfast", crf=26)
            except Exception as exc:  # noqa: BLE001 - a preview is not worth failing the video for
                logger.warning("Video %s: could not write the preview of step %d: %s", self.id, step, exc)
                return
            with self._lock:
                self.previews = max(self.previews, step)

        writer.submit(write)

    def _stop_previews(self) -> None:
        """Waits for the previews being written (none are left half-written in the job's folder)."""
        writer, self._preview_writer = self._preview_writer, None
        if writer is not None:
            writer.shutdown(wait=True, cancel_futures=self.token.cancelled)

    def _poses(self) -> None:
        """The control video from ``driving``, at most ``num_frames`` long; a shorter video makes a
        shorter result."""
        args = self.args
        self.progress("pose", 0, 1)
        ffmpeg = ffmpeg_binary()
        if not ffmpeg:
            raise RuntimeError("ffmpeg was not found; run setup to install it")
        if self.drawn:
            maps = pose.read_video(self.driving, ffmpeg, self.fps, args.width, args.height, self.num_frames)
        else:
            width, height = pose.draw_size(args.width, args.height)
            frames = pose.read_video(self.driving, ffmpeg, self.fps, width, height, self.num_frames)
            maps = STATE["pose"](
                frames,
                args.width,
                args.height,
                progress=lambda done, total: self.progress("pose", done, total),
                should_stop=lambda: self.token.cancelled,
            )
            if self.token.cancelled:
                raise Cancelled()
        count = (len(maps) - 1) // 4 * 4 + 1
        if count < 5:
            raise ValueError(f"The video is too short: it needs at least 5 frames at {self.fps} fps")
        with self._lock:
            self.num_frames = args.num_frames = count
        args.control = maps[:count]
        _write_video(args.control, self.fps, self.control_path)
        self.driving.unlink(missing_ok=True)

    def drop(self) -> None:
        self.token.cancel()
        self._finish(CANCELLED)

    def _finish(self, status: str, error: Optional[str] = None) -> None:
        with self._lock:
            now = time.time()
            if self.phase_started is not None and self.phase not in self.timings and self.phase != "queued":
                self.timings[self.phase] = now - self.phase_started
            self.finished, self.status, self.error = now, status, error
        if status != "completed":
            shutil.rmtree(self.folder, ignore_errors=True)

    def _estimate(self, now: float) -> Optional[float]:
        """Seconds left, from this job's own steps once it has some, else the measured rates."""
        preset = STATE["preset"]
        key = Rates.key(self)
        steps = len(preset.dmd_timesteps) if preset.sampler == "dmd" else self.args.steps
        step = _rates.get(key, "step")
        if self.phase == "denoise" and self.done > 0 and self.phase_started:
            step = (now - self.phase_started) / self.done
        decode = _rates.get(key, "decode") or 0.0
        if step is None:
            return None
        if self.phase in ("queued", "prepare", "text"):
            return steps * step + decode
        if self.phase == "denoise":
            return (steps - self.done) * step + decode
        if self.phase == "decode" and self.total:
            return decode * (1 - self.done / self.total)
        return 0.0

    def body(self, position: Optional[int] = None) -> dict:
        """OpenAI's Video object, plus what the app's progress display reads."""
        with self._lock:
            now = time.time()
            lo, hi = PHASE_SPAN.get(self.phase, (0, 0))
            progress = 100 if self.status == "completed" else int(lo + (hi - lo) * (self.done / self.total if self.total else 0))
            a = self.args
            body: dict[str, Any] = {
                "id": self.id,
                "object": "video",
                "model": self.model,
                "status": self.status,
                "progress": progress,
                "created_at": int(self.created),
                "completed_at": int(self.finished) if self.status == "completed" else None,
                "expires_at": int(self.finished + JOB_TTL_SECONDS) if self.status == "completed" else None,
                "size": f"{a.width}x{a.height}",
                "seconds": f"{(self.num_frames - 1) / self.fps:g}",
                "prompt": a.prompt,
                "remixed_from_video_id": None,
                "error": {"code": "generation_failed", "message": self.error} if self.status == "failed" else None,
                # Beyond OpenAI's object:
                "phase": self.phase if not self.is_final else self.status,
                "step": self.done if self.phase == "denoise" else None,
                "steps": self.total if self.phase == "denoise" else None,
                "num_frames": self.num_frames,
                "fps": self.fps,
                "seed": a.seed,
                "image_to_video": self.has_image and not STATE["preset"].vace,
                "reference_image": self.has_image and STATE["preset"].vace,
                "pose_to_video": self.driving is not None or a.control is not None,
                "elapsed_time": round((self.finished or now) - (self.started or self.created), 1),
            }
            if self.preview:
                # Steps 1 to `previews` have one (`content?variant=preview&step=n`).
                body["previews"] = self.previews
            if self.status == "queued":
                body["position"] = position
            if not self.is_final:
                estimate = self._estimate(now)
                body["estimated_time"] = round(estimate, 1) if estimate is not None else None
                if self.token.cancelled:
                    body["cancel_requested"] = True
            if self.status == "completed":
                seconds = self.finished - (self.started or self.created)
                steps = len(STATE["preset"].dmd_timesteps) if STATE["preset"].sampler == "dmd" else a.steps
                # For the app's Live metrics; `started` keys the job so polls count it once.
                body["perf"] = {
                    "seconds": seconds,
                    "items": 1,
                    "started": self.started,
                    "steps": steps,
                    "frames": self.num_frames,
                    **{f"{k}_seconds": round(v, 2) for k, v in self.timings.items()},
                }
            return body


def _write_video(
    frames, fps: int, video: Path, thumbnail: Optional[Path] = None, *, preset: str = "medium", crf: int = 18
) -> None:
    """H.264 MP4 (yuv420p, faststart: playable in every browser as it downloads) and a WebP still."""
    ffmpeg = ffmpeg_binary()
    if not ffmpeg:
        raise RuntimeError("ffmpeg was not found; run setup to install it")
    video.parent.mkdir(parents=True, exist_ok=True)
    count, height, width, _ = frames.shape
    partial = video.with_suffix(".partial.mp4")
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "-",
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(partial),
    ]  # fmt: skip
    result = subprocess.run(command, input=frames.tobytes(), capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode(errors='replace')[-400:]}")
    os.replace(partial, video)
    if thumbnail is not None:
        Image.fromarray(frames[count // 2]).save(thumbnail, "WEBP", quality=85)


class JobQueue:
    """One video at a time, first come first served: two at once would only share the device."""

    def __init__(self):
        self._cond = threading.Condition()
        self._waiting: deque[VideoJob] = deque()
        self._thread: Optional[threading.Thread] = None

    def submit(self, job: VideoJob) -> None:
        with self._cond:
            self._waiting.append(job)
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name="video-jobs", daemon=True)
                self._thread.start()
            self._cond.notify()

    def _run(self) -> None:
        while True:
            with self._cond:
                while not self._waiting:
                    self._cond.wait()
                job = self._waiting.popleft()
            job.run(PIPELINE)

    def status(self, job: VideoJob) -> dict:
        with self._cond:
            position = next((i for i, waiting in enumerate(self._waiting, 1) if waiting is job), None)
        return job.body(position)

    def cancel(self, job: VideoJob) -> None:
        """Drops a queued job at once; a running one stops before its next network call."""
        with self._cond:
            if job in self._waiting:
                self._waiting.remove(job)
                job.drop()
                return
        if not job.is_final:
            job.token.cancel()


_queue = JobQueue()
_jobs: dict[str, VideoJob] = {}
_jobs_lock = threading.Lock()


def _evict_finished() -> None:
    with _jobs_lock:
        now = time.time()
        finished = sorted((j for j in _jobs.values() if j.is_final), key=lambda j: j.finished or 0)
        expired = {j for j in finished if (j.finished or 0) < now - JOB_TTL_SECONDS}
        expired.update(finished[: max(0, len(finished) - MAX_FINISHED_JOBS + 1)])
        for job in expired:
            _jobs.pop(job.id, None)
    for job in expired:
        shutil.rmtree(job.folder, ignore_errors=True)


def _find(video_id: str) -> VideoJob:
    with _jobs_lock:
        job = _jobs.get(video_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Video not found")
    return job


# -- request parsing ----------------------------------------------------------------------------


def _number(value: Any, name: str, kind=float) -> Any:
    if value is None or value == "":
        return None
    try:
        return kind(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"`{name}` must be a number") from None


def _limits(preset: Preset) -> dict:
    width, height = preset.largest
    return {
        "max_pixels": width * height,
        "min_side": 256,
        "max_side": max(width, height),
        "size_multiple": preset.size_multiple,
        "max_frames": preset.longest,
        "min_frames": 5,
    }


def _build_request(fields: dict, image: Optional[Image.Image], posed: bool = False) -> tuple[GenerateArgs, int, int]:
    """``posed``: the request brings a driving or pose video, which says what moves (and a reference
    image, who): the prompt is optional then."""
    preset: Preset = STATE["preset"]
    limits = _limits(preset)
    prompt = str(fields.get("prompt") or "").strip()
    if not prompt and not posed:
        raise HTTPException(status_code=400, detail="`prompt` is required")
    model = str(fields.get("model") or "").strip()
    if model and model.lower() not in (preset.id.lower(), preset.id.split("/")[-1].lower()):
        raise HTTPException(status_code=400, detail=f"This instance serves {preset.id}, not {model}")

    width, height = preset.width, preset.height
    if fields.get("size"):
        try:
            width, height = (int(v) for v in str(fields["size"]).lower().split("x"))
        except ValueError:
            raise HTTPException(status_code=400, detail="`size` must look like 1280x704") from None
    m = limits["size_multiple"]
    if width % m or height % m:
        raise HTTPException(status_code=400, detail=f"Width and height must be multiples of {m}")
    if min(width, height) < limits["min_side"] or max(width, height) > limits["max_side"] or width * height > limits["max_pixels"]:
        raise HTTPException(
            status_code=400,
            detail=f"{preset.label} makes videos of at most {'x'.join(map(str, preset.largest))} pixels (either orientation)",
        )

    fps = _number(fields.get("fps"), "fps", int) or preset.fps
    if not 4 <= fps <= 60:
        raise HTTPException(status_code=400, detail="`fps` must be between 4 and 60")
    num_frames = _number(fields.get("num_frames"), "num_frames", int)
    seconds = _number(fields.get("seconds"), "seconds")
    if num_frames is None:
        num_frames = round(seconds * fps) + 1 if seconds else preset.num_frames
    num_frames = preset.fit_frames(num_frames)
    if not limits["min_frames"] <= num_frames <= limits["max_frames"]:
        raise HTTPException(
            status_code=400,
            detail=f"{preset.label} makes {limits['min_frames']} to {limits['max_frames']} frames "
            f"({(limits['max_frames'] - 1) / fps:g} s at {fps} fps)",
        )
    steps = _number(fields.get("num_inference_steps") or fields.get("steps"), "num_inference_steps", int) or preset.steps
    if not 1 <= steps <= 100:
        raise HTTPException(status_code=400, detail="`num_inference_steps` must be between 1 and 100")
    guidance = _number(fields.get("guidance_scale"), "guidance_scale")
    guidance = preset.guidance_scale if guidance is None else guidance
    if not 1.0 <= guidance <= 20.0:
        raise HTTPException(status_code=400, detail="`guidance_scale` must be between 1 and 20")
    # Wan2.2 A14B's low-noise transformer has its own (the preset's when not given).
    guidance_2 = _number(fields.get("guidance_scale_2"), "guidance_scale_2")
    if guidance_2 is not None and len(preset.experts) == 1:
        raise HTTPException(status_code=400, detail=f"{preset.label} has one transformer: `guidance_scale_2` is not used")
    if guidance_2 is not None and not 1.0 <= guidance_2 <= 20.0:
        raise HTTPException(status_code=400, detail="`guidance_scale_2` must be between 1 and 20")
    seed = _number(fields.get("seed"), "seed", int)
    if seed is None:
        seed = int.from_bytes(os.urandom(4), "little")
    if image is not None and not (preset.image_to_video or preset.vace):
        raise HTTPException(status_code=400, detail=f"{preset.label} makes videos from text only")
    try:
        PIPELINE.check_fits(width, height, num_frames, 1 if image is not None and preset.vace else 0)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    control_scale = _number(fields.get("control_scale"), "control_scale")
    control_scale = 1.0 if control_scale is None else control_scale
    if not 0.0 <= control_scale <= 2.0:
        raise HTTPException(status_code=400, detail="`control_scale` must be between 0 and 2")
    args = GenerateArgs(
        prompt=prompt,
        negative_prompt=(str(fields.get("negative_prompt") or "").strip() or None),
        width=width,
        height=height,
        num_frames=num_frames,
        steps=steps,
        guidance_scale=guidance,
        guidance_scale_2=guidance_2,
        seed=seed,
        # VACE takes the image as the subject to show, not as the first frame.
        image=None if preset.vace else image,
        reference=image if preset.vace else None,
        control_scale=control_scale,
    )
    return args, fps, num_frames


def _flag(value: Any, name: str) -> bool:
    """A JSON boolean, or a multipart field's ``true`` / ``false`` (``1`` / ``0``)."""
    if value is None or value == "" or isinstance(value, bool):
        return bool(value)
    text = str(value).strip().lower()
    if text in ("true", "1", "yes", "on"):
        return True
    if text in ("false", "0", "no", "off"):
        return False
    raise HTTPException(status_code=400, detail=f"`{name}` must be true or false")


async def _read_image(value: Any) -> Optional[Image.Image]:
    if value is None or value == "":
        return None
    if isinstance(value, (UploadFile,)) or hasattr(value, "read"):
        data = await value.read()
    elif isinstance(value, str) and value.startswith("data:"):
        import base64

        data = base64.b64decode(value.split(",", 1)[-1])
    else:
        raise HTTPException(status_code=400, detail="`input_reference` must be an image file or a data URL")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
        return image.convert("RGB")
    except Exception:  # noqa: BLE001 - any undecodable upload
        raise HTTPException(status_code=400, detail="`input_reference` is not a readable image") from None


# -- app ----------------------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    global PIPELINE
    shutil.rmtree(JOBS_DIR, ignore_errors=True)
    PIPELINE = await run_in_threadpool(load_pipeline, ARGS)
    # Latent tokens per transformer call for presets made in windows (``Preset.window_tokens``).
    PIPELINE.window_budget = int(os.environ.get("VIDEO_GENERATION_WINDOW_TOKENS", "0") or 0)
    logger.info(
        "Serving %s on %s (%s, %s, %s decoder)",
        STATE["preset"].label,
        STATE["execution_device"],
        STATE["backend"],
        STATE["precision"],
        STATE["decoder"],
    )
    yield
    PIPELINE = None


app = create_app("Video Generation Worker", lifespan=lifespan)


@app.get("/v1/videos/capabilities")
def capabilities():
    """What this instance makes: its model, device and the sizes, lengths and settings it takes."""
    preset: Preset = STATE["preset"]
    return {
        "model": preset.id,
        "label": preset.label,
        "backend": STATE["backend"],
        "device": STATE["device"],
        "execution_device": STATE["execution_device"],
        "precision": STATE["precision"],
        "decoder": STATE["decoder"],
        "image_to_video": preset.image_to_video,
        "pose_to_video": preset.vace,
        "reference_image": preset.vace,
        "pose_device": STATE.get("pose_device"),
        "sampler": preset.sampler,
        # `preview` requests get a small MP4 of each denoising step (the tiny decoder makes them).
        "previews": STATE["decoder"] == "tiny",
        "sizes": list(preset.sizes),
        "defaults": {
            "size": f"{preset.width}x{preset.height}",
            "num_frames": preset.num_frames,
            "fps": preset.fps,
            "num_inference_steps": preset.steps,
            "guidance_scale": preset.guidance_scale,
            **({"guidance_scale_2": preset.guidance_scale_2} if len(preset.experts) > 1 else {}),
        },
        "limits": _limits(preset),
    }


@app.post("/v1/videos", tags=["OpenAI-compatible"])
async def create_video(request: Request):
    """Start a video (JSON or multipart, as the OpenAI SDK sends) and answer with its job at once.

    OpenAI's fields: ``prompt``, ``model``, ``seconds``, ``size``, ``input_reference`` (an image to
    start from; for VACE, the subject to show). Also taken: ``negative_prompt``, ``num_frames``,
    ``fps``, ``num_inference_steps``, ``guidance_scale``, ``seed``, for Wan2.2 A14B
    ``guidance_scale_2`` (its low-noise transformer's), and for VACE (multipart only)
    ``input_video`` (a video whose poses the result follows), ``pose_video`` (pose maps drawn
    already) and ``control_scale``. ``preview``: true to also make a small MP4 of the model's guess
    at the video after each denoising step (``content?variant=preview&step=n``); ignored by an
    instance with the full VAE decoder (``previews`` false in its capabilities).
    """
    if PIPELINE is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    driving: Optional[UploadFile] = None
    drawn = False
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form()
        files = ("input_reference", "input_video", "pose_video")
        fields: dict[str, Any] = {k: v for k, v in form.items() if k not in files}
        reference = form.get("input_reference")
        for name in ("input_video", "pose_video"):
            upload = form.get(name)
            if upload is not None and upload != "":
                if not STATE["preset"].vace:
                    raise HTTPException(status_code=400, detail=f"{STATE['preset'].label} takes no `{name}`")
                if not hasattr(upload, "read"):
                    raise HTTPException(status_code=400, detail=f"`{name}` must be a video file")
                driving, drawn = upload, name == "pose_video"
    else:
        try:
            fields = await request.json()
        except ValueError:
            raise HTTPException(status_code=400, detail="Send JSON or multipart/form-data") from None
        if not isinstance(fields, dict):
            raise HTTPException(status_code=400, detail="The body must be a JSON object")
        reference = fields.pop("input_reference", None)
    image = await _read_image(reference)
    args, fps, num_frames = _build_request(fields, image, posed=driving is not None)
    job = VideoJob(
        args,
        model=STATE["preset"].id,
        fps=fps,
        num_frames=num_frames,
        has_image=image is not None,
        # A full-VAE decode of every step would take longer than the steps.
        preview=_flag(fields.get("preview"), "preview") and STATE["decoder"] == "tiny",
    )
    if driving is not None:
        # Read by ffmpeg when the job runs; a video it cannot read fails the job.
        job.folder.mkdir(parents=True, exist_ok=True)
        job.driving = job.folder / f"driving{Path(driving.filename or '').suffix[:8] or '.mp4'}"
        job.drawn = drawn
        with job.driving.open("wb") as f:
            while chunk := await driving.read(1 << 20):
                f.write(chunk)
    await run_in_threadpool(_evict_finished)
    with _jobs_lock:
        _jobs[job.id] = job
    _queue.submit(job)
    return _queue.status(job)


@app.get("/v1/videos", tags=["OpenAI-compatible"])
def list_videos(
    after: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    order: str = Query("desc", pattern="^(asc|desc)$"),
):
    with _jobs_lock:
        jobs = sorted(_jobs.values(), key=lambda j: j.created, reverse=order == "desc")
    if after:
        ids = [j.id for j in jobs]
        jobs = jobs[ids.index(after) + 1 :] if after in ids else []
    page = jobs[:limit]
    data = [_queue.status(j) for j in page]
    return {
        "object": "list",
        "data": data,
        "first_id": data[0]["id"] if data else None,
        "last_id": data[-1]["id"] if data else None,
        "has_more": len(jobs) > limit,
    }


@app.get("/v1/videos/{video_id}", tags=["OpenAI-compatible"])
def retrieve_video(video_id: str):
    return _queue.status(_find(video_id))


@app.delete("/v1/videos/{video_id}", tags=["OpenAI-compatible"])
def delete_video(video_id: str):
    """Deletes a finished video. One still queued or in progress is cancelled instead and its
    ``cancelled`` status stays readable (every worker's ``DELETE`` cancels, which the app relies on)."""
    job = _find(video_id)
    if job.is_final:
        with _jobs_lock:
            _jobs.pop(video_id, None)
        shutil.rmtree(job.folder, ignore_errors=True)
    else:
        _queue.cancel(job)
    return {"id": video_id, "object": "video.deleted", "deleted": True}


@app.get("/v1/videos/{video_id}/events")
async def video_events(video_id: str):
    """The video's status as Server-Sent Events whenever it changes, ending with the final one."""
    _find(video_id)

    def read():
        with _jobs_lock:
            job = _jobs.get(video_id)
        return _queue.status(job) if job is not None else None

    return sse_response(watch_status(read, lambda status: status["status"] in FINAL_STATUSES, interval=0.5))


@app.get(
    "/v1/videos/{video_id}/content",
    tags=["OpenAI-compatible"],
    response_class=FileResponse,
    responses={200: {"content": {"video/mp4": {}, "image/webp": {}}}},
)
def video_content(
    video_id: str,
    variant: str = Query("video", pattern="^(video|thumbnail|control|preview)$"),
    step: Optional[int] = Query(None, ge=1),
):
    """The MP4; ``thumbnail`` a WebP still; ``control`` the pose video a VACE video followed
    (readable once drawn, before the video is done); ``preview`` the small MP4 of denoising step
    ``step`` of a video asked with ``preview`` (readable once made; the latest without ``step``)."""
    job = _find(video_id)
    cache = f"private, max-age={JOB_TTL_SECONDS}, immutable"
    if variant == "preview":
        if not job.preview:
            raise HTTPException(status_code=404, detail="This video was not asked for with `preview`")
        made = job.previews_made()
        if made == 0 or (step is not None and step > made):
            raise HTTPException(status_code=404, detail=f"No preview of step {step or 1} yet")
        if step is None:
            # The latest changes as the video goes on.
            step, cache = made, "no-store"
        path = job.preview_path(step)
    elif variant == "control":
        path = job.control_path
    else:
        if job.status != "completed":
            raise HTTPException(status_code=409, detail=f"The video is {job.status}")
        path = job.video_path if variant == "video" else job.thumbnail_path
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(
        path,
        media_type="image/webp" if variant == "thumbnail" else "video/mp4",
        filename=f"{video_id}.mp4" if variant == "video" else None,
        headers={"Cache-Control": cache},
    )


install_models_routes(app, lambda: [STATE["preset"].id] if STATE.get("preset") else [])
install_openai_errors(app)


def main():
    global ARGS
    parser = base_parser(
        "Video Generation Worker",
        default_port=5110,
        default_device="GPU",
        device_help="XPU (PyTorch) or an OpenVINO device: GPU (the discrete one when present), GPU.1, CPU, AUTO",
        source=True,
    )
    parser.add_argument("--model", default="Wan-AI/Wan2.1-T2V-1.3B-Diffusers", choices=sorted(PRESETS))
    parser.add_argument(
        "--precision",
        default="int8",
        choices=["fp16", "int8", "int4"],
        help="OpenVINO weight format of the transformer and text encoder (default int8)",
    )
    parser.add_argument(
        "--decoder",
        default="tiny",
        choices=["tiny", "full"],
        help="tiny: LightX2V's distilled decoder (default, ~30x faster); full: the model's own VAE (XPU only)",
    )
    parser.add_argument("--text-device", default=None, help="OpenVINO device of the text encoder (default: --device)")
    parser.add_argument(
        "--decoder-device", default=None, help="OpenVINO device of the decoder, e.g. NPU (default: --device)"
    )
    parser.add_argument(
        "--pose-device",
        default=None,
        help="OpenVINO device of VACE's pose estimation, e.g. NPU (default: --device, or the GPU beside XPU)",
    )
    ARGS = parser.parse_args()
    serve(app, ARGS)


if __name__ == "__main__":
    main()
