# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Base model interface for all pipeline stages.

Every model wrapper must subclass one of these ABCs. This enables:
- Swapping models without changing pipeline code
- Auto-discovery of available models via config
- Consistent device/fallback behavior
- Uniform reload semantics
"""

import logging
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parent.parent.parent


class BaseModel(ABC):
    """Abstract base for all model wrappers."""

    def __init__(self, device: str = "CPU", config: Optional[dict] = None) -> None:
        self.device = device
        self._config = config or {}

    @abstractmethod
    def is_loaded(self) -> bool:
        ...


class TranscriberBase(BaseModel):
    """ABC for speech-to-text models."""

    @abstractmethod
    def transcribe(self, audio: np.ndarray, language: Optional[str] = None) -> str:
        ...


class TranslatorBase(BaseModel):
    """ABC for translation models."""

    @abstractmethod
    def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        ...


class SentimentBase(BaseModel):
    """ABC for sentiment analysis models."""

    @abstractmethod
    def analyze(self, text: str) -> Dict[str, Any]:
        ...


class VoiceEmotionBase(BaseModel):
    """ABC for voice/audio emotion recognition models."""

    @abstractmethod
    def analyze_audio(self, audio: np.ndarray) -> Dict[str, Any]:
        ...


class TTSBase(BaseModel):
    """ABC for text-to-speech models."""

    @abstractmethod
    def synthesize(self, text: str, language: str = "en") -> np.ndarray:
        ...
