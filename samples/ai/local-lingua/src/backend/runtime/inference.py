# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""OpenVINO runtime wrapper — single point of contact with openvino.runtime.Core."""

import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class InferenceRuntime:
    """Wraps OpenVINO Core to provide device discovery and model compilation.

    This class is the only place in the backend that directly imports and
    instantiates openvino.runtime.Core.  All other services go through this
    wrapper so that device availability is centralised.
    """

    def __init__(self, cache_dir: str = "/app/data/model_cache") -> None:
        try:
            from openvino.runtime import Core  # noqa: F401
            import os

            os.makedirs(cache_dir, exist_ok=True)
            self._core = Core()
            self._core.set_property({"CACHE_DIR": cache_dir})
            self._available = True
            logger.info("OpenVINO runtime initialised (cache: %s)", cache_dir)
        except ImportError:
            self._core = None
            self._available = False
            logger.warning(
                "openvino.runtime not available — inference will be stubbed"
            )

    @property
    def is_available(self) -> bool:
        """Return whether OpenVINO runtime was loaded successfully."""
        return self._available

    @property
    def core(self):
        """Return the raw openvino.runtime.Core instance (or None)."""
        return self._core

    def get_available_devices(self) -> List[str]:
        """Return list of available OpenVINO devices (e.g. ['CPU', 'GPU'])."""
        if not self._available:
            return ["CPU"]
        try:
            devices = self._core.available_devices
            logger.debug("Available OpenVINO devices: %s", devices)
            return list(devices)
        except Exception as exc:
            logger.error("Failed to enumerate devices: %s", exc)
            return ["CPU"]

    def get_device_info(self, device: str) -> Dict[str, str]:
        """Return device metadata (full name, supported properties).

        Parameters
        ----------
        device : str
            Device string such as "CPU", "GPU", or "NPU".

        Returns
        -------
        dict with keys "device", "full_name", and optionally other properties.
        """
        info: Dict[str, str] = {"device": device, "full_name": device}
        if not self._available:
            return info
        try:
            full_name = self._core.get_property(device, "FULL_DEVICE_NAME")
            info["full_name"] = full_name
        except Exception:
            pass
        return info

    def compile_model(self, model_path: str, device: str = "CPU"):
        """Compile an OpenVINO IR model for the given device.

        Parameters
        ----------
        model_path : str
            Path to the .xml file of the OpenVINO IR model.
        device : str
            Target device string.

        Returns
        -------
        Compiled model object, or None if runtime is unavailable.
        """
        if not self._available:
            logger.error("Cannot compile model — OpenVINO runtime unavailable")
            return None
        try:
            model = self._core.read_model(model_path)
            compiled = self._core.compile_model(model, device)
            logger.info("Compiled model %s on device %s", model_path, device)
            return compiled
        except Exception as exc:
            logger.error(
                "Failed to compile %s on %s: %s", model_path, device, exc
            )
            return None
