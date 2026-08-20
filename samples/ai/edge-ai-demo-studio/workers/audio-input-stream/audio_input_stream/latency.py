# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Per-session latency accounting for the audio input stream pipeline."""

import logging
import statistics
import time

from audio_input_stream.config import SLOW_UTTERANCE_MS

logger = logging.getLogger("uvicorn.error")


class LatencyTracker:
    """Per-session latency accounting for the streaming pipeline.

    Stage breakdown of one utterance, all measured from the moment the last
    chunk that still contained speech was received ("you stopped talking"):

    ``endpoint`` VAD pause detection — bounded below by ``audio_chunk_duration``
    ``queue``    waiting for the previous utterance's transcription to finish
    ``stt``      round trip to the batch speech-to-text transcription
    ``e2e``      total, i.e. what the user actually perceives
    """

    def __init__(self, latency_log: bool) -> None:
        self._latency_log = latency_log
        self.t_connect = time.perf_counter()
        self.count = 0
        self.endpoint_ms: list[float] = []
        self.queue_ms: list[float] = []
        self.stt_ms: list[float] = []
        self.e2e_ms: list[float] = []
        self.vad_ms: list[float] = []
        self.rtf: list[float] = []

    def record_vad(self, value_ms: float) -> None:
        self.vad_ms.append(value_ms)

    def record_utterance(
        self,
        *,
        audio_s: float,
        endpoint_ms: float,
        queue_ms: float,
        stt_ms: float,
        e2e_ms: float,
        lag_ms: float,
        reason: str,
        chars: int,
    ) -> None:
        self.count += 1
        self.endpoint_ms.append(endpoint_ms)
        self.queue_ms.append(queue_ms)
        self.stt_ms.append(stt_ms)
        self.e2e_ms.append(e2e_ms)
        rtf = stt_ms / 1000.0 / audio_s if audio_s > 0 else 0.0
        self.rtf.append(rtf)

        if not self._latency_log:
            return

        logger.info(
            "[latency] utt#%d %s audio=%.2fs endpoint=%.0fms queue=%.0fms "
            "stt=%.0fms e2e=%.0fms rtf=%.2f lag=%.0fms chars=%d",
            self.count,
            reason,
            audio_s,
            endpoint_ms,
            queue_ms,
            stt_ms,
            e2e_ms,
            rtf,
            lag_ms,
            chars,
        )
        if e2e_ms > SLOW_UTTERANCE_MS:
            dominant = max(
                (("endpointing", endpoint_ms), ("queue", queue_ms), ("stt", stt_ms)),
                key=lambda item: item[1],
            )
            logger.warning(
                "[latency] utt#%d slow (%.0fms > %.0fms), dominated by %s (%.0fms)",
                self.count,
                e2e_ms,
                SLOW_UTTERANCE_MS,
                dominant[0],
                dominant[1],
            )

    @staticmethod
    def _stats(values: list[float]) -> str:
        if not values:
            return "n/a"
        ordered = sorted(values)
        p95 = ordered[min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1))))]
        return f"avg={statistics.fmean(values):.0f} p95={p95:.0f} max={ordered[-1]:.0f}"

    def log_summary(self) -> None:
        if not self._latency_log:
            return
        duration_s = time.perf_counter() - self.t_connect
        if self.count == 0:
            logger.info(
                "[latency] session ended after %.1fs with no utterances "
                "(vad %s ms over %d chunks)",
                duration_s,
                self._stats(self.vad_ms),
                len(self.vad_ms),
            )
            return
        logger.info(
            "[latency] session summary: %d utterances over %.1fs | "
            "endpoint[%s] queue[%s] stt[%s] e2e[%s] ms | vad[%s] ms | rtf avg=%.2f",
            self.count,
            duration_s,
            self._stats(self.endpoint_ms),
            self._stats(self.queue_ms),
            self._stats(self.stt_ms),
            self._stats(self.e2e_ms),
            self._stats(self.vad_ms),
            statistics.fmean(self.rtf),
        )
