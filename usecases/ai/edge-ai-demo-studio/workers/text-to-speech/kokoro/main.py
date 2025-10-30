# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import argparse
import tempfile
from typing import Dict, List, Optional
import logging

import uvicorn
import torch
import soundfile as sf
from pydub import AudioSegment
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from utils import create_cache_directory, validate_and_sanitize_cache_dir
from ov_kokoro import OVKModel
from kokoro import KPipeline

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ESPEAK_NG_VERSION = "1.52.0"


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
    response_format: str = Field(
        default="mp3", description="The format to return audio in"
    )
    download_format: Optional[str] = Field(
        None, description="Optional different format for the final download"
    )
    speed: float = Field(
        default=1.0, description="The speed of the generated audio", ge=0.25, le=4.0
    )
    stream: bool = Field(
        default=True, description="If true, audio will be streamed as it's generated"
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
    def __init__(self, device: str = "CPU"):
        self.device = device.upper()
        self.model = None
        self.pipelines: Dict[str, KPipeline] = {}
        self.model_dir = None
        self._voices_cache = None

    def initialize(self):
        """Initialize the Kokoro TTS model and pipelines."""
        try:
            logger.info(f"Initializing Kokoro TTS model on device: {self.device}")

            # Initialize the OpenVINO Kokoro model
            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))
            model_dir = os.path.join(project_root, "models", "tts", "kokoro")
            model_dir = validate_and_sanitize_cache_dir(model_dir)
            create_cache_directory(model_dir)
            self.model_dir = model_dir

            self.model = OVKModel(model_dir, self.device)

            # Initialize default pipeline
            self.pipelines["a"] = KPipeline(
                lang_code="a",
                repo_id="hexgrad/Kokoro-82M",
                model=self.model,
                model_dir=model_dir,
            )

            # Warm up the pipeline
            try:
                logger.info("Warming up Kokoro TTS pipeline...")
                # Use the pipeline to generate a short test audio
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

    def get_results(self, pipeline: KPipeline, text: str, voice: str, speed: float = 1):
        """Helper to get results from a pipeline."""
        # Ensure self.model is initialized and has model_dir
        if self.model is None or not hasattr(self.model, "model_dir"):
            raise RuntimeError(
                "KokoroTTSService model is not initialized or missing 'model_dir' attribute."
            )

        # Check if voice is already available locally in the model directory
        model_voice_path = os.path.join(self.model.model_dir, "voices", f"{voice}.pt")
        if not os.path.exists(model_voice_path):
            logger.warning(f"Voice '{voice}' not found locally, downloading from hub")
        else:
            # Return path to local voice file
            voice = os.path.join(self.model_dir, "voices", f"{voice}.pt")
        return pipeline(text, voice=voice, speed=speed)

    @property
    def available_voices(self) -> List[str]:
        """Get the list of all supported Kokoro voices."""
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
                    voice_name = filename[:-3]  # Remove .pt extension
                    if (
                        voice_name in self.available_voices
                    ):  # Validate against known voices
                        cached_voices.add(voice_name)
            return cached_voices
        except (OSError, PermissionError) as e:
            logger.warning(f"Unable to scan voices directory: {e}")
            return set()

    def get_voices(self) -> Dict[str, bool]:
        """
        Get the status of all available voices.

        Returns:
            Dict mapping voice names to their cached status (True if cached locally, False if not)
        """
        cached_voices = self._get_cached_voices()
        return {voice: voice in cached_voices for voice in self.available_voices}

    def get_pipeline(self, lang_code: str) -> KPipeline:
        """Get or create a pipeline for the given language code."""
        if lang_code not in self.pipelines:
            try:
                self.pipelines[lang_code] = KPipeline(
                    lang_code=lang_code, repo_id="hexgrad/Kokoro-82M", model=self.model
                )
            except Exception as e:
                logger.warning(
                    f"Failed to create pipeline for lang_code '{lang_code}', falling back to default: {e}"
                )
                return self.pipelines["a"]
        return self.pipelines[lang_code]

    async def generate_speech(self, request: SpeechRequest):
        """Generate speech from text using Kokoro TTS."""
        try:
            logger.info(f"VOICE_USED: {request.voice}")
            # Determine language code from request or infer from voice prefix
            if request.voice:
                lang_code = request.voice[
                    0
                ]  # Extract language from voice prefix (e.g., 'z' from 'zf_xiaobei')
            else:
                lang_code = (
                    request.lang_code or "a"
                )  # Default to the default lang_code or American English

            logger.info("GENERATING WITH LANG_CODE: %s", lang_code)

            # Get the appropriate pipeline
            pipeline = self.get_pipeline(lang_code)

            # Generate audio
            audio_chunks = []
            for result in self.get_results(
                pipeline, request.input, voice=request.voice, speed=request.speed
            ):
                if result.audio is not None:
                    # Apply volume multiplier
                    audio = result.audio * request.volume_multiplier
                    audio_chunks.append(audio)

            if not audio_chunks:
                raise HTTPException(status_code=500, detail="No audio generated")

            # Concatenate all audio chunks
            full_audio = torch.cat(audio_chunks, dim=0)

            # Convert to desired format
            audio_bytes = self._convert_audio_format(
                full_audio, request.response_format
            )

            if request.stream:
                # For streaming, we'll return the full audio at once for now
                # In a production system, you might want to implement proper streaming
                return self._create_streaming_response(
                    audio_bytes, request.response_format
                )
            else:
                return audio_bytes

        except Exception as e:
            logger.error(f"Speech generation failed: {e}")
            raise HTTPException(
                status_code=500, detail=f"Speech generation failed: {str(e)}"
            )

    def _convert_audio_format(
        self, audio_tensor: torch.Tensor, format_type: str
    ) -> bytes:
        """Convert audio tensor to the specified format."""
        # Ensure audio is in the correct shape (channels, samples)
        if audio_tensor.dim() == 1:
            audio_tensor = audio_tensor.unsqueeze(0)  # Add channel dimension

        # Kokoro outputs at 24kHz, normalize to [-1, 1]
        audio_tensor = torch.clamp(audio_tensor, -1.0, 1.0)
        temp_dir = "./temp"
        os.makedirs(temp_dir, exist_ok=True)

        # Handle raw PCM bytes directly
        if format_type.lower() == "pcm":
            # Return raw 16-bit PCM samples
            audio_int16 = (audio_tensor * 32767).clamp(-32768, 32767).to(torch.int16)
            return audio_int16.cpu().numpy().tobytes()

        # We'll always write a temporary WAV first using soundfile, then
        # convert/export with pydub if a different format is requested.
        tmp_wav_fd, tmp_wav_path = tempfile.mkstemp(suffix=".wav", dir=temp_dir)
        try:
            os.close(tmp_wav_fd)
        except Exception:
            pass

        tmp_out_fd = None
        tmp_out_path = None

        try:
            # Convert tensor (channels, samples) -> numpy (samples, channels)
            np_audio = audio_tensor.cpu().numpy()
            if np_audio.ndim == 1:
                np_audio = np_audio.reshape(-1, 1)
            else:
                # channels first -> samples x channels
                np_audio = np_audio.T

            # Write WAV (PCM 16) at 24000 Hz
            sf.write(tmp_wav_path, np_audio, 24000, subtype="PCM_16")

            if format_type.lower() == "wav":
                with open(tmp_wav_path, "rb") as f:
                    return f.read()

            # For other formats (mp3, flac, opus, etc.) use pydub/ffmpeg to export
            tmp_out_fd, tmp_out_path = tempfile.mkstemp(
                suffix=f".{format_type}", dir=temp_dir
            )
            try:
                os.close(tmp_out_fd)
            except Exception:
                pass

            # Load WAV into pydub and export to desired format
            audio_seg = AudioSegment.from_wav(tmp_wav_path)
            # pydub expects format names like 'mp3', 'flac', 'ogg', 'wav', 'opus'
            audio_seg.export(tmp_out_path, format=format_type)

            with open(tmp_out_path, "rb") as f:
                return f.read()
        finally:
            # Clean up temporary files if they exist
            for p in (tmp_wav_path, tmp_out_path):
                try:
                    if p and os.path.exists(p):
                        os.unlink(p)
                except Exception:
                    # Don't raise from cleanup
                    pass

    def _create_streaming_response(self, audio_bytes: bytes, format_type: str):
        """Create a streaming response for audio data."""

        def generate():
            chunk_size = 8192
            for i in range(0, len(audio_bytes), chunk_size):
                yield audio_bytes[i : i + chunk_size]

        media_type = self._get_media_type(format_type)
        return StreamingResponse(generate(), media_type=media_type)

    def _get_media_type(self, format_type: str) -> str:
        """Get the appropriate media type for the audio format."""
        format_map = {
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
            "flac": "audio/flac",
            "opus": "audio/opus",
            "pcm": "audio/pcm",
        }
        return format_map.get(format_type.lower(), "audio/mpeg")


