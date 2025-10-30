# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import subprocess  # nosec
import string
import uuid
import requests
import numpy as np
import soundfile as sf
from pydub import AudioSegment

import openvino as ov
import openvino.properties.hint as hints
import openvino_genai

import wave
import os
import copy
from pathlib import Path
import re
import ffmpeg

from huggingface_hub import snapshot_download

MAX_PATH_LENGTH = 4096

logger = logging.getLogger("uvicorn.error")


def validate_and_sanitize_cache_dir(cache_dir: str) -> str:
    """
    Validate and sanitize a cache directory path to prevent path manipulation attacks.

    Args:
        cache_dir: The cache directory path to validate

    Returns:
        str: The validated and normalized cache directory path

    Raises:
        ValueError: If the path is invalid or poses security risks
    """
    # Basic validation
    if not cache_dir or not isinstance(cache_dir, str):
        raise ValueError("Invalid model cache directory: must be a valid string path")

    # Convert to absolute path and resolve any symbolic links/relative paths
    try:
        # Expand user directory (~) and resolve relative paths
        cache_dir = os.path.expanduser(cache_dir)
        cache_dir = os.path.abspath(cache_dir)

        # Use pathlib for additional validation
        cache_path = Path(cache_dir).resolve()
        cache_dir = str(cache_path)
    except (OSError, ValueError) as e:
        raise ValueError(f"Invalid model cache directory path: {e}")

    # Security check: ensure the path doesn't contain dangerous patterns
    # Check for directory traversal attempts
    if ".." in cache_dir:
        raise ValueError(
            "Model cache directory cannot contain '..' (directory traversal)"
        )

    # Define allowed base directories for cache
    allowed_base_dirs = [
        os.path.expanduser("~"),  # User home directory
        "/tmp",  # Temporary directory
        "/var/cache",  # System cache directory
        "/opt",  # Optional software directory
    ]

    # Check if the resolved path is within allowed directories
    path_is_allowed = False
    for allowed_base in allowed_base_dirs:
        try:
            allowed_resolved = Path(allowed_base).resolve()
            try:
                if Path(cache_dir).resolve().is_relative_to(allowed_resolved):
                    path_is_allowed = True
                    break
            except AttributeError:  # Fallback for Python < 3.9
                if str(allowed_resolved) in str(Path(cache_dir).resolve()):
                    if (
                        Path(cache_dir).resolve().parts[: len(allowed_resolved.parts)]
                        == allowed_resolved.parts
                    ):
                        path_is_allowed = True
                        break
        except (OSError, ValueError):
            continue

    if not path_is_allowed:
        raise ValueError(
            f"Model cache directory must be within allowed locations: {allowed_base_dirs}. "
            f"Attempted path: {cache_dir}"
        )

    # Additional security checks for sensitive system directories
    sensitive_paths = [
        "/etc",
        "/usr",
        "/bin",
        "/sbin",
        "/boot",
        "/sys",
        "/proc",
        "/dev",
        "/root",
    ]
    if any(cache_dir.startswith(sensitive) for sensitive in sensitive_paths):
        raise ValueError(
            f"Invalid model cache directory: {cache_dir} points to a sensitive system directory"
        )

    # Ensure the directory name is reasonable (not too long, valid characters)
    if len(cache_dir) > MAX_PATH_LENGTH:  # Increased from 255 to accommodate full paths
        raise ValueError("Model cache directory path is too long (>4096 characters)")

    # Check for valid characters (avoid control characters and potentially dangerous chars)
    # Include platform-specific path separators and Windows drive letter colon
    valid_chars = string.ascii_letters + string.digits + "/-._~" + os.sep
    if os.name == "nt":  # Add ':' for Windows drive letters
        valid_chars += ":"
    if not all(c in valid_chars for c in cache_dir):
        raise ValueError("Model cache directory contains invalid characters")

    return cache_dir


def create_cache_directory(cache_dir: str) -> None:
    """
    Create the cache directory with secure permissions if it doesn't exist.

    Args:
        cache_dir: The validated cache directory path to create

    Raises:
        ValueError: If directory creation fails
    """
    if not os.path.exists(cache_dir):
        try:
            # Create directory with user-only permissions (700)
            os.makedirs(cache_dir, mode=0o700, exist_ok=True)
        except OSError as e:
            raise ValueError(f"Failed to create model cache directory: {e}")


