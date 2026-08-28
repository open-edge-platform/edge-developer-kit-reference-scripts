# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Orchestrator that ties the active pipeline, devices and the gallery together.

``main.py`` holds only FastAPI routing; every route delegates to one method
here. This class owns the single *active* pipeline and serialises model swaps
so a load in flight never races an inference.

The gallery keeps the original reference-image bytes, so when a different
pipeline is loaded later the references are re-embedded for it automatically
(embeddings are cached per pipeline key).
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
from fastapi import HTTPException

from config import DEFAULT_DEVICE
from core import device as device_mod
from core.image_io import ImageDecodeError, decode_image, encode_jpeg_base64
from models import registry
from models.base import BaseFacePipeline, Face

logger = logging.getLogger(__name__)


@dataclass
class GalleryImage:
    """One enrolled reference image and its per-pipeline embeddings."""

    data: bytes
    thumbnail: str  # base64 JPEG of the detected face crop
    embeddings: dict[str, np.ndarray] = field(default_factory=dict)


@dataclass
class Person:
    id: str
    name: str
    images: list[GalleryImage] = field(default_factory=list)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "num_images": len(self.images),
            "thumbnails": [img.thumbnail for img in self.images],
        }


class FaceRecognitionWorker:
    def __init__(self) -> None:
        self._device = DEFAULT_DEVICE
        self._model_key: str | None = None
        self._pipeline: BaseFacePipeline | None = None
        self._swap_lock = threading.Lock()
        self._gallery: dict[str, Person] = {}
        self._gallery_lock = threading.Lock()

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def startup(
        self,
        default_model: str,
        device: str | None = None,
        autoload: bool = True,
    ) -> None:
        self._device = device_mod.normalize_device(device or DEFAULT_DEVICE)
        logger.info("=" * 60)
        for d in device_mod.get_available_devices():
            logger.info(f"  {d['name']:8s} | {d['full_name']}")
        logger.info(f"  default device requested: {self._device}")
        logger.info("=" * 60)

        if autoload:
            try:
                self.load_model(default_model, self._device)
            except Exception as exc:
                # Fail hard: a startup model that can't load means the worker
                # cannot serve. Re-raise so the process exits non-zero instead
                # of running half-broken.
                logger.error(f"Autoload of '{default_model}' failed: {exc}")
                raise

    def shutdown(self) -> None:
        if self._pipeline is not None:
            self._pipeline.release()
        logger.info("Face-recognition worker shut down")

    # ── Model management ───────────────────────────────────────────────────

    def load_model(
        self,
        key: str,
        device: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            target_device = device_mod.normalize_device(device or self._device)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        try:
            new_pipeline = registry.create_pipeline(key, target_device, options)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc))

        # Load outside the swap lock is not needed here (downloads are guarded
        # per-file), but serialise concurrent loads so two requests don't both
        # build a pipeline.
        with self._swap_lock:
            try:
                new_pipeline.ensure_loaded()
            except Exception as exc:
                logger.error(f"Failed to load '{key}': {exc}", exc_info=True)
                raise HTTPException(
                    status_code=500, detail=f"Failed to load '{key}': {exc}"
                )
            old = self._pipeline
            self._pipeline = new_pipeline
            self._model_key = key
            self._device = target_device
        if old is not None and old is not new_pipeline:
            old.release()

        self._reembed_gallery()
        logger.info(f"Active model -> {key} on {target_device}")
        return self.get_active()

    def list_models(self) -> dict[str, Any]:
        return {
            "active": self._model_key,
            "device": self._device,
            "available": registry.list_specs(),
        }

    def get_active(self) -> dict[str, Any]:
        if self._pipeline is None:
            return {"active": None, "loaded": False}
        info = self._pipeline.info()
        info["active"] = self._model_key
        return info

    def _require_pipeline(self) -> BaseFacePipeline:
        if self._pipeline is None or not self._pipeline.loaded:
            raise HTTPException(
                status_code=503,
                detail="No model loaded. Call POST /models/load first.",
            )
        return self._pipeline

    # ── Health ─────────────────────────────────────────────────────────────

    def healthcheck(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "active_model": self._model_key,
            "model_loaded": self._pipeline is not None and self._pipeline.loaded,
            "device": self._device,
            "gallery_size": len(self._gallery),
        }

    # ── Gallery ────────────────────────────────────────────────────────────

    def list_gallery(self) -> dict[str, Any]:
        with self._gallery_lock:
            return {"persons": [p.public() for p in self._gallery.values()]}

    def enroll(self, name: str, files: list[tuple[str, bytes]]) -> dict[str, Any]:
        pipeline = self._require_pipeline()
        name = name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Person name is required")
        if not files:
            raise HTTPException(
                status_code=400, detail="At least one reference image is required"
            )

        accepted: list[GalleryImage] = []
        file_results: list[dict[str, Any]] = []
        for filename, data in files:
            status: dict[str, Any] = {"file": filename}
            try:
                image = decode_image(data)
            except ImageDecodeError as exc:
                status["error"] = str(exc)
                file_results.append(status)
                continue

            face = pipeline.embed_largest_face(image)
            if face is None or face.embedding is None:
                status["error"] = "No face detected in this image"
                file_results.append(status)
                continue

            accepted.append(
                GalleryImage(
                    data=data,
                    thumbnail=self._face_thumbnail(image, face),
                    embeddings={pipeline.key: face.embedding},
                )
            )
            file_results.append(status)

        if not accepted:
            raise HTTPException(
                status_code=400,
                detail="No face was detected in any of the provided images",
            )

        with self._gallery_lock:
            person = next(
                (
                    p
                    for p in self._gallery.values()
                    if p.name.lower() == name.lower()
                ),
                None,
            )
            if person is None:
                person = Person(id=uuid.uuid4().hex[:8], name=name)
                self._gallery[person.id] = person
            person.images.extend(accepted)
            return {"person": person.public(), "files": file_results}

    def delete_person(self, person_id: str) -> dict[str, Any]:
        with self._gallery_lock:
            if person_id not in self._gallery:
                raise HTTPException(status_code=404, detail="Unknown person id")
            del self._gallery[person_id]
        return self.list_gallery()

    def clear_gallery(self) -> dict[str, Any]:
        with self._gallery_lock:
            self._gallery.clear()
        return self.list_gallery()

    def _reembed_gallery(self) -> None:
        """Compute missing embeddings for the active pipeline after a swap."""
        pipeline = self._pipeline
        if pipeline is None:
            return
        with self._gallery_lock:
            for person in self._gallery.values():
                for img in person.images:
                    if pipeline.key in img.embeddings:
                        continue
                    try:
                        image = decode_image(img.data)
                    except ImageDecodeError:
                        continue
                    face = pipeline.embed_largest_face(image)
                    if face is not None and face.embedding is not None:
                        img.embeddings[pipeline.key] = face.embedding

    @staticmethod
    def _face_thumbnail(image: np.ndarray, face: Face, size: int = 96) -> str:
        """Square crop around the detected box, encoded as a base64 JPEG."""
        h, w = image.shape[:2]
        x, y, bw, bh = face.box
        cx, cy = x + bw / 2, y + bh / 2
        half = max(bw, bh) * 0.65
        x1 = int(max(0, cx - half))
        y1 = int(max(0, cy - half))
        x2 = int(min(w, cx + half))
        y2 = int(min(h, cy + half))
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            crop = image
        crop = cv2.resize(crop, (size, size))
        return encode_jpeg_base64(crop)

    # ── Recognition ────────────────────────────────────────────────────────

    def recognize(self, data: bytes) -> dict[str, Any]:
        pipeline = self._require_pipeline()
        try:
            image = decode_image(data)
        except ImageDecodeError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        t0 = time.time()
        try:
            timings = pipeline.detect(image)
        except Exception as exc:
            logger.error(f"Inference error: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Inference error: {exc}")

        faces = []
        for face in timings.faces:
            entry = face.to_dict()
            entry.update(self._match(pipeline.key, face, pipeline.match_threshold))
            faces.append(entry)

        spec = registry.REGISTRY.get(pipeline.key)
        h, w = image.shape[:2]
        return {
            "elapsed_ms": round((time.time() - t0) * 1000, 2),
            "image": {"width": w, "height": h},
            "gallery_size": len(self._gallery),
            "model": pipeline.key,
            "label": spec.label if spec else pipeline.key,
            "runtime": pipeline.runtime,
            "threshold": pipeline.match_threshold,
            "detect_ms": round(timings.detect_ms, 2),
            "embed_ms": round(timings.embed_ms, 2),
            "num_faces": len(faces),
            "faces": faces,
        }

    def _match(
        self, pipeline_key: str, face: Face, threshold: float
    ) -> dict[str, Any]:
        """Cosine-match one embedding against every enrolled person."""
        if face.embedding is None:
            return {"match": None, "matched": False, "similarities": []}
        with self._gallery_lock:
            sims = []
            for person in self._gallery.values():
                person_sims = [
                    float(np.dot(face.embedding, img.embeddings[pipeline_key]))
                    for img in person.images
                    if pipeline_key in img.embeddings
                ]
                if person_sims:
                    sims.append(
                        {
                            "person_id": person.id,
                            "name": person.name,
                            "similarity": round(max(person_sims), 4),
                        }
                    )
        sims.sort(key=lambda s: -s["similarity"])
        best = sims[0] if sims else None
        matched = best is not None and best["similarity"] >= threshold
        return {"match": best, "matched": matched, "similarities": sims}
