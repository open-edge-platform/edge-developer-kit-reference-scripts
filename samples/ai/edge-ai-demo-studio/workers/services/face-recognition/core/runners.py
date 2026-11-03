# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""OpenVINO runner: a callable ``(blob) -> list[np.ndarray]`` with outputs in the model's order.

Reads both ONNX (OpenCV Zoo) and IR (Open Model Zoo) models.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
from worker_common.devices import (
    AUTO_DEVICE,
    normalize_openvino_device,
    openvino_compile_config,
    openvino_core,
    openvino_execution_device,
)

logger = logging.getLogger(__name__)

# "AUTO" lets OpenVINO pick the best plugin; the others are explicit targets.
# "XPU" is accepted as an alias for an Intel GPU (OpenVINO has no XPU plugin).
SUPPORTED_DEVICES = ("AUTO", "CPU", "GPU", "NPU", "XPU")
# Compile options for whichever GPU runs a model, AUTO's pick included.
_GPU_CONFIG = {"GPU_DISABLE_WINOGRAD_CONVOLUTION": "YES"}


def normalize_device(device: str | None) -> str:
    """Validate a device string; indexed names (``GPU.1``, ``xpu:0``) keep their index, ``XPU``
    becomes ``GPU``. Raises ValueError for an unsupported device.
    """
    cleaned = (device or "").strip().replace(":", ".")
    normalized = normalize_openvino_device(cleaned, supported=SUPPORTED_DEVICES)
    if normalized.startswith("XPU"):
        normalized = "GPU" + normalized[len("XPU") :]
    return normalized


def _device_available(device: str) -> bool:
    """True when the device's base is present; always for AUTO, which is never listed itself."""
    if device == AUTO_DEVICE:
        return True
    try:
        available = openvino_core().available_devices
    except Exception:
        return False
    # available_devices lists indexed names on multi-device systems (GPU.0,
    # GPU.1, ...), so match either exactly or on the base name.
    base = device.split(".")[0]
    return any(d == device or d.split(".")[0] == base for d in available)


class OVRunner:
    """Compile a model with OpenVINO, falling back to CPU if needed."""

    def __init__(
        self,
        model_path: Path,
        device: str,
        input_shape: list[int] | None = None,
    ) -> None:
        core = openvino_core()
        model = core.read_model(model_path)
        if input_shape is not None:
            model.reshape(input_shape)

        target = normalize_device(device)
        if not _device_available(target):
            logger.warning(
                f"[{model_path.name}] Device '{target}' not available in "
                "OpenVINO; falling back to CPU."
            )
            target = "CPU"
        config = openvino_compile_config(target, gpu=_GPU_CONFIG)
        try:
            self.compiled = core.compile_model(model, target, config)
        except Exception as exc:
            if target == "CPU":
                raise
            logger.warning(
                f"[{model_path.name}] Compile on '{target}' failed ({exc}); "
                "retrying on CPU."
            )
            target = "CPU"
            self.compiled = core.compile_model(model, target)
        # OpenVINO's answer, so AUTO reads as the device it selected.
        self.device = openvino_execution_device(self.compiled, target)
        self.runtime = f"openvino:{self.device}"
        self._request = self.compiled.create_infer_request()
        self.input_shape = tuple(self.compiled.inputs[0].shape)
        # An output tensor can carry several names; index them all so callers
        # can look outputs up by the ONNX name regardless of plugin.
        self.name_to_index: dict[str, int] = {}
        for i, out in enumerate(self.compiled.outputs):
            for name in out.get_names():
                self.name_to_index[name] = i

    def __call__(self, blob: np.ndarray) -> list[np.ndarray]:
        self._request.infer({0: blob})
        return [
            self._request.get_output_tensor(i).data.copy()
            for i in range(len(self.compiled.outputs))
        ]
