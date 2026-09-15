# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Whisper speech-to-text using faster-whisper (CTranslate2 backend).

faster-whisper provides significantly faster CPU inference via int8 quantization
and CTranslate2, with built-in language detection and ffmpeg-based audio decoding.
This backend is used instead of OpenVINO for transcription because CTranslate2
delivers better latency and quality on CPU for Whisper specifically.
"""

import logging
import re
import tempfile
import time
import os
from pathlib import Path
from typing import Optional

import numpy as np
import yaml
from faster_whisper import WhisperModel

from src.models.base import TranscriberBase, ROOT_DIR

logger = logging.getLogger(__name__)

CONFIG_PATH = ROOT_DIR / "config.yaml"

_MODEL_SIZE_MAP = {
    "openai/whisper-tiny": "tiny",
    "openai/whisper-small": "small",
    "openai/whisper-medium": "medium",
    "openai/whisper-large-v3": "large-v3",
}

# Initial prompts in native script to force Whisper to output in correct script.
# Without this, Whisper often outputs romanized text for non-Latin languages.
_SCRIPT_PROMPTS = {
    "hi": "हिंदी में बोलिए।",
    "ar": "تحدث بالعربية.",
    "zh": "请用中文说。",
    "ja": "日本語で話してください。",
    "ko": "한국어로 말하세요.",
    "ru": "Говорите по-русски.",
}

# Pattern to detect hallucinated repetitive output from Whisper
_REPETITION_RE = re.compile(r"(.{10,}?)\1{2,}")

# Whisper byte-token pattern (e.g. <|0xe0|><|0xa4|>) — indicates model can't decode script
_BYTE_TOKEN_RE = re.compile(r'<\|0x[0-9a-fA-F]+\|>')

# Expected Unicode ranges for non-Latin languages
_EXPECTED_SCRIPT = {
    "hi": re.compile(r'[ऀ-ॿ]'),  # Devanagari
    "ar": re.compile(r'[؀-ۿ]'),  # Arabic
    "zh": re.compile(r'[一-鿿]'),  # CJK
    "ja": re.compile(r'[぀-ヿ一-鿿]'),  # Hiragana/Katakana/CJK
    "ko": re.compile(r'[가-힯ᄀ-ᇿ]'),  # Hangul
    "ru": re.compile(r'[Ѐ-ӿ]'),  # Cyrillic
}


def _script_matches(text: str, language: str) -> bool:
    """Check if transcription contains expected script characters for the language."""
    if not language or language not in _EXPECTED_SCRIPT:
        return True
    return bool(_EXPECTED_SCRIPT[language].search(text))


def _load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


def _is_hallucination(text: str, initial_prompt: str = None) -> bool:
    """Detect common Whisper hallucination patterns."""
    if not text:
        return False
    # Repetitive looping output
    if _REPETITION_RE.search(text):
        return True

    lower = text.lower().strip()

    # If the output matches or contains the initial_prompt, it's echoed back
    if initial_prompt:
        prompt_lower = initial_prompt.lower().strip()
        if lower == prompt_lower or prompt_lower in lower:
            return True

    # Check against all script prompts — Whisper may echo any of them
    for prompt in _SCRIPT_PROMPTS.values():
        if prompt in text or text.strip() == prompt.strip():
            return True

    # Common hallucinated phrases on silence/noise
    hallucination_phrases = [
        "thank you for watching",
        "thanks for watching",
        "subscribe",
        "like and subscribe",
        "please subscribe",
        "thank you for listening",
        "thanks for listening",
        "please like",
        "you",
    ]
    for phrase in hallucination_phrases:
        if lower == phrase or lower.startswith(phrase + ".") or lower.startswith(phrase + "!"):
            return True
    return False


class TranscriberFasterWhisper(TranscriberBase):
    """Whisper speech-to-text using faster-whisper (CTranslate2 backend).

    Uses int8 quantization on CPU for fast inference. The model is downloaded
    and cached automatically by faster-whisper/CTranslate2 on first use.
    """

    def __init__(self, device: str = "CPU", config: dict = None) -> None:
        super().__init__(device=device, config=config)
        self._config = config or _load_config()
        self._loaded = False

        model_cfg = self._config.get("models", {}).get("whisper", {})
        model_name = model_cfg.get("name", "openai/whisper-small")

        model_size = _MODEL_SIZE_MAP.get(model_name, model_cfg.get("model_size", "small"))

        export_dir = ROOT_DIR / model_cfg.get("export_dir", "models/whisper-small")
        data_cache = ROOT_DIR / "data" / "whisper_cache"
        if (ROOT_DIR / "data").exists():
            data_cache.mkdir(parents=True, exist_ok=True)
            cache_dir = str(data_cache)
        else:
            cache_dir = str(export_dir)

        compute_type = model_cfg.get("compute_type", "int8")

        logger.info(
            "Loading faster-whisper model '%s' (size=%s, compute=%s, cache=%s)",
            model_name, model_size, compute_type, cache_dir,
        )

        fw_device = "cpu" if device.upper() == "CPU" else "cuda"
        if device.upper() in ("NPU", "GPU"):
            fw_device = "cpu"
            # Report the device we actually run on so telemetry labels and the
            # Settings tab reflect reality rather than the requested target.
            self.device = "CPU"
            logger.warning(
                "faster-whisper only supports CPU/CUDA; falling back to CPU (requested: %s)", device
            )

        self._model = WhisperModel(
            model_size,
            device=fw_device,
            compute_type=compute_type,
            download_root=cache_dir,
        )
        self._loaded = True
        logger.info("faster-whisper loaded (model_size=%s)", model_size)

    def is_loaded(self) -> bool:
        return self._loaded

    SAMPLE_RATE = 16000

    def _get_transcribe_kwargs(self, language: Optional[str], use_vad: bool = True) -> dict:
        """Build kwargs for model.transcribe(), including script-forcing prompt."""
        kwargs = {
            "language": language,
            "task": "transcribe",
            "beam_size": 5,
            "condition_on_previous_text": bool(language),
            "word_timestamps": True,
        }
        if use_vad:
            kwargs["vad_filter"] = True
            kwargs["vad_parameters"] = {
                "threshold": 0.25,
                "min_silence_duration_ms": 600,
                "speech_pad_ms": 400,
            }
        if language and language in _SCRIPT_PROMPTS:
            kwargs["initial_prompt"] = _SCRIPT_PROMPTS[language]
        return kwargs

    # Segments with no_speech_prob above this are likely silence/noise, not speech.
    # 0.7 is needed because Whisper-small scores valid Hindi/non-Latin speech at 0.4-0.7.
    _NO_SPEECH_THRESHOLD = 0.7

    def _run_transcribe(self, audio_input, language: Optional[str], use_vad: bool) -> tuple:
        """Run transcription on audio (numpy array or file path)."""
        kwargs = self._get_transcribe_kwargs(language, use_vad=use_vad)
        segments_gen, info = self._model.transcribe(audio_input, **kwargs)

        segments = []
        discarded = 0
        initial_prompt = kwargs.get("initial_prompt", "")
        for segment in segments_gen:
            text = segment.text.strip()
            if not text:
                continue
            # Discard segments that echo the initial prompt back
            if initial_prompt and initial_prompt in text:
                discarded += 1
                logger.debug("Discarding echoed prompt segment: %r", text)
                continue
            # Only discard segments that are very likely silence/noise
            # For non-English, Whisper assigns higher no_speech_prob even to valid speech
            if segment.no_speech_prob > self._NO_SPEECH_THRESHOLD:
                # If the segment has substantial text, keep it anyway — the model
                # decoded something meaningful despite low confidence
                if len(text) < 5:
                    discarded += 1
                    logger.debug(
                        "Discarding segment (no_speech=%.2f, len=%d): %r",
                        segment.no_speech_prob, len(text), text,
                    )
                    continue
            segments.append(text)

        if discarded:
            logger.info("Discarded %d low-confidence segments", discarded)

        transcription = " ".join(segments)

        # Strip byte tokens that indicate the model can't decode the script
        if _BYTE_TOKEN_RE.search(transcription):
            logger.warning("Byte-token output detected (model can't decode script): %r", transcription[:100])
            cleaned = _BYTE_TOKEN_RE.sub('', transcription).strip()
            if not cleaned:
                transcription = ""
            else:
                transcription = cleaned

        initial_prompt = kwargs.get("initial_prompt")
        if _is_hallucination(transcription, initial_prompt):
            logger.warning("Detected hallucinated output, discarding: %r", transcription[:100])
            transcription = ""

        return transcription, info.language

    def transcribe(self, audio: np.ndarray, language: Optional[str] = None) -> str:
        text, _ = self.transcribe_with_language(audio, language)
        return text

    def transcribe_with_language(self, audio: np.ndarray, language: Optional[str] = None) -> tuple:
        """Transcribe audio and return (text, detected_language_code).

        The detected language from Whisper is more reliable than langdetect
        on short phrases, since it uses acoustic features not just text.
        """
        start = time.perf_counter()

        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        transcription, detected_language = self._run_transcribe(audio, language, use_vad=True)

        # If VAD removed all audio, retry without VAD
        if not transcription:
            logger.info("VAD returned empty, retrying without VAD filter")
            transcription, detected_language = self._run_transcribe(audio, language, use_vad=False)

        # If output is in the wrong script (e.g. Chinese instead of Devanagari),
        # retry without condition_on_previous_text to break the contamination
        if transcription and language and not _script_matches(transcription, language):
            logger.warning(
                "Script mismatch for lang=%s, retrying without context conditioning", language
            )
            old_copt = self._get_transcribe_kwargs(language, use_vad=True)
            old_copt["condition_on_previous_text"] = False
            segments_gen, info = self._model.transcribe(audio, **old_copt)
            retry_text = " ".join(s.text.strip() for s in segments_gen if s.text.strip())
            if retry_text and _script_matches(retry_text, language):
                transcription = retry_text
                detected_language = info.language

        elapsed = time.perf_counter() - start
        logger.debug(
            "faster-whisper [lang=%s, detected=%s] took %.3fs (chars=%d)",
            language or "auto", detected_language, elapsed, len(transcription),
        )
        return transcription, detected_language

    def transcribe_file(self, file_path: str, language: Optional[str] = None) -> str:
        text, _ = self.transcribe_file_with_language(file_path, language)
        return text

    def transcribe_file_with_language(self, file_path: str, language: Optional[str] = None) -> tuple:
        """Transcribe from file and return (text, detected_language_code)."""
        start = time.perf_counter()

        transcription, detected_language = self._run_transcribe(file_path, language, use_vad=True)

        # If VAD removed all audio, retry without VAD
        if not transcription:
            logger.info("VAD returned empty, retrying without VAD filter")
            transcription, detected_language = self._run_transcribe(file_path, language, use_vad=False)

        elapsed = time.perf_counter() - start
        logger.debug(
            "faster-whisper file [lang=%s, detected=%s] took %.3fs (chars=%d)",
            language or "auto", detected_language, elapsed, len(transcription),
        )
        return transcription, detected_language
