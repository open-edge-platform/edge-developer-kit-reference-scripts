# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import re
import sys
import uuid
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import HTTPException
from fastapi.responses import FileResponse
from geti_sdk.data_models.annotations import Annotation
from geti_sdk.data_models.annotation_scene import AnnotationScene
from geti_sdk.data_models.media_identifiers import ImageIdentifier
from geti_sdk.data_models.shapes import Rectangle
from geti_sdk.rest_clients import AnnotationClient, ImageClient

from core.device_manager import DEFAULT_DEVICE, DeviceManager
from core.deployment_manager import DeploymentManager
from core.geti_client import GetiClient
from core.image_store import ImageStore
from core.model_manager import ModelManager
from core.sync_manager import MODEL_POLL_INTERVAL, SyncManager
from schemas import (
    AutoSyncToggleRequest,
    FeedbackRequest,
    FeedbackResponse,
    ModelsRequest,
    ModelsResponse,
    ProjectsRequest,
    ProjectsResponse,
    SetupRequest,
    SetupResponse,
)

logger = logging.getLogger(__name__)

WORKER_DIR = Path(__file__).resolve().parent
DEPLOYMENT_CLS_DIR = WORKER_DIR / "deployment_cls"
DEPLOYMENT_SEG_DIR = WORKER_DIR / "deployment_seg"
WORKER_CONFIG_CLS_FILE = WORKER_DIR / "worker_config_cls.json"
WORKER_CONFIG_SEG_FILE = WORKER_DIR / "worker_config_seg.json"


