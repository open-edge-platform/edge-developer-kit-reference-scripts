# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import glob
import threading
from typing import Dict, Iterator, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from piper.config import SynthesisConfig

from download_utils import ensure_voice
from ov_piper import OVPiperVoice, load_ov_voice
from schemas import OpenAISpeechRequest
from worker_common.speech import Piece, speech_response
import worker_common
from worker_common import (
    add_ffmpeg_to_path,
    base_parser,
    get_logger,
    install_models_routes,
    install_openai_errors,
    serve,
)

logger = get_logger(__name__)

# Any rhasspy/piper-voices code (<lang>_<REGION>-<name>-<quality>) works, downloaded on demand;
# this default only warms up at start.
DEFAULT_VOICE = "en_US-lessac-medium"


class PiperTTSService:
    """Loads Piper voices and runs synthesis through native OpenVINO IR."""

    def __init__(self, device: str = "CPU", source: str = "huggingface"):
        self.device = device.upper()
        self.source = source
        self.model_dir: Optional[str] = None
        self._voices: Dict[str, OVPiperVoice] = {}
        self._backend_label = "OpenVINO IR"
        # A compiled model serves one call at a time, and a voice's first use downloads and converts
        # it; requests take turns sentence by sentence (worker_common.speech.measured).
        self.lock = threading.Lock()

    def initialize(self):
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = str(worker_common.project_root())
        model_dir = os.path.join(project_root, "models", "tts", "piper")
        os.makedirs(model_dir, exist_ok=True)
        self.model_dir = model_dir
        logger.info("Piper model directory: %s", model_dir)
        logger.info("Requested inference device: %s", self.device)
        logger.info("Model source: %s", self.source)

        # Preload (and warm up) the default voice so the first request is fast.
        voice = self.get_voice(DEFAULT_VOICE)
        try:
            logger.info("Warming up Piper voice '%s'...", DEFAULT_VOICE)
            list(voice.synthesize("Xin chào.", syn_config=SynthesisConfig()))
            logger.info("Warm-up complete (backend: %s)", self._backend_label)
        except Exception as e:  # noqa: BLE001 - warm-up failure is non-fatal
            logger.warning("Warm-up failed: %s", e)

    def get_voice(self, voice: str) -> OVPiperVoice:
        """Return a cached voice, downloading + converting to IR on first use."""
        if voice in self._voices:
            return self._voices[voice]

        if not self.model_dir:
            raise RuntimeError("PiperTTSService is not initialized")

        model_path, config_path = ensure_voice(voice, self.model_dir, self.source)
        ir_path = os.path.join(self.model_dir, f"{voice}.xml")

        ov_voice, used_device = load_ov_voice(
            model_path, config_path, ir_path, self.device
        )
        self._backend_label = f"OpenVINO IR ({used_device})"
        self._voices[voice] = ov_voice
        return ov_voice

    def synthesize(self, request: OpenAISpeechRequest) -> Iterator[Piece]:
        """Speech for ``request``, sentence by sentence; lazy, so the voice loads only once iterated."""
        voice = self.get_voice(request.voice)

        # OpenAI speed (1.0 normal, >1 faster) -> Piper length_scale (inverse).
        syn_config = SynthesisConfig(
            length_scale=1.0 / request.speed,
            volume=request.volume_multiplier,
        )

        sample_rate = voice.config.sample_rate
        for chunk in voice.synthesize(request.input, syn_config=syn_config):
            if chunk.audio_float_array is not None and chunk.audio_float_array.size:
                yield chunk.audio_float_array, sample_rate


def setup_environment():
    """Add the bundled ffmpeg to PATH; it encodes the non-WAV formats."""
    add_ffmpeg_to_path()


def create_app(tts_service: PiperTTSService) -> FastAPI:
    app = worker_common.create_app(
        "Piper TTS API",
        description="OpenAI-compatible Text-to-Speech API using Piper + OpenVINO",
        version="1.0.0",
        healthcheck=False,
        # Called straight from the demo page on the app's port.
        allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    )

    @app.get("/healthcheck")
    async def healthcheck():
        return JSONResponse({"status": "ok"})

    @app.get("/v1/audio/voices")
    async def list_voices():
        """Voices already on disk; any other catalog voice is downloaded on first use."""
        cached = {}
        if tts_service.model_dir:
            for path in glob.glob(os.path.join(tts_service.model_dir, "*.onnx")):
                voice = os.path.basename(path)[: -len(".onnx")]
                cached[voice] = True
        return cached

    @app.post("/v1/audio/speech")
    async def create_speech(request: OpenAISpeechRequest):
        """Speech streamed sentence by sentence (``stream`` or SSE), else the whole file."""
        try:
            return await speech_response(
                tts_service.synthesize(request),
                request.response_format,
                stream=request.stream,
                stream_format=request.stream_format,
                lock=tts_service.lock,
                headers={
                    "Content-Disposition": f"attachment; filename=speech.{request.response_format}",
                    "Cache-Control": "no-cache",
                },
            )
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            logger.error("Speech generation failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to generate speech")

    # A Piper voice is the model here, but OpenAI clients send `model: "piper"`; list that so a
    # client validating against GET /v1/models finds it.
    install_models_routes(app, ["piper"], owned_by="piper")
    install_openai_errors(app)

    return app


def parse_arguments():
    return base_parser(
        "Piper TTS FastAPI Server (OpenVINO)",
        default_port=5005,
        default_device="AUTO",
        device_help=(
            "OpenVINO device for inference: AUTO (OpenVINO selects: a discrete "
            "GPU, then an integrated GPU, then the CPU), CPU, GPU, NPU (default: AUTO)"
        ),
        source=True,
    ).parse_args()


def main():
    args = parse_arguments()
    setup_environment()

    logger.info("Initializing Piper TTS service...")
    tts_service = PiperTTSService(device=args.device, source=args.source)
    try:
        tts_service.initialize()
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to initialize Piper TTS service: %s", e)
        return 1

    app = create_app(tts_service)
    logger.info("Starting Piper TTS server on port %s", args.port)
    logger.info("Serving all rhasspy/piper-voices voices (downloaded on demand)")
    serve(app, args, log_level="info")
    return 0


if __name__ == "__main__":
    exit(main())
