# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""VieNeu-TTS v3 Turbo (Vietnamese): its int8 ONNX graphs on ONNX Runtime via the vendored engine.

Fastest measured on a Core Ultra 9 285K: 6.3x real time, vs 3x for the same graphs on OpenVINO (17
small graph calls per 80 ms frame, where per-call overhead dominates), 3.4x PyTorch on an Arc Pro B60.
"""

import os

# The engine samples codebooks in numpy between graph calls, and BLAS threads fight ONNX Runtime's
# for the cores (2.2x vs 6.3x real time). Set before numpy loads.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import json
import threading
from pathlib import Path
from typing import Iterator

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import Field

from model_downloader import fetch_snapshot
from vieneu._v3_turbo_engine.onnx_runtime_lite import OnnxV3LiteEngine
from vieneu_utils.core_utils import gaps_to_silence, pause_pad_samples, strip_encoder_pad_frame
from vieneu_utils.phonemize_text import normalize_to_chunks_v3_with_gaps, phonemize_text_with_emotions
import worker_common
from worker_common import (
    add_ffmpeg_to_path,
    base_parser,
    get_logger,
    install_models_routes,
    install_openai_errors,
    lan_origins,
    models_dir,
    serve,
)
from worker_common.speech import Piece, SpeechRequest, retime, speech_response

logger = get_logger(__name__)

MODEL_ID = "vieneu"
REPO = "pnnbao-ump/VieNeu-TTS-v3-Turbo"
REVISION = "61b85e3d937fbbacb387714180e8182823512523"
GRAPHS = "onnx_int8"
CODEC_REPO = "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"
CODEC_REVISION = "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae"
# The decoder only: the encoder is for cloning a voice from a recording.
CODEC_FILES = [
    "codec_browser_onnx_meta.json",
    "moss_audio_tokenizer_decode_full.onnx",
    "moss_audio_tokenizer_decode_shared.data",
    "moss_audio_tokenizer_decode_step.onnx",
]
SAMPLE_RATE = 48_000
# The longest text the engine is given at once (upstream's default).
MAX_CHUNK_CHARS = 256
VOICES_FILE = Path(__file__).parent / "vieneu" / "assets" / "voices_v3_turbo.json"


def _load_voices() -> tuple[dict[str, dict], dict[str, str], str]:
    """Preset voices, their old names and the default (as V3TurboVieNeuTTS._load_v3_voices)."""
    data = json.loads(VOICES_FILE.read_text(encoding="utf-8"))
    voices, aliases = {}, {}
    for name, preset in data["presets"].items():
        voices[name] = {
            "speaker_emb": np.asarray(preset["speaker_emb"], dtype=np.float32),
            "codes": strip_encoder_pad_frame(np.asarray(preset["codes"], dtype=np.int64)),
        }
        for alias in preset.get("aliases") or []:
            aliases[alias] = name
    return voices, aliases, data["default_voice"]


VOICES, VOICE_ALIASES, DEFAULT_VOICE = _load_voices()


class VieNeuSpeechRequest(SpeechRequest):
    model: str = Field(default=MODEL_ID, description="The model: vieneu.")
    voice: str = Field(default=DEFAULT_VOICE, description="One of GET /v1/audio/voices.")


def resolve_voice(name: str) -> str | None:
    if name in VOICES:
        return name
    return VOICE_ALIASES.get(name)


class VieNeuService:
    def __init__(self, source: str):
        self.source = source
        self.engine: OnnxV3LiteEngine | None = None
        # One generation at a time; requests take turns chunk by chunk (worker_common.speech.measured).
        self.lock = threading.Lock()

    def initialize(self) -> None:
        model_dir = models_dir("tts", MODEL_ID, REPO)
        codec_dir = models_dir("tts", MODEL_ID, CODEC_REPO)
        fetch_snapshot(REPO, model_dir, source=self.source, revision=REVISION, allow_patterns=[f"{GRAPHS}/*"])
        fetch_snapshot(CODEC_REPO, codec_dir, source=self.source, revision=CODEC_REVISION, allow_patterns=CODEC_FILES)
        # Local directories throughout, so the engine never asks the hub.
        self.engine = OnnxV3LiteEngine(
            checkpoint_path=str(model_dir),
            onnx_dir=str(model_dir / GRAPHS),
            codec_dir=str(codec_dir),
        )
        logger.info(
            "VieNeu-TTS v3 Turbo loaded (ONNX Runtime, %d threads, %d voices); warming up",
            self.engine.ort_intra_op_threads, len(VOICES),
        )
        for _ in self.synthesize("Xin chào.", DEFAULT_VOICE, 1.0):
            pass

    def synthesize(self, text: str, voice: str, speed: float) -> Iterator[Piece]:
        """Speech for ``text``, chunk by chunk with upstream's pauses between (V3TurboVieNeuTTS.infer)."""
        preset = VOICES[voice]
        chunks, gaps = normalize_to_chunks_v3_with_gaps(text, max_chars=MAX_CHUNK_CHARS)
        pauses = gaps_to_silence(gaps)
        previous = None
        for i, chunk in enumerate(chunks):
            wav = self.engine.infer(
                phonemes=phonemize_text_with_emotions(chunk),
                speaker_emb=preset["speaker_emb"],
                ref_codes=preset["codes"],
            )
            wav = np.asarray(wav, dtype=np.float32).reshape(-1)
            if not wav.size:
                continue
            piece = wav
            if previous is not None:
                pad = pause_pad_samples(previous, wav, SAMPLE_RATE, pauses[i - 1])
                piece = np.concatenate([np.zeros(pad, dtype=np.float32), wav])
            previous = wav
            # The model has no speed control of its own.
            yield retime((piece, SAMPLE_RATE), speed)


def create_app(service: VieNeuService) -> FastAPI:
    app = worker_common.create_app(
        "VieNeu-TTS API",
        description="OpenAI-compatible Text-to-Speech API: VieNeu-TTS v3 Turbo on ONNX Runtime",
        healthcheck=False,
        # Called straight from the demo page on the app's port.
        allow_origins=lan_origins(8080),
    )

    @app.get("/healthcheck")
    async def healthcheck():
        return JSONResponse({"status": "ok"})

    @app.get("/v1/audio/voices")
    async def list_voices():
        return {voice: True for voice in VOICES}

    @app.post("/v1/audio/speech")
    async def create_speech(request: VieNeuSpeechRequest):
        voice = resolve_voice(request.voice)
        if voice is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported voice: {request.voice}. Available voices: {', '.join(VOICES)}",
            )
        try:
            return await speech_response(
                service.synthesize(request.input, voice, request.speed),
                request.response_format,
                stream=request.stream,
                stream_format=request.stream_format,
                lock=service.lock,
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

    install_models_routes(app, [MODEL_ID], owned_by="pnnbao-ump")
    install_openai_errors(app)
    return app


def main() -> int:
    args = base_parser(
        "VieNeu-TTS v3 Turbo (ONNX Runtime)",
        default_port=5007,
        default_device="CPU",
        device_help="The CPU only: its int8 graphs run on ONNX Runtime's CPU provider",
        source=True,
    ).parse_args()
    if args.device.upper() not in ("CPU", "AUTO"):
        logger.warning("VieNeu-TTS runs on the CPU only; ignoring --device %s", args.device)
    # ffmpeg encodes the non-WAV formats and applies the speed.
    add_ffmpeg_to_path()

    service = VieNeuService(args.source)
    try:
        service.initialize()
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to initialize VieNeu-TTS: %s", e)
        return 1

    logger.info("Starting VieNeu-TTS server on port %s", args.port)
    serve(create_app(service), args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
