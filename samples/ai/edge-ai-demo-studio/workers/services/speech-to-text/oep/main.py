# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Speech to Text worker wrapping the OEP ``audio-analyzer`` service, which start.sh fetches unchanged.

Adds the worker contract around upstream's FastAPI app: flags as ``AUDIO_ANALYZER__*`` overrides,
models under ``models/stt``, browser upload formats, per-instance session storage, and a
``/healthcheck`` that answers 503 until upstream's startup (export + warm-up) finishes.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
from pathlib import Path

import yaml
from worker_common import (
    add_instance_args,
    get_logger,
    install_models_routes,
    instance_data_dir,
    models_dir,
    serve,
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

SERVICE_ID = "speech-to-text"
UPSTREAM_NAME = "audio-analyzer"
CATALOG_WORKER = "services/speech-to-text/oep"
DEFAULT_PORT = 8023
DEFAULT_MODEL = "openai/whisper-base"
# optimum-cli --weight-format values offered for the Whisper export. int8
# weights are a quarter of fp32's size with practically the same transcripts.
PRECISIONS = ["fp32", "fp16", "int8", "int4"]
DEFAULT_PRECISION = "int8"
# Browser formats upstream's config.yaml doesn't list (MediaRecorder records WebM/Opus); upstream's
# ffmpeg chunking decodes them like the ones it lists.
BROWSER_AUDIO_EXTENSIONS = [".webm", ".weba", ".ogg", ".oga", ".opus", ".flac"]

WORKER_DIR = Path(__file__).resolve().parent
UPSTREAM_TAG = pinned_tag(CATALOG_WORKER)
APP_DIR = upstream_app_dir(WORKER_DIR, CATALOG_WORKER)
MODELS_DIR = Path(os.environ.get("STT_MODELS_DIR") or models_dir("stt"))

utf8_console()
logger = get_logger(SERVICE_ID)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=f"{SERVICE_ID} worker (OEP {UPSTREAM_NAME})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help="Whisper model as listed by the frontend (openai/whisper-<size>)",
    )
    parser.add_argument(
        "--device",
        default="AUTO",
        help="AUTO (OpenVINO selects: a discrete GPU, then an integrated GPU, then the CPU) | CPU | GPU | NPU",
    )
    parser.add_argument(
        "--precision",
        default=DEFAULT_PRECISION,
        choices=PRECISIONS,
        help=f"Weight format of the OpenVINO export (default: {DEFAULT_PRECISION})",
    )
    add_instance_args(parser)
    # parse_known_args so an unrecognised flag from buildArgs degrades to a
    # warning rather than killing the worker at import.
    args, unknown = parser.parse_known_args(argv)
    if unknown:
        logger.warning("ignoring unrecognised arguments: %s", " ".join(unknown))
    return args


def _upstream_model_name(model: str) -> str:
    """``openai/whisper-base`` -> ``whisper-base``; upstream re-adds ``openai/`` when exporting."""
    name = model.strip()
    if name.lower().startswith("openai/"):
        name = name[len("openai/"):]
    return name


def _allowed_extensions() -> str | None:
    """Upstream's upload extensions plus ``BROWSER_AUDIO_EXTENSIONS`` as JSON; None if unreadable.

    The env override replaces upstream's list, so it is read from upstream's config.yaml and extended.
    """
    try:
        with open(APP_DIR / "config.yaml", encoding="utf-8") as f:
            listed = yaml.safe_load(f)["audio_util"]["allowed_extensions"]
    except (OSError, KeyError, TypeError, yaml.YAMLError):
        return None
    return json.dumps(listed + [e for e in BROWSER_AUDIO_EXTENSIONS if e not in listed])


