# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Network helpers for workers the browser calls directly on their own port, possibly from the LAN."""

from __future__ import annotations

import socket

import psutil

__all__ = ["lan_origins", "local_ip"]

# Interface names that are never the address another device reaches us on.
_VIRTUAL_INTERFACE_MARKERS = (
    "vmware", "docker", "vbox", "virbr", "hyper-v", "br-", "tun", "tap", "wg",
)


def local_ip() -> str | None:
    """This machine's IPv4 address on the LAN, or None when it has none.

    Skips loopback and virtual interfaces and prefers the fastest link, the one another device most
    likely uses.
    """
    candidates = []
    for iface, stats in psutil.net_if_stats().items():
        name = iface.lower()
        if not stats.isup or name == "lo" or name.startswith("loopback"):
            continue
        if any(marker in name for marker in _VIRTUAL_INTERFACE_MARKERS):
            continue
        for addr in psutil.net_if_addrs().get(iface, []):
            if addr.family == socket.AF_INET:
                candidates.append((stats.speed, iface, addr.address))
    if not candidates:
        return None
    return max(candidates, key=lambda c: c[0])[2]


def lan_origins(port: int, *, scheme: str = "http") -> list[str]:
    """CORS origins for a page served on ``port`` here: localhost, 127.0.0.1 and the LAN address if any."""
    origins = [f"{scheme}://localhost:{port}", f"{scheme}://127.0.0.1:{port}"]
    ip = local_ip()
    if ip:
        origins.append(f"{scheme}://{ip}:{port}")
    return origins
