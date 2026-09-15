"""
Model loader — config-driven factory for instantiating pipeline models.

To add a new model:
1. Create a wrapper in src/models/ that subclasses the appropriate base
   (TranscriberBase, TranslatorBase, SentimentBase, TTSBase)
2. Add an entry in config.yaml under `models:` with a unique key
3. Register the class in MODEL_CLASSES below

The pipeline service never imports model classes directly — it goes through
this loader, so swapping a model only requires config + one line here.
"""

import logging
from pathlib import Path
from typing import Any, Dict, Optional, Type

import yaml

from src.models.base import BaseModel, TranscriberBase, TranslatorBase, SentimentBase, TTSBase, VoiceEmotionBase

logger = logging.getLogger(__name__)

MODEL_CLASSES: Dict[str, Type[BaseModel]] = {}

STAGE_TO_CONFIG_KEY: Dict[str, str] = {
    "transcription": "whisper",
    "audio_to_text": "whisper",
    "translation": "translator",
    "sentiment": "sentiment",
    "text_to_speech": "tts",
    "voice_emotion": "voice_emotion",
}

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = ROOT_DIR / "config.yaml"


def _load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


def _register_defaults():
    """Lazy-register default model classes."""
    if MODEL_CLASSES:
        return

    # Whisper: faster-whisper (CTranslate2)
    from src.models.transcriber_faster_whisper import TranscriberFasterWhisper
    MODEL_CLASSES["whisper"] = TranscriberFasterWhisper

    # Whisper: OpenVINO backend (for GPU-accelerated larger models)
    from src.models.transcriber_whisper_ov import TranscriberWhisperOV
    MODEL_CLASSES["whisper_ov"] = TranscriberWhisperOV

    # Cohere Transcribe: raw OpenVINO (ONNX frontend), no optimum-intel export path
    from src.models.transcriber_cohere_asr import TranscriberCohereASR
    MODEL_CLASSES["whisper_cohere_asr"] = TranscriberCohereASR

    # Translator
    from src.models.translator import Translator
    MODEL_CLASSES["translator"] = Translator

    # Sentiment
    from src.models.sentiment import SentimentAnalyzer
    MODEL_CLASSES["sentiment"] = SentimentAnalyzer

    # Sentiment: LLM-prompted (Tiny Aya), raw OpenVINO, no optimum-intel export path
    from src.models.sentiment_tiny_aya import TinyAyaSentimentAnalyzer
    MODEL_CLASSES["sentiment_llm"] = TinyAyaSentimentAnalyzer

    # TTS: Kokoro
    from src.models.tts_kokoro import KokoroTTS
    MODEL_CLASSES["tts"] = KokoroTTS

    # Voice emotion
    from src.models.voice_emotion import VoiceEmotionAnalyzer
    MODEL_CLASSES["voice_emotion"] = VoiceEmotionAnalyzer


def load_model(stage: str, device: str = "CPU", config: dict = None, model_id: str = None) -> Optional[BaseModel]:
    """Load a model for the given pipeline stage.

    If model_id is provided and matches an alternative in config, that
    alternative's export_dir is injected into the config so the model
    class loads the correct weights.
    """
    _register_defaults()

    config_key = STAGE_TO_CONFIG_KEY.get(stage)
    if not config_key or config_key not in MODEL_CLASSES:
        logger.warning("No model class registered for stage '%s'", stage)
        return None

    effective_config = config
    if model_id:
        effective_config = _resolve_model_config(config, config_key, model_id)

    cls = _resolve_model_class(config_key, effective_config)
    try:
        return cls(device=device, config=effective_config)
    except Exception as exc:
        logger.error("Failed to load model for stage '%s': %s", stage, exc)
        return None


def _resolve_model_class(config_key: str, config: dict = None) -> Type[BaseModel]:
    """Select the correct model class based on backend field in config."""
    if config_key == "whisper" and config:
        models_cfg = config.get("models", {})
        whisper_cfg = models_cfg.get("whisper", {})
        backend = whisper_cfg.get("backend", "faster-whisper")
        if backend == "openvino":
            return MODEL_CLASSES["whisper_ov"]
        if backend == "cohere_asr":
            return MODEL_CLASSES["whisper_cohere_asr"]
    if config_key == "sentiment" and config:
        sentiment_cfg = config.get("models", {}).get("sentiment", {})
        if sentiment_cfg.get("backend") == "llm":
            return MODEL_CLASSES["sentiment_llm"]
    return MODEL_CLASSES[config_key]


def _resolve_model_config(config: dict, config_key: str, model_id: str) -> dict:
    """Return a config copy with the selected model_id promoted to active."""
    if not config:
        config = _load_config()

    import copy
    resolved = copy.deepcopy(config)
    models_cfg = resolved.get("models", {})
    stage_cfg = models_cfg.get(config_key, {})

    active_name = stage_cfg.get("name", "")
    if model_id in active_name or active_name.endswith(model_id):
        return resolved

    for alt in stage_cfg.get("alternatives", []):
        alt_name = alt.get("name", "")
        if model_id in alt_name or alt_name.endswith(model_id):
            stage_cfg["name"] = alt_name
            stage_cfg["export_dir"] = alt.get("export_dir", stage_cfg.get("export_dir", ""))
            for key in ("model_size", "compute_type", "backend", "supported_targets",
                        "recommended_target", "labels", "pre_quantized", "sample_rate",
                        "default_voice", "multilingual", "mode", "dimensions",
                        "static_audio_samples"):
                if key in alt:
                    stage_cfg[key] = alt[key]
            logger.info("Resolved model_id '%s' -> '%s' (export_dir: %s)",
                        model_id, alt_name, stage_cfg["export_dir"])
            break

    return resolved


def get_available_stages() -> list:
    """Return list of stages that have registered model classes."""
    _register_defaults()
    return list(STAGE_TO_CONFIG_KEY.keys())
