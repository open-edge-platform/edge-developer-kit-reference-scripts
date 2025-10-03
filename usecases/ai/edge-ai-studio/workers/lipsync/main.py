# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import yaml
import argparse
import socket

from uuid import uuid4
from aiortc import (
    RTCPeerConnection,
    RTCSessionDescription,
    RTCIceServer,
    RTCConfiguration,
)
from aiortc.rtcrtpsender import RTCRtpSender

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel
from typing import Optional

from modules.base.logger import getLogger
from modules.webrtc_avatar import WebRTCAvatar

from pathlib import Path
import psutil

# import aiortc.codecs.vpx
# aiortc.codecs.vpx.MIN_BITRATE = 15000000
# aiortc.codecs.vpx.DEFAULT_BITRATE = 100000000
# aiortc.codecs.vpx.MAX_BITRATE = 1500000000

# import aiortc.codecs.h264
# aiortc.codecs.h264.MIN_BITRATE = 15000000
# aiortc.codecs.h264.DEFAULT_BITRATE = 100000000
# aiortc.codecs.h264.MAX_BITRATE = 1500000000


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
    return parser.parse_args()


def create_app():
    """Create and configure FastAPI application."""
    app = FastAPI()

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

    @app.post("/chat")
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

    @app.post("/stop")
    async def stop(chat_opt: ChatOption):
        session_id = chat_opt.session_id

        try:
            if chat_opt.chat_type == "stop":
                avatars[session_id].llm_stop_response()
        except:
            return JSONResponse({"status": "session id not found"})

        return JSONResponse({"status": "success"})

    @app.post("/offer", include_in_schema=False)
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
            session_id, configs=configs, device=args.device, tts_port=args.tts_port
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
    import uvicorn

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
    app = create_app()

    # Setup routes
    setup_routes(app, pcs, avatars, manager, args)

    # Run the server
    port = int(args.port)
    getLogger(__name__).info(f"Starting Avatar server on port {port}")
    run_server(app, port)


if __name__ == "__main__":
    main()
