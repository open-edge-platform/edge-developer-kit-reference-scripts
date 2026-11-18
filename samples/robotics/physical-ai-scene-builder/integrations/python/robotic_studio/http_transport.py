# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Single-port HTTP adapters for the SDK's existing command and multipart state channels."""

from __future__ import annotations

import json
import socket
import string
import struct
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from collections.abc import Mapping
from http.client import HTTPException
from typing import Any, BinaryIO

import zmq

MAX_PACKET_BYTES = 512 * 1024 * 1024
MAX_COMMAND_BYTES = 1024 * 1024
MAX_PARTS = 4098
# RFC 3986 unreserved, reserved, and percent-escape characters.
URL_CHARS = string.ascii_letters + string.digits + "-._~:/?#[]@!$&'()*+,;=%"


def _validate_http_url(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise urllib.error.URLError("Only HTTP(S) URLs are supported.")


class _HttpRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        _validate_http_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_http(request: urllib.request.Request, timeout_s: float) -> Any:
    _validate_http_url(request.full_url)
    requested_scheme, _, remainder = request.full_url.partition("://")
    scheme = next((allowed for allowed in ("http", "https") if allowed == requested_scheme.lower()), None)
    if scheme is None:
        raise urllib.error.URLError("Only HTTP(S) URLs are supported.")
    copied = ""
    for character in remainder:
        for allowed in URL_CHARS:
            if allowed == character:
                copied += allowed
                break
        else:
            raise urllib.error.URLError("The URL contains an unsupported character.")
    request.full_url = f"{scheme}://{copied}"
    opener = urllib.request.OpenerDirector()
    for handler in (
        urllib.request.ProxyHandler(),
        urllib.request.UnknownHandler(),
        urllib.request.HTTPHandler(),
        urllib.request.HTTPSHandler(),
        urllib.request.HTTPDefaultErrorHandler(),
        _HttpRedirectHandler(),
        urllib.request.HTTPErrorProcessor(),
    ):
        opener.add_handler(handler)
    return opener.open(request, timeout=timeout_s)


def _read_exact(stream: BinaryIO, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        try:
            chunk = stream.read(remaining)
        except HTTPException as error:
            raise OSError("The HTTP relay returned an incomplete response.") from error
        if not chunk:
            raise OSError("The HTTP relay closed before a complete packet arrived.")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_packet(stream: BinaryIO) -> list[bytes]:
    count = struct.unpack("<I", _read_exact(stream, 4))[0]
    if not 1 <= count <= MAX_PARTS:
        raise ValueError("The HTTP relay returned an invalid multipart count.")
    parts: list[bytes] = []
    total = 4
    for _ in range(count):
        size = struct.unpack("<I", _read_exact(stream, 4))[0]
        total += 4 + size
        if total > MAX_PACKET_BYTES:
            raise ValueError("The HTTP relay packet exceeds the size limit.")
        parts.append(_read_exact(stream, size))
    return parts


def _open(request: urllib.request.Request, timeout_s: float) -> Any:
    try:
        return open_http(request, timeout_s)
    except urllib.error.HTTPError as error:
        if error.code == 504:
            raise zmq.Again("HTTP relay command timed out; its outcome is unknown.") from error
        payload = error.read(MAX_COMMAND_BYTES)
        try:
            value = json.loads(payload)
        except (ValueError, UnicodeDecodeError):
            raise OSError(f"HTTP relay returned HTTP {error.code}.") from error
        message = value.get("error") if isinstance(value, dict) else None
        raise OSError(f"HTTP relay returned HTTP {error.code}: {message or 'request failed'}") from error
    except (TimeoutError, socket.timeout) as error:
        raise zmq.Again("HTTP relay timed out; the command was not retried.") from error
    except urllib.error.URLError as error:
        if isinstance(error.reason, TimeoutError):
            raise zmq.Again("HTTP relay timed out; the command was not retried.") from error
        raise OSError(f"Could not reach HTTP relay at {request.full_url}: {error.reason}") from error


class HttpCommandSocket:
    """Adapts HTTP packets to the SDK's send_json/recv command-channel interface."""

    def __init__(self, endpoint: str, timeout_s: float) -> None:
        self.endpoint = endpoint
        self.timeout_ms = max(1, int(timeout_s * 1000))
        self._pending: bytes | None = None
        self._responses: deque[bytes] = deque()
        self._closed = False

    def setsockopt(self, option: int, value: int) -> None:
        if option not in {zmq.RCVTIMEO, zmq.SNDTIMEO} or value < 1:
            raise ValueError("HTTP command channels only support positive send/receive timeouts.")
        if option == zmq.RCVTIMEO:
            self.timeout_ms = value

    def send_json(self, envelope: Mapping[str, Any]) -> None:
        if self._closed:
            raise OSError("The HTTP command channel is closed.")
        if self._pending is not None or self._responses:
            raise OSError("The previous HTTP command has not been fully received.")
        payload = json.dumps(envelope, allow_nan=False).encode("utf-8")
        if len(payload) > MAX_COMMAND_BYTES:
            raise ValueError("Command exceeds the 1 MiB limit.")
        self._pending = payload

    def recv(self) -> bytes:
        if self._closed:
            raise OSError("The HTTP command channel is closed.")
        if self._pending is not None:
            payload, self._pending = self._pending, None
            request = urllib.request.Request(
                self.endpoint,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/octet-stream",
                    "X-Studio-Timeout-Ms": str(min(self.timeout_ms, 120_000)),
                },
                method="POST",
            )
            try:
                with _open(request, self.timeout_ms / 1000) as response:
                    self._responses.extend(read_packet(response))
            except TimeoutError as error:
                raise zmq.Again("HTTP command response timed out; it was not retried.") from error
        if not self._responses:
            raise OSError("The HTTP command channel has no pending response.")
        return self._responses.popleft()

    def close(self, _linger: int = 0) -> None:
        self._closed = True
        self._pending = None
        self._responses.clear()


class HttpStateSocket:
    """Reads a continuous HTTP PUB relay, retaining only the newest complete state packet."""

    def __init__(self, endpoint: str, timeout_s: float) -> None:
        self._endpoint = endpoint
        self._timeout_s = timeout_s
        self._condition = threading.Condition()
        self._latest: list[bytes] | None = None
        self._error: Exception | None = None
        self._closed = False
        self._thread = threading.Thread(target=self._receive, daemon=True)
        self._thread.start()

    def _receive(self) -> None:
        try:
            request = urllib.request.Request(
                self._endpoint, headers={"Accept": "application/octet-stream"}
            )
            with _open(request, self._timeout_s) as response:
                with self._condition:
                    if self._closed:
                        return
                while True:
                    parts = read_packet(response)
                    with self._condition:
                        if self._closed:
                            return
                        self._latest = parts
                        self._condition.notify_all()
        except (OSError, ValueError, zmq.Again) as error:
            with self._condition:
                if not self._closed:
                    self._error = error
                    self._condition.notify_all()

    def poll(self, timeout: int = 0) -> bool:
        with self._condition:
            self._condition.wait_for(
                lambda: self._latest is not None or self._error is not None or self._closed,
                timeout=max(0, timeout) / 1000,
            )
            if self._latest is not None and not self._closed:
                return True
            if self._error is not None:
                raise OSError(f"The HTTP state relay failed: {self._error}") from self._error
            if self._closed:
                raise OSError("The HTTP state channel is closed.")
            return False

    def recv_multipart(self) -> list[bytes]:
        with self._condition:
            if self._latest is None:
                raise zmq.Again("No complete HTTP state packet is available.")
            parts, self._latest = self._latest, None
            return parts

    def close(self, _linger: int = 0) -> None:
        with self._condition:
            self._closed = True
            self._condition.notify_all()
        # The reader owns HTTPResponse; closing it during read() races its chunk decoder.
        if threading.current_thread() is not self._thread:
            self._thread.join(timeout=max(1.0, self._timeout_s))
