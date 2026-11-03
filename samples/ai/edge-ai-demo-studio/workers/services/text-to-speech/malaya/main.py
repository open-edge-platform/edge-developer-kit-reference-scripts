# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from pathlib import Path
from model_downloader import fetch_snapshot
from malaya_speech.torch_model.vits.commons import intersperse
from overrides.malaya_speech_tts import load_text_ids
import os
import threading
from typing import Iterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from ov_malaya import OVMalaya, ensure_ir, load_hparams
from schemas import OpenAISpeechRequest
from worker_common.speech import Piece, speech_response, split_sentences
import worker_common
from worker_common import (
    add_ffmpeg_to_path,
    base_parser,
    install_models_routes,
    install_openai_errors,
    instance_data_dir,
    lan_origins,
    migrate_legacy_models_dir,
    models_dir,
    normalize_openvino_device,
    serve,
)


AVAILABLE_VOICES = ["Husein", "Shafiqah Idayu", "Anwar Ibrahim"]
AVAILABLE_MODEL = "malaysia-ai/malay-VITS-multispeaker"
CONFIG = {
    "source": "huggingface",
}
# Loaded once at startup; `lock` has requests take turns sentence by sentence
# (worker_common.speech.measured).
model_state = {
    "model": None,
    "hps": None,
    "normalizer": None,
    "lock": threading.Lock(),
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting up Malaya TTS server...")

    # CPU unless another device is named: on a GPU every new sentence length recompiles,
    # slower than real time. AUTO goes to OpenVINO as is.
    device = normalize_openvino_device(getattr(app.state, "device", "CPU"), default="CPU")
    print(f"Loading Malaya TTS model on OpenVINO device: {device}")

    normalizer = load_normalizer()
    predefined_message = "Selamat datang ke Malaya TTS server."

    model, hps = load_model(device, CONFIG["source"])
    print("Model loaded successfully!")
    print(f"Available voices: {', '.join(AVAILABLE_VOICES)}")
    print("Warming up model")
    list(synthesize_speech(model, hps, normalizer, predefined_message, AVAILABLE_VOICES[0], 1))
    print("Model warm-up completed.")

    model_state["model"] = model
    model_state["hps"] = hps
    model_state["normalizer"] = normalizer

    yield

    print("Shutting down Malaya TTS server...")
    model_state["model"] = None
    model_state["hps"] = None
    model_state["normalizer"] = None
    print("Cleanup completed.")


def load_model(device, source="huggingface"):
    """The compiled VITS model and its hyperparameters; downloaded and converted on first start."""
    print("Loading model...")
    # Under models/tts with the other TTS backends, where "Clear model cache" looks; a copy at the
    # legacy models/huggingface location is moved over.
    model_dir = str(models_dir("tts", "malaya", AVAILABLE_MODEL))
    legacy_model_dir = worker_common.project_root() / "models" / "huggingface" / AVAILABLE_MODEL
    migration_msg = migrate_legacy_models_dir(legacy_model_dir, Path(model_dir))
    if migration_msg:
        print(migration_msg)

    if (
        not Path(f"{model_dir}/config.json").exists()
        or not Path(f"{model_dir}/model.pth").exists()
    ):
        print(f"Downloading model from {source}...")
        fetch_snapshot(AVAILABLE_MODEL, model_dir, source=source)

    hps = load_hparams(model_dir)
    return OVMalaya(ensure_ir(model_dir, hps), device), hps


def load_normalizer():
    """The Malaya text normalizer, loaded once and shared by every request."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    temp_dir = str(instance_data_dir(script_dir) / "temp")
    return load_text_ids(
        pad_to=None, understand_punct=True, is_lower=False, demoji_local_dir=temp_dir
    )


SPEAKER_IDS = {
    "Husein": 0,
    "Shafiqah Idayu": 1,
    "Anwar Ibrahim": 2,
}


def synthesize_speech(model, hps, normalizer, text, speaker, speed=1.0) -> Iterator[Piece]:
    """Speech for ``text``, one sentence per model call; lazy, so streaming sends each when ready."""
    print(f"Synthesizing text: '{text}'")
    print(f"Using speaker: {speaker}")
    print(f"Using speed: {speed}")

    # OpenAI speed (>1 faster) -> VITS length_scale (<1 faster).
    length_scale = 1.0 / speed

    for sentence in split_sentences(text):
        _, ids = normalizer.normalize(sentence, add_fullstop=False)
        if len(ids) == 0:  # nothing speakable, e.g. punctuation alone
            continue
        if hps.data.add_blank:
            ids = intersperse(ids, 0)
        yield model(ids, SPEAKER_IDS[speaker], length_scale), hps.data.sampling_rate


def parse_arguments():
    return base_parser(
        "Malaya Speech TTS Server with OpenAI-compatible API",
        default_port=5004,
        default_device="CPU",
        device_help=(
            "OpenVINO device for inference (AUTO: OpenVINO selects, a GPU "
            "when there is one). Default: CPU"
        ),
        source=True,
    ).parse_args()


def setup_routes(app: FastAPI):
    @app.post("/v1/audio/speech")
    async def create_speech(request: OpenAISpeechRequest):
        """OpenAI-compatible endpoint for text-to-speech using Malaya model"""

        if model_state["model"] is None:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "service_unavailable",
                    "message": "Model is not loaded yet. Please wait for server startup to complete.",
                    "type": "server_error",
                },
            )

        if request.voice not in AVAILABLE_VOICES:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "invalid_voice",
                    "message": f"Unsupported voice: {request.voice}. Available voices: {', '.join(AVAILABLE_VOICES)}",
                    "type": "invalid_request_error",
                },
            )

        try:
            model = model_state["model"]
            hps = model_state["hps"]
            normalizer = model_state["normalizer"]

            # Streamed sentence by sentence (`stream` or SSE), else the whole file.
            print("speed: ", request.speed)
            return await speech_response(
                synthesize_speech(
                    model, hps, normalizer, request.input, request.voice, request.speed
                ),
                request.response_format,
                stream=request.stream,
                stream_format=request.stream_format,
                lock=model_state["lock"],
                headers={
                    "Content-Disposition": f"attachment; filename=speech.{request.response_format}",
                    "Cache-Control": "no-cache",
                },
            )

        except Exception as e:
            print(f"Error generating speech: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "processing_error",
                    "message": "Failed to generate speech",
                    "type": "server_error",
                },
            )

    @app.get("/v1/audio/voices")
    async def list_voices():
        """List all available voices for text-to-speech"""
        try:
            return {voice: True for voice in AVAILABLE_VOICES}
        except Exception as e:
            print(f"Error listing voices: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "server_error",
                    "message": "Failed to retrieve voice list",
                    "type": "server_error",
                },
            )

    @app.get("/healthcheck")
    async def healthcheck():
        """Health check endpoint."""
        return JSONResponse({"status": "ok"})


def setup_environment():
    """Add the bundled ffmpeg to PATH; it encodes the non-WAV formats."""
    add_ffmpeg_to_path()


def create_app(device="CPU"):
    # Called straight from the demo page on the app's port, possibly from
    # another device on the LAN, so this machine's address is an origin too.
    app = worker_common.create_app(
        "Malaya TTS API",
        lifespan=lifespan,
        healthcheck=False,
        allow_origins=lan_origins(8080),
    )

    # Read by lifespan.
    app.state.device = device

    install_models_routes(app, ["malaya"], owned_by="malaya-speech")
    install_openai_errors(app)

    return app


def main():
    args = parse_arguments()
    CONFIG["source"] = args.source

    setup_environment()

    device = args.device
    port = args.port

    app = create_app(device)

    setup_routes(app)

    print(f"Starting Malaya TTS server on port {port}")
    print(f"Device: {device}")
    print(f"Available endpoints:")
    print(f"  - POST /audio/speech - Generate speech from text")
    print(f"  - GET /audio/voices - List available voices")
    print(f"Available voices: {', '.join(AVAILABLE_VOICES)}")

    serve(app, args)


if __name__ == "__main__":
    main()
