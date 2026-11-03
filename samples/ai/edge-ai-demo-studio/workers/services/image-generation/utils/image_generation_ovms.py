# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""OpenVINO Model Server for the image-generation worker: model repository, device check, NPU args.

The pull is ``model_downloader.ovms`` and the process lifecycle ``worker_common.ovms.OvmsServer``.
"""

from __future__ import annotations

import logging
import os
from typing import AsyncContextManager

import worker_common
from model_downloader import OvmsError, ovms_env, ovms_pull
from model_downloader.ovms import add_pipeline_tokenizers, pinned_cpu_args, serve_lock_path
from utils.util import create_cache_directory, validate_and_sanitize_cache_dir
from worker_common import OvmsServer, async_shared_model_lock

VALID_DEVICES = ("AUTO", "CPU", "GPU", "NPU", "HETERO")

# OVMS's own weight format when none is given; conversions at it (and
# pre-converted IR) stay in <repo>/models/ovms.
DEFAULT_PRECISION = "int8"

# The one OVMS this worker fronts; None until start_ovms_background ran.
_server: OvmsServer | None = None

# main.py logs through uvicorn's logger (the root logger has no handler in
# this worker), so OVMS's lines go to the same place as everything else.
logger = logging.getLogger("uvicorn.error")


def _forward_ovms_output(stream: str, line: str) -> None:
    """Hand one line of OVMS output to the worker's log (``out`` -> INFO, ``error`` -> WARNING)."""
    text = line.rstrip()
    if text:
        (logger.warning if stream == "error" else logger.info)("ovms: %s", text)


def _npu_args(device: str, model_id: str) -> list[str]:
    """Static shapes the NPU plugin needs, for a single or mixed device string.

    This fixes the UNet batch too (2 with classifier-free guidance, 1 without), so turbo models,
    which the demo runs at guidance 1, are reshaped without guidance.
    """
    if "NPU" not in device.upper():
        return []
    args = ["--resolution", "512x512"]
    if "turbo" in model_id.lower():
        args += ["--guidance_scale", "1.0"]
    return args


def validate_device(device: str) -> None:
    """Accept ``AUTO``/``CPU``/``GPU``/``NPU``/``HETERO`` (indexed, and space-separated per stage)."""
    for part in device.split():
        base = part.split(":")[0].split(".")[0].upper()
        if base not in VALID_DEVICES:
            raise ValueError(
                f"Invalid device type: {part}. Supported devices are {', '.join(VALID_DEVICES)}."
            )


def is_preconverted(model_id: str) -> bool:
    """OpenVINO IR repositories, which ``ovms --pull`` downloads as is: the OpenVINO organization,
    ``*-ov`` and ``*-openvino`` ids."""
    name = model_id.lower()
    return name.startswith("openvino/") or name.endswith(("-ov", "-openvino"))


def pull_model(
    model_id: str,
    model_repository_path: str,
    device: str = "CPU",
    source: str = "huggingface",
    precision: str = DEFAULT_PRECISION,
) -> None:
    """Use ovms --pull to download and convert an image_generation model."""
    try:
        ovms_pull(
            model_id,
            model_repository_path,
            task="image_generation",
            source=source,
            target_device=device,
            weight_format=None if is_preconverted(model_id) else precision,
            extra_args=_npu_args(device, model_id),
        )
    except OvmsError as e:
        raise RuntimeError(f"ovms --pull failed: {e}") from e
    # A pipeline exported without OpenVINO tokenizers loads, then fails every
    # generation request; the pull keeps files it already has, so this sticks.
    converted = add_pipeline_tokenizers(os.path.join(model_repository_path, model_id), ovms_env())
    if converted:
        print(f"Converted the OpenVINO tokenizers {model_id} lacked: {', '.join(converted)}")
    print(f"Model {model_id} pulled successfully to {model_repository_path}")


