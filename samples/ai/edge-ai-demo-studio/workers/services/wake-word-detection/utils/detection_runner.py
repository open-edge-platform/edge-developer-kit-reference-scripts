# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import queue
import threading
from typing import Optional

from utils.audio_manager import AudioManager
from utils.config import DetectionState
from utils.detection_events import DetectionEventLog
from utils.model_manager import ModelManager
from utils.webhook_manager import WebhookManager

logger = logging.getLogger("uvicorn.error")


class DetectionRunner:
    """Runs wake word detection on its own thread, over the mic's chunks in capture order.

    Webhook calls are only queued (``WebhookManager``), so a subscriber never holds detection up;
    when the model falls behind, ``AudioManager`` drops the oldest audio.
    """

    def __init__(
        self,
        audio: AudioManager,
        models: ModelManager,
        state: DetectionState,
        events: DetectionEventLog,
        webhooks: WebhookManager,
    ):
        self._audio = audio
        self._models = models
        self._state = state
        self._events = events
        self._webhooks = webhooks
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        """Start the detection thread; RuntimeError while the previous run is still finishing."""
        if self.running:
            if not self._stop.is_set():
                return
            raise RuntimeError("Detection is still stopping; try again shortly.")
        # Each run gets its own stop flag, so a run that outlives ``stop``'s
        # timeout still sees its own flag set.
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run, args=(self._stop,), name="wake-word-detection", daemon=True
        )
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> bool:
        """Stop the detection thread, waiting up to ``timeout`` s; returns whether it finished."""
        self._stop.set()
        thread = self._thread
        if thread is None:
            return True
        thread.join(timeout)
        return not thread.is_alive()

    def process(self, chunk) -> None:
        """Run the model on one chunk and act on its scores."""
        prediction = self._models.predict(chunk)
        threshold = self._state.detection_threshold
        for model_name, score in prediction.items():
            score_float = float(score)
            self._events.record(model_name, score_float, threshold=threshold)
            self._webhooks.notify_subscribers(model_name, score_float)

    def _run(self, stop: threading.Event) -> None:
        logger.info("Audio processing started")
        try:
            while not stop.is_set():
                try:
                    chunk = self._audio.next_chunk(timeout=0.1)
                except queue.Empty:
                    continue
                try:
                    self.process(chunk)
                except Exception as e:
                    logger.error(f"Error processing audio: {e}")
                    stop.wait(0.1)
        finally:
            logger.info("Audio processing stopped")
