# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""OpenVINO inference runner.

A runner is a callable ``(blob: np.ndarray) -> list[np.ndarray]`` returning the
network outputs in the model's declared output order, so pipeline code stays
free of runtime details. Both ONNX (OpenCV Zoo) and IR (Open Model Zoo) models
are read natively by OpenVINO.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from core.device import get_core, ov_device_available

logger = logging.getLogger(__name__)


class OVRunner:
    """Compile a model with OpenVINO, falling back to CPU if needed."""

    def __init__(
        self,
        model_path: Path,
        device: str,
        input_shape: list[int] | None = None,
    ) -> None:
        core = get_core()
        model = core.read_model(model_path)
        if input_shape is not None:
            model.reshape(input_shape)

        # OpenVINO has no "XPU" plugin — an XPU request targets the same Intel
        # GPU through the GPU plugin.
        target = "GPU" if device.split(":")[0] == "XPU" else device
        if not ov_device_available(target):
            logger.warning(
                f"[{model_path.name}] Device '{target}' not available in "
                "OpenVINO; falling back to CPU."
            )
            target = "CPU"
        config = (
            {"GPU_DISABLE_WINOGRAD_CONVOLUTION": "YES"} if "GPU" in target else {}
        )
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
        self.device = target
        self.runtime = f"openvino:{target}"
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
