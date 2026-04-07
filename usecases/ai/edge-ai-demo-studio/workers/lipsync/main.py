# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import yaml
import argparse
import socket
import sys
import subprocess  # nosec -- used as a catch exception type only
import av
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
from fastapi.responses import JSONResponse
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

# import aiortc.codecs.vpx
# aiortc.codecs.vpx.MIN_BITRATE = 15000000
# aiortc.codecs.vpx.DEFAULT_BITRATE = 100000000
# aiortc.codecs.vpx.MAX_BITRATE = 1500000000

# import aiortc.codecs.h264
# aiortc.codecs.h264.MIN_BITRATE = 15000000
# aiortc.codecs.h264.DEFAULT_BITRATE = 100000000
# aiortc.codecs.h264.MAX_BITRATE = 1500000000

avatar_dir = Path("./data/avatars")
tasks = {}


class Chat(BaseModel):
    chat_type: str
    session_id: str
    text: str
    voice: Optional[str]
    model: Optional[str]
    speed: Optional[str]


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
    """Parse command line arguments."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--config", type=str, default="config.wav2lip.yaml", help="Lipsync Config File"
    )
    parser.add_argument(
        "--turn_server",
        type=str,
        default="localhost:5901",
        help="WebRTC Turn Server (eg: localhost:5901)",
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
        "--tts_port",
        type=str,
        default="5002",
        help="TTS server port (default: 5002)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="huggingface",
        choices=["huggingface", "modelscope"],
        help="Model source (default: huggingface)",
    )
    return parser.parse_args()


def create_app(args):
    """Create and configure FastAPI application."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        getLogger(__name__).info("Starting lifespan...")
        try:
            getLogger(__name__).info("Downloading Wav2Lip models if needed...")
            download = (
                ms_snapshot_download
                if args.source == "modelscope"
                else snapshot_download
            )
            download(
                repo_id="Kedreamix/Linly-Talker",
                local_dir="models/wav2lip",
                allow_patterns=["checkpoints/wav2lipv2.pth"],
            )
            getLogger(__name__).info("Wav2Lip models ready.")

            # Avatar generation check
            conf_path = Path(args.config).resolve()
            if conf_path.exists():
                with open(conf_path) as f:
                    config = yaml.safe_load(f)

                avatar_path = config.get("wav2lip", {}).get("avatar_path", "")
                is_valid = False
                if avatar_path:
                    full_path = Path(avatar_path).resolve()
                    if full_path.exists() and (full_path / "coords.pkl").exists():
                        is_valid = True
                        getLogger(__name__).info(f"Avatar found at {full_path}")

                if not is_valid:
                    getLogger(__name__).info(
                        "Avatar not found or invalid. Generating default avatar..."
                    )
                    skin_id = uuid4().hex[:8]
                    video_path = Path("data/samples/sample_video_ai.mp4")
                    if video_path.exists():
                        generate_wav2lip_avatar(
                            video_path=str(video_path),
                            frame_count=128,
                            device="xpu",
                            img_size=256,
                            batch_size=1,
                            avatar_id=skin_id,
                            no_smooth=False,
                            pads=(0, 0, 0, 0),
                            base_avatar_dir=avatar_dir,
                            skin_name=None,
                            wav2lip_config_path=conf_path,
                        )
                        getLogger(__name__).info("Avatar generation completed.")
                    else:
                        getLogger(__name__).error(
                            f"Cannot generate avatar. Missing video: {video_path}"
                        )
        except Exception as e:
            getLogger(__name__).error(f"Error in lifespan startup: {e}")
            exit(1)
        yield

    app = FastAPI(lifespan=lifespan)

    # Get the current machine's IP address
    local_ip = get_local_ip()

    # Build the list of allowed origins
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


