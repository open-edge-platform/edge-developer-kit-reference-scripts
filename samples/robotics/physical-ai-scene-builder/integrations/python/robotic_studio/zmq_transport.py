# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Shared ZeroMQ helpers for the native worker servers (Generate and Evaluate)."""

from __future__ import annotations

from typing import Any


async def receive_request(router: Any, timeout_ms: int) -> list[bytes] | None:
    """Wait up to ``timeout_ms`` for one multipart request on an asyncio ROUTER socket.

    Returns ``None`` when nothing arrived so the caller can run periodic work and check for
    shutdown. Waiting with ``poll`` and receiving only once a message is queued avoids cancelling a
    pending ``recv_multipart``: ``asyncio.wait_for(router.recv_multipart(), timeout)`` can time out
    just after the message was read from the socket, which silently drops the request and leaves
    its sender waiting for a reply that never comes.
    """
    import zmq

    if not await router.poll(timeout=timeout_ms, flags=zmq.POLLIN):
        return None
    return await router.recv_multipart()