def validate_and_sanitize_model_id(model_id: str) -> str:
    """
    Validate and sanitize a model ID to prevent path manipulation attacks.

    Args:
        model_id: The model ID to validate (can be a Hugging Face model name or local path)

    Returns:
        str: The validated model ID

    Raises:
        ValueError: If the model ID is invalid or poses security risks
    """
    # Basic validation
    if not model_id or not isinstance(model_id, str):
        raise ValueError("Invalid model ID: must be a valid string")

    # Trim whitespace
    model_id = model_id.strip()

    if not model_id:
        raise ValueError("Invalid model ID: cannot be empty")

    # Check length (reasonable limit)
    if len(model_id) > 256:
        raise ValueError("Model ID is too long (>256 characters)")

    # Security check: prevent directory traversal
    if ".." in model_id:
        raise ValueError("Model ID cannot contain '..' (directory traversal)")

    # Prevent absolute paths starting with /
    if model_id.startswith("/"):
        raise ValueError("Model ID cannot be an absolute path")

    # Prevent Windows-style paths
    if "\\" in model_id:
        raise ValueError("Model ID cannot contain backslashes")

    # For Hugging Face model names (org/model format), validate format
    if "/" in model_id:
        parts = model_id.split("/")
        if len(parts) != 2:
            raise ValueError("Model ID with '/' must be in 'organization/model' format")

        organization, model_name = parts

        # Validate organization name
        if not organization:
            raise ValueError("Organization name cannot be empty")
        # Organization names: alphanumeric, hyphens, underscores
        if not re.match(r"^[a-zA-Z0-9_-]+$", organization):
            raise ValueError(f"Invalid characters in organization name: {organization}")

        # Validate model name - more permissive for HF models
        if not model_name:
            raise ValueError("Model name cannot be empty")
        # Model names: alphanumeric, hyphens, underscores, dots (for versions like 2.5)
        if not re.match(r"^[a-zA-Z0-9._-]+$", model_name):
            raise ValueError(f"Invalid characters in model name: {model_name}")
    else:
        # For local model names, validate characters
        if not re.match(r"^[a-zA-Z0-9._-]+$", model_id):
            raise ValueError(f"Invalid characters in model ID: {model_id}")

    return model_id


class OptimumCLI:
    def run_export(model_name_or_path, output_dir):
        # Build the command as a list to avoid shell injection
        command = [
            "optimum-cli",
            "export",
            "openvino",
            "--trust-remote-code",
            "--model",
            model_name_or_path,
            output_dir,
        ]
        subprocess.run(command, check=True)


def download_model(model_id: str, model_dir: str):
    """
    Download the model from Hugging Face Hub if it is not already present.
    """
    try:
        print(f"Downloading model: {model_id}...")
        path = snapshot_download(repo_id=model_id, local_dir=model_dir)
        return path
    except Exception as e:
        print(f"Error downloading {model_id}: {e}")
        raise RuntimeError(f"Failed to download model {model_id}")


def download_and_export_model(model_name_or_path, output_dir):
    logger.info(f"Downloading model: {model_name_or_path} to {output_dir}")
    OptimumCLI.run_export(model_name_or_path, output_dir)


def verify_device_available(device):
    logger.info(f"Verifying device availability: {device.upper()}")
    core = ov.Core()
    available_devices = core.available_devices
    if device.upper() in available_devices:
        return device.upper()
    else:
        logger.error(f"Device not available: {device.upper()}. Default to CPU device.")
        return "CPU"


def load_model_pipeline(model_dir, device="CPU"):
    logger.info(f"Initializing pipeline on device: {device}")
    pipeline = openvino_genai.WhisperPipeline(model_dir, device)
    return pipeline


