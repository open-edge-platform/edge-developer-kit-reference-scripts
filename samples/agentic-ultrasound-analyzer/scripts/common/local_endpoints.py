# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Base URLs for services that must run on the local machine."""

from __future__ import annotations

from urllib.parse import urlparse

_SCHEMES = ("http", "https")
_HOSTS = ("127.0.0.1", "localhost")
_PORTS = range(1, 65536)


def local_base_url(url: str, default_port: int) -> str:
    """Return ``scheme://host:port`` for a loopback service URL.

    Raises ValueError if the URL is not http(s) on a loopback host. The result is
    rebuilt from allow-listed values, so the URL's path and query are discarded.
    """
    parsed = urlparse(url)
    if parsed.scheme not in _SCHEMES or parsed.hostname not in _HOSTS:
        raise ValueError(f"Service URL must use http(s) on 127.0.0.1 or localhost: {url!r}")
    try:
        requested_port = parsed.port or default_port
    except ValueError as exc:
        raise ValueError(f"Invalid port in service URL: {url!r}") from exc

    scheme = next(s for s in _SCHEMES if s == parsed.scheme)
    host = next(h for h in _HOSTS if h == parsed.hostname)
    port = next((p for p in _PORTS if p == requested_port), default_port)
    return f"{scheme}://{host}:{port}"
