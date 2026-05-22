# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
from typing import Any

import openvino as ov
from fastapi import HTTPException
from geti_sdk.deployment import Deployment

logger = logging.getLogger(__name__)

SUPPORTED_DEVICES = {"CPU", "GPU", "NPU"}
DEFAULT_DEVICE = "GPU"


class DeviceManager:
    """
    Handles OpenVINO device discovery, validation,
    and inference model loading with device verification.
    """

    @staticmethod
    def get_available_devices() -> list[dict[str, Any]]:
        try:
            core = ov.Core()
            raw_devices = core.available_devices
            devices = []

            for device_name in raw_devices:
                try:
                    full_name = core.get_property(
                        device_name, "FULL_DEVICE_NAME"
                    )
                except Exception:
                    full_name = device_name

                if device_name.startswith("GPU"):
                    device_type = "GPU"
                elif device_name.startswith("NPU"):
                    device_type = "NPU"
                else:
                    device_type = "CPU"

                devices.append({
                    "name": device_name,
                    "full_name": full_name,
                    "type": device_type,
                    "supported": device_type in SUPPORTED_DEVICES,
                })

            logger.info(
                "[DEVICE] Available: "
                + ", ".join(
                    f"{d['name']} ({d['full_name']})" for d in devices
                )
            )
            return devices

        except Exception as exc:
            logger.warning(
                f"[DEVICE] Could not query OpenVINO devices: {exc}"
            )
            return [{
                "name": "CPU",
                "full_name": "CPU (fallback)",
                "type": "CPU",
                "supported": True,
            }]

    @staticmethod
    def validate_device(device: str) -> str:
        normalized = device.strip().upper()
        if normalized not in SUPPORTED_DEVICES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Unsupported device '{device}'. "
                    f"Must be one of: {sorted(SUPPORTED_DEVICES)}"
                ),
            )
        return normalized

    @staticmethod
    def verify_loaded_device(deployment: Deployment) -> str | None:
        try:
            models_container = None
            for attr in (
                "models", "_models",
                "inference_models", "_inference_models",
            ):
                candidate = getattr(deployment, attr, None)
                if candidate is not None:
                    models_container = candidate
                    break

            if models_container is None:
                return None

            items = (
                list(models_container.values())
                if isinstance(models_container, dict)
                else models_container
                if isinstance(models_container, list)
                else [models_container]
            )

            for item in items:
                compiled = None
                for path in (
                    "inference_model", "_inference_model",
                    "model", "_model",
                    "compiled_model", "_compiled_model",
                ):
                    candidate = getattr(item, path, None)
                    if candidate is not None:
                        compiled = candidate
                        break

                if compiled is None:
                    compiled = item

                for prop in ("EXECUTION_DEVICES", "DEVICE_PRIORITIES"):
                    try:
                        actual = compiled.get_property(prop)
                        if isinstance(actual, (list, tuple)):
                            actual = ", ".join(str(d) for d in actual)
                        return str(actual)
                    except Exception:
                        continue

            return None

        except Exception as exc:
            logger.debug(f"[DEVICE] verify_loaded_device error: {exc}")
            return None

    def load_inference_with_verification(
        self,
        deployment: Deployment,
        device: str,
        context: str = "",
    ) -> str:
        prefix = f"[DEVICE]{f' [{context}]' if context else ''}"
        logger.info(f"{prefix} Requesting device: {device}")

        try:
            deployment.load_inference_models(device=device)
            actual = self.verify_loaded_device(deployment)
            confirmed = bool(actual and device in actual)
            logger.info(
                f"{prefix} requested={device} | "
                f"actual={actual or 'unverified'} | "
                f"{'✓ CONFIRMED' if confirmed else '? unverified'}"
            )
            return device

        except Exception as exc:
            if device != "CPU":
                logger.warning(
                    f"{prefix} {device} failed: {exc} — falling back to CPU"
                )
                deployment.load_inference_models(device="CPU")
                actual = self.verify_loaded_device(deployment)
                logger.info(
                    f"{prefix} Fallback | "
                    f"actual={actual or 'CPU (unverified)'}"
                )
                return "CPU"
            raise