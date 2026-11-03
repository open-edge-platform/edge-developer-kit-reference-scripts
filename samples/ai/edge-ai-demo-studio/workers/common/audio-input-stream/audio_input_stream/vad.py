# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Live-audio VAD via the official ``silero-vad`` package.
"""

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from silero_vad import get_speech_timestamps, load_silero_vad

from audio_input_stream.config import SAMPLE_RATE


@dataclass
class AlgoOptions:
    """Buffering and pause-detection tuning for ``UtteranceSegmenter``, not passed to silero_vad."""

    audio_chunk_duration: float
    started_talking_threshold: float
    speech_threshold: float
    max_continuous_speech_s: float
    # Silence, in seconds, that ends an utterance once speech has started.
    pause_duration: float


@dataclass
class SileroVadOptions:
    """Options forwarded to ``silero_vad.get_speech_timestamps``.
    """

    threshold: float = 0.5
    min_speech_duration_ms: int = 250
    max_speech_duration_s: float = float("inf")
    min_silence_duration_ms: int = 2000
    speech_pad_ms: int = 400


class _SileroVadModel:
    """Adapts ``silero_vad`` to the ``model.vad(...)`` call shape
    ``UtteranceSegmenter`` expects: a ``(sample_rate, int16 pcm)`` tuple in,
    ``(speech_duration_seconds, chunks)`` out.
    """

    def __init__(self):
        self._model = load_silero_vad()

    def warmup(self) -> None:
        dummy = np.zeros(SAMPLE_RATE, dtype=np.int16)
        self.vad((SAMPLE_RATE, dummy), SileroVadOptions())

    def vad(self, audio: tuple[int, np.ndarray], options: SileroVadOptions | None):
        sampling_rate, pcm = audio
        if sampling_rate != SAMPLE_RATE:
            raise ValueError(f"Only {SAMPLE_RATE}Hz audio is supported, got {sampling_rate}Hz")
        if options is None:
            options = SileroVadOptions()

        float_audio = pcm.astype(np.float32) / 32768.0
        chunks = get_speech_timestamps(
            float_audio,
            self._model,
            threshold=options.threshold,
            sampling_rate=SAMPLE_RATE,
            min_speech_duration_ms=options.min_speech_duration_ms,
            max_speech_duration_s=options.max_speech_duration_s,
            min_silence_duration_ms=options.min_silence_duration_ms,
            speech_pad_ms=options.speech_pad_ms,
        )
        duration = sum(chunk["end"] - chunk["start"] for chunk in chunks) / SAMPLE_RATE
        return duration, chunks


@lru_cache
def get_silero_model() -> _SileroVadModel:
    """Returns the shared Silero VAD model instance, loaded and warmed up once."""
    model = _SileroVadModel()
    model.warmup()
    return model
