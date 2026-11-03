# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""OVMS lifecycle for speech-to-text: pull (and convert) a ``speech2text`` graph, then serve it.

``OpenVINO/*`` and ``*-ov`` repos download as IR; others convert through optimum-cli in the environment
``model_downloader.ovms`` picks. OVMS output goes to the worker log prefixed ``ovms:``.
"""

from __future__ import annotations

import logging
import os

from model_downloader import ovms_pull
from model_downloader.ovms import pinned_cpu_args
from worker_common import OvmsServer

# The one OVMS this worker fronts; None until start_stt_background ran.
_server: OvmsServer | None = None

# Propagates to the root handler main.py's get_logger() installs.
logger = logging.getLogger(__name__)


def _forward_ovms_output(stream: str, line: str) -> None:
    """Hand one line of OVMS output to the worker's log (``out`` -> INFO, ``error`` -> WARNING)."""
    text = line.rstrip()
    if text:
        (logger.warning if stream == "error" else logger.info)("ovms: %s", text)


def cleanup_ovms_process() -> None:
    """Stop the OVMS subprocess (idempotent)."""
    if _server is not None:
        _server.stop()


def is_preconverted_ov_model(model_id: str) -> bool:
    """``OpenVINO/whisper-base-fp16-ov`` style repositories ship IR already."""
    return model_id.startswith("OpenVINO/") or model_id.endswith("-ov")


def pull_stt_model(
    model_id: str,
    model_repository_path: str,
    device: str = "CPU",
    precision: str = "fp32",
    source: str = "huggingface",
) -> None:
    """``ovms --pull --task speech2text``: download (and convert) the model before serving.

    Re-running on an existing model is cheap: OVMS keeps the weights and only regenerates
    ``graph.pbtxt`` for the requested device. ``--weight-format`` applies only to conversions.
    """
    ovms_pull(
        model_id,
        model_repository_path,
        task="speech2text",
        source=source,
        target_device=device,
        weight_format=None if is_preconverted_ov_model(model_id) else precision,
    )
    print(f"Model {model_id} is ready in {model_repository_path}", flush=True)


def serving_args(port: int, model_id: str, model_repository_path: str, device: str) -> list[str]:
    """Arguments OVMS serves the pulled ``speech2text`` graph with."""
    return [
        "--rest_port", str(port),
        "--rest_bind_address", "127.0.0.1",
        "--source_model", model_id,
        "--model_repository_path", model_repository_path,
        "--model_name", model_id,
        "--task", "speech2text",
        "--target_device", device,
        *pinned_cpu_args(device),
    ]


def start_stt_background(
    model_id: str,
    model_repository_path: str,
    precision: str,
    ovms_port: int,
    source: str = "huggingface",
    device: str = "CPU",
):
    """Pull the model, then start OVMS serving it; returns the OVMS process."""
    global _server
    os.makedirs(model_repository_path, exist_ok=True)
    pull_stt_model(
        model_id=model_id,
        model_repository_path=model_repository_path,
        device=device,
        precision=precision,
        source=source,
    )
    _server = OvmsServer(
        serving_args(ovms_port, model_id, model_repository_path, device),
        on_output=_forward_ovms_output,
        name="OVMS speech2text",
    )
    return _server.start()


def wait_for_model_ready(
    port: int,
    model_name: str,
    timeout: int = 300,
    check_interval: float = 2.0,
) -> bool:
    """Poll ``/v2/models/<name>/ready`` until OVMS reports the model ready."""
    if _server is None:
        return False
    return _server.wait_model_ready(model_name, port, timeout=timeout, interval=check_interval)
