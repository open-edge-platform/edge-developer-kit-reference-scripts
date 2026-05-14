# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from geti_sdk.deployment import Deployment

from core.device_manager import DEFAULT_DEVICE, DeviceManager
from core.deployment_manager import DeploymentManager

logger = logging.getLogger(__name__)


class ModelManager:
    """
    Owns classification and segmentation model state:
    deployments, model info, and worker configs.
    Handles startup loading, setup, and config persistence.
    """

    def __init__(
        self,
        device_manager: DeviceManager,
        deployment_manager: DeploymentManager,
        cls_dir: Path,
        seg_dir: Path,
        cls_config_path: Path,
        seg_config_path: Path,
    ) -> None:
        self._device_manager = device_manager
        self._deployment_manager = deployment_manager

        self._cls_dir = cls_dir
        self._seg_dir = seg_dir
        self._cls_config_path = cls_config_path
        self._seg_config_path = seg_config_path

        # Classification state
        self.deployment_cls: Deployment | None = None
        self.model_info_cls: dict[str, Any] = {}
        self.worker_config_cls: dict[str, Any] = {}

        # Segmentation state
        self.deployment_seg: Deployment | None = None
        self.model_info_seg: dict[str, Any] = {}
        self.worker_config_seg: dict[str, Any] = {}

    # ── Config persistence ────────────────────────────────────────────────────

    @staticmethod
    def _default_worker_config() -> dict[str, Any]:
        return {
            "project_name": None,
            "project_id": None,
            "allowed_labels": [],
            "auto_sync_enabled": False,
            "device": DEFAULT_DEVICE,
        }

    @staticmethod
    def load_worker_config(path: Path) -> dict[str, Any]:
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                data.setdefault("device", DEFAULT_DEVICE)
                logger.info(
                    f"Loaded config from {path.name}: "
                    f"project='{data.get('project_name')}' | "
                    f"device={data.get('device')}"
                )
                return data
            except Exception as exc:
                logger.warning(f"Could not read {path.name}: {exc}")
        return ModelManager._default_worker_config()

    @staticmethod
    def save_worker_config(config: dict[str, Any], path: Path) -> None:
        try:
            path.write_text(
                json.dumps(config, indent=2), encoding="utf-8"
            )
            logger.info(f"Config saved to {path.name}")
        except Exception as exc:
            logger.warning(f"Could not save {path.name}: {exc}")

    # ── Model info ────────────────────────────────────────────────────────────

    @staticmethod
    def load_model_info(deployment_dir: Path) -> dict[str, Any]:
        candidates = sorted(deployment_dir.glob("*/model.json"))
        candidates += sorted(
            deployment_dir.glob("deployment/*/model.json")
        )
        candidates = [
            c for c in candidates if c.parent.name != "model"
        ]

        seen: set[Path] = set()
        unique_candidates: list[Path] = []
        for c in candidates:
            if c not in seen:
                seen.add(c)
                unique_candidates.append(c)

        raw: dict[str, Any] = {}
        used_path: Path | None = None

        for candidate in unique_candidates:
            if candidate.exists():
                try:
                    raw = json.loads(
                        candidate.read_text(encoding="utf-8")
                    )
                    used_path = candidate
                    logger.info(
                        f"Loaded model.json from: {candidate}"
                    )
                    break
                except Exception as exc:
                    logger.warning(
                        f"Could not parse {candidate}: {exc}"
                    )

        if not raw:
            logger.warning(
                f"model.json not found in {deployment_dir}"
            )
            return {
                "id": None,
                "name": "unknown",
                "version": None,
                "model_format": None,
                "precision": [],
                "performance_score": None,
                "has_xai_head": False,
                "target_device": DEFAULT_DEVICE,
                "lifecycle_stage": "unknown",
                "optimization_type": None,
                "size_bytes": None,
                "source_path": None,
                "raw": {},
            }

        performance = raw.get("performance") or {}
        return {
            "id": raw.get("id"),
            "name": raw.get("name", "unknown"),
            "version": raw.get("version"),
            "model_format": raw.get("model_format"),
            "precision": raw.get("precision", []),
            "performance_score": performance.get("score"),
            "has_xai_head": raw.get("has_xai_head", False),
            "target_device": raw.get("target_device", DEFAULT_DEVICE),
            "lifecycle_stage": raw.get("lifecycle_stage", "unknown"),
            "optimization_type": raw.get("optimization_type"),
            "size_bytes": raw.get("size"),
            "raw": raw,
            "source_path": str(used_path),
        }

    # ── Startup loading ───────────────────────────────────────────────────────

    def load_configs(self) -> None:
        self.worker_config_cls = self.load_worker_config(
            self._cls_config_path
        )
        self.worker_config_seg = self.load_worker_config(
            self._seg_config_path
        )

    def load_models_on_startup(self) -> None:
        self._load_single_model_on_startup(
            deployment_dir=self._cls_dir,
            worker_config=self.worker_config_cls,
            config_path=self._cls_config_path,
            context="startup-cls",
            is_cls=True,
        )
        self._load_single_model_on_startup(
            deployment_dir=self._seg_dir,
            worker_config=self.worker_config_seg,
            config_path=self._seg_config_path,
            context="startup-seg",
            is_cls=False,
        )

    def _load_single_model_on_startup(
        self,
        deployment_dir: Path,
        worker_config: dict[str, Any],
        config_path: Path,
        context: str,
        is_cls: bool,
    ) -> None:
        label = "CLS" if is_cls else "SEG"
        endpoint = "setup-cls" if is_cls else "setup-seg"

        if not deployment_dir.exists():
            logger.warning(
                f"No {label} deployment found. "
                f"Call POST /{endpoint} first."
            )
            return

        model_info = self.load_model_info(deployment_dir)
        logger.info(
            f"{label} model: "
            f"{model_info['name']} v{model_info['version']}"
        )

        if is_cls:
            self.model_info_cls = model_info
        else:
            self.model_info_seg = model_info

        try:
            deployment = self._deployment_manager.load_deployment_from_dir(
                deployment_dir, context
            )
            actual = (
                self._device_manager.load_inference_with_verification(
                    deployment,
                    worker_config.get("device", DEFAULT_DEVICE),
                    context=context,
                )
            )
            if actual != worker_config.get("device"):
                worker_config["device"] = actual
                self.save_worker_config(worker_config, config_path)

            if is_cls:
                self.deployment_cls = deployment
            else:
                self.deployment_seg = deployment

        except Exception as exc:
            logger.error(
                f"Failed to load {label} model: {exc}",
                exc_info=True,
            )

    # ── Setup ─────────────────────────────────────────────────────────────────

    def apply_setup(
        self,
        deployment: Deployment,
        model_info: dict[str, Any],
        worker_config: dict[str, Any],
        is_cls: bool,
    ) -> None:
        if is_cls:
            self.deployment_cls = deployment
            self.model_info_cls = model_info
            self.worker_config_cls = worker_config
        else:
            self.deployment_seg = deployment
            self.model_info_seg = model_info
            self.worker_config_seg = worker_config

    # ── Queries ───────────────────────────────────────────────────────────────

    def get_model_info_response(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "classification": {
                "id": self.model_info_cls.get("id"),
                "name": self.model_info_cls.get("name"),
                "version": self.model_info_cls.get("version"),
                "model_format": self.model_info_cls.get("model_format"),
                "precision": self.model_info_cls.get("precision", []),
                "target_device": self.worker_config_cls.get(
                    "device", DEFAULT_DEVICE
                ),
                "performance_score": self.model_info_cls.get(
                    "performance_score"
                ),
                "has_xai_head": self.model_info_cls.get("has_xai_head"),
                "lifecycle_stage": self.model_info_cls.get(
                    "lifecycle_stage"
                ),
                "size_bytes": self.model_info_cls.get("size_bytes"),
            },
            "segmentation": {
                "id": self.model_info_seg.get("id"),
                "name": self.model_info_seg.get("name"),
                "version": self.model_info_seg.get("version"),
                "model_format": self.model_info_seg.get("model_format"),
                "precision": self.model_info_seg.get("precision", []),
                "target_device": self.worker_config_seg.get(
                    "device", DEFAULT_DEVICE
                ),
                "performance_score": self.model_info_seg.get(
                    "performance_score"
                ),
                "has_xai_head": self.model_info_seg.get("has_xai_head"),
                "lifecycle_stage": self.model_info_seg.get(
                    "lifecycle_stage"
                ),
                "size_bytes": self.model_info_seg.get("size_bytes"),
            },
        }

    def assert_pipeline_ready(self) -> None:
        if self.deployment_seg is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Segmentation model not loaded. "
                    "Call POST /setup-seg first."
                ),
            )
        if self.deployment_cls is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Classification model not loaded. "
                    "Call POST /setup-cls first."
                ),
            )