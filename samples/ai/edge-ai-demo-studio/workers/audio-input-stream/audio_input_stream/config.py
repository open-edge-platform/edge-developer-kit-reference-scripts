# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Shared configuration and constants for live-audio VAD segmentation."""

SAMPLE_RATE = 16000

# How often the periodic "stream health" latency line is written, in seconds.
HEALTH_LOG_INTERVAL_S = 10.0

# Perceived latency above this is flagged in the log as a tuning hint.
SLOW_UTTERANCE_MS = 2000.0

# VAD / segmentation tuning defaults. The host worker's CONFIG (e.g.
# speech-to-text) owns network-facing settings like "port"; these are the
# per-connection tunables overridable via WebSocket query params.
DEFAULT_CONFIG = {
    "language": "en",
    "audio_chunk_duration": 0.5,
    "started_talking_threshold": 0.15,
    "speech_threshold": 0.1,
    "max_continuous_speech_s": 15.0,
    "min_speech_duration_ms": 250,
    "min_silence_duration_ms": 500,
    # Audio kept from *before* the VAD fired, prepended to the utterance. The
    # onset of the first word usually lands in the chunk that was still below
    # the speech threshold, so without this it gets cut off and the model
    # mis-hears the first word.
    "preroll_duration": 0.5,
    "min_utterance_duration": 0.8,
    "latency_log": False,
}
