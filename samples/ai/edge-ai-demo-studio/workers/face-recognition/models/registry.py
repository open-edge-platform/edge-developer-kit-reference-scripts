# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Pipeline registry + factory.

Each entry is a self-contained preset (model URLs, thresholds, backend). A
pipeline bundles a detector and a recogniser; exactly one pipeline is active
in the worker at a time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from models.base import BaseFacePipeline

# OpenCV Zoo hosts models via Git LFS; media.githubusercontent serves the blobs.
_ZOO = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models"
# Intel pre-trained IR models from the Open Model Zoo (Apache-2.0).
_OMZ = "https://storage.openvinotoolkit.org/repositories/open_model_zoo/2023.0/models_bin/1"


def _ir(name: str, precision: str = "FP16") -> str:
    return f"{_OMZ}/{name}/{precision}/{name}.xml"


# Shared by every Open Model Zoo preset — only the detector differs.
_OMZ_COMMON: dict[str, Any] = {
    "landmarks_url": _ir("landmarks-regression-retail-0009"),
    "reid_url": _ir("face-reidentification-retail-0095"),
    # Demo defaults: -t_fd 0.6, -exp_r_fd 1.15, -t_id 0.3 expressed as cosine
    # similarity (the demo's distance is 0.5 * (1 - similarity)).
    "det_threshold": 0.6,
    "roi_scale_factor": 1.15,
    "match_threshold": 0.4,
}


@dataclass(frozen=True)
class ModelSpec:
    key: str
    family: str  # "opencv-zoo" | "open-model-zoo"
    label: str
    description: str
    options: dict[str, Any] = field(default_factory=dict)


REGISTRY: dict[str, ModelSpec] = {
    "omz-retail": ModelSpec(
        key="omz-retail",
        family="open-model-zoo",
        label="OMZ face-detection-retail-0004",
        description=(
            "Open Model Zoo face_recognition_demo pipeline: "
            "face-detection-retail-0004 (300x300 SSD) + "
            "landmarks-regression-retail-0009 + "
            "face-reidentification-retail-0095 256-d — small and fast."
        ),
        options={
            **_OMZ_COMMON,
            "det_url": _ir("face-detection-retail-0004"),
        },
    ),
    "omz-adas": ModelSpec(
        key="omz-adas",
        family="open-model-zoo",
        label="OMZ face-detection-adas-0001",
        description=(
            "Open Model Zoo face_recognition_demo pipeline: "
            "face-detection-adas-0001 (672x384 SSD, wider field of view) + "
            "landmarks-regression-retail-0009 + "
            "face-reidentification-retail-0095 256-d."
        ),
        options={
            **_OMZ_COMMON,
            "det_url": _ir("face-detection-adas-0001"),
        },
    ),
    "yunet-sface": ModelSpec(
        key="yunet-sface",
        family="opencv-zoo",
        label="YuNet + SFace",
        description=(
            "OpenCV Zoo YuNet detector + SFace 128-d recogniser on OpenVINO "
            "— tiny and fast, cosine threshold 0.363."
        ),
        options={
            "det_url": f"{_ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
            "rec_url": f"{_ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
            "det_size": 640,
            "score_threshold": 0.7,
            "nms_threshold": 0.3,
            "match_threshold": 0.363,
        },
    ),
}

DEFAULT_KEY = "omz-retail"


def list_specs() -> list[dict[str, Any]]:
    """Serialisable summary of every registered preset."""
    return [
        {
            "key": s.key,
            "family": s.family,
            "label": s.label,
            "description": s.description,
        }
        for s in REGISTRY.values()
    ]


def create_pipeline(
    key: str,
    device: str | None = None,
    overrides: dict[str, Any] | None = None,
) -> BaseFacePipeline:
    """Instantiate (but do not load) the pipeline for ``key``."""
    if key not in REGISTRY:
        raise KeyError(f"Unknown model '{key}'. Available: {sorted(REGISTRY)}")
    spec = REGISTRY[key]
    opts = {**spec.options, **(overrides or {})}

    if spec.family == "opencv-zoo":
        from models.yunet_sface.model import YuNetSFacePipeline

        pipeline: BaseFacePipeline = YuNetSFacePipeline(device=device, **opts)
    elif spec.family == "open-model-zoo":
        from models.omz.model import OMZFacePipeline

        pipeline = OMZFacePipeline(device=device, **opts)
    else:
        raise KeyError(f"Unknown model family '{spec.family}'")
    pipeline.key = spec.key
    pipeline.description = spec.description
    return pipeline
