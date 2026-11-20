# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Multilingual text-to-speech with cloned voices: Fun-CosyVoice3-0.5B (FunAudioLLM) on OpenVINO.

Each voice is cloned from a short recording in ``models/tts/cosyvoice3/voices`` (``<name>.wav``, optional
``<name>.txt`` transcript), dropped there or added with ``POST /v1/audio/voices``; the built-in one is upstream's
own sample speaker. The first start exports the model to
OpenVINO IR (ov_cosyvoice). CosyVoice 3 also reads Japanese, Korean, German, Spanish, French, Italian and
Russian, and Chinese text in the dialect a request names (ov_cosyvoice.DIALECTS).
"""

from __future__ import annotations

import threading
from typing import Iterator

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import Field

import ov_cosyvoice
import worker_common
from worker_common import (
    add_ffmpeg_to_path,
    base_parser,
    get_logger,
    install_models_routes,
    install_openai_errors,
    lan_origins,
    normalize_openvino_device,
    serve,
)
from worker_common.speech import Piece, SpeechRequest, retime, speech_response

logger = get_logger(__name__)

MODEL_ID = ov_cosyvoice.MODEL_ID
# CosyVoice stretches the mel spectrogram for the speed; beyond this range the audio is stretched afterwards.
NATIVE_SPEED = (0.5, 2.0)
# An added voice's recording, as the demo's drop zone allows.
MAX_VOICE_BYTES = 50 * 1024 * 1024


class CosyVoiceSpeechRequest(SpeechRequest):
    model: str = Field(default=MODEL_ID, description="The model: cosyvoice3.")
    voice: str = Field(default=ov_cosyvoice.DEFAULT_VOICE, description="One of GET /v1/audio/voices.")
    dialect: str | None = Field(
        default=None,
        description=f"Read Chinese text in a dialect: {', '.join(ov_cosyvoice.DIALECTS)}. Default: as written.",
    )


class CosyVoiceService:
    def __init__(self, device: str, source: str, flow_steps: int = 0):
        # AUTO goes to OpenVINO as is: it picks a discrete GPU, the only device this model runs faster than
        # real time on (the 10-step DiT is too much for a CPU or an integrated GPU).
        self.device = normalize_openvino_device(device, supported=("AUTO", "CPU", "GPU"))
        self.source = source
        self.flow_steps = flow_steps
        self.model: ov_cosyvoice.CosyVoiceTTS | None = None
        # One infer request per model: requests take turns piece by piece (worker_common.speech.measured).
        self.lock = threading.Lock()

    def initialize(self) -> None:
        self.model = ov_cosyvoice.CosyVoiceTTS(self.source, self.device, self.flow_steps)
        logger.info("CosyVoice 3 loaded (%s, %d flow steps); voices: %s; warming up", self.model.devices,
                    self.model.flow_steps, ", ".join(self.model.voices))
        for _ in self.synthesize("Hello.", ov_cosyvoice.DEFAULT_VOICE, 1.0):
            pass

    def synthesize(self, text: str, voice: str, speed: float, dialect: str | None = None) -> Iterator[Piece]:
        native = min(max(speed, NATIVE_SPEED[0]), NATIVE_SPEED[1])
        for audio in self.model.synthesize(text, voice, native, dialect):
            if audio.size:
                yield retime((audio, self.model.sample_rate), speed / native)


def create_app(service: CosyVoiceService) -> FastAPI:
    app = worker_common.create_app(
        "CosyVoice 3 TTS API",
        description="OpenAI-compatible Text-to-Speech API: Fun-CosyVoice3-0.5B with cloned voices on OpenVINO",
        healthcheck=False,
        # Called straight from the demo page on the app's port.
        allow_origins=lan_origins(8080),
    )

    @app.get("/healthcheck")
    async def healthcheck():
        model = service.model
        return JSONResponse({"status": "ok", "devices": model.devices if model else None,
                             "flow_steps": model.flow_steps if model else None})

    @app.get("/v1/audio/voices")
    async def list_voices():
        # Voices dropped into the folder since the start are encoded here (about a second each).
        with service.lock:
            service.model.refresh_voices()
        return {voice: True for voice in service.model.voices}

    # Plain `def`s: FastAPI runs them in its thread pool, so encoding a voice does not hold up other requests.
    @app.post("/v1/audio/voices", status_code=201)
    def add_voice(
        name: str = Form(description="The new voice's id: letters, digits, '-' and '_', up to 40."),
        file: UploadFile = File(description="A recording of one speaker, 3-10 s works best; any audio format."),
        transcript: str = Form(default="", description="What the recording says: zero-shot cloning, closest "
                               "likeness. Without one the voice is cloned cross-lingually."),
    ):
        if not ov_cosyvoice.VOICE_NAME.fullmatch(name):
            raise HTTPException(status_code=400, detail="A voice name is 1-40 letters, digits, '-' or '_', "
                                                        "starting with a letter or digit")
        if name == ov_cosyvoice.DEFAULT_VOICE:
            raise HTTPException(status_code=400, detail=f"{name} is the built-in voice; pick another name")
        audio = file.file.read(MAX_VOICE_BYTES + 1)
        if len(audio) > MAX_VOICE_BYTES:
            raise HTTPException(status_code=413, detail="The recording must be under 50 MB")
        try:
            with service.lock:
                seconds = service.model.add_voice(name, audio, transcript)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"voice": name, "transcript": bool(transcript.strip()), "seconds": round(seconds, 2)}

    @app.delete("/v1/audio/voices/{name}")
    def delete_voice(name: str):
        if name == ov_cosyvoice.DEFAULT_VOICE:
            raise HTTPException(status_code=400, detail=f"{name} is the built-in voice and cannot be removed")
        with service.lock:
            if name not in service.model.voices:
                raise HTTPException(status_code=404, detail=f"No voice named {name}")
            service.model.remove_voice(name)
        return {"voice": name, "deleted": True}

    @app.post("/v1/audio/speech")
    async def create_speech(request: CosyVoiceSpeechRequest):
        if request.voice not in service.model.voices:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported voice: {request.voice}. Available voices: {', '.join(service.model.voices)}",
            )
        if request.dialect is not None and request.dialect not in ov_cosyvoice.DIALECTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported dialect: {request.dialect}. Available dialects: {', '.join(ov_cosyvoice.DIALECTS)}",
            )
        try:
            return await speech_response(
                service.synthesize(request.input, request.voice, request.speed, request.dialect),
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

    install_models_routes(app, [MODEL_ID], owned_by="FunAudioLLM")
    install_openai_errors(app)
    return app


def main() -> int:
    parser = base_parser(
        "CosyVoice 3 TTS (OpenVINO)",
        default_port=5008,
        default_device="AUTO",
        device_help=(
            "OpenVINO device for the speech-token LLM and the flow-matching DiT (AUTO: OpenVINO selects, a "
            "discrete GPU when there is one); the vocoder runs on the CPU. Default: AUTO"
        ),
        source=True,
    )
    parser.add_argument(
        "--flow-steps",
        type=int,
        default=0,
        help="Euler steps of the flow-matching DiT (0, default: 10 on a discrete GPU, 5 elsewhere, for real time)",
    )
    args = parser.parse_args()
    # ffmpeg encodes the non-WAV formats and applies speeds beyond the model's own range.
    add_ffmpeg_to_path()

    service = CosyVoiceService(args.device, args.source, args.flow_steps)
    try:
        service.initialize()
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to initialize CosyVoice 3: %s", e)
        return 1

    logger.info("Starting CosyVoice 3 server on port %s", args.port)
    serve(create_app(service), args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
