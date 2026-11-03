# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import importlib.util
import os
import sys
import threading
import types
from typing import Dict, Iterator, List, Literal, Optional, Union

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from model_downloader import fetch_file

from utils import (
    configure_system_espeak,
    create_cache_directory,
    validate_and_sanitize_cache_dir,
)
from ov_kokoro import OVKModel
from kokoro import KPipeline, KModel
from worker_common.speech import Piece, StreamFormat, speech_response, split_sentences

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

# misaki.ja imports pyopenjtalk, but Kokoro's Japanese G2P (JAG2P's "cutlet": fugashi + unidic-lite)
# never calls it, and it is source-only (no C++ compiler on Windows), so an empty module stands in
# for the misaki pinned in pyproject.toml. A real install still wins.
if importlib.util.find_spec("pyopenjtalk") is None:
    sys.modules["pyopenjtalk"] = types.ModuleType("pyopenjtalk")

#: Kokoro synthesizes at 24 kHz.
SAMPLE_RATE = 24000


class NormalizationOptions(BaseModel):
    normalize: bool = True
    unit_normalization: bool = False
    url_normalization: bool = True
    email_normalization: bool = True
    optional_pluralization_normalization: bool = True
    phone_normalization: bool = True


class SpeechRequest(BaseModel):
    model: str = Field(default="kokoro", description="The model to use for generation")
    input: str = Field(..., description="The text to generate audio for")
    voice: str = Field(
        default="af_heart", description="The voice to use for generation"
    )
    response_format: Literal["mp3", "opus", "aac", "flac", "wav", "pcm"] = Field(
        default="mp3",
        description=(
            "The format to return audio in. All six OpenAI formats are "
            "supported: mp3, opus, aac, flac, wav, pcm."
        ),
    )
    download_format: Optional[str] = Field(
        None, description="Optional different format for the final download"
    )
    speed: float = Field(
        default=1.0, description="The speed of the generated audio", ge=0.25, le=4.0
    )
    instructions: Optional[str] = Field(
        default=None,
        description=(
            "Accepted for OpenAI compatibility and ignored: Kokoro has no "
            "prompt-steerable delivery, so tone and pacing come from the voice "
            "and 'speed' instead."
        ),
    )
    stream: bool = Field(
        default=True,
        description=(
            "If true, audio is sent sentence by sentence as it is synthesized "
            "(wav with unknown-length sizes, raw pcm, mp3/aac per sentence; "
            "opus/flac once complete)"
        ),
    )
    stream_format: StreamFormat = Field(
        default="audio",
        description=(
            "'audio' sends the audio bytes; 'sse' sends OpenAI's "
            "speech.audio.delta events (base64 audio) and a final "
            "speech.audio.done, streamed regardless of 'stream'"
        ),
    )
    return_download_link: bool = Field(
        default=False,
        description="If true, returns a download link in X-Download-Path header",
    )
    lang_code: Optional[str] = Field(
        default="a", description="Optional language code to use for text processing"
    )
    volume_multiplier: float = Field(
        default=1.0, description="A volume multiplier to multiply the output audio by"
    )
    normalization_options: Optional[NormalizationOptions] = Field(
        default_factory=NormalizationOptions,
        description="Options for the normalization system",
    )