def is_windows():
    """Check if the current operating system is Windows."""
    return os.name == "nt"


def setup_environment():
    """Setup environment variables for Kokoro TTS."""
    if is_windows():
        os.environ["PYTHONUTF8"] = "1"
        script_dir = os.path.dirname(os.path.abspath(__file__))
        os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = os.path.join(
            script_dir,
            os.path.pardir,
            f"espeak-ng-{ESPEAK_NG_VERSION}",
            "src",
            "libespeak-ng",
            "libespeak-ng.dll",
        )
        ffmpeg_path = os.path.join(
            script_dir, "..", "..", "thirdparty", "ffmpeg", "bin"
        )
        os.environ["PATH"] += os.pathsep + ffmpeg_path
        print(os.environ["PATH"])
    else:
        os.environ["PHONEMIZER_ESPEAK_PATH"] = "/usr/bin"
        os.environ["PHONEMIZER_ESPEAK_DATA"] = "/usr/share/espeak-ng-data"
        os.environ["ESPEAK_DATA_PATH"] = "/usr/share/espeak-ng-data"
        os.environ["PYTHONUNBUFFERED"] = "1"


def create_app(tts_service: KokoroTTSService) -> FastAPI:
    """Create and configure FastAPI application."""
    app = FastAPI(
        title="Kokoro TTS API",
        description="OpenAI-compatible Text-to-Speech API using Kokoro TTS",
        version="1.0.0",
    )

    allowed_origins = [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ]

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthcheck")
    async def healthcheck():
        """Health check endpoint."""
        return JSONResponse({"status": "ok"})

    @app.post("/v1/audio/speech")
    async def create_speech(request: SpeechRequest):
        """Generate spoken audio from input text using Kokoro TTS."""
        try:
            result = await tts_service.generate_speech(request)

            if isinstance(result, StreamingResponse):
                return result
            else:
                media_type = tts_service._get_media_type(request.response_format)
                headers = {}
                if request.return_download_link:
                    # In a production system, you would save the file and return a proper download link
                    headers["X-Download-Path"] = (
                        f"/downloads/audio_{hash(request.input)}.{request.response_format}"
                    )

                return Response(content=result, media_type=media_type, headers=headers)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Unexpected error in speech generation: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")

    @app.get("/v1/audio/voices")
    async def list_voices():
        """List all available voices for text-to-speech synthesis."""
        try:
            voices = tts_service.get_voices()
            return voices
        except Exception as e:
            logger.error(f"Error listing voices: {e}")
            raise HTTPException(status_code=500, detail="Failed to retrieve voices")

    return app


def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Kokoro TTS FastAPI Server")
    parser.add_argument(
        "--port", type=int, default=5002, help="Port to serve on (default: 5002)"
    )
    parser.add_argument(
        "--device",
        type=str,
        default="CPU",
        help="Device to use for inference (default: CPU)",
    )
    return parser.parse_args()


def run_server(app: FastAPI, port: int):
    """Run the FastAPI server."""
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


def main():
    """Main function to run the Kokoro TTS server."""
    # Parse command line arguments
    args = parse_arguments()

    # Setup environment
    setup_environment()

    # Initialize TTS service
    logger.info("Initializing Kokoro TTS service...")
    tts_service = KokoroTTSService(device=args.device)

    try:
        tts_service.initialize()
        logger.info("Kokoro TTS service initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize TTS service: {e}")
        return 1

    # Create FastAPI application
    app = create_app(tts_service)

    # Run the server
    logger.info(f"Starting Kokoro TTS server on port {args.port}")
    run_server(app, port=args.port)

    return 0


if __name__ == "__main__":
    exit(main())
