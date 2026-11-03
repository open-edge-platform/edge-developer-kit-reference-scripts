# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Text-to-speech worker for models without a built-in worker (SpeechT5): the OEP
``text-to-speech`` microservice, fetched at the tag in ``workers/oep-services.json`` and imported
unchanged. The wrapper maps worker flags to ``TEXT_TO_SPEECH__*`` overrides, keeps models under
``models/tts/oep-tts``, keeps session storage per instance and holds ``/healthcheck`` at 503 until
upstream's startup (export, preload, warm-up) finishes.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from worker_common import (
    SPEECH_RESPONSE_FORMATS,
    add_instance_args,
    get_logger,
    install_models_routes,
    instance_data_dir,
    models_dir,
    override_api_route,
    serve,
    server_timing,
    speech_media_type,
    timed,
    transcode_wav,
    use_shared_hf_cache,
)
from worker_common.oep import (
    UpstreamState,
    failed_app,
    install_healthcheck,
    load_upstream_main,
    pinned_tag,
    redirect_storage_root,
    upstream_app_dir,
    utf8_console,
    wrap_lifespan,
)

SERVICE_ID = "text-to-speech"
WORKER_NAME = "oep-tts"
UPSTREAM_NAME = "text-to-speech"
CATALOG_WORKER = "services/text-to-speech/oep-tts"
DEFAULT_PORT = 8020
DEFAULT_MODEL = "microsoft/speecht5_tts"

# Short --model names. Upstream picks its implementation by substring but downloads by the full
# repo id, so an alias expands to the id.
MODEL_ALIASES = {
    "speecht5": "microsoft/speecht5_tts",
}

WORKER_DIR = Path(__file__).resolve().parent
UPSTREAM_TAG = pinned_tag(CATALOG_WORKER)
APP_DIR = upstream_app_dir(WORKER_DIR, CATALOG_WORKER)
MODELS_DIR = Path(os.environ.get("TTS_MODELS_DIR") or models_dir("tts", WORKER_NAME))

utf8_console()
logger = get_logger(f"{SERVICE_ID}.{WORKER_NAME}")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=f"{SERVICE_ID} worker (OEP {UPSTREAM_NAME})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help="Hugging Face id of an upstream-supported model (microsoft/speecht5_tts)",
    )
    parser.add_argument(
        "--device",
        default="AUTO",
        help="AUTO | CPU | GPU (upstream runs AUTO and indexed names such as GPU.1 on the CPU)",
    )
    parser.add_argument(
        "--dtype",
        default=None,
        help="OpenVINO export precision: int8 (default) | int4 | fp16 | fp32",
    )
    add_instance_args(parser)
    # parse_known_args: a flag meant for the built-in workers (--source ...) only warns.
    args, unknown = parser.parse_known_args(argv)
    if unknown:
        logger.warning("ignoring unrecognised arguments: %s", " ".join(unknown))
    return args


def _resolve_model(model: str) -> str:
    name = model.strip()
    return MODEL_ALIASES.get(name.lower(), name)