class KokoroTTSService:
    def __init__(self, device: str = "CPU", source: str = "huggingface"):
        self.device = device.upper()
        self.model = None
        self.pipelines: Dict[str, KPipeline] = {}
        self.model_dir = None
        self._voices_cache = None
        self.source = source
        # The compiled model and the G2P front ends serve one piece at a time
        # (worker_common.speech.measured).
        self.lock = threading.Lock()

    def initialize(self):
        try:
            logger.info(f"Initializing Kokoro TTS model on device: {self.device}")

            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = str(worker_common.project_root())
            model_dir = os.path.join(project_root, "models", "tts", "kokoro")
            model_dir = validate_and_sanitize_cache_dir(model_dir)
            create_cache_directory(model_dir)
            self.model_dir = model_dir

            self.init_model_and_pipeline(model_dir, self.source)

            try:
                logger.info("Warming up Kokoro TTS pipeline...")
                test_results = list(
                    self.get_results(self.pipelines["a"], "Hello world", "af_heart")
                )
                logger.info("Kokoro TTS pipeline warmed up successfully")
            except Exception as e:
                logger.warning(f"Failed to warm up pipeline: {e}")

        except Exception as e:
            import traceback

            traceback.print_exc()
            logger.error(f"Failed to initialize Kokoro TTS: {e}")
            raise

    def _download_file(self, repo_id: str, file_path: str, local_dir: str) -> str:
        logger.info("Downloading %s from %s (%s)", file_path, repo_id, self.source)
        return str(fetch_file(repo_id, file_path, local_dir, source=self.source))

    def init_model_and_pipeline(self, model_dir: str, source: str = "huggingface"):
        repo_id = "hexgrad/Kokoro-82M"
        try:
            logger.info("Loading Kokoro model with OpenVINO runtime...")
            self.model = OVKModel(model_dir, self.device, source=source)
            self.pipelines["a"] = KPipeline(
                lang_code="a",
                repo_id=repo_id,
                model=self.model,
                model_dir=model_dir,
            )
        except Exception as e:
            logger.warning(f"OVKModel initialization failed: {e}")
            config_local = os.path.join(model_dir, "config.json")
            if os.path.exists(config_local):
                config_path = config_local
            else:
                config_path = self._download_file(
                    repo_id=repo_id, file_path="config.json", local_dir=model_dir
                )

            model_filename = KModel.MODEL_NAMES[repo_id]
            model_local = os.path.join(model_dir, model_filename)
            if os.path.exists(model_local):
                model_path = model_local
            else:
                model_path = self._download_file(
                    repo_id=repo_id,
                    file_path=model_filename,
                    local_dir=model_dir,
                )

            self.model = (
                KModel(repo_id=repo_id, config=config_path, model=model_path)
                .to("cpu")
                .eval()
            )

            self.pipelines["a"] = KPipeline(
                lang_code="a",
                repo_id=repo_id,
                model=self.model,
                model_dir=model_dir,
            )

    def get_results(
        self,
        pipeline: KPipeline,
        text: Union[str, List[str]],
        voice: str,
        speed: float = 1,
    ):
        """Run ``pipeline`` with ``voice``, downloading the voice pack on first use."""
        if self.model is None or not self.model_dir:
            raise RuntimeError(
                "KokoroTTSService model is not initialized or missing 'model_dir' attribute."
            )

        model_voice_path = os.path.join(self.model_dir, "voices", f"{voice}.pt")
        if not os.path.exists(model_voice_path):
            logger.warning(f"Voice '{voice}' not found locally, downloading from hub")
            voice = self._download_file(
                repo_id="hexgrad/Kokoro-82M",
                file_path=f"voices/{voice}.pt",
                local_dir=self.model_dir,
            )
        else:
            voice = os.path.join(self.model_dir, "voices", f"{voice}.pt")
        return pipeline(text, voice=voice, speed=speed)

    @property
    def available_voices(self) -> List[str]:
        if not hasattr(self, "_available_voices"):
            self._available_voices = [
                # American Female voices
                "af_alloy",
                "af_aoede",
                "af_bella",
                "af_heart",
                "af_jadzia",
                "af_jessica",
                "af_kore",
                "af_nicole",
                "af_nova",
                "af_river",
                "af_sarah",
                "af_sky",
                # American Male voices
                "am_adam",
                "am_echo",
                "am_eric",
                "am_fenrir",
                "am_liam",
                "am_michael",
                "am_onyx",
                "am_puck",
                "am_santa",
                # British Female voices
                "bf_alice",
                "bf_emma",
                "bf_lily",
                # British Male voices
                "bm_daniel",
                "bm_fable",
                "bm_george",
                "bm_lewis",
                # Other language voices
                "ef_dora",
                "em_alex",
                "em_santa",
                "ff_siwis",
                "hf_alpha",
                "hf_beta",
                "hm_omega",
                "hm_psi",
                "if_sara",
                "im_nicola",
                "jf_alpha",
                "jf_gongitsune",
                "jf_nezumi",
                "jf_tebukuro",
                "jm_kumo",
                "pf_dora",
                "pm_alex",
                "pm_santa",
                "zf_xiaobei",
                "zf_xiaoni",
                "zf_xiaoxiao",
                "zf_xiaoyi",
                "zm_yunjian",
                "zm_yunxi",
                "zm_yunxia",
                "zm_yunyang",
            ]
        return self._available_voices

    def _get_cached_voices(self) -> set[str]:
        """Get the set of voices that are currently cached locally."""
        if not self.model_dir:
            return set()

        voices_dir = os.path.join(self.model_dir, "voices")
        if not os.path.exists(voices_dir):
            return set()

        try:
            cached_voices = set()
            for filename in os.listdir(voices_dir):
                if filename.endswith(".pt"):
                    voice_name = filename[:-3]
                    if (
                        voice_name in self.available_voices
                    ):
                        cached_voices.add(voice_name)
            return cached_voices
        except (OSError, PermissionError) as e:
            logger.warning(f"Unable to scan voices directory: {e}")
            return set()

    def get_voices(self) -> Dict[str, bool]:
        """Every known voice -> whether its pack is on disk."""
        cached_voices = self._get_cached_voices()
        return {voice: voice in cached_voices for voice in self.available_voices}

    def get_pipeline(self, lang_code: str) -> KPipeline:
        """Get or create a pipeline for the given language code."""
        if lang_code not in self.pipelines:
            try:
                self.pipelines[lang_code] = KPipeline(
                    lang_code=lang_code,
                    repo_id="hexgrad/Kokoro-82M",
                    model=self.model,
                    model_dir=self.model_dir,
                )
            except Exception as e:
                # No fallback to the English pipeline: it would read the text
                # with English phonemes and return nonsense audio.
                logger.error(f"Failed to create pipeline for lang_code '{lang_code}': {e}")
                raise RuntimeError(
                    f"Voices for language '{lang_code}' are not available on this machine"
                ) from e
        return self.pipelines[lang_code]

    def synthesize(self, request: SpeechRequest, by_sentence: bool) -> Iterator[Piece]:
        """Speech for ``request``, one pipeline result at a time (lazy).

        ``by_sentence`` feeds the pipeline sentences rather than up-to-510-phoneme chunks, so a stream
        starts after the first sentence.
        """
        logger.info(f"VOICE_USED: {request.voice}")
        # Language from the voice prefix (e.g. 'z' from 'zf_xiaobei'), else
        # the request's lang_code, else American English.
        lang_code = request.voice[0] if request.voice else (request.lang_code or "a")
        logger.info("GENERATING WITH LANG_CODE: %s", lang_code)

        pipeline = self.get_pipeline(lang_code)
        text = split_sentences(request.input) if by_sentence else request.input
        for result in self.get_results(
            pipeline, text, voice=request.voice, speed=request.speed
        ):
            if result.audio is not None:
                audio = result.audio * request.volume_multiplier
                yield audio.detach().cpu().numpy(), SAMPLE_RATE


