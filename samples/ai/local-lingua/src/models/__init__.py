# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Model wrappers for the Local Lingua pipeline.

To add a new model:
1. Create a new file in this package (e.g., src/models/my_model.py)
2. Subclass the appropriate base from src.models.base:
   - TranscriberBase for speech-to-text
   - TranslatorBase for translation
   - SentimentBase for sentiment analysis
   - TTSBase for text-to-speech
3. Add a config entry under `models:` in config.yaml
4. Register the class in src/models/loader.py MODEL_CLASSES dict

The pipeline service will automatically discover and load it.
"""

from src.models.base import BaseModel, SentimentBase, TranscriberBase, TranslatorBase, TTSBase, VoiceEmotionBase

__all__ = ["BaseModel", "TranscriberBase", "TranslatorBase", "SentimentBase", "VoiceEmotionBase", "TTSBase"]
