"""
Kokoro-82M OpenVINO wrapper for text-to-speech synthesis.

Uses tngtech/Kokoro-82M-int8-ov — a pre-quantized INT8 OpenVINO model that
produces high-quality multilingual speech at 24kHz.

Model interface:
  Inputs:
    - input_ids: [1, seq_len] int64 — phoneme token IDs (padded with 0 at start/end)
    - ref_s: [1, 256] float32 — style reference vector from voice pack
    - speed: [1] float32 — speaking speed multiplier
  Outputs:
    - waveform: [N] float32 — raw audio at 24kHz
    - phonemes: [M] int64 — aligned phoneme IDs (unused)

Voice packs are binary files of shape [510, 256] float32.
Vocabulary is loaded from the model's config.json.
"""

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import yaml

from src.models.base import TTSBase, ROOT_DIR

logger = logging.getLogger(__name__)

CONFIG_PATH = ROOT_DIR / "config.yaml"
MAX_TTS_CHARS = 350
KOKORO_SAMPLE_RATE = 24000

LANG_TO_VOICE = {
    "en": "af_heart",
    "gb": "bf_emma",
    "fr": "ff_siwis",
    "es": "ef_dora",
    "it": "if_sara",
    "pt": "pf_dora",
    "hi": "hf_alpha",
    "ja": "jf_alpha",
    "zh": "zf_xiaobei",
}

# Languages that Kokoro doesn't natively support — delegated to Piper TTS
PIPER_LANGUAGES = {"de", "ru", "ko", "ar", "tr", "nl", "pl"}

LANG_TO_ESPEAK = {
    "en": "en-us", "gb": "en-gb", "fr": "fr-fr",
    "es": "es", "it": "it", "pt": "pt-br",
    "de": "de", "hi": "hi", "ja": "ja",
    "zh": "cmn", "ko": "ko", "ru": "ru",
    "ar": "ar", "tr": "tr", "nl": "nl", "pl": "pl",
}


def _load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


def _split_sentences(text: str) -> List[str]:
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    return [p for p in parts if p.strip()]


def _chunk_text(text: str, max_chars: int) -> List[str]:
    """Split long text into chunks that fit within max_chars.

    Splits on sentence boundaries first, then on clause boundaries
    (commas, semicolons), then hard-splits as last resort.
    """
    if len(text) <= max_chars:
        return [text]

    chunks = []
    sentences = _split_sentences(text)

    current_chunk = ""
    for sentence in sentences:
        if len(sentence) > max_chars:
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""
            # Split long sentence on clause boundaries
            clause_parts = re.split(r'(?<=[,;:])\s+', sentence)
            for part in clause_parts:
                if len(part) > max_chars:
                    # Hard split as last resort
                    for i in range(0, len(part), max_chars):
                        chunks.append(part[i:i + max_chars].strip())
                elif len(current_chunk) + len(part) + 1 <= max_chars:
                    current_chunk = (current_chunk + " " + part).strip()
                else:
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                    current_chunk = part
        elif len(current_chunk) + len(sentence) + 1 <= max_chars:
            current_chunk = (current_chunk + " " + sentence).strip()
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sentence

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return [c for c in chunks if c]


