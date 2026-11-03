# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Webhook notifications. Each subscriber's go out in order from its own thread with a short timeout,
so a slow endpoint only delays itself; the subscriber list is cached and never read on the event loop.
"""

import logging
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import requests
from sqlmodel import Session, select

from utils.database import engine
from utils.models import DetectionEvent, WebhookSubscriber

logger = logging.getLogger("uvicorn.error")

# (connect, read) seconds allowed for one webhook call.
WEBHOOK_TIMEOUT = (2.0, 5.0)

# Notifications one subscriber may have waiting; beyond this new ones are dropped and logged.
SUBSCRIBER_BACKLOG = 32

# Seconds the cached subscriber list is used before the database is re-read.
# Subscribing, updating or unsubscribing through the API refreshes it at once.
SUBSCRIBERS_TTL = 2.0

# Seconds a subscriber's sender thread waits for work before it exits.
SENDER_IDLE_SECONDS = 60.0

# Seconds between "dropped notifications" warnings for one subscriber.
DROP_WARNING_INTERVAL = 10.0


@dataclass(frozen=True)
class Subscriber:
    """A subscriber as read from the database, detached from its session."""

    url: str
    name: str
    threshold: float
    api_key: Optional[str]


def send_webhook(
    url: str,
    data: dict,
    api_key: Optional[str] = None,
    http: Optional[requests.Session] = None,
) -> None:
    """POST ``data`` to ``url``; requests.RequestException on failure, timeout or error status."""
    headers = {"content-type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    res = (http or requests).post(url, json=data, headers=headers, timeout=WEBHOOK_TIMEOUT)
    res.raise_for_status()


class _SubscriberSender:
    """Sends one subscriber's notifications, oldest first, on its own thread."""

    def __init__(self, url: str, manager: "WebhookManager"):
        self.url = url
        self._manager = manager
        self.jobs: queue.Queue = queue.Queue(maxsize=SUBSCRIBER_BACKLOG)
        self._dropped = 0
        self._last_drop_warning = 0.0
        self._thread = threading.Thread(
            target=self._run, name=f"webhook-sender {url}", daemon=True
        )
        self._thread.start()

    def offer(self, subscriber: Subscriber, data: dict) -> None:
        try:
            self.jobs.put_nowait((subscriber, data))
        except queue.Full:
            self._dropped += 1
            now = time.monotonic()
            if now - self._last_drop_warning >= DROP_WARNING_INTERVAL:
                logger.warning(
                    f"Webhook subscriber {subscriber.name} is not keeping up; "
                    f"dropped {self._dropped} notification(s)"
                )
                self._dropped = 0
                self._last_drop_warning = now

    def _run(self) -> None:
        with requests.Session() as http:
            while True:
                try:
                    job = self.jobs.get(timeout=SENDER_IDLE_SECONDS)
                except queue.Empty:
                    if self._manager._retire(self):
                        return
                    continue
                if job is None:
                    return
                subscriber, data = job
                try:
                    send_webhook(subscriber.url, data, subscriber.api_key, http=http)
                    logger.info(
                        f"Notified subscriber {subscriber.name}: {data['model']} "
                        f"(score: {data['score']:.3f})"
                    )
                except Exception as e:
                    logger.error(f"Error sending webhook to {subscriber.url}: {e}")


class WebhookManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._senders: dict[str, _SubscriberSender] = {}
        self._subscribers: list[Subscriber] = []
        self._loaded_at: Optional[float] = None

    def invalidate(self) -> None:
        """Re-read the subscriber list on next use (after the table changed)."""
        self._loaded_at = None

    def subscribers(self) -> list[Subscriber]:
        """The current subscribers; reads the database, so call off the event loop."""
        loaded_at = self._loaded_at
        if loaded_at is not None and time.monotonic() - loaded_at < SUBSCRIBERS_TTL:
            return self._subscribers
        with Session(engine) as session:
            rows = session.exec(select(WebhookSubscriber)).all()
            fresh = [Subscriber(r.url, r.name, r.threshold, r.api_key) for r in rows]
        self._subscribers = fresh
        self._loaded_at = time.monotonic()
        return fresh

    def notify_subscribers(self, model_name: str, score: float) -> None:
        """Queue a notification for every subscriber whose threshold ``score`` exceeds; never blocks."""
        try:
            targets = [s for s in self.subscribers() if score > s.threshold]
        except Exception as e:
            logger.error(f"Could not read webhook subscribers: {e}")
            return
        if not targets:
            return
        data = DetectionEvent(
            model=model_name,
            score=score,
            timestamp=datetime.now().isoformat(),
            message=f"Wake word '{model_name}' detected!",
        ).model_dump()
        with self._lock:
            for subscriber in targets:
                sender = self._senders.get(subscriber.url)
                if sender is None:
                    sender = _SubscriberSender(subscriber.url, self)
                    self._senders[subscriber.url] = sender
                sender.offer(subscriber, data)

    def _retire(self, sender: _SubscriberSender) -> bool:
        """Drop an idle sender, unless work arrived for it meanwhile."""
        with self._lock:
            if not sender.jobs.empty():
                return False
            if self._senders.get(sender.url) is sender:
                del self._senders[sender.url]
            return True

    def get_subscriber_count(self) -> int:
        """Number of subscribers (reads the database)."""
        return len(self.subscribers())

    def send_test_webhook(self) -> list[dict]:
        """Send a test webhook to every subscriber at once and return each result.

        Blocks for up to the webhook timeout, so call off the event loop.
        """
        self.invalidate()
        subscribers = self.subscribers()
        if not subscribers:
            return []

        test_event = DetectionEvent(
            model="test",
            score=0.999,
            timestamp=datetime.now().isoformat(),
            message="This is a test webhook",
        ).model_dump()

        with ThreadPoolExecutor(max_workers=min(8, len(subscribers))) as pool:
            calls = [
                (s, pool.submit(send_webhook, s.url, test_event, s.api_key))
                for s in subscribers
            ]
        results = []
        for subscriber, call in calls:
            error = call.exception()
            if error is None:
                results.append(
                    {
                        "url": subscriber.url,
                        "status": "success",
                        "message": "Test webhook sent successfully",
                    }
                )
            else:
                logger.error(f"Error sending webhook to {subscriber.url}: {error}")
                results.append(
                    {"url": subscriber.url, "status": "error", "message": str(error)}
                )
        return results

    def close(self) -> None:
        """Let every sender finish what it has queued, then exit."""
        with self._lock:
            senders = list(self._senders.values())
            self._senders.clear()
        for sender in senders:
            try:
                sender.jobs.put_nowait(None)
            except queue.Full:
                pass  # Daemon thread; it ends with the process.