def is_windows():
    return os.name == "nt"


def setup_environment():
    # mp3/opus/aac/flac are encoded by the bundled ffmpeg (worker_common.speech).
    add_ffmpeg_to_path()

    if is_windows():
        os.environ["PYTHONUTF8"] = "1"
    else:
        # The system espeak-ng instead of espeakng-loader's.
        configure_system_espeak()
        os.environ["PYTHONUNBUFFERED"] = "1"


def create_app(tts_service: KokoroTTSService) -> FastAPI:
    app = worker_common.create_app(
        "Kokoro TTS API",
        description="OpenAI-compatible Text-to-Speech API using Kokoro TTS",
        version="1.0.0",
        healthcheck=False,
        # Called straight from the demo page on the app's port.
        allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    )

    @app.get("/healthcheck")
    async def healthcheck():
        """Health check endpoint."""
        return JSONResponse({"status": "ok"})

    @app.post("/v1/audio/speech")
    async def create_speech(request: SpeechRequest):
        """Generate speech, streamed sentence by sentence (``stream`` or SSE) or as a whole file."""
        headers = {}
        if request.return_download_link:
            # A path only: nothing is written to disk, so there is no file
            # behind it to serve.
            headers["X-Download-Path"] = (
                f"/downloads/audio_{hash(request.input)}.{request.response_format}"
            )
        try:
            return await speech_response(
                tts_service.synthesize(
                    request,
                    by_sentence=request.stream or request.stream_format == "sse",
                ),
                request.response_format,
                stream=request.stream,
                stream_format=request.stream_format,
                lock=tts_service.lock,
                headers=headers,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Speech generation failed: {e}")
            raise HTTPException(
                status_code=500, detail=f"Speech generation failed: {str(e)}"
            )

    @app.get("/v1/audio/voices")
    async def list_voices():
        """List all available voices for text-to-speech synthesis."""
        try:
            voices = tts_service.get_voices()
            return voices
        except Exception as e:
            logger.error(f"Error listing voices: {e}")
            raise HTTPException(status_code=500, detail="Failed to retrieve voices")

    install_models_routes(app, ["kokoro"], owned_by="kokoro")
    install_openai_errors(app)

    return app


def parse_arguments():
    return base_parser(
        "Kokoro TTS FastAPI Server",
        default_port=5002,
        default_device="AUTO",
        device_help="OpenVINO device: AUTO (OpenVINO selects), CPU, GPU, NPU (default: AUTO)",
        source=True,
    ).parse_args()


def main():
    args = parse_arguments()

    setup_environment()

    logger.info("Initializing Kokoro TTS service...")
    tts_service = KokoroTTSService(device=args.device, source=args.source)

    try:
        tts_service.initialize()
        logger.info("Kokoro TTS service initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize TTS service: {e}")
        return 1

    app = create_app(tts_service)

    logger.info(f"Starting Kokoro TTS server on port {args.port}")
    serve(app, args, log_level="info")

    return 0


if __name__ == "__main__":
    exit(main())
