"""
Language identification on transcribed text using langdetect.
Configuration-driven — reads supported languages and settings from config.yaml.
"""

import logging
from pathlib import Path

import yaml
from langdetect import DetectorFactory, detect, detect_langs
from langdetect.lang_detect_exception import LangDetectException

logger = logging.getLogger(__name__)

DetectorFactory.seed = 0

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = ROOT_DIR / "config.yaml"


def load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


class LanguageDetector:
    """Detect language of text using langdetect library."""

    def __init__(self, config: dict = None) -> None:
        self._config = config or load_config()
        lang_cfg = self._config.get("language", {})
        self._supported = [l["code"] for l in lang_cfg.get("supported", [])]
        self._min_length = lang_cfg.get("min_text_length", 3)
        logger.info("LanguageDetector initialised, supported: %s", self._supported)

    def detect_language(self, text: str) -> str:
        if not text or len(text.strip()) < self._min_length:
            return "unknown"

        try:
            detected = detect(text)
            return detected
        except LangDetectException:
            return "unknown"

    def detect_with_confidence(self, text: str) -> list:
        if not text or len(text.strip()) < self._min_length:
            return []

        try:
            results = detect_langs(text)
            return [{"lang": r.lang, "prob": r.prob} for r in results]
        except LangDetectException:
            return []
