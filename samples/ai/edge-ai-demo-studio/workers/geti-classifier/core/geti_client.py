# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import shutil
from pathlib import Path
from typing import Any

import urllib3
from fastapi import HTTPException
from geti_sdk import Geti
from geti_sdk.rest_clients import ModelClient
from geti_sdk.rest_clients.configuration_clients import (
    ProjectConfigurationClient,
)
from geti_sdk.rest_clients.deployment_client import DeploymentClient

from schemas import ModelsRequest, ProjectsRequest, ProjectsResponse, ModelsResponse, SetupRequest
from core.device_manager import DEFAULT_DEVICE

logger = logging.getLogger(__name__)


class GetiClient:
    """
    Manages Geti server connections and all Geti API interactions:
    project listing, model listing, and deployment downloads.
    """

    def __init__(self, worker_dir: Path) -> None:
        self._worker_dir = worker_dir
        self._geti_cache: dict[str, Geti] = {}

    # ── Connection ────────────────────────────────────────────────────────────

    @staticmethod
    def _normalize_host(host: str) -> str:
        host = host.strip()
        if not host.startswith("http"):
            host = f"https://{host}"
        return host.rstrip("/")

    def get_geti(
        self,
        host: str,
        token: str,
        verify_ssl: bool = False,
    ) -> Geti:
        host = self._normalize_host(host)
        cache_key = f"{host}:{token}:{verify_ssl}"
        if cache_key not in self._geti_cache:
            urllib3.disable_warnings(
                urllib3.exceptions.InsecureRequestWarning
            )
            geti = Geti(
                host=host,
                token=token,
                verify_certificate=verify_ssl,
            )
            self._geti_cache[cache_key] = geti
            logger.info(f"Geti connection established: {host}")
        return self._geti_cache[cache_key]

    # ── Project listing ───────────────────────────────────────────────────────

    def list_projects(self, req: ProjectsRequest) -> ProjectsResponse:
        try:
            geti = self.get_geti(req.host, req.token, req.verify_ssl)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot connect: {exc}",
            )

        try:
            projects = geti.project_client.get_all_projects(
                get_project_details=False
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to list projects: {exc}",
            )

        project_list = []
        for p in projects:
            labels = [
                label.name
                for task in p.pipeline.tasks
                for label in (task.labels or [])
            ]
            project_list.append({
                "id": p.id,
                "name": p.name,
                "labels": labels,
                "creation_time": (
                    str(p.creation_time) if p.creation_time else None
                ),
                "score": p.score,
            })

        return ProjectsResponse(
            status="ok",
            projects=project_list,
            total=len(project_list),
        )

    # ── Model listing ─────────────────────────────────────────────────────────

    def list_models(self, req: ModelsRequest) -> ModelsResponse:
        if req.project_id is None and req.project_name is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Either project_id or project_name must be provided."
                ),
            )

        try:
            geti = self.get_geti(req.host, req.token, req.verify_ssl)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot connect: {exc}",
            )

        try:
            project = geti.get_project(
                project_name=req.project_name,
                project_id=req.project_id,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=404,
                detail=f"Project not found: {exc}",
            )

        try:
            model_client = ModelClient(
                workspace_id=geti.workspace_id,
                project=project,
                session=geti.session,
            )
            all_model_groups = model_client.get_all_model_groups()
            model_list = []

            for group in all_model_groups:
                for model in (group.models or []):
                    performance = getattr(model, "performance", None)
                    score = (
                        getattr(performance, "score", None)
                        if performance
                        else None
                    )
                    model_list.append({
                        "id": model.id,
                        "name": group.name,
                        "version": model.version,
                        "score": score,
                        "is_active": getattr(
                            model, "active_model", False
                        ),
                        "creation_date": (
                            str(model.creation_date)
                            if getattr(model, "creation_date", None)
                            else None
                        ),
                        "precision": getattr(model, "precision", []),
                        "size": getattr(model, "size", None),
                        "target_device": getattr(
                            model, "target_device", DEFAULT_DEVICE
                        ),
                        "lifecycle_stage": getattr(
                            model, "lifecycle_stage", "unknown"
                        ),
                    })

            model_list.sort(
                key=lambda m: (
                    m["version"] if m["version"] is not None else 0
                ),
                reverse=True,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to list models: {exc}",
            )

        return ModelsResponse(
            status="ok",
            models=model_list,
            total=len(model_list),
        )

    # ── Deployment download ───────────────────────────────────────────────────

    def download_setup_deployment(
        self,
        req: SetupRequest,
        context: str,
    ) -> tuple[Path, Any]:
        try:
            geti = self.get_geti(req.host, req.token, req.verify_ssl)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot connect to Geti: {exc}",
            )

        project = geti.get_project(
            project_name=req.project_name,
            project_id=req.project_id,
        )
        logger.info(
            f"[{context}] Project: '{project.name}' (id={project.id})"
        )

        self._try_enable_auto_train(geti, project, context)

        deployment_client = DeploymentClient(
            workspace_id=geti.workspace_id,
            project=project,
            session=geti.session,
        )

        if not deployment_client.ready_to_deploy:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Project '{project.name}' "
                    f"is not ready for deployment."
                ),
            )

        temp_output_dir = self._worker_dir / f"{context}_download_tmp"
        if temp_output_dir.exists():
            shutil.rmtree(str(temp_output_dir))
        temp_output_dir.mkdir(parents=True, exist_ok=True)

        self._deploy_project(
            geti=geti,
            project=project,
            deployment_client=deployment_client,
            req=req,
            temp_output_dir=temp_output_dir,
            context=context,
        )

        return temp_output_dir, project

    @staticmethod
    def _try_enable_auto_train(
        geti: Geti,
        project: Any,
        context: str,
    ) -> None:
        try:
            config_client = ProjectConfigurationClient(
                workspace_id=geti.workspace_id,
                project=project,
                session=geti.session,
            )
            config = config_client.get_configuration()
            for task_config in config.task_configs:
                task_config.auto_training.enable = True
            config_client.set_configuration(config)
        except Exception as exc:
            logger.warning(
                f"[{context}] Could not enable auto-train: {exc}"
            )

    def _deploy_project(
        self,
        geti: Geti,
        project: Any,
        deployment_client: DeploymentClient,
        req: SetupRequest,
        temp_output_dir: Path,
        context: str,
    ) -> None:
        if not req.model_id:
            deployment_client.deploy_project(
                output_folder=str(temp_output_dir)
            )
            return

        try:
            model_client = ModelClient(
                workspace_id=geti.workspace_id,
                project=project,
                session=geti.session,
            )
            all_groups = model_client.get_all_model_groups()
            target_model = None
            target_group = None

            for group in all_groups:
                for model in (group.models or []):
                    if model.id == req.model_id:
                        target_model = model
                        target_group = group
                        break
                if target_model:
                    break

            if target_model is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Model id '{req.model_id}' not found.",
                )

            logger.info(
                f"[{context}] Target model: {target_model.id} "
                f"v{target_model.version} in '{target_group.name}'"
            )
            target_model = model_client.update_model_detail(target_model)
            deployment_client.deploy_project(
                output_folder=str(temp_output_dir),
                models=[target_model],
            )

        except HTTPException:
            raise
        except Exception as exc:
            logger.warning(
                f"[{context}] Specific model failed, using latest: {exc}"
            )
            deployment_client.deploy_project(
                output_folder=str(temp_output_dir)
            )