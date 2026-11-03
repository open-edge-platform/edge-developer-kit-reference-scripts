# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import logging
from pathlib import Path
from typing import Any

from geti_sdk.rest_clients import ModelClient
from geti_sdk.rest_clients.deployment_client import DeploymentClient

from core.device_manager import DEFAULT_DEVICE
from core.deployment_manager import DeploymentManager
from core.model_manager import ModelManager
from core.geti_client import GetiClient

logger = logging.getLogger(__name__)

MODEL_POLL_INTERVAL = 30


class SyncManager:
    """Auto-sync: polls Geti for newer cls/seg model versions and hot-swaps them in."""

    def __init__(
        self,
        model_manager: ModelManager,
        deployment_manager: DeploymentManager,
        geti_client: GetiClient,
        cls_dir: Path,
        seg_dir: Path,
        cls_config_path: Path,
        seg_config_path: Path,
        instance_dir: Path,
    ) -> None:
        self._model_manager = model_manager
        self._deployment_manager = deployment_manager
        self._geti_client = geti_client

        self._cls_dir = cls_dir
        self._seg_dir = seg_dir
        self._cls_config_path = cls_config_path
        self._seg_config_path = seg_config_path
        # For download scratch dirs: cls_dir/seg_dir are the shared install location.
        self._instance_dir = instance_dir

        self._sync_config: dict[str, Any] = {}
        self._auto_sync_enabled: bool = False
        self._poll_task: asyncio.Task | None = None

    def start(self, auto_sync_enabled: bool) -> None:
        self._auto_sync_enabled = auto_sync_enabled
        self._poll_task = asyncio.create_task(self._auto_sync_loop())
        logger.info(
            f"Auto-sync started (every {MODEL_POLL_INTERVAL}s)"
        )

    async def stop(self) -> None:
        if self._poll_task is not None:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass

    def set_credentials(
        self,
        host: str,
        token: str,
        verify_ssl: bool,
    ) -> None:
        self._sync_config = {
            "host": host,
            "token": token,
            "verify_ssl": verify_ssl,
        }

    def toggle(self, enabled: bool) -> None:
        self._auto_sync_enabled = enabled
        self._model_manager.worker_config_cls[
            "auto_sync_enabled"
        ] = enabled
        self._model_manager.worker_config_seg[
            "auto_sync_enabled"
        ] = enabled
        ModelManager.save_worker_config(
            self._model_manager.worker_config_cls,
            self._cls_config_path,
        )
        ModelManager.save_worker_config(
            self._model_manager.worker_config_seg,
            self._seg_config_path,
        )
        logger.info(
            f"Auto-sync {'enabled' if enabled else 'disabled'}"
        )

    @property
    def enabled(self) -> bool:
        return self._auto_sync_enabled

    @property
    def credentials_set(self) -> bool:
        return bool(self._sync_config)

    async def _auto_sync_loop(self) -> None:
        logger.info(
            f"Auto-sync loop started "
            f"(poll interval: {MODEL_POLL_INTERVAL}s)"
        )

        while True:
            await asyncio.sleep(MODEL_POLL_INTERVAL)

            if not self._auto_sync_enabled:
                logger.debug("Auto-sync: disabled, skipping")
                continue

            if not self._sync_config:
                logger.debug("Auto-sync: no credentials, skipping")
                continue

            host = self._sync_config["host"]
            token = self._sync_config["token"]
            verify_ssl = self._sync_config["verify_ssl"]

            # Geti calls, the download and the swap block for minutes on a new model: run them in a
            # thread so the worker keeps answering.
            try:
                await asyncio.to_thread(
                    self._sync_models, host, token, verify_ssl
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning(f"Auto-sync error: {exc}")

    def _sync_models(self, host: str, token: str, verify_ssl: bool) -> None:
        self._sync_model(
            host=host,
            token=token,
            verify_ssl=verify_ssl,
            is_cls=True,
            context="auto-sync-cls",
        )
        self._sync_model(
            host=host,
            token=token,
            verify_ssl=verify_ssl,
            is_cls=False,
            context="auto-sync-seg",
        )

    def _sync_model(
        self,
        host: str,
        token: str,
        verify_ssl: bool,
        is_cls: bool,
        context: str,
    ) -> None:
        # A setup of the same model installs into the same folder: let it
        # finish, and check again next round.
        install_lock = self._model_manager.install_lock(is_cls)
        if not install_lock.acquire(blocking=False):
            logger.info(f"[{context}] Setup in progress, skipping")
            return
        try:
            self._sync_model_locked(host, token, verify_ssl, is_cls, context)
        finally:
            install_lock.release()

    def _sync_model_locked(
        self,
        host: str,
        token: str,
        verify_ssl: bool,
        is_cls: bool,
        context: str,
    ) -> None:
        # Read while holding the install lock: a setup that just finished
        # has replaced these.
        mm = self._model_manager
        worker_config = mm.worker_config_cls if is_cls else mm.worker_config_seg
        model_info = mm.model_info_cls if is_cls else mm.model_info_seg
        config_path = self._cls_config_path if is_cls else self._seg_config_path
        deployment_dir = self._cls_dir if is_cls else self._seg_dir

        if not worker_config.get("project_name"):
            logger.debug(
                f"[{context}] No project configured, skipping"
            )
            return

        try:
            geti = self._geti_client.get_geti(host, token, verify_ssl)
            project = geti.get_project(
                project_name=worker_config.get("project_name"),
                project_id=worker_config.get("project_id"),
            )

            deployment_client = DeploymentClient(
                workspace_id=geti.workspace_id,
                project=project,
                session=geti.session,
            )

            if not deployment_client.ready_to_deploy:
                logger.info(
                    f"[{context}] Not ready to deploy, skipping"
                )
                return

            model_client = ModelClient(
                workspace_id=geti.workspace_id,
                project=project,
                session=geti.session,
            )
            active_models = model_client.get_all_active_models()

            if not active_models or all(
                m is None for m in active_models
            ):
                logger.debug(
                    f"[{context}] No active models on server"
                )
                return

            server_version = max(
                (
                    m.version
                    for m in active_models
                    if m is not None and m.version is not None
                ),
                default=None,
            )

            if server_version is None:
                return

            local_version = model_info.get("version")
            logger.info(
                f"[{context}] local=v{local_version} | "
                f"server=v{server_version}"
            )

            if (
                local_version is not None
                and server_version <= local_version
            ):
                logger.info(
                    f"[{context}] Already on latest (v{local_version})"
                )
                return

            logger.info(
                f"[{context}] New model available, downloading..."
            )

            temp_output_dir = (
                self._instance_dir / f"{context}_v{server_version}_tmp"
            )
            temp_output_dir.mkdir(parents=True, exist_ok=True)

            new_deployment = deployment_client.deploy_project(
                output_folder=str(temp_output_dir),
            )

            self._deployment_manager.do_model_swap(
                new_deployment=new_deployment,
                new_deployment_saved_dir=temp_output_dir,
                new_version=server_version,
                deployment_dir=deployment_dir,
                worker_config=worker_config,
                config_path=config_path,
                model_info_ref=model_info,
                save_config_fn=ModelManager.save_worker_config,
                load_model_info_fn=ModelManager.load_model_info,
                context=context,
                device=worker_config.get("device", DEFAULT_DEVICE),
                publish=lambda deployment, info: mm.publish_swap(
                    deployment, info, is_cls
                ),
            )

        except Exception as exc:
            logger.warning(f"[{context}] Sync error: {exc}")