def run_avatar_generation(taskId, video_path, cfg_path, skin_name=None):
    tasks[taskId] = "running"

    try:
        avatar_id = generate_wav2lip_avatar(
            video_path=str(video_path),
            frame_count=128,
            device="xpu",
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
        getLogger(__name__).error(f"Avatar generation failed: {e}")
        tasks[taskId] = {"status": "error", "detail": str(e)}


def setup_routes(
    app: FastAPI, pcs: set, avatars: dict, manager: WSConnectionManager, args
):
    """Setup all FastAPI routes."""

    @app.get("/healthcheck")
    async def healthcheck():
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
            avatars[session_id].echo(chat.text, chat.voice, chat.model, chat.speed)

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
        """
        Endpoint for processing audio files directly for lipsync streaming.
        The audio and video are streamed back via WebRTC similar to the chat endpoint.
        """

        # Validate session
        if not session_id or session_id not in avatars:
            raise HTTPException(status_code=400, detail="Invalid or missing session_id")

        # Validate audio file
        if not file.filename.lower().endswith((".wav", ".mp3")):
            raise HTTPException(
                status_code=400,
                detail="Unsupported audio format. Please use WAV, MP3",
            )

        try:
            # Read and process audio file
            audio_data = await file.read()
            audio_buffer = io.BytesIO(audio_data)

            # Load audio with librosa (converts to mono, 16kHz)
            audio_array, sample_rate = librosa.load(
                audio_buffer,
                sr=16000,  # Target sample rate to match avatar expectations
                mono=True,
            )

            getLogger(__name__).info(
                f"Loaded audio: duration={len(audio_array)/sample_rate:.2f}s, samples={len(audio_array)}"
            )

            # Get avatar instance
            avatar_streamer = avatars[session_id]

            # Prepare metadata for text overlay if provided
            metadata = None
            if text_overlay:
                metadata = {"message": text_overlay, "language_code": language_code}

            # Process audio through the WebRTC avatar
            # This will queue the audio for lipsync processing and stream via WebRTC
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
        session_id: str = Form(...),
        skin_name: str = Form(None),
    ):
        if not session_id or session_id not in avatars:
            raise HTTPException(status_code=400, detail="Invalid or missing session_id")
        if not video or not video.filename:
            raise HTTPException(status_code=400, detail="Missing video file")

        skin_id = uuid4().hex[:8]
        samples_dir = Path("./data/samples").resolve() / skin_id
        samples_dir.mkdir(parents=True, exist_ok=True)
        video_path = samples_dir / video.filename

        with open(video_path, "wb") as f:
            f.write(await video.read())

        cfg_path = Path("config.wav2lip.yaml").resolve().as_posix()

        try:
            validate_video(str(video_path))
        except Exception as e:
            getLogger(__name__).error(f"Fail to process video: {e}")
            raise HTTPException(status_code=400, detail="Invalid or unsupported video")

        tasks[skin_id] = {
            "status": "finished",
            "avatar_id": skin_id,
            "skin_name": skin_name,
        }
        background.add_task(
            run_avatar_generation,
            taskId=skin_id,
            video_path=str(video_path),
            cfg_path=cfg_path,
            skin_name=skin_name,
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
        return {"items": items}

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
            return {
                "status": "success",
                "avatar_path": avatar_path,
                "avatar_id": avatar_id,
            }
        except Exception as e:
            getLogger(__name__).error(f"Failed to write YAML: {e}")
            raise HTTPException(status_code=500, detail="Failed to save default skin")

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

        turn_server = args.turn_server

        if params.get("turn", False) == True:
            getLogger(__name__).info(f"Using TURN Server: {turn_server}")
            ice_server = RTCIceServer(
                urls=f"turn:{turn_server}", username="dummy", credential="dummy"
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
            tts_port=args.tts_port,
            ws_manager=manager,
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

        return JSONResponse(
            {
                "sdp": pc.localDescription.sdp,
                "type": pc.localDescription.type,
                "session_id": session_id,
            }
        )


def run_server(app: FastAPI, port: int):
    """Run the FastAPI server."""
    uvicorn.run(app, host="0.0.0.0", port=port)


def main():
    """Main function to run the avatar server."""
    # Parse command line arguments
    args = parse_arguments()

    # Initialize global state
    pcs = set()
    avatars = {}
    manager = WSConnectionManager()

    # Create FastAPI application
    app = create_app(args)

    # Setup routes
    setup_routes(app, pcs, avatars, manager, args)

    # Run the server
    port = int(args.port)
    getLogger(__name__).info(f"Starting Avatar server on port {port}")
    run_server(app, port)


if __name__ == "__main__":
    main()