class GetiWorker:
    """
    Orchestrator — composes all sub-managers and exposes
    clean endpoint handler methods to main.py.
    Contains no business logic itself.
    """

    def __init__(self) -> None:
        self._device_manager = DeviceManager()
        self._deployment_manager = DeploymentManager(self._device_manager)
        self._image_store = ImageStore()
        self._geti_client = GetiClient(worker_dir=WORKER_DIR)

        self._model_manager = ModelManager(
            device_manager=self._device_manager,
            deployment_manager=self._deployment_manager,
            cls_dir=DEPLOYMENT_CLS_DIR,
            seg_dir=DEPLOYMENT_SEG_DIR,
            cls_config_path=WORKER_CONFIG_CLS_FILE,
            seg_config_path=WORKER_CONFIG_SEG_FILE,
        )

        self._sync_manager = SyncManager(
            model_manager=self._model_manager,
            deployment_manager=self._deployment_manager,
            geti_client=self._geti_client,
            cls_dir=DEPLOYMENT_CLS_DIR,
            seg_dir=DEPLOYMENT_SEG_DIR,
            cls_config_path=WORKER_CONFIG_CLS_FILE,
            seg_config_path=WORKER_CONFIG_SEG_FILE,
        )

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def startup(self) -> None:
        logger.info(f"Platform      : {sys.platform}")
        logger.info(f"Worker dir    : {WORKER_DIR}")
        logger.info(f"Deploy CLS dir: {DEPLOYMENT_CLS_DIR}")
        logger.info(f"Deploy SEG dir: {DEPLOYMENT_SEG_DIR}")
        logger.info(f"Temp dir      : {self._image_store.temp_dir}")

        available = self._device_manager.get_available_devices()
        logger.info("=" * 60)
        for d in available:
            status = "✓ supported" if d["supported"] else "— not supported"
            logger.info(
                f"  {d['name']:10s} | {d['full_name']:50s} | {status}"
            )
        logger.info("=" * 60)

        self._model_manager.load_configs()
        self._model_manager.load_models_on_startup()

        self._sync_manager.start(
            auto_sync_enabled=self._model_manager.worker_config_cls.get(
                "auto_sync_enabled", False
            )
        )

    async def shutdown(self) -> None:
        await self._sync_manager.stop()
        logger.info("Shutting down geti worker")

    # ── Healthcheck ───────────────────────────────────────────────────────────

    def healthcheck(self) -> dict[str, Any]:
        mm = self._model_manager
        cls_ready = mm.deployment_cls is not None
        seg_ready = mm.deployment_seg is not None

        return {
            "status": "ok",
            "pipeline_ready": cls_ready and seg_ready,
            "cls_configured": bool(
                mm.worker_config_cls.get("project_name")
            ),
            "cls_model_loaded": cls_ready,
            "cls_project_name": mm.worker_config_cls.get("project_name"),
            "cls_project_id": mm.worker_config_cls.get("project_id"),
            "cls_allowed_labels": mm.worker_config_cls.get(
                "allowed_labels", []
            ),
            "cls_device": mm.worker_config_cls.get(
                "device", DEFAULT_DEVICE
            ),
            "cls_model_id": mm.model_info_cls.get("id"),
            "cls_model_name": mm.model_info_cls.get("name", "unknown"),
            "cls_model_version": mm.model_info_cls.get("version"),
            "cls_model_score": mm.model_info_cls.get("performance_score"),
            "seg_configured": bool(
                mm.worker_config_seg.get("project_name")
            ),
            "seg_model_loaded": seg_ready,
            "seg_project_name": mm.worker_config_seg.get("project_name"),
            "seg_project_id": mm.worker_config_seg.get("project_id"),
            "seg_device": mm.worker_config_seg.get(
                "device", DEFAULT_DEVICE
            ),
            "seg_model_id": mm.model_info_seg.get("id"),
            "seg_model_name": mm.model_info_seg.get("name", "unknown"),
            "seg_model_version": mm.model_info_seg.get("version"),
            "seg_model_score": mm.model_info_seg.get("performance_score"),
            "platform": sys.platform,
            "auto_sync_enabled": self._sync_manager.enabled,
            "auto_sync_interval_seconds": MODEL_POLL_INTERVAL,
        }

    # ── Devices ───────────────────────────────────────────────────────────────

    def get_devices(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "current_device": self._model_manager.worker_config_cls.get(
                "device", DEFAULT_DEVICE
            ),
            "available_devices": (
                self._device_manager.get_available_devices()
            ),
            "supported_devices": sorted(
                self._device_manager.SUPPORTED_DEVICES
                if hasattr(self._device_manager, "SUPPORTED_DEVICES")
                else {"CPU", "GPU", "NPU"}
            ),
        }

    # ── Projects / Models ─────────────────────────────────────────────────────

    def list_projects(self, req: ProjectsRequest) -> ProjectsResponse:
        return self._geti_client.list_projects(req)

    def list_models(self, req: ModelsRequest) -> ModelsResponse:
        return self._geti_client.list_models(req)

    # ── Setup ─────────────────────────────────────────────────────────────────

    def _run_setup(
        self,
        req: SetupRequest,
        deployment_dir: Path,
        config_path: Path,
        context: str,
        is_cls: bool,
    ) -> SetupResponse:
        requested_device = self._device_manager.validate_device(req.device)

        if req.project_id is None and req.project_name is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Either project_id or project_name must be provided."
                ),
            )

        try:
            temp_output_dir, project = (
                self._geti_client.download_setup_deployment(
                    req=req,
                    context=context,
                )
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Download failed: {exc}",
            )

        try:
            deployment, actual_device = (
                self._deployment_manager.install_deployment(
                    temp_output_dir=temp_output_dir,
                    deployment_dir=deployment_dir,
                    device=requested_device,
                    context=context,
                )
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Install failed: {exc}",
            )

        model_info = ModelManager.load_model_info(deployment_dir)
        labels = [
            label.name
            for task in project.pipeline.tasks
            for label in (task.labels or [])
        ]
        worker_config = {
            "project_name": project.name,
            "project_id": project.id,
            "allowed_labels": labels,
            "device": actual_device,
            "auto_sync_enabled": False,
        }
        ModelManager.save_worker_config(worker_config, config_path)

        self._model_manager.apply_setup(
            deployment=deployment,
            model_info=model_info,
            worker_config=worker_config,
            is_cls=is_cls,
        )
        self._sync_manager.set_credentials(
            host=req.host,
            token=req.token,
            verify_ssl=req.verify_ssl,
        )

        logger.info(
            f"[{context}] Setup complete | "
            f"project='{project.name}' | "
            f"model='{model_info.get('name')}' "
            f"v{model_info.get('version')} | "
            f"device={actual_device}"
        )

        return SetupResponse(
            status="success",
            project_id=worker_config["project_id"],
            project_name=worker_config["project_name"],
            labels=worker_config["allowed_labels"],
            model_name=model_info.get("name", "unknown"),
            model_version=model_info.get("version"),
            model_score=model_info.get("performance_score"),
            device=actual_device,
            requested_device=requested_device,
            device_confirmed=actual_device == requested_device,
            message=(
                f"{'Classification' if is_cls else 'Segmentation'} "
                f"worker configured for '{project.name}'. "
                f"Running on {actual_device}."
            ),
        )

    def setup_cls(self, req: SetupRequest) -> SetupResponse:
        return self._run_setup(
            req=req,
            deployment_dir=DEPLOYMENT_CLS_DIR,
            config_path=WORKER_CONFIG_CLS_FILE,
            context="setup-cls",
            is_cls=True,
        )

    def setup_seg(self, req: SetupRequest) -> SetupResponse:
        return self._run_setup(
            req=req,
            deployment_dir=DEPLOYMENT_SEG_DIR,
            config_path=WORKER_CONFIG_SEG_FILE,
            context="setup-seg",
            is_cls=False,
        )

    # ── Model info ────────────────────────────────────────────────────────────

    def get_model_info(self) -> dict[str, Any]:
        return self._model_manager.get_model_info_response()

    # ── Classify ─────────────────────────────────────────────────────────────

    async def classify(self, file: Any) -> dict[str, Any]:
        self._model_manager.assert_pipeline_ready()

        image_bytes = await file.read()
        if not image_bytes:
            raise HTTPException(
                status_code=400, detail="Empty file uploaded"
            )

        nparr = np.frombuffer(image_bytes, np.uint8)
        bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if bgr is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Could not decode image. "
                    "Supported: JPG, PNG, BMP, TIFF, WEBP"
                ),
            )
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

        try:
            seg_prediction = self._model_manager.deployment_seg.infer(rgb)
        except Exception as exc:
            logger.error(
                f"Segmentation inference error: {exc}", exc_info=True
            )
            raise HTTPException(
                status_code=500, detail=f"Segmentation error: {exc}"
            )

        masked_rgb, seg_meta = self._apply_segmentation_mask(
            rgb, seg_prediction
        )

        try:
            cls_prediction = self._model_manager.deployment_cls.infer(
                masked_rgb
            )
        except Exception as exc:
            logger.error(
                f"Classification inference error: {exc}", exc_info=True
            )
            raise HTTPException(
                status_code=500,
                detail=f"Classification error: {exc}",
            )

        if not cls_prediction.annotations:
            raise HTTPException(
                status_code=500,
                detail="Classification model returned no predictions",
            )

        all_predictions = sorted(
            [
                {
                    "label": label.name,
                    "confidence": round(
                        float(label.probability) * 100, 1
                    ),
                }
                for annotation in cls_prediction.annotations
                for label in annotation.labels
            ],
            key=lambda x: x["confidence"],
            reverse=True,
        )
        top = all_predictions[0]

        image_id = str(uuid.uuid4())
        ext = Path(file.filename or "image.jpg").suffix or ".jpg"
        self._image_store.save(image_id, ext, image_bytes)

        masked_bgr = cv2.cvtColor(masked_rgb, cv2.COLOR_RGB2BGR)
        cropped_id = self._image_store.save_masked(image_id, masked_bgr)

        mm = self._model_manager
        cls_device = mm.worker_config_cls.get("device", DEFAULT_DEVICE)
        seg_device = mm.worker_config_seg.get("device", DEFAULT_DEVICE)

        logger.info(
            f"[INFERENCE] "
            f"seg_device={seg_device} | cls_device={cls_device} | "
            f"seg_model={mm.model_info_seg.get('name')} "
            f"v{mm.model_info_seg.get('version')} | "
            f"cls_model={mm.model_info_cls.get('name')} "
            f"v{mm.model_info_cls.get('version')} | "
            f"result={top['label']} ({top['confidence']}%) | "
            f"id={image_id}"
        )

        return {
            "status": "success",
            "image_id": image_id,
            "cropped_image_id": cropped_id,
            "predicted_label": top["label"],
            "confidence": top["confidence"],
            "all_predictions": all_predictions,
            "segmentation": seg_meta,
            "cls_model_id": mm.model_info_cls.get("id"),
            "cls_model_name": mm.model_info_cls.get("name", "unknown"),
            "cls_model_version": mm.model_info_cls.get("version"),
            "cls_model_score": mm.model_info_cls.get("performance_score"),
            "seg_model_id": mm.model_info_seg.get("id"),
            "seg_model_name": mm.model_info_seg.get("name", "unknown"),
            "seg_model_version": mm.model_info_seg.get("version"),
            "cls_device": cls_device,
            "seg_device": seg_device,
        }

    # ── Segmentation mask ─────────────────────────────────────────────────────

    @staticmethod
    def _apply_segmentation_mask(
        rgb_image: np.ndarray,
        prediction: Any,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        if not prediction.annotations:
            raise HTTPException(
                status_code=404,
                detail="No segment found in image",
            )

        h, w = rgb_image.shape[:2]
        combined_mask = np.zeros((h, w), dtype=np.uint8)
        object_masks: list[np.ndarray] = []
        object_areas_px: list[int] = []
        seg_labels_all: list[list[dict[str, Any]]] = []

        for annotation in prediction.annotations:
            shape = annotation.shape
            shape_type = type(shape).__name__.lower()
            object_mask = np.zeros((h, w), dtype=np.uint8)

            try:
                if shape_type == "polygon":
                    points = shape.points
                    if not points:
                        continue
                    xs = [p.x for p in points]
                    ys = [p.y for p in points]
                    if max(xs) <= 1.0 and max(ys) <= 1.0:
                        xs = [x * w for x in xs]
                        ys = [y * h for y in ys]
                    contour = np.array(
                        [(int(x), int(y)) for x, y in zip(xs, ys)],
                        dtype=np.int32,
                    )
                    cv2.fillPoly(object_mask, [contour], 255)

                elif shape_type == "rectangle":
                    if shape.width <= 1.0 and shape.height <= 1.0:
                        x1 = int(shape.x * w)
                        y1 = int(shape.y * h)
                        x2 = int((shape.x + shape.width) * w)
                        y2 = int((shape.y + shape.height) * h)
                    else:
                        x1, y1 = int(shape.x), int(shape.y)
                        x2 = int(shape.x + shape.width)
                        y2 = int(shape.y + shape.height)
                    cv2.rectangle(
                        object_mask, (x1, y1), (x2, y2), 255, -1
                    )

                elif shape_type == "ellipse":
                    if shape.width <= 1.0 and shape.height <= 1.0:
                        cx = int((shape.x + shape.width / 2) * w)
                        cy = int((shape.y + shape.height / 2) * h)
                        ax = int(shape.width / 2 * w)
                        ay = int(shape.height / 2 * h)
                    else:
                        cx = int(shape.x + shape.width / 2)
                        cy = int(shape.y + shape.height / 2)
                        ax = int(shape.width / 2)
                        ay = int(shape.height / 2)
                    cv2.ellipse(
                        object_mask,
                        (cx, cy),
                        (ax, ay),
                        0, 0, 360, 255, -1,
                    )

                else:
                    logger.warning(
                        f"Unknown shape type: {shape_type}, skipping"
                    )
                    continue

            except Exception as exc:
                logger.warning(
                    f"Could not process annotation shape: {exc}"
                )
                continue

            area = int((object_mask > 0).sum())
            object_masks.append(object_mask)
            object_areas_px.append(area)
            combined_mask = cv2.bitwise_or(combined_mask, object_mask)
            seg_labels_all.append([
                {
                    "label": lbl.name,
                    "confidence": round(
                        float(lbl.probability) * 100, 1
                    ),
                }
                for lbl in annotation.labels
            ])

        if not object_masks:
            raise HTTPException(
                status_code=404,
                detail="No segment found in image",
            )

        combined_area_px = int((combined_mask > 0).sum())
        masked_rgb = cv2.bitwise_and(
            rgb_image, rgb_image, mask=combined_mask
        )

        seg_meta = {
            "num_objects": len(object_masks),
            "object_areas_px": object_areas_px,
            "combined_area_px": combined_area_px,
            "labels_per_object": seg_labels_all,
            "shape_type": "polygon",
            "area_px": combined_area_px,
            "box": {"x1": 0, "y1": 0, "x2": w, "y2": h},
            "labels": seg_labels_all[0] if seg_labels_all else [],
        }

        logger.info(
            f"[SEG] Masked image: {len(object_masks)} object(s) | "
            f"combined_area={combined_area_px}px²"
        )

        return masked_rgb, seg_meta

    # ── Image serving ─────────────────────────────────────────────────────────

    def get_image(self, image_id: str) -> FileResponse:
        if not re.match(r"^[a-f0-9\-]{36}(_cropped)?$", image_id):
            raise HTTPException(
                status_code=400, detail="Invalid image ID"
            )
        try:
            path = self._image_store.find(image_id)
        except FileNotFoundError:
            raise HTTPException(
                status_code=404,
                detail=f"Image '{image_id}' not found",
            )
        return FileResponse(
            path=str(path),
            media_type="image/jpeg",
            filename=path.name,
        )

    # ── Feedback ──────────────────────────────────────────────────────────────

    def feedback(self, req: FeedbackRequest) -> FeedbackResponse:
        mm = self._model_manager
        allowed_labels = frozenset(
            lbl.lower()
            for lbl in mm.worker_config_cls.get("allowed_labels", [])
        )
        if not allowed_labels:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Worker not configured. "
                    "Call POST /setup-cls first."
                ),
            )
        if req.label_name.lower() not in allowed_labels:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid label '{req.label_name}'. "
                    f"Allowed: {sorted(allowed_labels)}"
                ),
            )

        cropped_id = f"{req.image_id}_cropped"
        try:
            image_path = self._image_store.find(cropped_id)
        except FileNotFoundError:
            try:
                image_path = self._image_store.find(req.image_id)
            except FileNotFoundError as exc:
                raise HTTPException(
                    status_code=404, detail=str(exc)
                )

        try:
            geti = self._geti_client.get_geti(
                req.host, req.token, req.verify_ssl
            )
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"Cannot connect: {exc}"
            )

        try:
            project = geti.get_project(
                project_name=mm.worker_config_cls.get("project_name"),
                project_id=mm.worker_config_cls.get("project_id"),
            )
        except Exception as exc:
            raise HTTPException(
                status_code=404, detail=f"Project not found: {exc}"
            )

        all_labels = [
            label
            for task in project.pipeline.tasks
            for label in (task.labels or [])
        ]
        matched_label = next(
            (
                lbl
                for lbl in all_labels
                if lbl.name.lower() == req.label_name.lower()
            ),
            None,
        )
        if matched_label is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Label '{req.label_name}' not found in project."
                ),
            )

        try:
            image_client = ImageClient(
                session=geti.session,
                workspace_id=geti.workspace_id,
                project=project,
            )
            uploaded_image = image_client.upload_image(str(image_path))
            logger.info(
                f"Uploaded masked image to Geti: {uploaded_image.id}"
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to upload image: {exc}",
            )

        try:
            annotation_client = AnnotationClient(
                session=geti.session,
                workspace_id=geti.workspace_id,
                project=project,
            )
            full_rect = Rectangle(
                x=0,
                y=0,
                width=uploaded_image.media_information.width,
                height=uploaded_image.media_information.height,
            )
            annotation_scene = AnnotationScene(
                annotations=[
                    Annotation(
                        shape=full_rect,
                        labels=[matched_label],
                    )
                ],
                media_identifier=ImageIdentifier(
                    type="image",
                    image_id=uploaded_image.id,
                ),
            )
            annotation_client.upload_annotation(
                media_item=uploaded_image,
                annotation_scene=annotation_scene,
            )
            logger.info(
                f"Annotation uploaded for image: {uploaded_image.id}"
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to upload annotation: {exc}",
            )

        if not self._sync_manager.credentials_set:
            self._sync_manager.set_credentials(
                host=req.host,
                token=req.token,
                verify_ssl=req.verify_ssl,
            )

        logger.info(
            f"Feedback complete | label={req.label_name} | "
            f"correct={req.is_correct} | "
            f"geti_image_id={uploaded_image.id}"
        )

        return FeedbackResponse(
            status="success",
            action="enhancement" if req.is_correct else "fine-tuning",
            geti_image_id=uploaded_image.id,
            training_triggered=False,
            training_tasks=[],
        )

    # ── Auto-sync ─────────────────────────────────────────────────────────────

    def auto_sync_status(self) -> dict[str, Any]:
        return {
            "enabled": self._sync_manager.enabled,
            "interval_seconds": MODEL_POLL_INTERVAL,
            "credentials_set": self._sync_manager.credentials_set,
        }

    def toggle_auto_sync(
        self,
        req: AutoSyncToggleRequest,
    ) -> dict[str, Any]:
        self._sync_manager.toggle(req.enabled)
        return {
            "enabled": self._sync_manager.enabled,
            "message": (
                f"Auto-sync "
                f"{'enabled' if req.enabled else 'disabled'} "
                f"for both models"
            ),
        }