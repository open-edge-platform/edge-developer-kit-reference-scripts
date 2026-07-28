# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import shutil
import yaml
import argparse
import socket
import sys
import subprocess  # nosec -- used as a catch exception type only
import av
import re
from contextlib import asynccontextmanager

from huggingface_hub import snapshot_download
from modelscope import snapshot_download as ms_snapshot_download
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
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel
from typing import Optional
import librosa
import io
import uvicorn

from modules.base.logger import getLogger
from modules.webrtc_avatar import WebRTCAvatar
from modules.lipsync.wav2lip.wav2lip_avatar_generator import generate_wav2lip_avatar

from pathlib import Path
import psutil
import asyncio
from fastapi.responses import StreamingResponse

avatar_dir = Path("./data/avatars")
tasks = {}


class Chat(BaseModel):
    chat_type: str
    session_id: str
    text: str
    voice: Optional[str] = None
    model: Optional[str] = None
    speed: Optional[str] = None
    tts_url: Optional[str] = None


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


def get_local_ip():
    interfaces_stats = psutil.net_if_stats()
    interfaces_addrs = psutil.net_if_addrs()

    candidates = []

    for iface, stats in interfaces_stats.items():
        # Skip interfaces that are down
        if not stats.isup:
            continue

        # Skip loopback
        if iface.lower() == "lo" or iface.lower().startswith("loopback"):
            continue

        # Skip common virtual interfaces (VMware, Docker, Hyper-V, VirtualBox, etc.)
        if any(
            v in iface.lower()
            for v in [
                "vmware",
                "docker",
                "vbox",
                "virbr",
                "hyper-v",
                "br-",
                "tun",
                "tap",
                "wg",
            ]
        ):
            continue

        # Find IPv4 addresses for this interface
        for addr in interfaces_addrs.get(iface, []):
            if addr.family == socket.AF_INET:
                candidates.append((stats.speed, iface, addr.address))

    if not candidates:
        return None

    # Pick the interface with the highest speed
    best = max(candidates, key=lambda x: x[0])
    return best[2]


def parse_arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--config", type=str, default="config.wav2lip.yaml", help="Lipsync Config File"
    )
    parser.add_argument(
        "--ice_server",
        type=str,
        default="",
        help="WebRTC ICE Server URL (eg: turn:localhost:5901 or stun:stun.l.google.com:19302). If no scheme prefix, defaults to turn:.",
    )
    parser.add_argument(
        "--port",
        type=str,
        default="5004",
        help="Server port (default: 5004)",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        help="Inference Device (default: CPU)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="huggingface",
        choices=["huggingface", "modelscope"],
        help="Model source (default: huggingface)",
    )
    parser.add_argument(
        "--int8",
        action=argparse.BooleanOptionalAction,
        default=None,
        help=(
            "Use an INT8 (NNCF-quantized) model. Defaults to True on CPU and NPU "
            "(FP16 can't sustain 25fps there) and False on other devices. "
            "Pass --no-int8 to force FP16."
        ),
    )
    return parser.parse_args()


CHECKPOINT_PATH = "models/wav2lip/checkpoints/wav2lipv2.pth"
OV_FP16_PATH = "models/wav2lip/checkpoints/wav2lipv2_ov/wav2lip.xml"
OV_INT8_PATH = "models/wav2lip/checkpoints/wav2lipv2_ov_int8/wav2lip.xml"
OV_DEVICES = {"cpu", "gpu", "npu", "auto"}