class KokoroTTS(TTSBase):
    """Kokoro-82M text-to-speech using OpenVINO runtime.

    For languages not natively supported by Kokoro (de, ru, ko, ar, tr, nl, pl),
    delegates to PiperTTS which uses lightweight per-language VITS models.
    """

    def __init__(self, device: str = "CPU", config: dict = None) -> None:
        self._config = config or _load_config()
        model_cfg = self._config.get("models", {}).get("tts", {})
        super().__init__(device=device, config=config)

        self._loaded = False
        self._compiled_model = None
        self._vocab: Dict[str, int] = {}
        self._voice_cache: Dict[str, np.ndarray] = {}
        self._phonemizer_available = False
        self._sample_rate = KOKORO_SAMPLE_RATE
        self._piper: Optional["PiperTTS"] = None
        self._phonemizer_backends: Dict[str, "EspeakBackend"] = {}

        export_dir = model_cfg.get("export_dir", "models/kokoro-82m-int8-ov")
        self._model_dir = ROOT_DIR / export_dir

        self._load_model()
        self._init_piper()

    def _load_model(self) -> None:
        import openvino as ov

        model_path = self._model_dir / "openvino_model.xml"
        if not model_path.exists():
            logger.error("Kokoro model not found at %s", model_path)
            return

        try:
            core = ov.Core()
            ov_model = core.read_model(str(model_path))

            # Cache compiled kernels to disk so repeated sequence lengths across
            # a session (and future runs) skip GPU/NPU re-compilation overhead.
            ov_config = {}
            model_cache_dir = ROOT_DIR / "data" / "model_cache"
            if model_cache_dir.exists() and os.access(str(model_cache_dir), os.W_OK):
                ov_config["CACHE_DIR"] = str(model_cache_dir)

            try:
                self._compiled_model = core.compile_model(ov_model, self.device, ov_config)
            except Exception as e:
                if self.device != "CPU":
                    logger.warning(
                        "Failed to compile Kokoro on %s (%s), falling back to CPU", self.device, e
                    )
                    self.device = "CPU"
                    self._compiled_model = core.compile_model(ov_model, "CPU", ov_config)
                else:
                    raise

            # Load vocabulary from config.json
            config_path = self._model_dir / "config.json"
            with open(config_path) as f:
                model_config = json.load(f)
            self._vocab = model_config.get("vocab", {})
            logger.info("Kokoro vocab loaded: %d tokens", len(self._vocab))

            # Load default voice
            self._load_voice("af_heart")

            # Check phonemizer availability
            self._init_phonemizer()

            self._loaded = True
            logger.info("Kokoro TTS loaded from %s on %s", self._model_dir, self.device)

        except Exception as e:
            logger.error("Failed to load Kokoro TTS: %s", e, exc_info=True)

    def _init_piper(self) -> None:
        """Initialize PiperTTS for languages Kokoro doesn't support."""
        try:
            from src.models.tts_piper import PiperTTS
            self._piper = PiperTTS(device="CPU", config=self._config)
            logger.info("PiperTTS fallback initialized for languages: %s", ", ".join(sorted(PIPER_LANGUAGES)))
        except Exception as e:
            logger.warning("PiperTTS fallback unavailable: %s", e)

    def _init_phonemizer(self) -> None:
        try:
            from phonemizer.backend import EspeakBackend
            from phonemizer.separator import Separator
            # Quick test
            backend = EspeakBackend(language="en-us", preserve_punctuation=True, with_stress=True)
            sep = Separator(phone="", word=" ", syllable="")
            result = backend.phonemize(["test"], separator=sep, strip=True)
            if result:
                self._phonemizer_available = True
                logger.info("Phonemizer (espeak-ng) available")
        except Exception as e:
            logger.warning("Phonemizer not available: %s — TTS quality will be reduced", e)

    def _load_voice(self, voice_name: str) -> bool:
        if voice_name in self._voice_cache:
            return True

        voice_path = self._model_dir / "voices" / f"{voice_name}.bin"
        if not voice_path.exists():
            logger.warning("Voice file not found: %s", voice_path)
            return False

        try:
            raw = np.fromfile(str(voice_path), dtype=np.float32)
            # Voice packs are [510, 256] — reshape to 2D
            voice_2d = raw.reshape(510, 256)
            self._voice_cache[voice_name] = voice_2d
            logger.debug("Loaded voice '%s' (%s)", voice_name, voice_2d.shape)
            return True
        except Exception as e:
            logger.error("Failed to load voice '%s': %s", voice_name, e)
            return False

    def _get_voice(self, language: str) -> Optional[np.ndarray]:
        voice_name = LANG_TO_VOICE.get(language, "af_heart")
        if voice_name not in self._voice_cache:
            if not self._load_voice(voice_name):
                voice_name = "af_heart"
                if voice_name not in self._voice_cache:
                    self._load_voice(voice_name)

        voice_2d = self._voice_cache.get(voice_name)
        if voice_2d is None:
            return None
        # Use average of style vectors from the middle range for natural, warm voice
        # Early indices are quiet/cold, middle indices give the richest timbre
        ref_s = voice_2d[100:400, :].mean(axis=0, keepdims=True)
        return ref_s

    def _get_phonemizer_backend(self, espeak_lang: str) -> Optional["EspeakBackend"]:
        """Return a cached EspeakBackend for the language, creating it once.

        Constructing an EspeakBackend is expensive (~100-150ms), so recreating
        it per sentence made long-text synthesis (e.g. a multi-minute
        transcript) take minutes just in backend setup overhead.
        """
        backend = self._phonemizer_backends.get(espeak_lang)
        if backend is None:
            from phonemizer.backend import EspeakBackend

            backend = EspeakBackend(
                language=espeak_lang,
                preserve_punctuation=True,
                with_stress=True,
            )
            self._phonemizer_backends[espeak_lang] = backend
        return backend

    def _phonemize(self, text: str, language: str = "en") -> str:
        if self._phonemizer_available:
            try:
                from phonemizer.separator import Separator

                espeak_lang = LANG_TO_ESPEAK.get(language, "en-us")
                backend = self._get_phonemizer_backend(espeak_lang)
                separator = Separator(phone="", word=" ", syllable="")
                phonemes = backend.phonemize([text], separator=separator, strip=True)[0]
                return phonemes
            except Exception as e:
                logger.debug("Phonemizer failed: %s", e)

        # Fallback: pass text through as-is (will still produce some output)
        return text.lower()

    def _tokenize(self, phonemes: str) -> np.ndarray:
        tokens = []
        for ch in phonemes:
            if ch in self._vocab:
                tokens.append(self._vocab[ch])
            # Skip unknown characters

        if not tokens:
            tokens = [0]

        # Pad with 0 at start and end (required by model)
        input_ids = [0] + tokens + [0]
        return np.array([input_ids], dtype=np.int64)

    def is_loaded(self) -> bool:
        return self._loaded

    def get_sample_rate(self) -> int:
        return self._sample_rate

    def synthesize(self, text: str, language: str = "en") -> np.ndarray:
        if not self._loaded:
            return np.zeros(8000, dtype=np.float32)

        text = text.strip()
        if not text:
            return np.zeros(8000, dtype=np.float32)

        if language in PIPER_LANGUAGES and self._piper is not None:
            wav = self._piper.synthesize(text, language)
            if self._piper.get_sample_rate() != self._sample_rate and len(wav) > 0:
                from scipy.signal import resample
                new_len = int(len(wav) * self._sample_rate / self._piper.get_sample_rate())
                wav = resample(wav, new_len).astype(np.float32)
            return wav

        start = time.perf_counter()

        ref_s = self._get_voice(language)
        if ref_s is None:
            logger.error("No voice embedding available")
            return np.zeros(8000, dtype=np.float32)

        chunks = _chunk_text(text, MAX_TTS_CHARS)
        waveforms = []

        for chunk in chunks:
            sentences = _split_sentences(chunk)
            if not sentences:
                sentences = [chunk]

            for sentence in sentences:
                wf = self._synthesize_single(sentence, language, ref_s)
                if wf is not None and len(wf) > 0:
                    waveforms.append(wf)
                    pause_samples = int(self._sample_rate * 0.15)
                    waveforms.append(np.zeros(pause_samples, dtype=np.float32))

        if not waveforms:
            return np.zeros(8000, dtype=np.float32)

        # Remove trailing pause
        if len(waveforms) > 1:
            waveforms.pop()

        result = np.concatenate(waveforms)

        peak = np.abs(result).max()
        if peak > 0:
            result = result * (0.9 / peak)

        elapsed = time.perf_counter() - start
        logger.debug(
            "Kokoro TTS [%s] took %.3fs (%d samples, %.1fs audio, %d chunks)",
            language, elapsed, len(result), len(result) / self._sample_rate,
            len(chunks),
        )
        return result

    def _synthesize_single(
        self, text: str, language: str, ref_s: np.ndarray
    ) -> Optional[np.ndarray]:
        try:
            phonemes = self._phonemize(text, language)
            input_ids = self._tokenize(phonemes)

            if input_ids.size <= 2:
                return None

            speed = np.array([1.0], dtype=np.float32)

            result = self._compiled_model({
                "input_ids": input_ids,
                "ref_s": ref_s,
                "speed": speed,
            })

            waveform = result[self._compiled_model.output(0)].flatten().astype(np.float32)
            return waveform

        except Exception as e:
            logger.error("Kokoro synthesis failed for '%s': %s", text[:30], e)
            return None

    def synthesize_streaming(self, text: str, language: str = "en"):
        """Yield (chunk_index, total_chunks, waveform) tuples for streaming playback."""
        if not self._loaded:
            return

        text = text.strip()
        if not text:
            return

        if language in PIPER_LANGUAGES and self._piper is not None:
            wav = self._piper.synthesize(text, language)
            if self._piper.get_sample_rate() != self._sample_rate and len(wav) > 0:
                from scipy.signal import resample
                new_len = int(len(wav) * self._sample_rate / self._piper.get_sample_rate())
                wav = resample(wav, new_len).astype(np.float32)
            if len(wav) > 0:
                yield (0, 1, wav)
            return

        ref_s = self._get_voice(language)
        if ref_s is None:
            return

        chunks = _chunk_text(text, MAX_TTS_CHARS)
        total = len(chunks)

        for idx, chunk in enumerate(chunks):
            sentences = _split_sentences(chunk)
            if not sentences:
                sentences = [chunk]

            waveforms = []
            for sentence in sentences:
                wf = self._synthesize_single(sentence, language, ref_s)
                if wf is not None and len(wf) > 0:
                    waveforms.append(wf)
                    pause_samples = int(self._sample_rate * 0.15)
                    waveforms.append(np.zeros(pause_samples, dtype=np.float32))

            if not waveforms:
                continue

            if len(waveforms) > 1:
                waveforms.pop()

            chunk_audio = np.concatenate(waveforms)
            peak = np.abs(chunk_audio).max()
            if peak > 0:
                chunk_audio = chunk_audio * (0.9 / peak)

            yield (idx, total, chunk_audio)

    def get_available_voices(self) -> List[str]:
        voices_dir = self._model_dir / "voices"
        if not voices_dir.exists():
            return []
        return [p.stem for p in voices_dir.glob("*.bin")]
