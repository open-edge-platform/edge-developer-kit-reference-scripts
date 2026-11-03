# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Keeping a worker's loopback traffic off the shell's HTTP proxy.

Without ``no_proxy``, urllib/requests/httpx send calls to the worker itself, its OVMS, the app or a sibling
to the proxy, which answers with its own 403 page. httpx reads the environment when a client is built,
so the exemption is applied when ``worker_common`` is imported.
"""

from __future__ import annotations

import os
import urllib.request

__all__ = ["LOOPBACK_HOSTS", "ensure_loopback_no_proxy", "loopback_opener"]

#: Added to ``no_proxy``: the names a worker dials itself, the app and a sibling by.
LOOPBACK_HOSTS = ("localhost", "127.0.0.1", "::1")

_NO_PROXY_VARS = ("no_proxy", "NO_PROXY")


def ensure_loopback_no_proxy() -> None:
    """Append :data:`LOOPBACK_HOSTS` to ``no_proxy`` and ``NO_PROXY``, keeping existing entries; idempotent.

    Both spellings are set because libraries differ in which one they read first.
    """
    for var in _NO_PROXY_VARS:
        entries = [entry.strip() for entry in os.environ.get(var, "").split(",") if entry.strip()]
        present = {entry.lower() for entry in entries}
        for host in LOOPBACK_HOSTS:
            if host.lower() not in present:
                entries.append(host)
                present.add(host.lower())
        os.environ[var] = ",".join(entries)


def loopback_opener() -> urllib.request.OpenerDirector:
    """A ``urllib`` opener that never uses a proxy, whatever the environment says; HTTP errors still raise."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))
