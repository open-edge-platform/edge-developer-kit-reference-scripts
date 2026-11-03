# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Command-line entrypoint helpers."""

from __future__ import annotations

import argparse
import os
from typing import Any

from worker_common.instance import add_instance_args, with_instance_header
from worker_common.proxy import ensure_loopback_no_proxy

DEFAULT_HOST = "127.0.0.1"

#: Hubs for ``--source``, spelled as ``model_downloader.normalize_source`` accepts them.
SOURCES = ("huggingface", "modelscope")


def base_parser(
    description: str,
    *,
    default_port: int,
    device: bool = True,
    default_device: str = "cpu",
    device_help: str | None = None,
    source: bool = False,
    default_source: str = "huggingface",
    host: bool = False,
    instance: bool = True,
    **parser_kwargs: Any,
) -> argparse.ArgumentParser:
    """An argument parser with the flags every worker accepts; workers add their own to it.

    ``--port`` is always there; ``--device`` (on by default), ``--source`` and ``--host`` are opt-in so a
    worker only advertises what it honours. ``instance`` adds the ``--instance-id``/``--data-dir`` the app
    passes; a worker started outside the app passes ``instance=False``. Re-applies the loopback
    ``no_proxy`` exemption in case the worker rewrote its environment since import.
    """
    ensure_loopback_no_proxy()
    parser = argparse.ArgumentParser(description=description, **parser_kwargs)
    parser.add_argument(
        "--port",
        type=int,
        default=default_port,
        help="Port for the worker to listen on",
    )
    if host:
        parser.add_argument(
            "--host",
            type=str,
            default=DEFAULT_HOST,
            help="Interface to bind (SERVER_HOST in the environment wins)",
        )
    if device:
        parser.add_argument(
            "--device",
            type=str,
            default=default_device,
            help=device_help or "Device to run models on (e.g. cpu, xpu, xpu:0, xpu:1)",
        )
    if source:
        parser.add_argument(
            "--source",
            type=str,
            default=default_source,
            choices=SOURCES,
            help="Hub to fetch model weights from",
        )
    if instance:
        add_instance_args(parser)
    return parser


def serve(
    app: Any,
    args: argparse.Namespace,
    *,
    default_host: str = DEFAULT_HOST,
    **uvicorn_kwargs: Any,
) -> None:
    """Run ``app`` under uvicorn, every response naming the instance that sent it.

    ``SERVER_HOST``/``SERVER_PORT`` (set by the app at launch) win over ``--host``/``--port``. The default
    host is loopback: workers are reached through the app's proxy, never directly from another machine.
    """
    import uvicorn

    host = os.environ.get("SERVER_HOST") or getattr(args, "host", None) or default_host
    port = int(os.environ.get("SERVER_PORT") or getattr(args, "port"))
    uvicorn.run(with_instance_header(app), host=host, port=port, **uvicorn_kwargs)
