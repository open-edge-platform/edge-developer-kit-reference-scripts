# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Piper TTS — lightweight VITS-based text-to-speech via OpenVINO.

Used as a fallback for languages that Kokoro doesn't natively support
(German, Russian, Korean, Arabic, Turkish, Dutch, Polish).
Piper models are ~15MB ONNX files that run extremely fast on CPU (~0.07x real-time).

Each language has its own model downloaded from HuggingFace on first use.
Models are stored in models/piper-voices/<lang_code>/.
"""

import json
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import openvino as ov
import yaml

from src.models.base import TTSBase, ROOT_DIR

logger = logging.getLogger(__name__)

CONFIG_PATH = ROOT_DIR / "config.yaml"

PIPER_MODELS = {
    "de": {
        "repo": "csukuangfj/vits-piper-de_DE-thorsten-medium",
        "onnx": "de_DE-thorsten-medium.onnx",
        "config": "de_DE-thorsten-medium.onnx.json",
    },
    "ru": {
        "repo": "csukuangfj/vits-piper-ru_RU-dmitri-medium",
        "onnx": "ru_RU-dmitri-medium.onnx",
        "config": "ru_RU-dmitri-medium.onnx.json",
    },
    "ko": {
        "repo": "rhasspy/piper-voices",
        "onnx": "ko/ko_KR/kss/medium/ko_KR-kss-medium.onnx",
        "config": "ko/ko_KR/kss/medium/ko_KR-kss-medium.onnx.json",
    },
    "ar": {
        "repo": "csukuangfj/vits-piper-ar_JO-kareem-medium",
        "onnx": "ar_JO-kareem-medium.onnx",
        "config": "ar_JO-kareem-medium.onnx.json",
    },
    "tr": {
        "repo": "csukuangfj/vits-piper-tr_TR-dfki-medium",
        "onnx": "tr_TR-dfki-medium.onnx",
        "config": "tr_TR-dfki-medium.onnx.json",
    },
    "nl": {
        "repo": "csukuangfj/vits-piper-nl_BE-nathalie-medium",
        "onnx": "nl_BE-nathalie-medium.onnx",
        "config": "nl_BE-nathalie-medium.onnx.json",
    },
    "pl": {
        "repo": "csukuangfj/vits-piper-pl_PL-gosia-medium",
        "onnx": "pl_PL-gosia-medium.onnx",
        "config": "pl_PL-gosia-medium.onnx.json",
    },
}

PIPER_VOICES_DIR = ROOT_DIR / "models" / "piper-voices"


def _load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


class PiperTTS(TTSBase):
    """Piper VITS TTS for languages not covered by Kokoro.

    Loads per-language ONNX models via OpenVINO on CPU.
    Models are downloaded from HuggingFace on first use.
    """

    def __init__(self, device: str = "CPU", config: dict = None) -> None:
        super().__init__(device="CPU", config=config)
        self._config = config or _load_config()
        self._loaded = False
        self._core = ov.Core()
        self._models: Dict[str, dict] = {}
        self._phonemizer_available = False

        self._init_phonemizer()
        self._loaded = True
        logger.info("PiperTTS initialized (models loaded on demand per language)")

    def _init_phonemizer(self) -> None:
        try:
            from phonemizer.backend import EspeakBackend
            from phonemizer.separator import Separator
            backend = EspeakBackend(language="en-us", preserve_punctuation=True, with_stress=True)
            sep = Separator(phone="|", word=" ", syllable="")
            result = backend.phonemize(["test"], separator=sep, strip=True)
            if result:
                self._phonemizer_available = True
                logger.info("Piper phonemizer (espeak-ng) available")
        except Exception as e:
            logger.error("Piper requires espeak-ng for phonemization: %s", e)

    def _get_model(self, language: str) -> Optional[dict]:
        """Get or load the Piper model for a language."""
        if language in self._models:
            return self._models[language]

        if language not in PIPER_MODELS:
            logger.warning("No Piper model available for language '%s'", language)
            return None

        model_info = PIPER_MODELS[language]
        model_dir = PIPER_VOICES_DIR / language

        onnx_name = Path(model_info["onnx"]).name
        config_name = Path(model_info["config"]).name
        onnx_path = model_dir / onnx_name
        config_path = model_dir / config_name

        if not onnx_path.exists():
            if not self._download_model(language, model_info, model_dir):
                return None

        try:
            with open(config_path) as f:
                piper_config = json.load(f)

            ov_model = self._core.read_model(str(onnx_path))
            compiled = self._core.compile_model(ov_model, "CPU")

            entry = {
                "compiled": compiled,
                "phoneme_id_map": piper_config.get("phoneme_id_map", {}),
                "espeak_voice": piper_config.get("espeak", {}).get("voice", language),
                "sample_rate": piper_config.get("audio", {}).get("sample_rate", 22050),
            }
            self._models[language] = entry
            logger.info("Piper model loaded for '%s' (sr=%d)", language, entry["sample_rate"])
            return entry

        except Exception as e:
            logger.error("Failed to load Piper model for '%s': %s", language, e)
            return None

    def _download_model(self, language: str, model_info: dict, model_dir: Path) -> bool:
        """Download Piper model from HuggingFace."""
        try:
            from huggingface_hub import hf_hub_download
            import shutil

            model_dir.mkdir(parents=True, exist_ok=True)
            repo = model_info["repo"]

            for key in ["onnx", "config"]:
                filename = model_info[key]
                local_name = Path(filename).name
                target = model_dir / local_name
                if target.exists():
                    continue
                logger.info("Downloading Piper %s: %s/%s", language, repo, filename)
                downloaded = hf_hub_download(repo, filename)
                shutil.copy2(downloaded, target)

            return True
        except Exception as e:
            logger.error("Failed to download Piper model for '%s': %s", language, e)
            return False

    def _phonemize(self, text: str, espeak_voice: str) -> List[str]:
        """Convert text to phoneme list using espeak-ng."""
        if not self._phonemizer_available:
            return list(text.lower())

        try:
            from phonemizer.backend import EspeakBackend
            from phonemizer.separator import Separator

            backend = EspeakBackend(
                language=espeak_voice,
                preserve_punctuation=True,
                with_stress=True,
            )
            separator = Separator(phone="|", word=" ", syllable="")
            phonemes_raw = backend.phonemize([text], separator=separator, strip=True)[0]

            phoneme_list = []
            for word in phonemes_raw.split(" "):
                phones = word.split("|")
                phoneme_list.extend(phones)
                phoneme_list.append(" ")
            if phoneme_list and phoneme_list[-1] == " ":
                phoneme_list.pop()

            return phoneme_list
        except Exception as e:
            logger.warning("Phonemization failed for voice '%s': %s", espeak_voice, e)
            return list(text.lower())

    def _phonemes_to_ids(self, phonemes: List[str], phoneme_id_map: dict) -> np.ndarray:
        """Convert phoneme list to input IDs with interspersed padding."""
        input_ids = [0]
        for p in phonemes:
            if p in phoneme_id_map:
                for pid in phoneme_id_map[p]:
                    input_ids.append(pid)
                    input_ids.append(0)
        return np.array([input_ids], dtype=np.int64)

    def is_loaded(self) -> bool:
        return self._loaded

    def get_sample_rate(self) -> int:
        return 22050

    def supports_language(self, language: str) -> bool:
        return language in PIPER_MODELS

    def synthesize(self, text: str, language: str = "en") -> np.ndarray:
        if not self._loaded or not self._phonemizer_available:
            return np.zeros(8000, dtype=np.float32)

        text = text.strip()
        if not text:
            return np.zeros(8000, dtype=np.float32)

        model = self._get_model(language)
        if model is None:
            return np.zeros(8000, dtype=np.float32)

        start = time.perf_counter()

        sentences = self._split_sentences(text)
        waveforms = []

        for sentence in sentences:
            wf = self._synthesize_sentence(sentence, model)
            if wf is not None and len(wf) > 0:
                waveforms.append(wf)
                pause_samples = int(model["sample_rate"] * 0.2)
                waveforms.append(np.zeros(pause_samples, dtype=np.float32))

        if not waveforms:
            return np.zeros(8000, dtype=np.float32)

        if len(waveforms) > 1:
            waveforms.pop()

        result = np.concatenate(waveforms)

        peak = np.abs(result).max()
        if peak > 0:
            result = result * (0.9 / peak)

        elapsed = time.perf_counter() - start
        logger.debug(
            "Piper TTS [%s] took %.3fs (%.1fs audio, RTF=%.3f)",
            language, elapsed, len(result) / model["sample_rate"],
            elapsed / (len(result) / model["sample_rate"]) if len(result) > 0 else 0,
        )
        return result

    def _synthesize_sentence(self, text: str, model: dict) -> Optional[np.ndarray]:
        try:
            phonemes = self._phonemize(text, model["espeak_voice"])
            input_ids = self._phonemes_to_ids(phonemes, model["phoneme_id_map"])

            if input_ids.size <= 2:
                return None

            input_lengths = np.array([input_ids.shape[1]], dtype=np.int64)
            scales = np.array([0.667, 1.0, 0.8], dtype=np.float32)

            result = model["compiled"]({
                "input": input_ids,
                "input_lengths": input_lengths,
                "scales": scales,
            })

            waveform = list(result.values())[0].flatten().astype(np.float32)
            return waveform

        except Exception as e:
            logger.error("Piper synthesis failed: %s", e)
            return None

    @staticmethod
    def _split_sentences(text: str) -> List[str]:
        import re
        parts = re.split(r'(?<=[.!?।])\s+', text.strip())
        return [p for p in parts if p.strip()]
