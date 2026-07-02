# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import glob
import time
import logging
import argparse
import tempfile
from typing import Dict, Optional

import numpy as np
import soundfile as sf
from pydub import AudioSegment

import uvicorn
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from piper.config import SynthesisConfig

from download_utils import ensure_voice
from ov_piper import OVPiperVoice, load_ov_voice
from schemas import OpenAISpeechRequest

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Any Piper voice code from rhasspy/piper-voices is supported (all languages);
# voices are downloaded on demand. This default is only used to warm up at start.
# A voice code looks like <lang>_<REGION>-<name>-<quality>, e.g. en_US-lessac-medium.
DEFAULT_VOICE = "en_US-lessac-medium"


class PiperTTSService:
    """Loads Piper voices and runs synthesis through native OpenVINO IR."""

    def __init__(self, device: str = "CPU", source: str = "huggingface"):
        self.device = device.upper()
        self.source = source
        self.model_dir: Optional[str] = None
        self._voices: Dict[str, OVPiperVoice] = {}
        self._backend_label = "OpenVINO IR"

    def initialize(self):
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))
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

        # Download the ONNX model + config into <project>/models/tts/piper, then
        # convert to OpenVINO IR (.xml/.bin) alongside it.
        model_path, config_path = ensure_voice(voice, self.model_dir, self.source)
        ir_path = os.path.join(self.model_dir, f"{voice}.xml")

        ov_voice, used_device = load_ov_voice(
            model_path, config_path, ir_path, self.device
        )
        self._backend_label = f"OpenVINO IR ({used_device})"
        self._voices[voice] = ov_voice
        return ov_voice

    def synthesize(self, request: OpenAISpeechRequest):
        """Synthesize speech and return (audio_float_array, sample_rate)."""
        voice = self.get_voice(request.voice)

        # OpenAI speed (1.0 normal, >1 faster) -> Piper length_scale (inverse).
        syn_config = SynthesisConfig(
            length_scale=1.0 / request.speed,
            volume=request.volume_multiplier,
        )

        start = time.time()
        chunks = [
            chunk.audio_float_array
            for chunk in voice.synthesize(request.input, syn_config=syn_config)
            if chunk.audio_float_array is not None and chunk.audio_float_array.size
        ]
        infer_time = time.time() - start

        if not chunks:
            raise HTTPException(status_code=500, detail="No audio generated")

        audio = np.concatenate(chunks)
        sample_rate = voice.config.sample_rate

        duration = len(audio) / sample_rate
        logger.info(
            "Synthesized %.2fs of audio in %.3fs (RTF=%.3f) via %s",
            duration,
            infer_time,
            infer_time / duration if duration else 0.0,
            self._backend_label,
        )
        return audio, sample_rate


def _convert_audio_format(
    audio_np: np.ndarray, sample_rate: int, format_type: str
) -> bytes:
    """Convert a float32 audio array in [-1, 1] to the requested format bytes."""
    audio_np = audio_np.squeeze().astype(np.float32)

    if format_type.lower() == "pcm":
        audio_int16 = (audio_np * 32767).clip(-32768, 32767).astype(np.int16)
        return audio_int16.tobytes()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    temp_dir = os.path.join(script_dir, "temp")
    os.makedirs(temp_dir, exist_ok=True)

    tmp_wav_fd, tmp_wav_path = tempfile.mkstemp(suffix=".wav", dir=temp_dir)
    try:
        os.close(tmp_wav_fd)
    except Exception:
        pass

    tmp_out_path = None
    try:
        sf.write(tmp_wav_path, audio_np, sample_rate, subtype="PCM_16")

        if format_type.lower() == "wav":
            with open(tmp_wav_path, "rb") as f:
                return f.read()

        tmp_out_fd, tmp_out_path = tempfile.mkstemp(
            suffix=f".{format_type}", dir=temp_dir
        )
        try:
            os.close(tmp_out_fd)
        except Exception:
            pass

        audio_seg = AudioSegment.from_wav(tmp_wav_path)
        audio_seg.export(tmp_out_path, format=format_type)

        with open(tmp_out_path, "rb") as f:
            return f.read()
    finally:
        for p in (tmp_wav_path, tmp_out_path):
            try:
                if p and os.path.exists(p):
                    os.unlink(p)
            except Exception:
                pass


def _get_media_type(format_type: str) -> str:
    """Return the MIME type for a given audio format."""
    format_map = {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "flac": "audio/flac",
        "opus": "audio/opus",
        "pcm": "audio/pcm",
    }
    return format_map.get(format_type.lower(), "audio/mpeg")


def setup_environment():
    """Add the bundled ffmpeg to PATH so pydub can export non-WAV formats."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))
    ffmpeg_path = os.path.join(project_root, "thirdparty", "ffmpeg", "bin")
    os.environ["PATH"] = ffmpeg_path + os.pathsep + os.environ.get("PATH", "")


def create_app(tts_service: PiperTTSService) -> FastAPI:
    app = FastAPI(
        title="Piper TTS API",
        description="OpenAI-compatible Text-to-Speech API using Piper + OpenVINO",
        version="1.0.0",
    )

    allowed_origins = [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthcheck")
    async def healthcheck():
        return JSONResponse({"status": "ok"})

    @app.get("/v1/audio/voices")
    async def list_voices():
        """Report which Piper voices are downloaded (cached) locally.

        Any voice code from rhasspy/piper-voices is supported and downloaded on
        demand, so rather than enumerate the full catalog we return the voices
        already present on disk. The frontend keeps the full catalog and treats
        any voice missing from this map as not-yet-downloaded.
        """
        cached = {}
        if tts_service.model_dir:
            for path in glob.glob(os.path.join(tts_service.model_dir, "*.onnx")):
                voice = os.path.basename(path)[: -len(".onnx")]
                cached[voice] = True
        return cached

    @app.post("/v1/audio/speech")
    async def create_speech(request: OpenAISpeechRequest):
        try:
            audio, sample_rate = tts_service.synthesize(request)
            audio_bytes = _convert_audio_format(
                audio, sample_rate, request.response_format
            )
            media_type = _get_media_type(request.response_format)
            headers = {
                "Content-Disposition": f"attachment; filename=speech.{request.response_format}",
                "Cache-Control": "no-cache",
            }

            if request.stream:
                def audio_stream():
                    chunk_size = 9600
                    for i in range(0, len(audio_bytes), chunk_size):
                        yield audio_bytes[i : i + chunk_size]

                return StreamingResponse(
                    audio_stream(), media_type=media_type, headers=headers
                )

            return Response(content=audio_bytes, media_type=media_type, headers=headers)
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            logger.error("Speech generation failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to generate speech")

    return app


def parse_arguments():
    parser = argparse.ArgumentParser(description="Piper TTS FastAPI Server (OpenVINO)")
    parser.add_argument(
        "--port", type=int, default=5005, help="Port to serve on (default: 5005)"
    )
    parser.add_argument(
        "--device",
        type=str,
        default="CPU",
        help="OpenVINO device for inference: CPU, GPU, NPU, AUTO (default: CPU)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="huggingface",
        choices=["huggingface", "modelscope"],
        help="Source to download voices from (default: huggingface)",
    )
    return parser.parse_args()


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
    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    exit(main())