def get_local_ffmpeg_path():
    """Get the path to the locally installed ffmpeg in thirdparty folder."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workers_dir = os.path.dirname(script_dir)
    thirdparty_dir = os.path.join(workers_dir, "thirdparty")

    # Try Windows first
    ffmpeg_exe = os.path.join(thirdparty_dir, "ffmpeg", "bin", "ffmpeg.exe")
    if os.path.exists(ffmpeg_exe):
        return ffmpeg_exe

    # Try Linux/Mac
    ffmpeg_bin = os.path.join(thirdparty_dir, "ffmpeg", "bin", "ffmpeg")
    if os.path.exists(ffmpeg_bin):
        return ffmpeg_bin

    return None


def ensure_wav(in_path: str, out_wav: str) -> bool:
    """Convert arbitrary audio file to 16k mono 16-bit WAV.
    Try pydub first, fall back to ffmpeg if needed.
    Returns True on success.
    """
    try:
        audio = AudioSegment.from_file(in_path)
        audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
        audio.export(out_wav, format="wav")
        logger.info(f"Converted {in_path} -> {out_wav} using pydub")
        return True
    except Exception as e:
        logger.warning(
            f"pydub failed to process {in_path}: {e}; trying ffmpeg-python fallback"
        )
    # Try ffmpeg-python if installed
    try:
        (
            ffmpeg.input(in_path)
            .output(out_wav, format="wav", acodec="pcm_s16le", ac=1, ar="16k")
            .run(overwrite_output=True, quiet=True)
        )
        # Verify the output file was actually created
        if os.path.exists(out_wav) and os.path.getsize(out_wav) > 0:
            logger.info(f"Converted {in_path} -> {out_wav} using ffmpeg-python")
            return True
        else:
            logger.warning(
                f"ffmpeg completed but output file {out_wav} was not created or is empty"
            )
            return False
    except Exception as e:
        logger.warning(
            f"ffmpeg-python failed to process {in_path}: {e}; trying local ffmpeg fallback"
        )

    # Try local ffmpeg from thirdparty folder
    local_ffmpeg = get_local_ffmpeg_path()
    if local_ffmpeg:
        try:
            import subprocess  # nosec -- used to run ffmpeg in secured environment

            subprocess.run(
                [
                    local_ffmpeg,
                    "-i",
                    in_path,
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-c:a",
                    "pcm_s16le",
                    "-y",
                    out_wav,
                ],
                check=True,
                capture_output=True,
            )

            if os.path.exists(out_wav) and os.path.getsize(out_wav) > 0:
                logger.info(f"Converted {in_path} -> {out_wav} using local ffmpeg")
                return True
            else:
                logger.warning(
                    f"Local ffmpeg completed but output file {out_wav} was not created or is empty"
                )
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            logger.warning(
                f"Local ffmpeg failed to process {in_path}: {e}; trying system ffmpeg fallback"
            )

    # Try system ffmpeg as last resort
    try:
        import subprocess  # nosec -- used to run ffmpeg in secured environment

        subprocess.run(
            [
                "ffmpeg",
                "-i",
                in_path,
                "-ar",
                "16000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                "-y",
                out_wav,
            ],
            check=True,
            capture_output=True,
        )

        if os.path.exists(out_wav) and os.path.getsize(out_wav) > 0:
            logger.info(f"Converted {in_path} -> {out_wav} using system ffmpeg")
            return True
        else:
            logger.warning(
                f"System ffmpeg completed but output file {out_wav} was not created or is empty"
            )
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        logger.warning(f"System ffmpeg failed to process {in_path}: {e}")

    logger.error(
        "No available converter succeeded (pydub, ffmpeg-python, local ffmpeg, or system ffmpeg)."
    )
    return False


def resample(audio, src_sample_rate, dst_sample_rate):
    if src_sample_rate == dst_sample_rate:
        return audio
    duration = audio.shape[0] / src_sample_rate
    resampled_data = np.zeros(shape=(int(duration * dst_sample_rate)), dtype=np.float32)
    x_old = np.linspace(0, duration, audio.shape[0], dtype=np.float32)
    x_new = np.linspace(0, duration, resampled_data.shape[0], dtype=np.float32)
    resampled_audio = np.interp(x_new, x_old, audio)
    return resampled_audio.astype(np.float32)


def language_mapping(language):
    """
    Maps ISO-639-1 language codes to the format expected by the model.
    Supports all standard ISO-639-1 language codes.

    Args:
        language (str): ISO-639-1 language code (e.g., 'en', 'fr', 'zh')

    Returns:
        str: Formatted language token (e.g., '<|en|>')
    """
    # Complete ISO-639-1 language code mapping
    iso_639_1_mapping = {
        "aa": "<|aa|>",  # Afar
        "ab": "<|ab|>",  # Abkhazian
        "ae": "<|ae|>",  # Avestan
        "af": "<|af|>",  # Afrikaans
        "ak": "<|ak|>",  # Akan
        "am": "<|am|>",  # Amharic
        "an": "<|an|>",  # Aragonese
        "ar": "<|ar|>",  # Arabic
        "as": "<|as|>",  # Assamese
        "av": "<|av|>",  # Avaric
        "ay": "<|ay|>",  # Aymara
        "az": "<|az|>",  # Azerbaijani
        "ba": "<|ba|>",  # Bashkir
        "be": "<|be|>",  # Belarusian
        "bg": "<|bg|>",  # Bulgarian
        "bh": "<|bh|>",  # Bihari languages
        "bi": "<|bi|>",  # Bislama
        "bm": "<|bm|>",  # Bambara
        "bn": "<|bn|>",  # Bengali
        "bo": "<|bo|>",  # Tibetan
        "br": "<|br|>",  # Breton
        "bs": "<|bs|>",  # Bosnian
        "ca": "<|ca|>",  # Catalan
        "ce": "<|ce|>",  # Chechen
        "ch": "<|ch|>",  # Chamorro
        "co": "<|co|>",  # Corsican
        "cr": "<|cr|>",  # Cree
        "cs": "<|cs|>",  # Czech
        "cu": "<|cu|>",  # Church Slavonic
        "cv": "<|cv|>",  # Chuvash
        "cy": "<|cy|>",  # Welsh
        "da": "<|da|>",  # Danish
        "de": "<|de|>",  # German
        "dv": "<|dv|>",  # Divehi
        "dz": "<|dz|>",  # Dzongkha
        "ee": "<|ee|>",  # Ewe
        "el": "<|el|>",  # Greek
        "en": "<|en|>",  # English
        "eo": "<|eo|>",  # Esperanto
        "es": "<|es|>",  # Spanish
        "et": "<|et|>",  # Estonian
        "eu": "<|eu|>",  # Basque
        "fa": "<|fa|>",  # Persian
        "ff": "<|ff|>",  # Fulah
        "fi": "<|fi|>",  # Finnish
        "fj": "<|fj|>",  # Fijian
        "fo": "<|fo|>",  # Faroese
        "fr": "<|fr|>",  # French
        "fy": "<|fy|>",  # Western Frisian
        "ga": "<|ga|>",  # Irish
        "gd": "<|gd|>",  # Scottish Gaelic
        "gl": "<|gl|>",  # Galician
        "gn": "<|gn|>",  # Guarani
        "gu": "<|gu|>",  # Gujarati
        "gv": "<|gv|>",  # Manx
        "ha": "<|ha|>",  # Hausa
        "he": "<|he|>",  # Hebrew
        "hi": "<|hi|>",  # Hindi
        "ho": "<|ho|>",  # Hiri Motu
        "hr": "<|hr|>",  # Croatian
        "ht": "<|ht|>",  # Haitian Creole
        "hu": "<|hu|>",  # Hungarian
        "hy": "<|hy|>",  # Armenian
        "hz": "<|hz|>",  # Herero
        "ia": "<|ia|>",  # Interlingua
        "id": "<|id|>",  # Indonesian
        "ie": "<|ie|>",  # Interlingue
        "ig": "<|ig|>",  # Igbo
        "ii": "<|ii|>",  # Sichuan Yi
        "ik": "<|ik|>",  # Inupiaq
        "io": "<|io|>",  # Ido
        "is": "<|is|>",  # Icelandic
        "it": "<|it|>",  # Italian
        "iu": "<|iu|>",  # Inuktitut
        "ja": "<|ja|>",  # Japanese
        "jv": "<|jv|>",  # Javanese
        "ka": "<|ka|>",  # Georgian
        "kg": "<|kg|>",  # Kongo
        "ki": "<|ki|>",  # Kikuyu
        "kj": "<|kj|>",  # Kuanyama
        "kk": "<|kk|>",  # Kazakh
        "kl": "<|kl|>",  # Kalaallisut
        "km": "<|km|>",  # Central Khmer
        "kn": "<|kn|>",  # Kannada
        "ko": "<|ko|>",  # Korean
        "kr": "<|kr|>",  # Kanuri
        "ks": "<|ks|>",  # Kashmiri
        "ku": "<|ku|>",  # Kurdish
        "kv": "<|kv|>",  # Komi
        "kw": "<|kw|>",  # Cornish
        "ky": "<|ky|>",  # Kirghiz
        "la": "<|la|>",  # Latin
        "lb": "<|lb|>",  # Luxembourgish
        "lg": "<|lg|>",  # Ganda
        "li": "<|li|>",  # Limburgan
        "ln": "<|ln|>",  # Lingala
        "lo": "<|lo|>",  # Lao
        "lt": "<|lt|>",  # Lithuanian
        "lu": "<|lu|>",  # Luba-Katanga
        "lv": "<|lv|>",  # Latvian
        "mg": "<|mg|>",  # Malagasy
        "mh": "<|mh|>",  # Marshallese
        "mi": "<|mi|>",  # Maori
        "mk": "<|mk|>",  # Macedonian
        "ml": "<|ml|>",  # Malayalam
        "mn": "<|mn|>",  # Mongolian
        "mr": "<|mr|>",  # Marathi
        "ms": "<|ms|>",  # Malay
        "mt": "<|mt|>",  # Maltese
        "my": "<|my|>",  # Burmese
        "na": "<|na|>",  # Nauru
        "nb": "<|nb|>",  # Norwegian Bokmål
        "nd": "<|nd|>",  # North Ndebele
        "ne": "<|ne|>",  # Nepali
        "ng": "<|ng|>",  # Ndonga
        "nl": "<|nl|>",  # Dutch
        "nn": "<|nn|>",  # Norwegian Nynorsk
        "no": "<|no|>",  # Norwegian
        "nr": "<|nr|>",  # South Ndebele
        "nv": "<|nv|>",  # Navajo
        "ny": "<|ny|>",  # Chichewa
        "oc": "<|oc|>",  # Occitan
        "oj": "<|oj|>",  # Ojibwa
        "om": "<|om|>",  # Oromo
        "or": "<|or|>",  # Oriya
        "os": "<|os|>",  # Ossetian
        "pa": "<|pa|>",  # Panjabi
        "pi": "<|pi|>",  # Pali
        "pl": "<|pl|>",  # Polish
        "ps": "<|ps|>",  # Pushto
        "pt": "<|pt|>",  # Portuguese
        "qu": "<|qu|>",  # Quechua
        "rm": "<|rm|>",  # Romansh
        "rn": "<|rn|>",  # Rundi
        "ro": "<|ro|>",  # Romanian
        "ru": "<|ru|>",  # Russian
        "rw": "<|rw|>",  # Kinyarwanda
        "sa": "<|sa|>",  # Sanskrit
        "sc": "<|sc|>",  # Sardinian
        "sd": "<|sd|>",  # Sindhi
        "se": "<|se|>",  # Northern Sami
        "sg": "<|sg|>",  # Sango
        "si": "<|si|>",  # Sinhala
        "sk": "<|sk|>",  # Slovak
        "sl": "<|sl|>",  # Slovenian
        "sm": "<|sm|>",  # Samoan
        "sn": "<|sn|>",  # Shona
        "so": "<|so|>",  # Somali
        "sq": "<|sq|>",  # Albanian
        "sr": "<|sr|>",  # Serbian
        "ss": "<|ss|>",  # Swati
        "st": "<|st|>",  # Southern Sotho
        "su": "<|su|>",  # Sundanese
        "sv": "<|sv|>",  # Swedish
        "sw": "<|sw|>",  # Swahili
        "ta": "<|ta|>",  # Tamil
        "te": "<|te|>",  # Telugu
        "tg": "<|tg|>",  # Tajik
        "th": "<|th|>",  # Thai
        "ti": "<|ti|>",  # Tigrinya
        "tk": "<|tk|>",  # Turkmen
        "tl": "<|tl|>",  # Tagalog
        "tn": "<|tn|>",  # Tswana
        "to": "<|to|>",  # Tonga
        "tr": "<|tr|>",  # Turkish
        "ts": "<|ts|>",  # Tsonga
        "tt": "<|tt|>",  # Tatar
        "tw": "<|tw|>",  # Twi
        "ty": "<|ty|>",  # Tahitian
        "ug": "<|ug|>",  # Uighur
        "uk": "<|uk|>",  # Ukrainian
        "ur": "<|ur|>",  # Urdu
        "uz": "<|uz|>",  # Uzbek
        "ve": "<|ve|>",  # Venda
        "vi": "<|vi|>",  # Vietnamese
        "vo": "<|vo|>",  # Volapük
        "wa": "<|wa|>",  # Walloon
        "wo": "<|wo|>",  # Wolof
        "xh": "<|xh|>",  # Xhosa
        "yi": "<|yi|>",  # Yiddish
        "yo": "<|yo|>",  # Yoruba
        "za": "<|za|>",  # Zhuang
        "zh": "<|zh|>",  # Chinese
        "zu": "<|zu|>",  # Zulu
    }

    # Convert input to lowercase for case-insensitive matching
    language_code = language.lower() if language else ""

    # Return the mapped language token, defaulting to English if not found
    return iso_639_1_mapping.get(language_code, "<|en|>")


def transcribe(pipeline, audio, language="english"):
    config = pipeline.get_generation_config()
    if config.is_multilingual:
        config.language = language_mapping(language)
        config.task = "transcribe"

    data, fs = sf.read(audio)
    resampled_audio = resample(
        audio=data, src_sample_rate=fs, dst_sample_rate=16000
    ).astype(np.float32)

    results = pipeline.generate(resampled_audio, config)
    if results.texts and len(results.texts) > 0:
        return results.texts[0]
    else:
        logger.error("No transcription results.")
        return ""


def translate(pipeline, audio, source_language="english"):
    """
    translate is taking the source language and output to english
    """
    config = pipeline.get_generation_config()
    if config.is_multilingual:
        config.language = language_mapping(source_language)
        config.task = "translate"

    data, fs = sf.read(audio)
    resampled_audio = resample(
        audio=data, src_sample_rate=fs, dst_sample_rate=16000
    ).astype(np.float32)
    results = pipeline.generate(resampled_audio, config)
    if results.texts and len(results.texts) > 0:
        return results.texts[0]
    else:
        logger.error("No translation results.")
        return ""


# DENOISE UTILS
def download_omz_model(model_dir: str, model_id: str, model_precision: str = "FP32"):
    """Download the model directly from OpenVINO Model Zoo storage."""
    # Create the model directory structure
    model_path = os.path.join(model_dir, "intel", model_id, model_precision)
    os.makedirs(model_path, exist_ok=True)

    # Base URL for OpenVINO Model Zoo storage
    base_url = "https://storage.openvinotoolkit.org/repositories/open_model_zoo/temp"

    # Download both .xml and .bin files
    for file_ext in ["xml", "bin"]:
        file_url = f"{base_url}/{model_id}/{model_precision}/{model_id}.{file_ext}"
        file_path = os.path.join(model_path, f"{model_id}.{file_ext}")

        try:
            logger.info(f"Downloading {file_url}...")
            response = requests.get(file_url, stream=True, timeout=30)
            response.raise_for_status()

            with open(file_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)

            logger.info(f"Successfully downloaded {model_id}.{file_ext}")

        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to download {file_url}: {str(e)}")
            # Clean up partial downloads
            if os.path.exists(file_path):
                os.remove(file_path)
            raise RuntimeError(f"Failed to download model {model_id}.{file_ext}")

    logger.info(f"Model {model_id} downloaded successfully to {model_path}.")


def load_denoise_model(model_dir: str, device: str):
    """Load and compile the denoising model."""
    core = ov.Core()
    config = {hints.performance_mode: hints.PerformanceMode.LATENCY}

    if not os.path.exists(model_dir):
        raise FileNotFoundError(f"Model file not found: {model_dir}")

    compiled_model = core.compile_model(model_dir, device, config)
    logger.info(f"Denoising model {model_dir} loaded and compiled.")
    return compiled_model


def wav_read(wav_name):
    with wave.open(wav_name, "rb") as wav:
        if wav.getsampwidth() != 2:
            raise RuntimeError(f"wav file {wav_name} does not have int16 format")
        freq = wav.getframerate()
        data = wav.readframes(wav.getnframes())
        x = np.frombuffer(data, dtype=np.int16)
        x = x.astype(np.float32) * (1.0 / np.iinfo(np.int16).max)
        if wav.getnchannels() > 1:
            x = x.reshape(-1, wav.getnchannels())
            x = x.mean(1)
    return x, freq


def wav_write(wav_name, x, freq):
    x = np.clip(x, -1, +1)
    x = (x * np.iinfo(np.int16).max).astype(np.int16)
    with wave.open(wav_name, "wb") as wav:
        wav.setnchannels(1)
        wav.setframerate(freq)
        wav.setsampwidth(2)
        wav.writeframes(x.tobytes())


def denoise(compiled_model, file_path):
    ov_encoder = compiled_model

    # Load the audio file
    audio = AudioSegment.from_wav(f"{file_path}")

    # Set the target sampling rate (16000 Hz)
    target_sr = 16000

    # Resample the audio to the target sampling rate
    resampled_audio = audio.set_frame_rate(target_sr)

    # Export the resampled audio to a new WAV file
    resampled_audio.export(f"{file_path}", format="wav")

    inp_shapes = {
        name: obj.shape for obj in ov_encoder.inputs for name in obj.get_names()
    }
    out_shapes = {
        name: obj.shape for obj in ov_encoder.outputs for name in obj.get_names()
    }

    state_out_names = [n for n in out_shapes.keys() if "state" in n]
    state_inp_names = [n for n in inp_shapes.keys() if "state" in n]
    if len(state_inp_names) != len(state_out_names):
        raise RuntimeError(
            "Number of input states of the model ({}) is not equal to number of output states({})".format(
                len(state_inp_names), len(state_out_names)
            )
        )

    compiled_model = compiled_model
    infer_request = compiled_model.create_infer_request()
    sample_inp, freq_data = wav_read(str(file_path))
    sample_size = sample_inp.shape[0]

    infer_request.infer()
    delay = 0
    if "delay" in out_shapes:
        delay = infer_request.get_tensor("delay").data[0]
        sample_inp = np.pad(sample_inp, ((0, delay),))
    freq_model = 16000
    if "freq" in out_shapes:
        freq_model = infer_request.get_tensor("freq").data[0]

    if freq_data != freq_model:
        raise RuntimeError(
            "Wav file {} sampling rate {} does not match model sampling rate {}".format(
                file_path, freq_data, freq_model
            )
        )

    input_size = inp_shapes["input"][1]
    res = None

    samples_out = []
    while sample_inp is not None and sample_inp.shape[0] > 0:
        if sample_inp.shape[0] > input_size:
            input = sample_inp[:input_size]
            sample_inp = sample_inp[input_size:]
        else:
            input = np.pad(
                sample_inp, ((0, input_size - sample_inp.shape[0]),), mode="constant"
            )
            sample_inp = None

        # forms input
        inputs = {"input": input[None, :]}

        # add states to input
        for n in state_inp_names:
            if res:
                inputs[n] = infer_request.get_tensor(n.replace("inp", "out")).data
            else:
                # on the first iteration fill states by zeros
                inputs[n] = np.zeros(inp_shapes[n], dtype=np.float32)

        infer_request.infer(inputs)
        res = infer_request.get_tensor("output")
        samples_out.append(copy.deepcopy(res.data).squeeze(0))

    # concat output patches and align with input
    sample_out = np.concatenate(samples_out, 0)
    sample_out = sample_out[delay : sample_size + delay]
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_file = os.path.join(script_dir, "tmp", f"{str(uuid.uuid4())}.wav")
    try:
        wav_write(output_file, sample_out, freq_data)
        with open(output_file, "rb") as f:
            file_bytes = f.read()

        return file_bytes
    finally:
        os.remove(output_file)
