# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Webhook management module for wake word detection."""

import logging
from datetime import datetime
from typing import Optional

import requests
from sqlmodel import Session, select

from utils.database import engine
from utils.models import WebhookSubscriber, DetectionEvent

logger = logging.getLogger("uvicorn.error")


class WebhookManager:
    """Manages webhook subscribers and notifications."""

    @staticmethod
    async def send_webhook(url: str, data: dict, api_key: Optional[str] = None):
        """Send webhook notification to a subscriber.

        Args:
            url: Webhook URL to send to
            data: Data to send in the webhook
            api_key: Optional API key for authorization
        """
        try:
            headers = {"content-type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            res = requests.post(
                url,
                json=data,
                headers=headers,
            )

            res.raise_for_status()
        except Exception as e:
            logger.error(f"Error sending webhook to {url}: {e}")

    @staticmethod
    async def notify_subscribers(model_name: str, score: float):
        """Notify all subscribers about a wake word detection.

        Args:
            model_name: Name of the detected wake word model
            score: Detection confidence score
        """
        with Session(engine) as session:
            subscribers = session.exec(select(WebhookSubscriber)).all()

            for subscriber in subscribers:
                # Check if score exceeds subscriber's threshold
                if score > subscriber.threshold:
                    # Create detection event
                    event = DetectionEvent(
                        model=model_name,
                        score=score,
                        timestamp=datetime.now().isoformat(),
                        message=f"Wake word '{model_name}' detected!",
                    )

                    # Send webhook
                    await WebhookManager.send_webhook(
                        subscriber.url, event.model_dump(), subscriber.api_key
                    )

                    logger.info(
                        f"Notified subscriber {subscriber.name}: {model_name} (score: {score:.3f})"
                    )

    @staticmethod
    def get_subscriber_count() -> int:
        """Get the total number of active subscribers."""
        with Session(engine) as session:
            return len(session.exec(select(WebhookSubscriber)).all())

    @staticmethod
    async def send_test_webhook():
        """Send a test webhook to all subscribers.

        Returns:
            List of results for each subscriber
        """
        with Session(engine) as session:
            subscribers = session.exec(select(WebhookSubscriber)).all()

            if not subscribers:
                return []

            test_event = DetectionEvent(
                model="test",
                score=0.999,
                timestamp=datetime.now().isoformat(),
                message="This is a test webhook",
            )

            results = []
            for subscriber in subscribers:
                try:
                    await WebhookManager.send_webhook(
                        subscriber.url, test_event.model_dump(), subscriber.api_key
                    )
                    results.append(
                        {
                            "url": subscriber.url,
                            "status": "success",
                            "message": "Test webhook sent successfully",
                        }
                    )
                except Exception as e:
                    results.append(
                        {"url": subscriber.url, "status": "error", "message": str(e)}
                    )

            return results
