# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import shutil
import sys
from pathlib import Path

from geti_sdk.deployment import Deployment

from core.device_manager import DEFAULT_DEVICE, DeviceManager

logger = logging.getLogger(__name__)


class DeploymentManager:
    """
    Handles all deployment folder operations:
    locating, copying, loading, and hot-swapping model deployments.
    """

    def __init__(self, device_manager: DeviceManager) -> None:
        self._device_manager = device_manager

    # ── Folder helpers ────────────────────────────────────────────────────────

    @staticmethod
    def rmtree_safe(path: Path, context: str) -> None:
        if not path.exists():
            return
        if sys.platform == "win32":
            import time
            for attempt in range(5):
                try:
                    shutil.rmtree(str(path))
                    return
                except PermissionError:
                    if attempt == 4:
                        raise
                    logger.warning(
                        f"[{context}] PermissionError removing {path}, "
                        f"retry {attempt + 1}/5"
                    )
                    time.sleep(1)
        else:
            shutil.rmtree(str(path))

    @staticmethod
    def find_deployment_source(
        search_root: Path,
        context: str,
    ) -> Path:
        candidate = search_root / "deployment"
        if candidate.is_dir() and any(candidate.glob("*/model.json")):
            logger.info(
                f"[{context}] Deployment source: {search_root} "
                f"(contains deployment/ subfolder)"
            )
            return search_root

        if search_root.name == "deployment" and any(
            search_root.glob("*/model.json")
        ):
            logger.info(
                f"[{context}] search_root is the deployment folder itself; "
                f"returning parent: {search_root.parent}"
            )
            return search_root.parent

        for child in sorted(search_root.iterdir()):
            if not child.is_dir():
                continue
            nested = child / "deployment"
            if nested.is_dir() and any(nested.glob("*/model.json")):
                logger.info(
                    f"[{context}] Found nested deployment source: {child}"
                )
                return child

        all_files = [str(f) for f in search_root.rglob("*")]
        raise FileNotFoundError(
            f"[{context}] Could not locate a valid deployment folder under "
            f"{search_root}.\nFull tree:\n" + "\n".join(all_files)
        )

    def install_deployment_folder(
        self,
        source_load_path: Path,
        deployment_dir: Path,
        context: str,
    ) -> None:
        source_deployment = source_load_path / "deployment"
        if not source_deployment.is_dir():
            raise FileNotFoundError(
                f"[{context}] Expected 'deployment' subfolder not found "
                f"at {source_deployment}"
            )

        self.rmtree_safe(deployment_dir, context)

        dest_deployment = deployment_dir / "deployment"
        shutil.copytree(str(source_deployment), str(dest_deployment))
        logger.info(
            f"[{context}] Copied {source_deployment} → {dest_deployment}"
        )

        if not any(deployment_dir.glob("deployment/*/model.json")):
            all_files = [str(f) for f in deployment_dir.rglob("*")]
            raise RuntimeError(
                f"[{context}] Copy succeeded but structure is wrong — "
                f"no deployment/*/model.json found.\nTree:\n"
                + "\n".join(all_files)
            )

        contents = list(deployment_dir.iterdir())
        logger.info(
            f"[{context}] deployment_dir contents after install: {contents}"
        )

    @staticmethod
    def load_deployment_from_dir(
        deployment_dir: Path,
        context: str,
    ) -> Deployment:
        dep_sub = deployment_dir / "deployment"
        if not dep_sub.is_dir():
            all_files = [str(f) for f in deployment_dir.rglob("*")]
            raise FileNotFoundError(
                f"[{context}] deployment_dir has no 'deployment' "
                f"subfolder.\nTree:\n" + "\n".join(all_files)
            )

        load_path = str(deployment_dir)
        logger.info(
            f"[{context}] Calling Deployment.from_folder({load_path})"
        )

        try:
            return Deployment.from_folder(load_path)
        except Exception:
            all_files = [str(f) for f in deployment_dir.rglob("*")]
            logger.error(
                f"[{context}] Deployment.from_folder() failed.\n"
                f"Tree:\n" + "\n".join(all_files)
            )
            raise

    def install_deployment(
        self,
        temp_output_dir: Path,
        deployment_dir: Path,
        device: str,
        context: str,
    ) -> tuple[Deployment, str]:
        logger.info(
            f"[{context}] temp_output_dir contents: "
            f"{list(temp_output_dir.iterdir())}"
        )

        source_load_path = self.find_deployment_source(
            temp_output_dir, context
        )
        self.install_deployment_folder(
            source_load_path, deployment_dir, context
        )

        try:
            self.rmtree_safe(temp_output_dir, context)
        except Exception as exc:
            logger.warning(
                f"[{context}] Could not clean temp dir: {exc}"
            )

        logger.info(
            f"[{context}] Deployment installed at {deployment_dir}"
        )

        deployment = self.load_deployment_from_dir(deployment_dir, context)
        actual_device = (
            self._device_manager.load_inference_with_verification(
                deployment, device, context=context
            )
        )
        return deployment, actual_device

    def do_model_swap(
        self,
        new_deployment: Deployment,
        new_deployment_saved_dir: Path,
        new_version: int | None,
        deployment_dir: Path,
        worker_config: dict,
        config_path: Path,
        model_info_ref: dict,
        save_config_fn,
        load_model_info_fn,
        context: str,
        device: str = DEFAULT_DEVICE,
    ) -> Deployment:
        current_version = model_info_ref.get("version")

        try:
            del new_deployment
            if sys.platform == "win32":
                import gc
                gc.collect()
        except Exception as exc:
            logger.warning(
                f"[{context}] Could not release old deployment: {exc}"
            )

        source_load_path = self.find_deployment_source(
            new_deployment_saved_dir, context
        )
        self.install_deployment_folder(
            source_load_path, deployment_dir, context
        )

        logger.info(
            f"[{context}] Deployment folder replaced: "
            f"v{current_version} → v{new_version}"
        )

        reloaded = self.load_deployment_from_dir(deployment_dir, context)
        actual_device = (
            self._device_manager.load_inference_with_verification(
                reloaded, device, context=context
            )
        )

        if actual_device != device:
            worker_config["device"] = actual_device
            save_config_fn(worker_config, config_path)

        model_info_ref.clear()
        model_info_ref.update(load_model_info_fn(deployment_dir))

        try:
            self.rmtree_safe(new_deployment_saved_dir, context)
        except Exception as exc:
            logger.warning(
                f"[{context}] Could not clean temp dir: {exc}"
            )

        logger.info(
            f"[{context}] Swap complete | "
            f"v{current_version} → v{model_info_ref.get('version')} | "
            f"device={worker_config.get('device', DEFAULT_DEVICE)}"
        )

        return reloaded