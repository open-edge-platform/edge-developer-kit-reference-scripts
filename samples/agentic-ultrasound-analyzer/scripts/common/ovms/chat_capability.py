# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Helpers for determining OVMS chat route capability."""


def is_ovms_chat_unsupported(status_code: int, body_text: str) -> bool:
    """Return True when response matches known unsupported chat-route signature."""
    return (
        status_code == 404
        and "Mediapipe graph definition with requested name is not found" in (body_text or "")
    )
