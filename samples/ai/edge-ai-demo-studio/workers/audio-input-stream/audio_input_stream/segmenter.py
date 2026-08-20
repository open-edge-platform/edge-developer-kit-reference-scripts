# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Live-audio utterance segmentation via Silero VAD."""

import logging
import time
from typing import Optional

import numpy as np

from audio_input_stream.config import SAMPLE_RATE
from audio_input_stream.vad import AlgoOptions, SileroVadOptions

logger = logging.getLogger("uvicorn.error")

# Shared empty-array sentinel: these fields are only ever replaced wholesale
# via ``np.concatenate``, never mutated in place, so reusing one instance
# across segmenters/resets is safe and avoids a fresh allocation each time.
_EMPTY_PCM = np.array([], dtype=np.int16)


class UtteranceSegmenter:
    """Segments a live audio stream into utterances using Silero VAD.

    The pause-detection logic follows a ``ReplyOnPause``-style state machine:
    audio is buffered until ``audio_chunk_duration`` seconds are available, the
    VAD then measures the speech duration in that chunk, and an utterance is
    flushed once a pause (or the max continuous-speech limit) is reached after
    speech has started.
    """

    def __init__(
        self,
        vad_model,
        algo_options: AlgoOptions,
        vad_options: SileroVadOptions,
        preroll_duration: float,
        min_utterance_duration: float,
        latency_log: bool,
    ):
        self._vad_model = vad_model
        self._algo = algo_options
        self._vad_options = vad_options
        self._preroll_samples = int(preroll_duration * SAMPLE_RATE)
        self._min_utterance_samples = int(min_utterance_duration * SAMPLE_RATE)
        self._latency_log = latency_log
        self._buffer = _EMPTY_PCM
        self._speech = _EMPTY_PCM
        # Rolling window of the most recent pre-speech audio.
        self._preroll = _EMPTY_PCM
        # How much of ``_speech`` came from the pre-roll (excluded from the
        # minimum-duration check, which only counts detected speech).
        self._preroll_used = 0
        self._started_talking = False
        self._received_samples = 0
        self._utterance_start_sec: float = 0.0
        self.dropped_short = 0
        # Wall-clock instrumentation (perf_counter seconds).
        self.t_first_frame: Optional[float] = None
        self.t_last_frame: float = 0.0
        self.t_last_speech: float = 0.0
        self.last_vad_ms: float = 0.0

    def add_frame(self, frame: np.ndarray) -> None:
        now = time.perf_counter()
        if self.t_first_frame is None:
            self.t_first_frame = now
        self.t_last_frame = now
        self._buffer = np.concatenate((self._buffer, frame))
        self._received_samples += len(frame)

    def ingest_lag_s(self) -> float:
        """How far behind real time the socket ingest is running.

        The client emits audio in real time, so ``wall elapsed - audio received``
        is the backlog introduced by the network plus any blocking work done on
        the receive loop. It must stay near zero for a live feel.
        """
        if self.t_first_frame is None:
            return 0.0
        return (time.perf_counter() - self.t_first_frame) - self._now_sec()

    def _now_sec(self) -> float:
        return self._received_samples / SAMPLE_RATE

    def ready_to_evaluate(self) -> bool:
        return len(self._buffer) / SAMPLE_RATE >= self._algo.audio_chunk_duration

    def evaluate(self) -> dict:
        """Run VAD on the accumulated buffer and update segmentation state.

        Returns a dict describing what happened: ``speech_started`` (bool) and
        ``utterance`` (an int16 array when a full utterance was flushed, else None).
        """
        buffer = self._buffer
        t_vad = time.perf_counter()
        dur_vad, _ = self._vad_model.vad((SAMPLE_RATE, buffer), self._vad_options)
        self.last_vad_ms = (time.perf_counter() - t_vad) * 1000.0

        speech_started = False
        if dur_vad > self._algo.started_talking_threshold and not self._started_talking:
            self._started_talking = True
            speech_started = True
            # Prepend the pre-roll so the onset of the first word survives.
            self._preroll_used = len(self._preroll)
            self._speech = self._preroll
            self._preroll = _EMPTY_PCM
            # Speech began roughly at the start of this buffer window, minus
            # whatever pre-roll was carried over.
            self._utterance_start_sec = max(
                0.0,
                self._now_sec()
                - len(buffer) / SAMPLE_RATE
                - self._preroll_used / SAMPLE_RATE,
            )

        if self._started_talking:
            self._speech = np.concatenate((self._speech, buffer))
        elif self._preroll_samples > 0:
            # Keep the tail of the pre-speech audio around for the next onset.
            self._preroll = np.concatenate((self._preroll, buffer))[
                -self._preroll_samples :
            ]

        self._buffer = _EMPTY_PCM

        pause = dur_vad < self._algo.speech_threshold and self._started_talking
        if not pause:
            # Last chunk that still carried speech — the reference point for the
            # endpointing delay reported per utterance.
            self.t_last_speech = self.t_last_frame

        too_long = (
            self._started_talking
            and len(self._speech) / SAMPLE_RATE >= self._algo.max_continuous_speech_s
        )

        utterance = None
        start = end = 0.0
        if (pause or too_long) and len(self._speech) > 0:
            speech_samples = len(self._speech) - self._preroll_used
            if speech_samples < self._min_utterance_samples:
                # Too short to transcribe reliably — drop it rather than feed
                # the model a context-free fragment it will hallucinate over.
                self.dropped_short += 1
                if self._latency_log:
                    logger.info(
                        "[latency] dropped short utterance (%.2fs speech < %.2fs)",
                        speech_samples / SAMPLE_RATE,
                        self._min_utterance_samples / SAMPLE_RATE,
                    )
            else:
                utterance = self._speech
                start = self._utterance_start_sec
                end = start + len(self._speech) / SAMPLE_RATE
            self._reset_utterance()

        return {
            "speech_started": speech_started,
            "utterance": utterance,
            "start": start,
            "end": end,
            "vad_ms": self.last_vad_ms,
            "speech_end": self.t_last_speech or self.t_last_frame,
            "reason": "max_speech" if too_long else "pause",
        }

    def flush(self) -> Optional[dict]:
        """Return any pending speech as a final utterance (called on stop/close)."""
        pending = np.concatenate((self._speech, self._buffer))
        if not self._started_talking or len(pending) == 0:
            return None
        start = self._utterance_start_sec
        end = start + len(pending) / SAMPLE_RATE
        utterance = pending
        self._reset_utterance()
        return {
            "utterance": utterance,
            "start": start,
            "end": end,
            "speech_end": self.t_last_speech or self.t_last_frame,
            "reason": "flush",
        }

    def _reset_utterance(self) -> None:
        self._speech = _EMPTY_PCM
        self._buffer = _EMPTY_PCM
        self._preroll = _EMPTY_PCM
        self._preroll_used = 0
        self._started_talking = False
