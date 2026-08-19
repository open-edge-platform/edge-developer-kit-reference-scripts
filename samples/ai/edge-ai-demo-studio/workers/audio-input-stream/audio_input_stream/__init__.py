# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Live-audio VAD segmentation gateway, importable as a library.
"""

from audio_input_stream.audio import pcm_to_wav_bytes
from audio_input_stream.config import (
    DEFAULT_CONFIG,
    HEALTH_LOG_INTERVAL_S,
    SAMPLE_RATE,
    SLOW_UTTERANCE_MS,
)
from audio_input_stream.latency import LatencyTracker
from audio_input_stream.segmenter import UtteranceSegmenter
from audio_input_stream.stream import handle_audio_stream
from audio_input_stream.vad import AlgoOptions, SileroVadOptions, get_silero_model

__all__ = [
    "DEFAULT_CONFIG",
    "HEALTH_LOG_INTERVAL_S",
    "SAMPLE_RATE",
    "SLOW_UTTERANCE_MS",
    "AlgoOptions",
    "LatencyTracker",
    "SileroVadOptions",
    "UtteranceSegmenter",
    "get_silero_model",
    "handle_audio_stream",
    "pcm_to_wav_bytes",
]