def _publish_native_environment(args: argparse.Namespace) -> None:
    """Translate worker flags into upstream ``TEXT_TO_SPEECH__*`` overrides.

    Must run before upstream is imported (it reads its config once, at import). ``setdefault`` leaves
    values from the shell or deployment.json in charge, e.g. ``...__TTS__RUNTIME=pytorch``.
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    models = str(MODELS_DIR)
    # optimum / snapshot_download fetch into the shared HF cache; this worker's old cache moves into it.
    moved = use_shared_hf_cache(MODELS_DIR / "huggingface")
    if moved:
        logger.info(moved)
    model = _resolve_model(args.model)
    # Passed as is; upstream's normalize_device keeps GPU and NPU and runs anything else (AUTO,
    # GPU.1) on the CPU.
    overrides = {
        "TEXT_TO_SPEECH__MODELS__TTS__NAME": model,
        "TEXT_TO_SPEECH__MODELS__TTS__RUNTIME": "openvino",
        "TEXT_TO_SPEECH__MODELS__TTS__DEVICE": str(args.device).upper(),
        # A SpeechT5 voice: upstream's startup check rejects a speaker the model lacks, and its own
        # default follows its default model (Kokoro's af_heart on main).
        "TEXT_TO_SPEECH__MODELS__TTS__DEFAULT_SPEAKER": "Ryan",
        "TEXT_TO_SPEECH__MODELS__TTS__DEFAULT_LANGUAGE": "English",
        # Exported IR lands in <models>/openvino/<model>__<dtype>.
        "TEXT_TO_SPEECH__MODELS__TTS__MODELS_BASE_PATH": models,
        "TEXT_TO_SPEECH__MODELS__TTS__USE_LOCAL_CACHE": "true",
        # The app reads the HTTP response; a WAV + generation.json per request would only fill disk.
        "TEXT_TO_SPEECH__PIPELINE__PERSIST_OUTPUTS": "false",
        "TEXT_TO_SPEECH__APP__CLEAR_STORAGE_ON_STARTUP": "true",
    }
    if args.dtype:
        overrides["TEXT_TO_SPEECH__MODELS__TTS__DTYPE"] = str(args.dtype).lower()
    for key, value in overrides.items():
        os.environ.setdefault(key, value)


ARGS = _parse_args()
_publish_native_environment(ARGS)
ACTIVE_MODEL = os.environ["TEXT_TO_SPEECH__MODELS__TTS__NAME"]

STATE = UpstreamState()
try:
    app = load_upstream_main(APP_DIR, "oep_text_to_speech_main").app
except Exception as exc:  # noqa: BLE001 - surfaced through /healthcheck
    app = failed_app(SERVICE_ID, STATE, exc, logger)
else:
    # Session storage (unused while PERSIST_OUTPUTS=false) goes under this instance's data directory,
    # not the copy every instance shares; with no instance assigned, upstream's BASE_DIR/storage.
    redirect_storage_root(instance_data_dir(APP_DIR, args=ARGS) / "storage")
    # Upstream exports the model into the shared models directory on startup.
    wrap_lifespan(
        app,
        STATE,
        logger,
        f"{UPSTREAM_NAME} ({UPSTREAM_TAG}) with {ACTIVE_MODEL} on {str(ARGS.device).upper()}",
        model_lock=MODELS_DIR / ".oep-startup",
    )

install_healthcheck(
    app,
    STATE,
    lambda: {
        "service": SERVICE_ID,
        "worker": WORKER_NAME,
        "upstream": UPSTREAM_NAME,
        "upstream_tag": UPSTREAM_TAG,
        "active_model": ACTIVE_MODEL,
        "device": str(ARGS.device).upper(),
        "port": ARGS.port,
    },
)


# OpenAI-compatible speech. Upstream's route takes only wav/json (OpenAI defaults to mp3) and has no
# `speed`, so this one, put ahead of it by override_api_route, has upstream synthesize WAV and
# re-encodes it with ffmpeg in any of the six formats. `stream`/SSE hands upstream one sentence per
# call, so audio starts after the first sentence instead of the whole text.

SPEECH_PATH = "/v1/audio/speech"

import json  # noqa: E402 - after the upstream app import
from typing import Literal  # noqa: E402

from fastapi import HTTPException  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from fastapi.responses import Response  # noqa: E402
from pydantic import BaseModel, ConfigDict, Field  # noqa: E402

from worker_common.speech import decode_wav, speech_response, split_sentences  # noqa: E402


# Module scope: with `from __future__ import annotations`, FastAPI resolves the handler's
# `SpeechRequest` annotation against module globals.
class SpeechRequest(BaseModel):
    """OpenAI's ``POST /v1/audio/speech`` body, plus upstream's ``language`` and ``json`` format.

    ``json`` returns upstream's session metadata envelope, which some callers read.
    """

    model_config = ConfigDict(extra="ignore", protected_namespaces=())

    model: str | None = None
    input: str
    voice: str | None = None
    instructions: str | None = None
    language: str | None = None
    response_format: str = "mp3"
    speed: float = Field(default=1.0, ge=0.25, le=4.0)
    # Sentence-by-sentence streaming, as the built-in workers offer it; off by
    # default here so a plain request still gets upstream's single synthesis.
    stream: bool = False
    stream_format: Literal["audio", "sse"] = "audio"


class UpstreamSpeechError(RuntimeError):
    """Upstream answered one sentence with an (OpenAI-shaped) error response."""

    def __init__(self, response):
        self.response = response
        try:
            message = json.loads(response.body)["error"]["message"]
        except Exception:  # noqa: BLE001 - the status is still worth reporting
            message = f"upstream answered {response.status_code}"
        super().__init__(message)


def _install_openai_speech() -> None:
    # Upstream's handler takes its own DTO and returns a Response; both are
    # imported from the copy that load_upstream_main put on sys.path.
    from api.openai_endpoints import generate_speech as upstream_generate_speech
    from dto.speech_dto import SpeechRequest as UpstreamSpeechRequest

    def upstream_request_for(request: SpeechRequest, text: str, response_format: str):
        return UpstreamSpeechRequest(
            model=request.model or ACTIVE_MODEL,
            input=text,
            voice=request.voice,
            language=request.language,
            instructions=request.instructions,
            response_format=response_format,
        )

    def sentence_pieces(request: SpeechRequest):
        """Upstream's audio for each sentence of the input, decoded, as it is
        synthesized (a lazy generator, advanced in the threadpool)."""
        for sentence in split_sentences(request.input):
            response = upstream_generate_speech(
                upstream_request_for(request, sentence, "wav")
            )
            if getattr(response, "status_code", 200) >= 400:
                raise UpstreamSpeechError(response)
            wav = response.body
            if abs(request.speed - 1.0) >= 1e-3:
                wav = transcode_wav(wav, "wav", speed=request.speed)
            yield decode_wav(wav)

    # No return annotation: `from __future__ import annotations` makes it a
    # string, which FastAPI would try to resolve into a response model.
    async def create_speech(request: SpeechRequest):
        fmt = (request.response_format or "mp3").strip().lower()
        if fmt not in SPEECH_RESPONSE_FORMATS and fmt != "json":
            raise HTTPException(
                status_code=400,
                detail=(
                    "response_format must be one of "
                    f"{', '.join(SPEECH_RESPONSE_FORMATS)} or json"
                ),
            )

        if request.stream_format == "sse" or (request.stream and fmt != "json"):
            if fmt == "json":
                raise HTTPException(
                    status_code=400,
                    detail="stream_format 'sse' carries audio; response_format json cannot be streamed",
                )
            if not request.input.strip():
                raise HTTPException(status_code=400, detail="Input text is required")
            try:
                return await speech_response(
                    sentence_pieces(request),
                    fmt,
                    stream=True,
                    stream_format=request.stream_format,
                    headers={"Content-Disposition": f'inline; filename="speech.{fmt}"'},
                )
            except UpstreamSpeechError as exc:
                # The first sentence already failed: pass upstream's error on.
                return exc.response
            except RuntimeError as exc:
                logger.error("streaming speech as %s failed: %s", fmt, exc)
                raise HTTPException(status_code=500, detail=str(exc)) from exc

        # Always ask upstream for the format it can actually produce.
        upstream_request = upstream_request_for(
            request, request.input, "json" if fmt == "json" else "wav"
        )
        # Upstream's handler is synchronous and runs the model inline, so its
        # time is the model time, reported to the app's Live metrics.
        with timed() as clock:
            response = await run_in_threadpool(upstream_generate_speech, upstream_request)
        timing = server_timing(clock.seconds)

        # An upstream failure is already an OpenAI error body; pass it through.
        if fmt == "json" or getattr(response, "status_code", 200) >= 400:
            return response
        if fmt == "wav" and abs(request.speed - 1.0) < 1e-3:
            response.headers.update(timing)
            return response

        try:
            audio = await run_in_threadpool(
                transcode_wav, response.body, fmt, speed=request.speed
            )
        except RuntimeError as exc:
            logger.error("re-encoding speech to %s failed: %s", fmt, exc)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        headers = {
            key: value
            for key, value in getattr(response, "headers", {}).items()
            if key.lower() == "x-session-id"
        }
        headers["Content-Disposition"] = f'inline; filename="speech.{fmt}"'
        headers.update(timing)
        return Response(content=audio, media_type=speech_media_type(fmt), headers=headers)

    override_api_route(
        app,
        SPEECH_PATH,
        create_speech,
        methods=["POST"],
        response_class=Response,
        tags=["OpenAI-compatible"],
        summary="Generate speech (OpenAI request shape; all six response formats; optional sentence streaming)",
    )


try:
    _install_openai_speech()
except Exception as exc:  # noqa: BLE001 - upstream stays reachable either way
    logger.warning("could not install the OpenAI speech route (%s); upstream's is unchanged", exc)

# Upstream serves exactly the model this worker was started with. Its own
# errors are already OpenAI-shaped, so no error handler is installed here.
install_models_routes(app, lambda: [ACTIVE_MODEL], owned_by=UPSTREAM_NAME)


if __name__ == "__main__":
    serve(app, ARGS, log_level="info")