def model_repository(model_id: str, precision: str) -> str:
    """``<repo>/models/ovms``, the model repository every instance shares.

    Other precisions than int8 convert into ``precision-<p>`` under it: a pull keeps the weights a
    repository already holds, so each precision needs its own.
    """
    path = os.path.join(str(worker_common.project_root()), "models", "ovms")
    if precision != DEFAULT_PRECISION and not is_preconverted(model_id):
        path = os.path.join(path, f"precision-{precision}")
    return validate_and_sanitize_cache_dir(path)


def serve_lock(model_id: str, precision: str) -> AsyncContextManager[None]:
    """Hold from pulling ``model_id`` until OVMS reports it ready.

    The pull writes the graph for this device and the tokenizer fix-up rewrites files in place, so
    an instance on another device must wait (see ``model_downloader.ovms.serve_lock_path``).
    """
    return async_shared_model_lock(serve_lock_path(model_repository(model_id, precision), model_id))


def setup_ovms_environment():
    """The OVMS executable and the environment to serve with (``model_downloader.ovms_env``)."""
    env = ovms_env()
    return str(env.executable), env.env


def serving_args(port: int, model_path: str, model_id: str, device: str) -> list[str]:
    """Arguments OVMS serves an image_generation pipeline with."""
    return [
        "--rest_port", str(port),
        "--rest_bind_address", "127.0.0.1",
        "--source_model", model_id,
        "--model_repository_path", model_path,
        "--task", "image_generation",
        "--target_device", device,
        *_npu_args(device, model_id),
        *pinned_cpu_args(device),
    ]


def setup_ovms_server(
    model_id: str,
    device: str,
    precision: str,
    serving_port: int = 5006,
    source: str = "huggingface",
) -> str:
    """Validate the request and pull the model; returns the model repository path."""
    # The app allocates the port from its instance range, so only the valid range is checked.
    if not (1024 <= int(serving_port) <= 65535):
        raise ValueError(f"Invalid port: {serving_port}. Port must be between 1024 and 65535.")
    validate_device(device)

    model_cache_dir = model_repository(model_id, precision)
    create_cache_directory(model_cache_dir)
    try:
        pull_model(
            model_id=model_id,
            model_repository_path=model_cache_dir,
            device=device,
            source=source,
            precision=precision,
        )
    except Exception as e:
        print(f"Error pulling model {model_id}: {e}")
        raise RuntimeError(f"Failed to pull model {model_id}: {e}") from e
    print(f"Model {model_id} is ready in {model_cache_dir}")
    return model_cache_dir


def start_ovms_background(
    model_id: str,
    device: str,
    precision: str,
    serving_port: int = 5006,
    source: str = "huggingface",
):
    """Pull the model, then start OVMS serving it; returns the OVMS process."""
    global _server
    model_path = setup_ovms_server(model_id, device, precision, serving_port, source)
    _server = OvmsServer(
        serving_args(serving_port, model_path, model_id, device),
        on_output=_forward_ovms_output,
        name="OVMS image_generation",
    )
    try:
        return _server.start()
    except Exception as e:
        print(f"Error starting model serving: {e}")
        raise RuntimeError(f"Failed to start model serving: {e}") from e


def wait_for_model_ready(port: int, model_id: str, timeout: int = 60, check_interval: float = 1.0) -> bool:
    """True once OVMS reports ``model_id`` ready, False on timeout or an early exit."""
    if _server is None:
        return False
    return _server.wait_model_ready(model_id, port, timeout=timeout, interval=check_interval)


def cleanup_ovms_process() -> None:
    """Stop the OVMS subprocess (idempotent)."""
    if _server is not None:
        _server.stop()


def main() -> None:
    """Serve one model in the foreground (development aid); Ctrl+C stops OVMS."""
    parser = worker_common.base_parser(
        "Image generation OVMS server", default_port=5007, default_device="CPU", source=True
    )
    parser.add_argument("--model-id", required=True, help="Image generation model id")
    parser.add_argument("--precision", default="int8", choices=["fp32", "fp16", "int8", "int4"])
    args = parser.parse_args()
    device = str(args.device).upper().strip()
    process = start_ovms_background(args.model_id, device, args.precision, args.port, args.source)
    try:
        process.wait()
    except KeyboardInterrupt:
        cleanup_ovms_process()


if __name__ == "__main__":
    main()