def download_wav2lip_checkpoint(source: str):
    """Fetch the Wav2Lip PyTorch checkpoint if not already present."""
    getLogger(__name__).info("Downloading Wav2Lip models if needed...")
    download = ms_snapshot_download if source == "modelscope" else snapshot_download
    download(
        repo_id="Kedreamix/Linly-Talker",
        local_dir="models/wav2lip",
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
    video_path = Path("data/samples/sample_video_ai.mp4")
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
    batch_size = cfg.get("batch_size", 16)
    image_size = int(str(avatar_path).split("_")[-1])
    model_path = OV_FP16_PATH
    if args.int8 and Path(OV_INT8_PATH).exists():
        model_path = OV_INT8_PATH

    getLogger(__name__).info(
        "Precompiling Wav2Lip model for faster first connection..."
    )
    compile_wav2lip_model(model_path, args.device, batch_size, image_size)


def initialize_models(args):
    download_wav2lip_checkpoint(args.source)

    is_ov = args.device.lower() in OV_DEVICES
    if is_ov:
        ensure_openvino_model()

    avatar_path = ensure_default_avatar(args)

    if is_ov and args.int8:
        ensure_int8_model(avatar_path)

    # Remove the original PyTorch checkpoint once all conversions are done.
    if is_ov:
        pth_path = Path(CHECKPOINT_PATH)
        if pth_path.exists():
            pth_path.unlink()

        preload_ov_model(args)
        getLogger(__name__).info(f"Deleted original checkpoint: {CHECKPOINT_PATH}")


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

    app = FastAPI(lifespan=lifespan)
    # Not ready until lifespan startup (model download/convert/quantize) finishes.
    app.state.ready = False

    local_ip = get_local_ip()
    allowed_origins = [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        f"http://{local_ip}:8080",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

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


def run_avatar_generation(taskId, video_path, cfg_path, skin_name=None, device="cpu"):
    tasks[taskId] = "running"

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
        )

        tasks[taskId] = {
            "status": "finished",
            "avatar_id": avatar_id,
            "skin_name": skin_name,
        }

    except Exception as e:
        getLogger(__name__).exception("Avatar generation failed")
        tasks[taskId] = {"status": "error", "detail": str(e) or repr(e)}

        partial = avatar_dir / f"wav2lip_avatar_{taskId}_256"
        if partial.is_dir():
            shutil.rmtree(partial, ignore_errors=True)
        upload_dir = Path("./data/samples") / taskId
        if upload_dir.is_dir():
            shutil.rmtree(upload_dir, ignore_errors=True)


SKIN_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


def setup_routes(
    app: FastAPI, pcs: set, avatars: dict, manager: WSConnectionManager, args
):
    """Setup all FastAPI routes."""

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
            avatars[session_id].echo(
                chat.text, chat.voice, chat.model, chat.speed, chat.tts_url
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

            audio_array, sample_rate = librosa.load(
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

            avatar_streamer.process_audio(audio_array, metadata)

            return JSONResponse(
                {
                    "status": "success",
                    "session_id": session_id,
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

        with open(video_path, "wb") as f:
            f.write(await video.read())

        cfg_path = Path("config.wav2lip.yaml").resolve().as_posix()

        try:
            validate_video(str(video_path))
        except Exception as e:
            getLogger(__name__).error(f"Fail to process video: {e}")
            shutil.rmtree(skin_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="Invalid or unsupported video")

        tasks[skin_id] = {
            "status": "processing",
            "avatar_id": skin_id,
            "skin_name": skin_name,
        }
        background.add_task(
            run_avatar_generation,
            taskId=skin_id,
            video_path=str(video_path),
            cfg_path=cfg_path,
            skin_name=skin_name,
            device=args.device,
        )
        return JSONResponse({"taskId": skin_id})

    @app.get("/v1/tasks/{taskId}")
    async def task_status(taskId: str):
        return tasks.get(taskId, {"status": "not_found"})

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
            samples_root = Path("./data/samples").resolve()
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
                # Ensure avatar_dir is a Path
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

        # Hot-reload the new skin into any live sessions so the change applies
        # immediately, without requiring a WebRTC reconnect.
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
                if session_id in avatars:
                    avatars[session_id].stop()
                    del avatars[session_id]
            elif pc.connectionState == "closed":
                getLogger(__name__).info(
                    f"WebRTC connection closed for Avatar {session_id}"
                )
                pcs.discard(pc)
                if session_id in avatars:
                    avatars[session_id].stop()
                    del avatars[session_id]
            elif pc.connectionState == "connected":
                getLogger(__name__).info(
                    f"WebRTC connection successfully established for Avatar {session_id}"
                )

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

        avatar_streamer = WebRTCAvatar(
            session_id,
            configs=configs,
            device=args.device,
            ws_manager=manager,
            use_int8=args.int8,
        )
        audio, video = avatar_streamer.get_av_tracks()
        _ = pc.addTrack(audio)
        _ = pc.addTrack(video)
        avatar_streamer.start()

        avatars[session_id] = avatar_streamer

        capabilities = RTCRtpSender.getCapabilities("video")
        preferences = list(filter(lambda x: x.name == "H264", capabilities.codecs))
        preferences += list(filter(lambda x: x.name == "VPX", capabilities.codecs))

        transceiver = pc.getTransceivers()[1]
        transceiver.setCodecPreferences(preferences)

        await pc.setRemoteDescription(offer)
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        # Wait for the server's ICE gathering to complete before returning the
        # answer. aiortc gathers candidates (including TURN relay) asynchronously
        # after setLocalDescription, so without this wait the answer SDP may be
        # missing relay candidates and ICE connectivity checks will fail.
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


def run_server(app: FastAPI, port: int):
    uvicorn.run(app, host="0.0.0.0", port=port)


def main():
    args = parse_arguments()

    # Default to INT8 on CPU and NPU, where FP16 can't keep up with 25fps
    # streaming; other devices opt in with --int8. --int8/--no-int8 overrides this.
    if args.int8 is None:
        args.int8 = args.device.lower() in ("cpu", "npu")
    getLogger(__name__).info(
        f"Inference device={args.device}, precision={'INT8' if args.int8 else 'FP16'}"
    )

    pcs = set()
    avatars = {}
    manager = WSConnectionManager()

    app = create_app(args)
    setup_routes(app, pcs, avatars, manager, args)

    port = int(args.port)
    getLogger(__name__).info(f"Starting Avatar server on port {port}")
    run_server(app, port)


if __name__ == "__main__":
    main()
