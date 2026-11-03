# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Shared configuration and constants for live-audio VAD segmentation."""

SAMPLE_RATE = 16000

# How often the periodic "stream health" latency line is written, in seconds.
HEALTH_LOG_INTERVAL_S = 10.0

# Perceived latency above this is flagged in the log as a tuning hint.
SLOW_UTTERANCE_MS = 2000.0

# Per-connection VAD/segmentation defaults, overridable via WebSocket query params.
DEFAULT_CONFIG = {
    "language": "en",
    "audio_chunk_duration": 0.5,
    "started_talking_threshold": 0.15,
    "speech_threshold": 0.1,
    "max_continuous_speech_s": 15.0,
    # How long a silence ends an utterance, in seconds; it is counted in
    # whole ``audio_chunk_duration`` chunks, so one chunk at the least.
    "pause_duration": 0.5,
    # Silero's speech probability (0..1) that counts as speech: lower hears
    # quieter speech, and more noise.
    "vad_threshold": 0.5,
    "min_speech_duration_ms": 250,
    "min_silence_duration_ms": 500,
    # Audio from before the VAD fired, prepended to the utterance: the first word's onset usually
    # lands in the chunk still below the speech threshold and would otherwise be cut off.
    "preroll_duration": 0.5,
    "min_utterance_duration": 0.8,
    "latency_log": False,
}
