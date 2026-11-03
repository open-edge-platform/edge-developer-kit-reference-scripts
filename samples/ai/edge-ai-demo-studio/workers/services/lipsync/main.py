# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import argparse
import json
import shutil
import yaml
import sys
import subprocess  # nosec -- used as a catch exception type only
import av
import re
from contextlib import asynccontextmanager

from model_downloader import fetch_snapshot
from uuid import uuid4
from aiortc import (
    RTCPeerConnection,
    RTCSessionDescription,
    RTCIceServer,
    RTCConfiguration,
)
from aiortc.rtcrtpsender import RTCRtpSender

from fastapi import (
    FastAPI,
    Request,
    WebSocket,
    UploadFile,
    File,
    HTTPException,
    Form,
    BackgroundTasks,
)
from fastapi.responses import FileResponse, JSONResponse

from pydantic import BaseModel
from typing import Optional
import librosa
import io
import worker_common
from worker_common import (
    CANCELLED,
    CancelToken,
    JobCancelled,
    base_parser,
    instance_data_dir,
    lan_origins,
    migrate_legacy_models_dir,
    models_dir,
    serve,
    shared_model_lock,
    sse_event,
    sse_response,
    watch_status,
)

from modules.base.logger import getLogger
from modules.base.tts import warm_up_resampler
from modules.webrtc_avatar import WebRTCAvatar
from modules.lipsync.wav2lip.wav2lip_avatar_generator import (
    generate_wav2lip_avatar,
    set_default_avatar,
)

from pathlib import Path
from threading import Lock, RLock
import asyncio
from fastapi.responses import StreamingResponse

# Shipped read-only assets stay in WORKER_DIR; generated avatars and uploads live in this
# instance's own data dir so two instances never collide.
WORKER_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = instance_data_dir(".")
avatar_dir = INSTANCE_DIR / "data" / "avatars"
samples_dir = INSTANCE_DIR / "data" / "samples"
tasks = {}


class Chat(BaseModel):
    chat_type: str
    session_id: str
    text: str
    voice: Optional[str] = None
    model: Optional[str] = None
    speed: Optional[str] = None
    tts_url: Optional[str] = None
    # RIFE in-between frames via the frame generation service; only activates when inference lags.
    frame_generation: bool = False


class ChatOption(BaseModel):
    chat_type: str
    session_id: str


