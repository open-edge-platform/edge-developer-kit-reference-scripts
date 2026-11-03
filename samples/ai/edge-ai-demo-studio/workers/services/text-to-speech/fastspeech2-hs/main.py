# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Fastspeech2_HS (IIT Madras) Tamil text-to-speech on OpenVINO: the female and male voices.

Each voice (FastSpeech2 + HiFi-GAN) becomes one IR on first start (ov_fastspeech2, from the
ESPnet-free modules in fastspeech2.py); tamil_frontend turns text into phones.
"""

import threading
from typing import Iterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import Field

from model_downloader import fetch_snapshot, fetch_url
from ov_fastspeech2 import Voice, ensure_ir
from tamil_frontend import TamilFrontend
import worker_common
from worker_common import (
    add_ffmpeg_to_path,
    base_parser,
    get_logger,
    install_models_routes,
    install_openai_errors,
    lan_origins,
    models_dir,
    normalize_openvino_device,
    serve,
)
from worker_common.speech import Piece, SpeechRequest, retime, speech_response, split_sentences

logger = get_logger(__name__)

MODEL_ID = "fastspeech2-hs"
REPO = "smtiitm/Fastspeech2_HS"
REVISION = "d4fe7ccfcb71f668bc25d54e97ebbef57d17a9f3"
# Voice -> its acoustic model and vocoder in the repository. Upstream's
# inference.py pairs every language with the "aryan" vocoder of the gender.
VOICES = {
    "tamil_female": ("tamil/female/model", "vocoder/female/aryan/hifigan"),
    "tamil_male": ("tamil/male/model", "vocoder/male/aryan/hifigan"),
}
DEFAULT_VOICE = "tamil_female"
# Speed comes from shorter predicted durations up to this, the rest from a time stretch: at 2x the
# durations blurred the phones (Whisper small lost most words) while 1.5x stayed clean.
MAX_DURATION_SPEED = 1.5
# Hugging Face serves a different female vocoder (55,786,428 bytes) than its LFS pointer names
# (55,829,161 bytes, this sha256), which the hub client rejects; GitHub has the right file.
GITHUB_FILES = {
    "vocoder/female/aryan/hifigan/generator": (
        "https://raw.githubusercontent.com/smtiitm/Fastspeech2_HS/"
        "ca4a01bae7314340545d3e558b876b11880a926b/vocoder/female/aryan/hifigan/generator",
        "c0b25fa8a73884c92187aaead427fd413d02788d0d1acda3023f0a280c396cc4",
        55829161,
    ),
}
DOWNLOAD = [
    *(f"{model}/{f}" for model, _ in VOICES.values() for f in ("config.yaml", "model.pth")),
    *(f"{vocoder}/{f}" for _, vocoder in VOICES.values() for f in ("config.json", "generator")),
    "phone_dict/tamil",
    "phone_dict/english",
    "ssn_parser_new/lists/*",
]
DOWNLOAD = [path for path in DOWNLOAD if path not in GITHUB_FILES]


class FastSpeech2SpeechRequest(SpeechRequest):
    model: str = Field(default=MODEL_ID, description="The model: fastspeech2-hs.")
    voice: str = Field(default=DEFAULT_VOICE, description="One of GET /v1/audio/voices.")


class FastSpeech2Service:
    def __init__(self, device: str, source: str):
        # CPU unless another device is named: on a GPU every new sentence length recompiles,
        # slower than real time. AUTO goes to OpenVINO as is.
        self.device = normalize_openvino_device(device, default="CPU")
        self.source = source
        self.voices: dict[str, Voice] = {}
        self.frontend: TamilFrontend | None = None
        # A compiled model serves one call at a time; requests take turns
        # sentence by sentence (worker_common.speech.measured).
        self.lock = threading.Lock()

    def initialize(self) -> None:
        root = models_dir("tts", MODEL_ID, REPO)
        fetch_snapshot(REPO, root, source=self.source, revision=REVISION, allow_patterns=DOWNLOAD)
        for path, (url, sha256, size) in GITHUB_FILES.items():
            target = root / path
            # fetch_url keeps any non-empty file; replace one of the wrong size.
            stale = target.is_file() and target.stat().st_size != size
            fetch_url(url, dest=target, sha256=sha256, force=stale)
        for voice, (model, vocoder) in VOICES.items():
            ir = ensure_ir(root / model, root / vocoder, root / "openvino" / f"{voice}.xml")
            self.voices[voice] = Voice(ir, root / model, self.device)
        self.frontend = TamilFrontend(root)
        logger.info("Fastspeech2_HS loaded on %s; warming up", self.device)
        for voice in self.voices:
            for _ in self.synthesize("வணக்கம்.", voice, 1.0):
                pass

    def synthesize(self, text: str, voice: str, speed: float) -> Iterator[Piece]:
        """Speech for ``text``, one sentence per model call."""
        model = self.voices[voice]
        duration_speed = min(speed, MAX_DURATION_SPEED)
        for sentence in split_sentences(text):
            phones = self.frontend(sentence)
            if not phones:  # nothing speakable, e.g. punctuation alone
                continue
            # The duration predictor's scale: above 1 is slower.
            piece = model(phones, 1.0 / duration_speed), model.sample_rate
            yield retime(piece, speed / duration_speed)


def create_app(service: FastSpeech2Service) -> FastAPI:
    app = worker_common.create_app(
        "Fastspeech2_HS TTS API",
        description="OpenAI-compatible Text-to-Speech API: Fastspeech2_HS Tamil on OpenVINO",
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
    async def create_speech(request: FastSpeech2SpeechRequest):
        if request.voice not in VOICES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported voice: {request.voice}. Available voices: {', '.join(VOICES)}",
            )
        try:
            return await speech_response(
                service.synthesize(request.input, request.voice, request.speed),
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

    install_models_routes(app, [MODEL_ID], owned_by="smtiitm")
    install_openai_errors(app)
    return app


def main() -> int:
    args = base_parser(
        "Fastspeech2_HS Tamil TTS (OpenVINO)",
        default_port=5008,
        default_device="CPU",
        device_help=(
            "OpenVINO device for inference (AUTO: OpenVINO selects, a GPU "
            "when there is one). Default: CPU"
        ),
        source=True,
    ).parse_args()
    # ffmpeg encodes the non-WAV formats.
    add_ffmpeg_to_path()

    service = FastSpeech2Service(args.device, args.source)
    try:
        service.initialize()
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to initialize Fastspeech2_HS: %s", e)
        return 1

    logger.info("Starting Fastspeech2_HS server on port %s", args.port)
    serve(create_app(service), args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
