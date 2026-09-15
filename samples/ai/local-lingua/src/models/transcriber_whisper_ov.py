# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Whisper speech-to-text using OpenVINO backend on Intel GPU.

Uses optimum-intel's OVModelForSpeechSeq2Seq to run Whisper models
(including whisper-large-v3-turbo) on Intel integrated GPU via OpenVINO.
This backend enables GPU-accelerated transcription with larger Whisper models
that deliver superior accuracy on non-Latin scripts (Hindi, Arabic, etc.).
"""

import logging
import os
import re
import tempfile
import time
# Only invoked below with hardcoded argv lists, never shell=True.
import subprocess  # nosec B404
from pathlib import Path
from typing import Optional

import numpy as np
import yaml

from src.models.base import TranscriberBase, ROOT_DIR

logger = logging.getLogger(__name__)

CONFIG_PATH = ROOT_DIR / "config.yaml"

_SCRIPT_PROMPTS = {
    "hi": "हिंदी में बोलिए।",
    "ar": "تحدث بالعربية.",
    "zh": "请用中文说。",
    "ja": "日本語で話してください。",
    "ko": "한국어로 말하세요.",
    "ru": "Говорите по-русски.",
}

_REPETITION_RE = re.compile(r"(.{10,}?)\1{2,}")
_BYTE_TOKEN_RE = re.compile(r'<\|0x[0-9a-fA-F]+\|>')

_EXPECTED_SCRIPT = {
    "hi": re.compile(r'[ऀ-ॿ]'),
    "ar": re.compile(r'[؀-ۿ]'),
    "zh": re.compile(r'[一-鿿]'),
    "ja": re.compile(r'[぀-ヿ一-鿿]'),
    "ko": re.compile(r'[가-힯ᄀ-ᇿ]'),
    "ru": re.compile(r'[Ѐ-ӿ]'),
}


def _script_matches(text: str, language: str) -> bool:
    if not language or language not in _EXPECTED_SCRIPT:
        return True
    return bool(_EXPECTED_SCRIPT[language].search(text))


def _is_hallucination(text: str) -> bool:
    if not text:
        return False
    if _REPETITION_RE.search(text):
        return True
    lower = text.lower().strip()
    for prompt in _SCRIPT_PROMPTS.values():
        if prompt in text or text.strip() == prompt.strip():
            return True
    hallucination_phrases = [
        "thank you for watching", "thanks for watching", "subscribe",
        "like and subscribe", "please subscribe", "thank you for listening",
        "thanks for listening", "please like", "you",
    ]
    for phrase in hallucination_phrases:
        if lower == phrase or lower.startswith(phrase + ".") or lower.startswith(phrase + "!"):
            return True
    return False


def _load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


class TranscriberWhisperOV(TranscriberBase):
    """Whisper speech-to-text using OpenVINO on Intel GPU.

    Runs whisper-large-v3-turbo (or other Whisper variants) via
    OVModelForSpeechSeq2Seq for GPU-accelerated inference. Achieves
    ~3-4x real-time speed on Intel Panther Lake iGPU with high accuracy
    on non-Latin scripts.
    """

    SAMPLE_RATE = 16000
    CHUNK_SECONDS = 30

    def __init__(self, device: str = "GPU", config: dict = None) -> None:
        super().__init__(device=device, config=config)
        self._config = config or _load_config()
        self._loaded = False

        model_cfg = self._config.get("models", {}).get("whisper", {})
        model_name = model_cfg.get("name", "openai/whisper-large-v3-turbo")
        export_dir = ROOT_DIR / model_cfg.get("export_dir", "models/whisper-large-v3-turbo")

        ov_device = device.upper()
        if ov_device == "NPU":
            ov_device = "GPU"
            logger.warning("NPU not supported for Whisper OV; using GPU")

        self._export_dir = export_dir
        self._model_name = model_name
        self._ov_device = ov_device

        logger.info(
            "Loading Whisper OV model '%s' on %s (export_dir=%s)",
            model_name, ov_device, export_dir,
        )

        from optimum.intel.openvino import OVModelForSpeechSeq2Seq
        from transformers import AutoProcessor

        if (export_dir / "openvino_encoder_model.xml").exists():
            self._model = OVModelForSpeechSeq2Seq.from_pretrained(
                str(export_dir), device=ov_device
            )
            logger.info("Loaded cached OV model from %s", export_dir)
        else:
            logger.info("No cached export found — exporting %s to OV IR...", model_name)
            self._model = OVModelForSpeechSeq2Seq.from_pretrained(
                model_name, export=True, device=ov_device
            )
            export_dir.mkdir(parents=True, exist_ok=True)
            self._model.save_pretrained(str(export_dir))
            logger.info("Exported and saved OV model to %s", export_dir)

        self._processor = AutoProcessor.from_pretrained(
            str(export_dir) if (export_dir / "preprocessor_config.json").exists() else model_name
        )

        self._loaded = True
        logger.info("Whisper OV loaded on %s (model=%s)", ov_device, model_name)

    def is_loaded(self) -> bool:
        return self._loaded

    def _transcribe_chunk(self, audio_chunk: np.ndarray, language: Optional[str]) -> str:
        inputs = self._processor(
            audio_chunk, sampling_rate=self.SAMPLE_RATE, return_tensors="pt"
        )
        input_features = inputs.input_features

        generate_kwargs = {"task": "transcribe"}
        if language:
            generate_kwargs["language"] = language

        generated = self._model.generate(input_features, **generate_kwargs)
        text = self._processor.batch_decode(generated, skip_special_tokens=True)[0].strip()
        return text

    def transcribe(self, audio: np.ndarray, language: Optional[str] = None) -> str:
        text, _ = self.transcribe_with_language(audio, language)
        return text

    def transcribe_with_language(self, audio: np.ndarray, language: Optional[str] = None) -> tuple:
        start = time.perf_counter()

        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        chunk_size = self.CHUNK_SECONDS * self.SAMPLE_RATE
        chunks = [audio[i:i + chunk_size] for i in range(0, len(audio), chunk_size)]

        segments = []
        detected_language = language or "en"

        for i, chunk in enumerate(chunks):
            if len(chunk) < self.SAMPLE_RATE * 0.5:
                continue

            text = self._transcribe_chunk(chunk, language)

            if _BYTE_TOKEN_RE.search(text):
                cleaned = _BYTE_TOKEN_RE.sub('', text).strip()
                text = cleaned

            if _is_hallucination(text):
                logger.warning("Discarding hallucinated chunk %d: %r", i, text[:60])
                continue

            if text:
                segments.append(text)

        transcription = " ".join(segments)

        if transcription and language and not _script_matches(transcription, language):
            logger.warning("Script mismatch for lang=%s, retrying without language hint", language)
            retry_segments = []
            for chunk in chunks:
                if len(chunk) < self.SAMPLE_RATE * 0.5:
                    continue
                text = self._transcribe_chunk(chunk, None)
                if text and not _is_hallucination(text):
                    retry_segments.append(text)
            retry_text = " ".join(retry_segments)
            if retry_text and _script_matches(retry_text, language):
                transcription = retry_text

        elapsed = time.perf_counter() - start
        duration = len(audio) / self.SAMPLE_RATE
        logger.debug(
            "Whisper OV [device=%s, lang=%s] took %.3fs for %.1fs audio (RTF=%.2f)",
            self._ov_device, language or "auto", elapsed, duration,
            elapsed / duration if duration > 0 else 0,
        )
        return transcription, detected_language

    def transcribe_file(self, file_path: str, language: Optional[str] = None) -> str:
        text, _ = self.transcribe_file_with_language(file_path, language)
        return text

    def transcribe_file_with_language(self, file_path: str, language: Optional[str] = None) -> tuple:
        fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", file_path, "-ar", "16000", "-ac", "1", wav_path],
                capture_output=True, check=True,
            )
            from scipy.io import wavfile
            _, audio_int = wavfile.read(wav_path)
            if audio_int.dtype == np.int16:
                audio = audio_int.astype(np.float32) / 32768.0
            elif audio_int.dtype == np.int32:
                audio = audio_int.astype(np.float32) / 2147483648.0
            else:
                audio = audio_int.astype(np.float32)
        finally:
            if os.path.exists(wav_path):
                os.unlink(wav_path)

        return self.transcribe_with_language(audio, language)