def _publish_native_environment(args: argparse.Namespace) -> None:
    """Translate worker flags into upstream ``AUDIO_ANALYZER__*`` overrides.

    Runs before upstream is imported, since it reads its config once at import. ``setdefault`` lets
    values from the shell or deployment.json win (e.g. ``..._ASR__DIARIZATION=true`` + ``HF_TOKEN``).
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    models = str(MODELS_DIR)
    # optimum-cli downloads into the shared HF cache; migrate the legacy models/stt/huggingface.
    moved = use_shared_hf_cache(MODELS_DIR / "huggingface")
    if moved:
        logger.info(moved)
    overrides = {
        "AUDIO_ANALYZER__MODELS__ASR__PROVIDER": "openvino",
        "AUDIO_ANALYZER__MODELS__ASR__NAME": _upstream_model_name(args.model),
        "AUDIO_ANALYZER__MODELS__ASR__DEVICE": str(args.device).upper(),
        # Every model family upstream can load goes under models/stt.
        "AUDIO_ANALYZER__MODELS__ASR__MODELS_BASE_PATH": models,
        "AUDIO_ANALYZER__MODELS__DIARIZATION__MODELS_BASE_PATH": models,
        "AUDIO_ANALYZER__SENTIMENT__MODELS_BASE_PATH": models,
    }
    extensions = _allowed_extensions()
    if extensions:
        overrides["AUDIO_ANALYZER__AUDIO_UTIL__ALLOWED_EXTENSIONS"] = extensions
    # Upstream exports to <name>-<weight_format>, or to <name> (fp32) with no format set; fp32
    # leaves it unset so existing <name> exports are reused.
    if args.precision != "fp32":
        overrides["AUDIO_ANALYZER__MODELS__ASR__WEIGHT_FORMAT"] = args.precision
    for key, value in overrides.items():
        os.environ.setdefault(key, value)


def _requested_language(language: str | None) -> str | None:
    """``ms``, ``<|ms|>`` -> ``ms``; none, ``""`` and ``auto`` -> None: Whisper detects the language."""
    code = (language or "").strip().strip("<|>").strip().lower()
    return None if code in ("", "auto") else code


def _report_detected_language() -> None:
    """Auto-detect and the detected language, which upstream's OpenVINO GenAI path lacks.

    Upstream passes ``language=auto`` on to Whisper as ``<|auto|>``, which it rejects, and drops the
    language ``WhisperPipeline.generate`` detected, so ``verbose_json`` (and the realtime socket's
    ``completed`` event) had no ``language`` unless one was sent. Here ``auto`` detects, the detected code
    (``ms``) comes back as ``language``, and a request that names none reports what Whisper heard in it,
    not the language its session reported first. A language that is sent is still the one reported.
    """
    import pipeline  # noqa: PLC0415  (upstream's modules, importable once load_upstream_main ran)
    from components.asr.openvino_genai import whisper as genai_whisper  # noqa: PLC0415

    heard = threading.local()  # generate() runs in the request's thread; requests run concurrently

    class _Recorder:
        """The WhisperPipeline, keeping the language each generate() detected."""

        def __init__(self, pipe):
            self._pipe = pipe

        def generate(self, *args, **kwargs):
            result = self._pipe.generate(*args, **kwargs)
            heard.language = _requested_language(getattr(result, "language", None))
            return result

        def __getattr__(self, name):
            return getattr(self._pipe, name)

    upstream_transcribe = genai_whisper.Whisper.transcribe

    def transcribe(self, audio_path: str, temperature: float = 0.0, language: str | None = None) -> dict:
        if not isinstance(self.model, _Recorder):
            self.model = _Recorder(self.model)
        language = _requested_language(language)
        heard.language = None
        result = upstream_transcribe(self, audio_path, temperature=temperature, language=language)
        return {**result, "language": language or heard.language}

    genai_whisper.Whisper.transcribe = transcribe

    def per_request(upstream):
        def run(self, input, language: str | None = None):
            language = _requested_language(language)
            if language is None:
                self._session_state["language"] = None
            return upstream(self, input, language=language)

        return run

    pipeline.Pipeline.transcribe = per_request(pipeline.Pipeline.transcribe)
    pipeline.Pipeline.stream_transcribe = per_request(pipeline.Pipeline.stream_transcribe)


ARGS = _parse_args()
_publish_native_environment(ARGS)

STATE = UpstreamState()
try:
    app = load_upstream_main(APP_DIR, "audio_analyzer_main").app
    _report_detected_language()
except Exception as exc:  # noqa: BLE001 - surfaced through /healthcheck
    app = failed_app(SERVICE_ID, STATE, exc, logger)
else:
    # Session storage is per-instance (upstream's own BASE_DIR/storage when no instance is assigned).
    redirect_storage_root(instance_data_dir(APP_DIR, args=ARGS) / "storage")
    # Upstream exports the Whisper IR into the shared models/stt on startup.
    wrap_lifespan(
        app,
        STATE,
        logger,
        f"{UPSTREAM_NAME} ({UPSTREAM_TAG})",
        model_lock=MODELS_DIR / ".oep-startup",
    )

install_healthcheck(
    app,
    STATE,
    lambda: {
        "service": SERVICE_ID,
        "backend": "oep",
        "upstream": UPSTREAM_NAME,
        "upstream_tag": UPSTREAM_TAG,
        "active_model": ARGS.model,
        "device": str(ARGS.device).upper(),
        "precision": os.environ.get("AUDIO_ANALYZER__MODELS__ASR__WEIGHT_FORMAT") or "fp32",
        "port": ARGS.port,
    },
)


# Upstream's GET /models is the VSS contract, not OpenAI's. `whisper-1` (OpenAI clients' default) is
# listed too; the audio routes ignore `model`. Upstream's error handlers are already OpenAI-shaped.
install_models_routes(
    app,
    lambda: [ARGS.model, "whisper-1"] if ARGS.model != "whisper-1" else ["whisper-1"],
    owned_by=UPSTREAM_NAME,
)


if __name__ == "__main__":
    serve(app, ARGS, log_level="info")
