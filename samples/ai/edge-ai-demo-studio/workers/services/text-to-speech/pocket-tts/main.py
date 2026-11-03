# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Pocket TTS Indonesian (anak10thn/pocket-tts-indonesian, 6-layer) on OpenVINO.

The first start exports the checkpoint to IR (ov_pocket). The model clones a short recording's voice;
the four Common Voice prompts the repository ships are the voices.
"""

import threading
from pathlib import Path
from typing import Iterator

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import Field

from model_downloader import fetch_file, fetch_snapshot
from ov_pocket import PocketTTS, ensure_export
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
    staged_model_file,
)
from worker_common.speech import Piece, SpeechRequest, retime, speech_response

logger = get_logger(__name__)

MODEL_ID = "pocket-tts"
REPO = "anak10thn/pocket-tts-indonesian"
# The repository at the revision that ships the voice prompts; the config
# pins its weights and tokenizer to revisions of their own.
REVISION = "382fe85ca848546efb04bf1b7fdba78c6396e2ce"
CONFIG_FILE = "indonesian_6l.yaml"
LOCAL_CONFIG_FILE = "indonesian_6l.local.yaml"
# The model card's end-of-speech threshold (pocket-tts defaults to -4.0, which
# the card measured dropping words).
EOS_THRESHOLD = -6.0
# Voice -> its prompt in the repository (CC0 Common Voice 22.0 clips). Female
# and male by the pitch of the speech generated from each.
VOICES = {
    "female_1": "voices/common_voice_id_20954552.mp3",
    "female_2": "voices/common_voice_id_20954811.mp3",
    "male_1": "voices/common_voice_id_19961910.mp3",
    "male_2": "voices/common_voice_id_22918082.mp3",
}
DEFAULT_VOICE = "female_1"


class PocketSpeechRequest(SpeechRequest):
    model: str = Field(default=MODEL_ID, description="The model: pocket-tts.")
    voice: str = Field(default=DEFAULT_VOICE, description="One of GET /v1/audio/voices.")


def _hf_path(uri: str) -> tuple[str, str, str | None]:
    """``hf://owner/repo/path/in/repo@revision`` as (repo, path, revision)."""
    rest, _, revision = uri.removeprefix("hf://").partition("@")
    owner, name, path = rest.split("/", 2)
    return f"{owner}/{name}", path, revision or None


def download(model_dir: Path, source: str) -> Path:
    """Fetch checkpoint, tokenizer and voice prompts into ``model_dir``; return a config pointing there."""
    fetch_snapshot(
        REPO, model_dir, source=source, revision=REVISION,
        allow_patterns=[CONFIG_FILE, *VOICES.values()],
    )
    config = yaml.safe_load((model_dir / CONFIG_FILE).read_text(encoding="utf-8"))
    lookup = config["flow_lm"]["lookup_table"]
    for holder, key in ((config, "weights_path"), (lookup, "tokenizer_path")):
        repo, path, revision = _hf_path(holder[key])
        holder[key] = str(fetch_file(repo, path, model_dir, source=source, revision=revision))
    local = model_dir / LOCAL_CONFIG_FILE
    with staged_model_file(str(local)) as staged:
        Path(staged).write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    return local


class PocketService:
    def __init__(self, device: str, source: str):
        # CPU unless another device is named: the GPU runs the one-frame-at-a-time loop at about a
        # fifth of the CPU's speed. AUTO goes to OpenVINO as is.
        self.device = normalize_openvino_device(device, default="CPU")
        self.source = source
        self.model: PocketTTS | None = None
        # One infer request holds the generation state; requests take turns
        # chunk by chunk (worker_common.speech.measured).
        self.lock = threading.Lock()

    def initialize(self) -> None:
        model_dir = models_dir("tts", MODEL_ID, REPO)
        config = download(model_dir, self.source)
        out_dir = model_dir / "openvino"
        prompts = {voice: str(model_dir / path) for voice, path in VOICES.items()}
        ensure_export(str(config), prompts, out_dir)
        self.model = PocketTTS(str(config), out_dir, list(VOICES), self.device)
        logger.info("Pocket TTS loaded on %s; warming up", self.device)
        for _ in self.synthesize("Selamat datang.", DEFAULT_VOICE, 1.0):
            pass

    def synthesize(self, text: str, voice: str, speed: float) -> Iterator[Piece]:
        """Speech for ``text``, one pocket-tts chunk (about a sentence) at a time."""
        model = self.model
        for prompt, frames_after_eos in model.chunks(text):
            audio = model.generate(voice, prompt, frames_after_eos, EOS_THRESHOLD)
            if audio.size:
                # The model has no speed control of its own.
                yield retime((audio, model.sample_rate), speed)


def create_app(service: PocketService) -> FastAPI:
    app = worker_common.create_app(
        "Pocket TTS API",
        description="OpenAI-compatible Text-to-Speech API: Pocket TTS Indonesian on OpenVINO",
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
    async def create_speech(request: PocketSpeechRequest):
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

    install_models_routes(app, [MODEL_ID], owned_by="kyutai")
    install_openai_errors(app)
    return app


def main() -> int:
    args = base_parser(
        "Pocket TTS Indonesian (OpenVINO)",
        default_port=5006,
        default_device="CPU",
        device_help=(
            "OpenVINO device for inference (AUTO: OpenVINO selects, a GPU "
            "when there is one). Default: CPU"
        ),
        source=True,
    ).parse_args()
    # ffmpeg encodes the non-WAV formats and applies the speed.
    add_ffmpeg_to_path()

    service = PocketService(args.device, args.source)
    try:
        service.initialize()
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to initialize Pocket TTS: %s", e)
        return 1

    logger.info("Starting Pocket TTS server on port %s", args.port)
    serve(create_app(service), args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