class WSConnectionManager:
    def __init__(self):
        self.active_connections: dict = {}

    async def connect(self, id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[id] = websocket

    def disconnect(self, id: str):
        del self.active_connections[id]

    async def send_message(self, id: str, message: str):
        websocket = self.active_connections[id]
        await websocket.send_text(message)

    def get_websocket(self, id: str):
        return self.active_connections[id]


def positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError(f"must be 1 or more, got {value}")
    return number


def parse_arguments():
    parser = base_parser(
        "Lipsync Worker",
        default_port=5004,
        default_device="auto",
        device_help=(
            "Inference device: auto (OpenVINO selects a discrete GPU, then an "
            "integrated GPU, then the CPU), cpu, gpu, npu (default: auto)"
        ),
        source=True,
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help=(
            "Lipsync config YAML. Default: this instance's own copy "
            "(<instance-data-dir>/config.wav2lip.yaml), seeded on first run "
            "from the worker's shipped read-only template so each instance "
            "persists its own avatar selection instead of sharing (and "
            "overwriting) one file across instances."
        ),
    )
    parser.add_argument(
        "--ice_server",
        type=str,
        default="",
        help="WebRTC ICE Server URL (eg: turn:127.0.0.1:5901 or stun:stun.l.google.com:19302). If no scheme prefix, defaults to turn:.",
    )
    parser.add_argument(
        "--avatar_model",
        type=str,
        default=None,
        choices=["wav2lip", "musetalk"],
        help=(
            "Lipsync model (default: the config file's avatar_type, else "
            "wav2lip). MuseTalk needs a discrete GPU for realtime."
        ),
    )
    parser.add_argument(
        "--batch_size",
        type=positive_int,
        default=None,
        help=(
            "Frames per lipsync inference (default: the config file's "
            "batch_size, else 8 on the NPU and 16 on other devices). Smaller "
            "batches start talking sooner; larger ones can infer more frames "
            "per second."
        ),
    )
    parser.add_argument(
        "--int8",
        action=argparse.BooleanOptionalAction,
        default=None,
        help=(
            "Use an INT8 (NNCF-quantized) model. Defaults to True on CPU, NPU "
            "and integrated GPUs (FP16 can't sustain 25fps there) and False "
            "on other devices; for auto, on the device OpenVINO selects. Pass "
            "--no-int8 to force FP16."
        ),
    )
    parser.add_argument(
        "--frame_gen_url",
        type=str,
        default=None,
        help=(
            "Base URL of the frame generation service (default: the running "
            "Frame Generation instance, looked up through the app). Frame "
            "generation is requested per lipsync request "
            "(frame_generation=true); it only activates when Wav2Lip "
            "inference alone cannot match the avatar video FPS, and "
            "requires the frame generation service to be running. The "
            "interpolation device is configured on that service."
        ),
    )
    args = parser.parse_args()

    if args.config is None:
        # Each instance gets its own copy of the read-only template, so instances don't
        # overwrite each other's wav2lip.avatar_path.
        instance_config = INSTANCE_DIR / "config.wav2lip.yaml"
        if not instance_config.exists():
            shutil.copyfile(WORKER_DIR / "config.wav2lip.yaml", instance_config)
        args.config = str(instance_config)

    return args


# Shared by all instances under <repo>/models/wav2lip (see worker_common.paths.models_dir).
CHECKPOINT_PATH = str(models_dir("wav2lip", "checkpoints", "wav2lipv2.pth"))
OV_FP16_PATH = str(models_dir("wav2lip", "checkpoints", "wav2lipv2_ov", "wav2lip.xml"))
OV_INT8_PATH = str(models_dir("wav2lip", "checkpoints", "wav2lipv2_ov_int8", "wav2lip.xml"))
# Held while the shared checkpoint is fetched, converted, quantized or deleted.
WAV2LIP_LOCK = models_dir("wav2lip", "checkpoints", ".prepare")
OV_DEVICES = {"cpu", "gpu", "npu", "auto"}

# Inference FPS is measured at startup so a per-request frame_generation flag works any time.
# The plan also needs the frame generation service, which may start later, so it is built
# lazily by ensure_frame_gen_plan when not reachable at startup.
frame_gen_state = {"plan": None, "context": None, "url": None, "lock": Lock()}


def download_wav2lip_checkpoint(source: str):
    """Fetch the Wav2Lip PyTorch checkpoint if not already present."""
    getLogger(__name__).info("Downloading Wav2Lip models if needed...")
    fetch_snapshot(
        "Kedreamix/Linly-Talker",
        models_dir("wav2lip"),
        source=source,
        allow_patterns=["checkpoints/wav2lipv2.pth"],
    )
    getLogger(__name__).info("Wav2Lip models ready.")


def ensure_openvino_model():
    """Convert the PyTorch checkpoint to OpenVINO FP16 IR (idempotent)."""
    from convert_to_openvino import convert_wav2lip_to_openvino

    convert_wav2lip_to_openvino(
        checkpoint_path=CHECKPOINT_PATH,
        output_path=OV_FP16_PATH,
        img_size=256,
        batch_size=16,
    )
    getLogger(__name__).info("OpenVINO Wav2Lip model ready.")


def ensure_default_avatar(args) -> str:
    conf_path = Path(args.config).resolve()
    if not conf_path.exists():
        return ""

    with open(conf_path) as f:
        config = yaml.safe_load(f) or {}
    avatar_path = config.get("wav2lip", {}).get("avatar_path", "")

    if avatar_path:
        full_path = Path(avatar_path).resolve()
        if full_path.exists() and (full_path / "coords.pkl").exists():
            getLogger(__name__).info(f"Avatar found at {full_path}")
            return avatar_path

    getLogger(__name__).info(
        "Avatar not found or invalid. Generating default avatar..."
    )
    # Read-only sample shipped with the worker; seeds each instance's default avatar.
    video_path = WORKER_DIR / "data" / "samples" / "sample_video_ai.mp4"
    if not video_path.exists():
        getLogger(__name__).error(
            f"Cannot generate avatar. Missing video: {video_path}"
        )
        return avatar_path

    generate_wav2lip_avatar(
        video_path=str(video_path),
        frame_count=128,
        device=args.device,
        img_size=256,
        batch_size=1,
        no_smooth=False,
        pads=(0, 0, 0, 0),
        base_avatar_dir=avatar_dir,
        skin_name=None,
        wav2lip_config_path=conf_path,
        avatar_id="sample",
    )
    getLogger(__name__).info("Avatar generation completed.")
    with open(conf_path) as f:
        return (
            (yaml.safe_load(f) or {}).get("wav2lip", {}).get("avatar_path", avatar_path)
        )


def ensure_int8_model(avatar_path: str):
    if Path(OV_INT8_PATH).exists():
        getLogger(__name__).info("INT8 quantized model already exists, skipping.")
        return

    getLogger(__name__).info("Generating INT8 quantized model via NNCF...")
    from convert_to_openvino import quantize_wav2lip_to_int8

    quantize_wav2lip_to_int8(
        fp16_model_path=OV_FP16_PATH,
        output_path=OV_INT8_PATH,
        avatar_path=avatar_path,
        img_size=256,
        batch_size=16,
    )
    getLogger(__name__).info("INT8 quantized model ready.")


def preload_ov_model(args):

    from modules.lipsync.wav2lip.wav2lip_avatar import compile_wav2lip_model

    try:
        with open(Path(args.config).resolve()) as f:
            cfg = yaml.safe_load(f) or {}
    except Exception as e:
        getLogger(__name__).warning(f"Skipping model preload; cannot read config: {e}")
        return

    avatar_path = cfg.get("wav2lip", {}).get("avatar_path", "")
    if not avatar_path:
        getLogger(__name__).warning("Skipping model preload; no avatar_path in config.")
        return

    # Match the exact parameters WebRTCAvatar derives so the cache key lines up.
    batch_size = lipsync_batch_size(args, cfg)
    image_size = int(str(avatar_path).split("_")[-1])
    model_path = OV_FP16_PATH
    if args.int8 and Path(OV_INT8_PATH).exists():
        model_path = OV_INT8_PATH

    getLogger(__name__).info(
        "Precompiling Wav2Lip model for faster first connection..."
    )
    compile_wav2lip_model(model_path, args.device, batch_size, image_size)


def setup_frame_generation(args):
    """Measure Wav2Lip inference FPS and, if the frame generation service is up, build the plan now."""
    from modules.base.constants import CONSTANTS
    from modules.frame_generation.planner import get_avatar_fps
    from modules.lipsync.wav2lip.wav2lip_avatar import measure_wav2lip_inference_fps

    try:
        with open(Path(args.config).resolve()) as f:
            cfg = yaml.safe_load(f) or {}
    except Exception as e:
        getLogger(__name__).warning(
            f"Skipping frame generation setup; cannot read config: {e}"
        )
        return

    avatar_path = cfg.get("wav2lip", {}).get("avatar_path", "")
    if not avatar_path:
        getLogger(__name__).warning(
            "Skipping frame generation setup; no avatar_path in config."
        )
        return

    batch_size = lipsync_batch_size(args, cfg)
    image_size = int(str(avatar_path).split("_")[-1])
    model_path = OV_FP16_PATH
    if args.int8 and Path(OV_INT8_PATH).exists():
        model_path = OV_INT8_PATH

    inference_fps = measure_wav2lip_inference_fps(
        model_path, args.device, batch_size, image_size
    )
    frame_gen_state["url"] = args.frame_gen_url
    frame_gen_state["context"] = {
        "avatar_type": "wav2lip",
        "avatar_fps": get_avatar_fps(avatar_path),
        "inference_fps": inference_fps,
        "batch_size": batch_size,
        "image_size": image_size,
        "max_output_fps": 1.0 / CONSTANTS.VIDEO_PTIME,
        "model_path": model_path,
        "device": args.device,
    }

    ensure_frame_gen_plan()


def ensure_frame_gen_plan():
    """Return the frame generation plan, building it on first use.

    The frame generation service may start after this worker, so a missing plan is retried per
    request; once built (enabled or not) it is kept.
    """
    from modules.frame_generation.client import check_frame_gen_service
    from modules.frame_generation.planner import plan_frame_generation

    with frame_gen_state["lock"]:
        if frame_gen_state["plan"] is not None:
            return frame_gen_state["plan"]

        ctx = frame_gen_state["context"]
        if ctx is None:
            # Startup measurement was skipped (non-OpenVINO device or missing
            # config); frame generation cannot be planned.
            return None

        client = check_frame_gen_service(frame_gen_state["url"])
        if client is None:
            return None

        plan = plan_frame_generation(
            client=client,
            avatar_fps=ctx["avatar_fps"],
            inference_fps=ctx["inference_fps"],
            batch_size=ctx["batch_size"],
            image_size=ctx["image_size"],
            max_output_fps=ctx["max_output_fps"],
        )
        if plan.enabled:
            # Precompile the keyframe-batch model so the first frame-generated batch doesn't wait.
            if ctx["avatar_type"] == "musetalk":
                from modules.lipsync.musetalk.musetalk_models import (
                    get_shared_musetalk_inference,
                )

                get_shared_musetalk_inference(ctx["device"], len(plan.keyframes))
            else:
                from modules.lipsync.wav2lip.wav2lip_avatar import (
                    get_shared_inference,
                )

                get_shared_inference(
                    ctx["model_path"],
                    ctx["device"],
                    len(plan.keyframes),
                    ctx["image_size"],
                )
        frame_gen_state["plan"] = plan
        return plan


def apply_frame_generation(streamer, requested):
    """Toggle frame generation for the session's next utterance; return whether it is active."""
    plan = ensure_frame_gen_plan() if requested else None
    active = streamer.avatar.set_frame_generation(requested, plan)
    if requested and not active:
        if plan is None:
            reason = (
                "the frame generation service is unreachable or frame "
                "generation setup was skipped at startup"
            )
        elif not plan.enabled:
            reason = (
                "inference alone already matches the avatar frame rate "
                f"({plan.inference_fps:.1f} vs {plan.target_fps:.1f} FPS; "
                f"frame generation benchmarked at {plan.framegen_fps:.1f} "
                "FPS, 0 interpolated frames needed)"
            )
        else:
            reason = "the avatar model does not support frame generation"
        getLogger(__name__).warning(
            f"Frame generation was requested but is not active: {reason}."
        )
    return active


def auto_selected_device() -> str:
    """The device OpenVINO's AUTO plugin selects on this machine.

    AUTO only picks at compile time, so this compiles a one-op model; the pick depends only on
    precision, so Wav2Lip later lands on the same device.
    """
    import numpy as np
    import openvino as ov
    import openvino.opset13 as ops

    try:
        probe = ops.parameter([1], np.float32)
        model = ov.Model([ops.relu(probe)], [probe], "auto_probe")
        compiled = ov.Core().compile_model(
            model, "AUTO", worker_common.openvino_compile_config("AUTO")
        )
    except Exception as e:
        getLogger(__name__).warning(f"Could not ask OpenVINO what AUTO selects: {e}")
        return "AUTO"
    return worker_common.openvino_execution_device(compiled, "AUTO")


def default_int8(device: str) -> bool:
    """Whether --int8 defaults on: CPU, NPU and iGPUs, where FP16 Wav2Lip can't sustain 25 fps.

    Core Ultra 9 285K iGPU: FP16 ~39 ms/frame, INT8 ~14 ms, 46 dB PSNR apart; Arc Pro B60 FP16
    ~1.4 ms. For ``auto``, decides for the device AUTO selects.
    """
    kind = device.upper().split(".")[0]
    if kind == "AUTO":
        device = auto_selected_device()
        getLogger(__name__).info(f"OpenVINO AUTO selects {device}")
        kind = device.upper().split(".")[0]
    if kind in ("CPU", "NPU"):
        return True
    if kind != "GPU":
        return False
    import openvino as ov
    import openvino.properties.device as ov_device

    try:
        device_type = ov.Core().get_property(device.upper(), ov_device.type)
    except Exception:
        return False
    return device_type == ov_device.Type.INTEGRATED


def lipsync_batch_size(args, cfg) -> int:
    """Frames per lipsync inference: --batch_size, else the config's, else the device default."""
    from modules.lipsync.lipsync_avatar import default_batch_size

    return args.batch_size or cfg.get("batch_size") or default_batch_size(args.device)


def get_avatar_type(args) -> str:
    if getattr(args, "avatar_model", None):
        return args.avatar_model
    try:
        with open(Path(args.config).resolve()) as f:
            cfg = yaml.safe_load(f) or {}
        return cfg.get("avatar_type", "wav2lip")
    except Exception:
        return "wav2lip"


def initialize_musetalk_models(args):
    """Prepare the MuseTalk models and default avatar, and measure FPS for frame generation."""
    from modules.base.constants import CONSTANTS
    from modules.frame_generation.planner import get_avatar_fps
    from modules.lipsync.musetalk.musetalk_models import (
        FACE_SIZE,
        ensure_musetalk_openvino_models,
        get_shared_whisper_encoder,
        measure_musetalk_inference_fps,
    )

    if args.int8:
        getLogger(__name__).warning(
            "INT8 is not available for MuseTalk yet; using FP16."
        )

    if args.device.lower().split(".")[0] == "npu":
        # MuseTalk's batch-16 VAE decoder never finishes compiling on the NPU (>9 min on AI Boost,
        # OpenVINO 2026.2); AUTO leaves the NPU out unless named.
        getLogger(__name__).warning(
            "MuseTalk is not supported on the NPU (its VAE decoder does not "
            "compile there); using AUTO instead (OpenVINO selects the device)."
        )
        args.device = "auto"

    ensure_musetalk_openvino_models(source=args.source)
    avatar_path = ensure_default_avatar(args)
    if not avatar_path:
        getLogger(__name__).warning("Skipping MuseTalk preload; no avatar available.")
        return

    with open(Path(args.config).resolve()) as f:
        cfg = yaml.safe_load(f) or {}
    batch_size = lipsync_batch_size(args, cfg)

    getLogger(__name__).info(
        "Precompiling MuseTalk models for faster first connection..."
    )
    get_shared_whisper_encoder(args.device)
    inference_fps = measure_musetalk_inference_fps(args.device, batch_size)

    frame_gen_state["url"] = args.frame_gen_url
    frame_gen_state["context"] = {
        "avatar_type": "musetalk",
        "avatar_fps": get_avatar_fps(avatar_path),
        "inference_fps": inference_fps,
        "batch_size": batch_size,
        "image_size": FACE_SIZE,
        "max_output_fps": 1.0 / CONSTANTS.VIDEO_PTIME,
        "model_path": None,
        "device": args.device,
    }

    ensure_frame_gen_plan()

    # The default avatar's crops and latents take minutes on CPU: start them in the background,
    # after the FPS measurement they would slow down.
    from modules.lipsync.musetalk.musetalk_latents import musetalk_latents_job

    musetalk_latents_job(avatar_path, args.device)


def _migrate_legacy_models():
    """Move old `WORKER_DIR/models/<name>` dirs to `<repo>/models/<name>`, for both models."""
    for name in ("wav2lip", "musetalk"):
        message = migrate_legacy_models_dir(WORKER_DIR / "models" / name, models_dir(name))
        if message:
            getLogger(__name__).info(message)


def initialize_models(args):
    _migrate_legacy_models()
    warm_up_resampler()

    if get_avatar_type(args) == "musetalk":
        initialize_musetalk_models(args)
        return

    # Accept indexed device names like GPU.1 (multi-GPU systems).
    is_ov = args.device.lower().split(".")[0] in OV_DEVICES

    with shared_model_lock(WAV2LIP_LOCK):
        # OpenVINO needs the checkpoint only to convert it (then deletes it): refetch only if
        # nothing is converted yet.
        fetched_to_convert = False
        if not is_ov or not Path(OV_FP16_PATH).exists():
            fetched_to_convert = is_ov and not Path(CHECKPOINT_PATH).exists()
            download_wav2lip_checkpoint(args.source)
        if is_ov:
            ensure_openvino_model()

    avatar_path = ensure_default_avatar(args)

    if is_ov and args.int8:
        with shared_model_lock(WAV2LIP_LOCK):
            ensure_int8_model(avatar_path)

    if is_ov:
        # Delete the checkpoint only if this start fetched it: an instance on a PyTorch device
        # may be using one that was already here.
        if fetched_to_convert:
            with shared_model_lock(WAV2LIP_LOCK):
                Path(CHECKPOINT_PATH).unlink(missing_ok=True)
            getLogger(__name__).info(f"Deleted original checkpoint: {CHECKPOINT_PATH}")

        preload_ov_model(args)

        setup_frame_generation(args)


def create_app(args):
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        getLogger(__name__).info("Starting lifespan...")
        try:
            initialize_models(args)
            app.state.ready = True
            getLogger(__name__).info("Startup complete; server is ready.")
        except Exception as e:
            getLogger(__name__).error(f"Error in lifespan startup: {e}")
            exit(1)
        yield

    # The demo page talks WebRTC to this worker directly, possibly from another LAN device.
    # /healthcheck is readiness-gated, so it is this worker's own.
    allowed_origins = lan_origins(8080)
    app = worker_common.create_app(
        "Lipsync Worker", lifespan=lifespan, healthcheck=False, allow_origins=allowed_origins
    )
    # Not ready until lifespan startup (model download/convert/quantize) finishes.
    app.state.ready = False

    getLogger(__name__).info(f"CORS configured for origins: {allowed_origins}")

    return app


def validate_video(video_path: str) -> str:
    try:
        with av.open(video_path) as container:
            vstreams = [s for s in container.streams if s.type == "video"]
            if not vstreams:
                raise ValueError("No video stream detected")

            v0 = vstreams[0]
            codec_name = (v0.codec_context.name or "").strip()
            if not codec_name:
                raise ValueError("Video codec not identifiable")
            return codec_name
    except Exception as e:
        raise ValueError(f"Invalid or unsupported video: {e}") from e


def save_upload(source, destination: Path):
    """Copy an upload's spooled file to ``destination`` in chunks."""
    with open(destination, "wb") as f:
        shutil.copyfileobj(source, f, 1024 * 1024)


# Statuses an avatar job ends with.
AVATAR_TASK_FINAL = {"finished", "error", CANCELLED}

# Avatar job stages in order: (share of progress, message). Face detection and MuseTalk's
# landmark pass dominate.
AVATAR_STAGES = {
    "extracting": (1, "Extracting frames from the video ({done} of {total})"),
    "detecting": (6, "Finding the face in each frame ({done} of {total})"),
    "saving": (1, "Saving face crops ({done} of {total})"),
    "musetalk": (6, "Preparing MuseTalk face crops ({done} of {total})"),
}
# What a stage that reports nothing done yet is busy with.
AVATAR_STAGE_LOADING = {
    "detecting": "Loading the face detector",
    "musetalk": "Loading the MuseTalk landmark model",
}


# Guards `tasks` records and moving avatar jobs between queued, running and finished.
tasks_lock = RLock()
# Cancel tokens of unfinished avatar jobs by task id; jobs not yet picked up by their thread are
# the ones missing from `avatar_started`.
avatar_cancels: dict[str, CancelToken] = {}
avatar_started: set[str] = set()


def update_task(task_id, **fields):
    # Replaced, never mutated in place: the job runs in a worker thread while
    # the status endpoints read (and encode) the record on the event loop.
    with tasks_lock:
        tasks[task_id] = {**tasks.get(task_id, {}), **fields}


def remove_partial_avatar(task_id):
    """Remove what an avatar job that did not finish left on disk: its skin
    directory (the uploaded video, frames, face crops) and upload staging."""
    partial = avatar_dir / f"wav2lip_avatar_{task_id}_256"
    if partial.is_dir():
        shutil.rmtree(partial, ignore_errors=True)
    upload_dir = samples_dir / task_id
    if upload_dir.is_dir():
        shutil.rmtree(upload_dir, ignore_errors=True)


def cancel_avatar_task(task_id):
    """Cancel an avatar job and return its record (None if unknown).

    An unstarted job is dropped and ``cancelled`` at once; a running one gets ``cancel_requested``
    and stops before its next frame.
    """
    with tasks_lock:
        record = tasks.get(task_id)
        cancel = avatar_cancels.get(task_id)
        if record is None or cancel is None:
            return record
        cancel.cancel()
        if task_id in avatar_started:
            update_task(task_id, cancel_requested=True)
            return tasks[task_id]
        # Its thread, when it comes, finds the request and does not start.
        del avatar_cancels[task_id]
    remove_partial_avatar(task_id)
    update_task(task_id, status=CANCELLED, cancel_requested=True, message="Cancelled")
    return tasks[task_id]


def run_avatar_generation(
    taskId,
    video_path,
    cfg_path,
    skin_name=None,
    device="cpu",
    avatar_type="wav2lip",
    cancel=None,
):
    cancel = cancel or CancelToken()
    with tasks_lock:
        if cancel.cancelled:  # cancelled before it started
            return
        avatar_cancels[taskId] = cancel
        avatar_started.add(taskId)

    stages = ["extracting", "detecting", "saving"]
    if avatar_type == "musetalk":
        stages.append("musetalk")
    weight = sum(AVATAR_STAGES[stage][0] for stage in stages)
    starts, start = {}, 0
    for stage in stages:
        starts[stage] = start
        start += AVATAR_STAGES[stage][0]

    def report(stage, done, total):
        share, message = AVATAR_STAGES[stage]
        fraction = min(done / total, 1.0) if total else 0.0
        update_task(
            taskId,
            stage=stage,
            progress=round((starts[stage] + share * fraction) / weight, 3),
            message=(
                AVATAR_STAGE_LOADING.get(stage, message)
                if done == 0
                else message
            ).format(done=done, total=total),
        )

    update_task(taskId, status="processing")
    try:
        avatar_id = generate_wav2lip_avatar(
            video_path=str(video_path),
            frame_count=128,
            device=device,
            img_size=256,
            batch_size=1,
            avatar_id=taskId,
            no_smooth=False,
            pads=(0, 0, 0, 0),
            base_avatar_dir=avatar_dir,
            skin_name=skin_name,
            wav2lip_config_path=cfg_path,
            on_progress=report,
            cancel=cancel,
            # Not until the MuseTalk crops below are ready too: a job
            # cancelled meanwhile must not leave the default pointing at the
            # skin it removes.
            make_default=False,
        )

        if avatar_type == "musetalk":
            # MuseTalk crops around landmarks, not detector boxes. Computing them now spares the first
            # session the wait; a session computes them itself if this fails.
            report("musetalk", 0, 0)
            try:
                from modules.lipsync.musetalk.musetalk_face_prep import (
                    ensure_musetalk_coords,
                )

                ensure_musetalk_coords(
                    avatar_dir / avatar_id,
                    device,
                    lambda done, total: report("musetalk", done, total),
                    cancel,
                )
            except JobCancelled:
                raise
            except Exception as e:
                getLogger(__name__).warning(
                    f"Could not prepare MuseTalk face crops for {avatar_id}: {e}"
                )

        with tasks_lock:
            # The last point it can be cancelled at: past it, it is an avatar.
            cancel.check()
            avatar_cancels.pop(taskId, None)
        set_default_avatar(cfg_path, avatar_dir / avatar_id)

        update_task(
            taskId,
            status="finished",
            avatar_id=avatar_id,
            skin_name=skin_name,
            stage="done",
            progress=1.0,
            message="Avatar ready",
        )

    except JobCancelled:
        getLogger(__name__).info(f"Avatar generation {taskId} cancelled")
        # Removed before the job reports cancelled, so a client refreshing
        # the avatar list then no longer sees the half-made skin.
        remove_partial_avatar(taskId)
        update_task(taskId, status=CANCELLED, message="Cancelled")

    except Exception as e:
        getLogger(__name__).exception("Avatar generation failed")
        update_task(taskId, status="error", detail=str(e) or repr(e))
        remove_partial_avatar(taskId)

    finally:
        with tasks_lock:
            avatar_cancels.pop(taskId, None)
            avatar_started.discard(taskId)


SKIN_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


def setup_routes(
    app: FastAPI, pcs: set, avatars: dict, manager: WSConnectionManager, args
):
    # Per session: serializes /v1/lipsync/chat utterances (see chat()).
    chat_locks: dict[str, asyncio.Lock] = {}

    def resolve_skin_dir(skin_id: str) -> Path:
        """Validate a skin id and return its directory, guarding traversal."""
        if not SKIN_ID_RE.fullmatch(skin_id):
            raise HTTPException(status_code=400, detail="Invalid skin id")
        skin_path = (avatar_dir / skin_id).resolve()
        if skin_path.parent != avatar_dir.resolve() or not skin_path.is_dir():
            raise HTTPException(status_code=404, detail="Skin not found")
        return skin_path

    def get_default_skin() -> str | None:
        """Read the active skin folder name from the wav2lip config."""
        try:
            cfg_path = Path(args.config).resolve()
            if cfg_path.exists():
                with cfg_path.open() as f:
                    data = yaml.safe_load(f) or {}
                avatar_path = data.get("wav2lip", {}).get("avatar_path", "")
                if avatar_path:
                    return Path(avatar_path).name
        except Exception as e:
            getLogger(__name__).warning(f"Could not resolve default skin: {e}")
        return None

    @app.get("/healthcheck")
    async def healthcheck():
        # Report healthy only after startup (incl. INT8 quantization) completes.
        if not getattr(app.state, "ready", False):
            return JSONResponse({"status": "initializing"}, status_code=503)
        return JSONResponse({"status": "ok"})

    @app.websocket("/ws/{session_id}")
    async def websocket_endpoint(websocket: WebSocket, session_id: str):
        await manager.connect(session_id, websocket)
        try:
            while True:
                data = await websocket.receive_text()
        except:
            manager.disconnect(session_id)

    @app.post("/v1/lipsync/chat")
    async def chat(chat: Chat):
        session_id = chat.session_id

        if not session_id in avatars.keys():
            return JSONResponse({"status": "invalid session id"})

        if chat.chat_type == "echo":
            # Keeps utterances in arrival order across the thread hop below (asyncio.Lock wakes
            # waiters in order).
            async with chat_locks.setdefault(session_id, asyncio.Lock()):
                # Building the plan on first use benchmarks the interpolator,
                # so keep it off the event loop.
                frame_gen_active = await asyncio.to_thread(
                    apply_frame_generation, avatars[session_id], chat.frame_generation
                )
                if session_id not in avatars:
                    return JSONResponse({"status": "invalid session id"})
                avatars[session_id].echo(
                    chat.text, chat.voice, chat.model, chat.speed, chat.tts_url
                )
            return JSONResponse(
                {"status": "success", "frame_generation": frame_gen_active}
            )

        elif chat.chat_type == "clear":
            avatars[session_id].llm_clear_history()

        elif chat.chat_type == "stop":
            avatars[session_id].llm_stop_response()

        return JSONResponse({"status": "success"})

    @app.post("/v1/lipsync/stop")
    async def stop(chat_opt: ChatOption):
        session_id = chat_opt.session_id

        try:
            if chat_opt.chat_type == "stop":
                avatars[session_id].llm_stop_response()
        except:
            return JSONResponse({"status": "session id not found"})

        return JSONResponse({"status": "success"})

    @app.post("/v1/lipsync")
    async def audio_lipsync(
        file: UploadFile = File(...),
        session_id: str = Form(...),
        text_overlay: str = Form(None),
        language_code: str = Form("en-US"),
        frame_generation: bool = Form(False),
    ):
        if not session_id or session_id not in avatars:
            raise HTTPException(status_code=400, detail="Invalid or missing session_id")

        if not file.filename.lower().endswith((".wav", ".mp3")):
            raise HTTPException(
                status_code=400,
                detail="Unsupported audio format. Please use WAV, MP3",
            )

        try:
            audio_data = await file.read()
            audio_buffer = io.BytesIO(audio_data)

            # Decoding (and resampling) a whole file blocks for a while.
            audio_array, sample_rate = await asyncio.to_thread(
                librosa.load,
                audio_buffer,
                sr=16000,
                mono=True,
            )

            getLogger(__name__).info(
                f"Loaded audio: duration={len(audio_array)/sample_rate:.2f}s, samples={len(audio_array)}"
            )

            avatar_streamer = avatars[session_id]

            metadata = None
            if text_overlay:
                metadata = {"message": text_overlay, "language_code": language_code}

            # Off the event loop, as in chat().
            frame_gen_active = await asyncio.to_thread(
                apply_frame_generation, avatar_streamer, frame_generation
            )
            avatar_streamer.process_audio(audio_array, metadata)

            return JSONResponse(
                {
                    "status": "success",
                    "session_id": session_id,
                    "frame_generation": frame_gen_active,
                    "audio_info": {
                        "filename": file.filename,
                        "duration_seconds": len(audio_array) / sample_rate,
                        "sample_rate": sample_rate,
                        "samples": len(audio_array),
                        "has_text_overlay": text_overlay is not None,
                    },
                    "message": "Audio processing started, check WebRTC stream for output",
                }
            )

        except Exception as e:
            getLogger(__name__).error(f"Error processing audio file: {str(e)}")
            raise HTTPException(
                status_code=500, detail=f"Error processing audio: {str(e)}"
            )

    @app.post("/v1/avatar")
    async def upload_avatar(
        background: BackgroundTasks,
        video: UploadFile = File(...),
        session_id: str = Form(None),  # optional; uploads don't need a session
        skin_name: str = Form(None),
    ):
        if not video or not video.filename:
            raise HTTPException(status_code=400, detail="Missing video file")

        skin_id = uuid4().hex[:8]
        skin_dir = (avatar_dir / f"wav2lip_avatar_{skin_id}_256").resolve()
        skin_dir.mkdir(parents=True, exist_ok=True)
        suffix = re.sub(r"[^A-Za-z0-9.]", "", Path(video.filename).suffix) or ".mp4"
        video_path = skin_dir / f"source{suffix.lower()}"

        # Copying a large upload and probing it with PyAV both block; the
        # event loop they would stall carries every session's signaling.
        await asyncio.to_thread(save_upload, video.file, video_path)

        cfg_path = Path(args.config).resolve().as_posix()

        try:
            await asyncio.to_thread(validate_video, str(video_path))
        except Exception as e:
            getLogger(__name__).error(f"Fail to process video: {e}")
            await asyncio.to_thread(shutil.rmtree, skin_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="Invalid or unsupported video")

        cancel = CancelToken()
        with tasks_lock:
            tasks[skin_id] = {
                "status": "processing",
                "avatar_id": skin_id,
                "skin_name": skin_name,
                "stage": "queued",
                "progress": 0.0,
                "message": "Waiting to start",
            }
            avatar_cancels[skin_id] = cancel
        background.add_task(
            run_avatar_generation,
            taskId=skin_id,
            video_path=str(video_path),
            cfg_path=cfg_path,
            skin_name=skin_name,
            device=args.device,
            avatar_type=get_avatar_type(args),
            cancel=cancel,
        )
        return JSONResponse({"taskId": skin_id})

    @app.get("/v1/tasks/{taskId}")
    async def task_status(taskId: str):
        return tasks.get(taskId, {"status": "not_found"})

    @app.delete("/v1/tasks/{taskId}")
    async def cancel_task(taskId: str):
        """Cancel an avatar job and return its status (404 if unknown)."""
        # Dropping a queued job removes its upload from disk.
        status = await asyncio.to_thread(cancel_avatar_task, taskId)
        if status is None:
            return JSONResponse({"status": "not_found"}, status_code=404)
        return status

    @app.get("/v1/tasks/{taskId}/events")
    async def task_events(taskId: str):
        """Stream the avatar job's status as Server-Sent Events until it finishes."""
        return sse_response(
            watch_status(
                lambda: tasks.get(taskId),
                lambda status: status.get("status") in AVATAR_TASK_FINAL,
            )
        )

    @app.get("/v1/avatar")
    async def list_avatar_skins():
        items = []
        for d in avatar_dir.iterdir():
            if not d.is_dir():
                continue
            if not (d / "coords.pkl").exists():
                continue
            skin = {"skin_id": d.name}
            cfg = d / "config.json"
            if cfg.exists():
                try:
                    meta = json.loads(cfg.read_text(encoding="utf-8"))
                    if meta.get("skin_name"):
                        skin["skin_name"] = meta["skin_name"]
                except Exception:
                    pass
            items.append(skin)

        return {"items": items, "default_skin": get_default_skin()}

    @app.get("/v1/avatar/{skin_id}/preview")
    async def avatar_preview(skin_id: str):
        """Serve a cached JPEG thumbnail of the skin's first full frame."""
        skin_path = resolve_skin_dir(skin_id)
        thumb = skin_path / "preview.jpg"
        if not thumb.exists():
            import cv2

            frames = sorted((skin_path / "full_images").glob("*.[pj][np]g"))
            if not frames:
                raise HTTPException(status_code=404, detail="No preview available")
            img = cv2.imread(str(frames[0]))
            if img is None:
                raise HTTPException(status_code=404, detail="No preview available")
            h, w = img.shape[:2]
            scale = 320.0 / max(h, w)
            if scale < 1:
                img = cv2.resize(img, (int(w * scale), int(h * scale)))
            cv2.imwrite(str(thumb), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return FileResponse(thumb, media_type="image/jpeg")

    @app.delete("/v1/avatar/{skin_id}")
    async def delete_avatar_skin(skin_id: str):
        skin_path = resolve_skin_dir(skin_id)
        if skin_id == get_default_skin():
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the active skin. Switch to another skin first.",
            )

        shutil.rmtree(skin_path)

        match = re.fullmatch(r"wav2lip_avatar_(.+)_\d+", skin_id)
        if match:
            upload_id = match.group(1)
            tasks.pop(upload_id, None)
            samples_root = samples_dir.resolve()
            source_dir = (samples_root / upload_id).resolve()
            if source_dir.parent == samples_root and source_dir.is_dir():
                shutil.rmtree(source_dir)
                getLogger(__name__).info(f"Deleted uploaded source video: {source_dir}")

        getLogger(__name__).info(f"Deleted avatar skin: {skin_id}")
        return {"status": "success", "skin_id": skin_id}

    @app.patch("/v1/avatar/default")
    async def set_default_skin(req: Request):
        try:
            body = await req.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Body must be a JSON object")

        avatar_id = body.get("avatarId")
        avatar_path = avatar_dir / avatar_id
        avatar_path = str(avatar_path)

        if not avatar_path and avatar_id:
            try:
                base = avatar_dir if isinstance(avatar_dir, Path) else Path(avatar_dir)
                avatar_path = str((base / avatar_id).resolve())
            except Exception as e:
                getLogger(__name__).error(
                    f"Failed to resolve avatar path from avatar_id: {e}"
                )
                raise HTTPException(
                    status_code=400,
                    detail="Could not resolve avatar_path from avatar_id",
                )

        if not avatar_path or not isinstance(avatar_path, str):
            raise HTTPException(
                status_code=400, detail="avatar_id or avatar_path is required"
            )

        target_dir = Path(avatar_path)
        if not (target_dir.exists() and target_dir.is_dir()):
            raise HTTPException(
                status_code=400, detail=f"Avatar folder does not exist: {avatar_path}"
            )
        if not (target_dir / "coords.pkl").exists():
            raise HTTPException(
                status_code=400,
                detail="Avatar is incomplete (missing coords.pkl); cannot be used.",
            )

        cfg_path = args.config if isinstance(args.config, Path) else Path(args.config)
        if not cfg_path.parent.exists():
            cfg_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if cfg_path.exists():
                with cfg_path.open("r", encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
            else:
                data = None
        except Exception as e:
            getLogger(__name__).error(f"Failed to read YAML: {e}")
            raise HTTPException(status_code=500, detail="Failed to read YAML config")

        if not isinstance(data, dict):
            data = {}

        wav2lip_node = data.get("wav2lip")
        if not isinstance(wav2lip_node, dict):
            wav2lip_node = {}
            data["wav2lip"] = wav2lip_node

        wav2lip_node["avatar_path"] = avatar_path

        try:
            with cfg_path.open("w", encoding="utf-8") as f:
                yaml.safe_dump(
                    data,
                    f,
                    allow_unicode=True,
                    sort_keys=False,
                    default_flow_style=False,
                )
            getLogger(__name__).info(f"Updated wav2lip.avatar_path -> {avatar_path}")
        except Exception as e:
            getLogger(__name__).error(f"Failed to write YAML: {e}")
            raise HTTPException(status_code=500, detail="Failed to save default skin")

        # Hot-reload the skin into live sessions so it applies without a WebRTC reconnect.
        reloaded, failed = [], []
        for sid, streamer in list(avatars.items()):
            try:
                await asyncio.to_thread(streamer.avatar.reload_avatar, avatar_path)
                reloaded.append(sid)
            except Exception as e:
                getLogger(__name__).error(f"Hot-reload failed for session {sid}: {e}")
                failed.append(sid)

        return {
            "status": "success",
            "avatar_path": avatar_path,
            "avatar_id": avatar_id,
            "reloaded_sessions": reloaded,
            "failed_sessions": failed,
        }

    @app.post("/v1/lipsync/prepare")
    async def prepare_avatar():
        """Prepare MuseTalk's avatar crops and latents, streaming SSE ``status`` events until ready."""

        def ready():
            yield sse_event({"status": "ready"}, event="status")

        if get_avatar_type(args) != "musetalk":
            return sse_response(ready())
        with open(Path(args.config).resolve()) as f:
            avatar_path = (yaml.safe_load(f) or {}).get("wav2lip", {}).get("avatar_path", "")
        if not avatar_path:
            # Nothing to prepare; the offer says what is missing.
            return sse_response(ready())

        from modules.lipsync.musetalk.musetalk_latents import musetalk_latents_job

        job = musetalk_latents_job(avatar_path, args.device)
        return sse_response(
            watch_status(job.status, lambda status: status["status"] != "preparing")
        )

    async def stop_avatar(session_id: str):
        """End a session's streaming threads, off the event loop since joining can take a while."""
        avatar = avatars.pop(session_id, None)
        if avatar is not None:
            await asyncio.to_thread(avatar.stop)

    @app.post("/v1/lipsync/offer", include_in_schema=False)
    async def offer(request: Request):
        params = await request.json()

        offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

        sanitized_config_path = Path(args.config).resolve()
        if sanitized_config_path.is_file() == False:
            return JSONResponse(
                {"error": f"Config file {sanitized_config_path} not found"}
            )
        with open(sanitized_config_path) as f:
            configs = yaml.safe_load(f)

        # --avatar_model and --batch_size override the config file.
        configs["avatar_type"] = get_avatar_type(args)
        configs["batch_size"] = lipsync_batch_size(args, configs)

        session_id = configs.get("session_id", "")
        if session_id == "":
            session_id = str(uuid4())[:4]

        session_id = str(session_id)
        getLogger(__name__).info(f"Running with Session Id: {session_id}")

        ice_server_url = args.ice_server

        if ice_server_url:
            if not re.match(r"^(stuns?|turns?):", ice_server_url, re.IGNORECASE):
                ice_server_url = f"turn:{ice_server_url}"

            getLogger(__name__).info(f"Using ICE Server: {ice_server_url}")

            is_turn = re.match(r"^turns?:", ice_server_url, re.IGNORECASE)
            ice_server = RTCIceServer(
                urls=ice_server_url,
                **(
                    {
                        "username": "dummy",
                        "credential": "dummy",
                    }
                    if is_turn
                    else {}
                ),
            )

            pc = RTCPeerConnection(
                configuration=RTCConfiguration(iceServers=[ice_server])
            )
        else:
            pc = RTCPeerConnection()

        pcs.add(pc)

        @pc.on("connectionstatechange")
        async def on_connectionstatechange():
            getLogger(__name__).info(f"Avatar {session_id} is {pc.connectionState}")
            if pc.connectionState == "failed":
                getLogger(__name__).error(
                    f"WebRTC connection failed for Avatar {session_id}"
                )
                await pc.close()
                pcs.discard(pc)
                chat_locks.pop(session_id, None)
                await stop_avatar(session_id)
            elif pc.connectionState == "closed":
                getLogger(__name__).info(
                    f"WebRTC connection closed for Avatar {session_id}"
                )
                pcs.discard(pc)
                chat_locks.pop(session_id, None)
                await stop_avatar(session_id)
            elif pc.connectionState == "connected":
                getLogger(__name__).info(
                    f"WebRTC connection successfully established for Avatar {session_id}"
                )
                # Start producing frames only now: earlier, a backlog builds that delays every
                # later utterance. Idempotent.
                avatar_streamer.start()

        @pc.on("icegatheringstatechange")
        async def on_icegatheringstatechange():
            getLogger(__name__).info(
                f"Avatar {session_id} ICE gathering state: {pc.iceGatheringState}"
            )

        @pc.on("iceconnectionstatechange")
        async def on_iceconnectionstatechange():
            getLogger(__name__).info(
                f"Avatar {session_id} ICE connection state: {pc.iceConnectionState}"
            )
            if pc.iceConnectionState == "failed":
                getLogger(__name__).error(
                    f"ICE connection failed for Avatar {session_id}"
                )

        @pc.on("icecandidate")
        async def on_icecandidate(candidate):
            if candidate:
                getLogger(__name__).debug(
                    f"Avatar {session_id} ICE candidate: {candidate}"
                )
            else:
                getLogger(__name__).debug(
                    f"Avatar {session_id} ICE candidate gathering complete"
                )

        # Loading the model and avatar frames takes seconds or more; off the event loop so other
        # sessions' signaling isn't frozen.
        try:
            avatar_streamer = await asyncio.to_thread(
                WebRTCAvatar,
                session_id,
                configs=configs,
                device=args.device,
                ws_manager=manager,
                use_int8=args.int8,
                frame_gen_plan=frame_gen_state["plan"],
            )
        except Exception:
            await pc.close()
            pcs.discard(pc)
            raise
        audio, video = avatar_streamer.get_av_tracks()
        _ = pc.addTrack(audio)
        _ = pc.addTrack(video)
        # The stream starts from on_connectionstatechange("connected"); audio
        # posted before that just waits in the input queue.

        avatars[session_id] = avatar_streamer

        capabilities = RTCRtpSender.getCapabilities("video")
        preferences = list(filter(lambda x: x.name == "H264", capabilities.codecs))
        preferences += list(filter(lambda x: x.name == "VPX", capabilities.codecs))

        transceiver = pc.getTransceivers()[1]
        transceiver.setCodecPreferences(preferences)

        await pc.setRemoteDescription(offer)
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        # aiortc gathers candidates (incl. TURN relay) after setLocalDescription; answering
        # before gathering completes can drop relay candidates and fail ICE.
        if pc.iceGatheringState != "complete":
            _gathered = asyncio.Event()

            @pc.on("icegatheringstatechange")
            async def _on_gather_complete():
                if pc.iceGatheringState == "complete":
                    _gathered.set()

            try:
                await asyncio.wait_for(_gathered.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                getLogger(__name__).warning(
                    f"ICE gathering timed out for session {session_id}"
                )

        return JSONResponse(
            {
                "sdp": pc.localDescription.sdp,
                "type": pc.localDescription.type,
                "session_id": session_id,
            }
        )


def main():
    args = parse_arguments()

    # AUTO stays AUTO: the models compile on it and OpenVINO picks the device.
    if args.int8 is None:
        args.int8 = default_int8(args.device)
    getLogger(__name__).info(
        f"Inference device={args.device}, precision={'INT8' if args.int8 else 'FP16'}"
    )

    pcs = set()
    avatars = {}
    manager = WSConnectionManager()

    app = create_app(args)
    setup_routes(app, pcs, avatars, manager, args)

    getLogger(__name__).info(f"Starting Avatar server on port {args.port}")
    serve(app, args)


if __name__ == "__main__":
    main()
