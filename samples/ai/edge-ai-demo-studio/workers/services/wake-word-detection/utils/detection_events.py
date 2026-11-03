# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Recent detection events, and the event streams following them."""

import asyncio
import threading
from datetime import datetime
from typing import Any, Optional

# Events a stream holds for a client that reads slower than they arrive; past
# this the oldest are dropped (the client can re-read GET /events).
STREAM_BUFFER = 256


class DetectionStream:
    """One client's queue of ``(event name, data)`` pairs, filled from any thread."""

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop
        self._queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue(maxsize=STREAM_BUFFER)

    def push(self, name: str, data: Any) -> None:
        try:
            self._loop.call_soon_threadsafe(self._put, (name, data))
        except RuntimeError:
            pass  # The loop has closed; nobody is reading any more.

    def _put(self, item: tuple[str, Any]) -> None:
        if self._queue.full():
            self._queue.get_nowait()
        self._queue.put_nowait(item)

    async def next(self, timeout: float) -> Optional[tuple[str, Any]]:
        """The next pair, or ``None`` when none arrives within ``timeout`` s."""
        try:
            async with asyncio.timeout(timeout):
                return await self._queue.get()
        except TimeoutError:
            return None


class DetectionEventLog:
    """The newest detections first, capped; thread-safe.

    Every subscribed stream gets each new event (``detection``) and each clear (``cleared``).
    """

    def __init__(self, max_events: int = 200):
        self._max_events = max_events
        self._lock = threading.Lock()
        self._events: list[dict] = []
        self._streams: set[DetectionStream] = set()

    def record(self, model_name: str, score: float, threshold: float = 0.5) -> Optional[dict]:
        """Store a detection if it reaches ``threshold``; returns the event stored."""
        if score < threshold:
            return None
        event = {
            "event": "wake_word_detected",
            "model": model_name,
            "score": score,
            "timestamp": datetime.now().isoformat(),
            "message": f"Wake word '{model_name}' detected!",
        }
        with self._lock:
            self._events.insert(0, event)
            del self._events[self._max_events :]
            for stream in self._streams:
                stream.push("detection", event)
        return event

    def recent(self, since: str = "") -> list[dict]:
        """Stored events, newest first; only those after ``since`` when given."""
        with self._lock:
            return self._filter(since)

    def clear(self) -> None:
        with self._lock:
            self._events.clear()
            for stream in self._streams:
                stream.push("cleared", {})

    def subscribe(self, since: str = "") -> tuple[list[dict], DetectionStream]:
        """The stored events (as ``recent``) and a stream of everything after them.

        Taken together, so no event falls between the two. Call from the event
        loop that reads the stream; ``unsubscribe`` it when done.
        """
        stream = DetectionStream(asyncio.get_running_loop())
        with self._lock:
            self._streams.add(stream)
            return self._filter(since), stream

    def unsubscribe(self, stream: DetectionStream) -> None:
        with self._lock:
            self._streams.discard(stream)

    def _filter(self, since: str) -> list[dict]:
        if since:
            return [e for e in self._events if e["timestamp"] > since]
        return list(self._events)
