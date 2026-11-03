# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Streaming output and progress to the app as Server-Sent Events.

The app's proxy cuts off a worker only after silence, so streams send keep-alive comments between events
and can run as long as the work needs.
"""

from __future__ import annotations

import asyncio
import inspect
import json
from typing import Any, AsyncIterable, AsyncIterator, Awaitable, Callable, Iterable

from starlette.concurrency import iterate_in_threadpool
from starlette.responses import StreamingResponse

#: Seconds of silence after which a comment line keeps the stream alive.
KEEPALIVE_SECONDS = 15.0

#: Headers every event stream needs: no caching, no buffering by a proxy.
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}

_KEEPALIVE = b": keep-alive\n\n"


def sse_event(data: Any, event: str | None = None) -> bytes:
    """One event: ``data`` as JSON (a ``str`` is sent as is), named ``event``."""
    payload = data if isinstance(data, str) else json.dumps(data, separators=(",", ":"), default=str)
    lines = [f"event: {event}"] if event else []
    lines.extend(f"data: {line}" for line in (payload.splitlines() or [""]))
    return ("\n".join(lines) + "\n\n").encode("utf-8")


async def _with_keepalive(source: AsyncIterator[bytes], interval: float) -> AsyncIterator[bytes]:
    """``source``, with a comment line whenever it stays quiet for ``interval`` s."""
    pending: asyncio.Future[bytes] | None = None
    try:
        while True:
            if pending is None:
                pending = asyncio.ensure_future(source.__anext__())
            done, _ = await asyncio.wait({pending}, timeout=interval)
            if not done:
                yield _KEEPALIVE
                continue
            try:
                chunk = pending.result()
            except StopAsyncIteration:
                pending = None
                return
            pending = None
            yield chunk
    finally:
        if pending is not None:
            pending.cancel()
            try:
                await pending
            except (asyncio.CancelledError, StopAsyncIteration, Exception):
                pass
        closer = getattr(source, "aclose", None)
        if closer is not None:
            try:
                await closer()
            except RuntimeError:
                pass


def sse_response(
    events: Iterable[bytes] | AsyncIterable[bytes],
    *,
    headers: dict[str, str] | None = None,
    keepalive: float = KEEPALIVE_SECONDS,
) -> StreamingResponse:
    """A ``text/event-stream`` response relaying encoded ``events`` as they come.

    A plain generator is advanced in the threadpool, so it may block on model work without stalling the
    event loop.
    """
    source: AsyncIterator[bytes]
    if hasattr(events, "__aiter__"):
        source = events.__aiter__()  # type: ignore[union-attr]
    else:
        source = iterate_in_threadpool(iter(events))  # type: ignore[arg-type]
    return StreamingResponse(
        _with_keepalive(source, keepalive),
        media_type="text/event-stream",
        headers={**SSE_HEADERS, **(headers or {})},
    )


async def watch_status(
    read: Callable[[], dict[str, Any] | None | Awaitable[dict[str, Any] | None]],
    is_final: Callable[[dict[str, Any]], bool],
    *,
    interval: float = 0.25,
    event: str = "status",
) -> AsyncIterator[bytes]:
    """Events for a background job: its status whenever it changes, ending with the final one.

    ``read`` returns the job's poll body (so its ``perf`` block reaches Live metrics), or None for an
    unknown job, which ends the stream with an ``error`` event.
    """
    last: str | None = None
    while True:
        status = read()
        if inspect.isawaitable(status):
            status = await status
        if status is None:
            yield sse_event({"detail": "Job not found"}, event="error")
            return
        encoded = json.dumps(status, sort_keys=True, default=str)
        if encoded != last:
            last = encoded
            yield sse_event(status, event=event)
        if is_final(status):
            return
        await asyncio.sleep(interval)
