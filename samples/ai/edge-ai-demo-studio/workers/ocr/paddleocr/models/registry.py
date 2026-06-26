# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Model registry + factory.

Each entry is a self-contained preset: which family of model to build and the
constructor options (model URLs, character dictionary, VL repo id, ...). The
concrete model classes are imported lazily inside :func:`create_model` so that
importing the registry never drags in the heavy VL dependencies (torch,
transformers, nncf).

A user selects a model with ``POST /models/load {"model": "<key>"}`` and may
override any of the options in the same request.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from models.base import BaseOCRModel

# ── Asset URLs ─────────────────────────────────────────────────────────────

# PP-OCRv5 ONNX exports (read natively by OpenVINO — no Paddle runtime needed).
_V5 = "https://huggingface.co/bukuroo/PPOCRv5-ONNX/resolve/main"
_V5_DICT = f"{_V5}/ppocrv5_dict.txt"

# PP-OCRv3 Paddle inference models hosted by OpenVINO (the classic
# paddle-ocr-webcam notebook models, .pdmodel format).
_V3 = "https://storage.openvinotoolkit.org/repositories/openvino_notebooks/models/paddle-ocr"
_V3_DICT = "https://raw.githubusercontent.com/WenmuZhou/PytorchOCR/master/torchocr/datasets/alphabets/ppocr_keys_v1.txt"


@dataclass(frozen=True)
class ModelSpec:
    key: str
    family: str  # "ppocr" | "vl"
    description: str
    options: dict[str, Any] = field(default_factory=dict)
    requires_extra: str | None = None  # pip extra needed, e.g. "vl"


REGISTRY: dict[str, ModelSpec] = {
    # ── PP-OCR detection + recognition pipelines ────────────────────────────
    "ppocrv5": ModelSpec(
        key="ppocrv5",
        family="ppocr",
        description="PP-OCRv5 mobile (ONNX) — fast detect+recognise pipeline.",
        options={
            "det_url": f"{_V5}/ppocrv5-mobile-det.onnx",
            "rec_url": f"{_V5}/ppocrv5-mobile-rec.onnx",
            "dict_url": _V5_DICT,
            "rec_image_height": 48,
            "det_limit_side_len": 960,
        },
    ),
    "ppocrv5-server": ModelSpec(
        key="ppocrv5-server",
        family="ppocr",
        description="PP-OCRv5 server (ONNX) — higher accuracy, heavier.",
        options={
            "det_url": f"{_V5}/ppocrv5-server-det.onnx",
            "rec_url": f"{_V5}/ppocrv5-server-rec.onnx",
            "dict_url": _V5_DICT,
            "rec_image_height": 48,
            "det_limit_side_len": 960,
        },
    ),
    "ppocrv3": ModelSpec(
        key="ppocrv3",
        family="ppocr",
        description="PP-OCRv3 (Paddle .pdmodel) — classic OpenVINO notebook model.",
        options={
            "det_url": f"{_V3}/ch_PP-OCRv3_det_infer.tar",
            "rec_url": f"{_V3}/ch_PP-OCRv3_rec_infer.tar",
            "dict_url": _V3_DICT,
            "rec_image_height": 48,
            "det_limit_side_len": 960,
        },
    ),
    # ── PaddleOCR-VL vision-language models ──────────────────────────────────
    "paddleocr-vl-1.5": ModelSpec(
        key="paddleocr-vl-1.5",
        family="vl",
        description="PaddleOCR-VL-1.5 (0.9B VLM) on OpenVINO — layout-aware OCR.",
        options={"model_id": "PaddlePaddle/PaddleOCR-VL-1.5"},
        requires_extra="vl",
    ),
    "paddleocr-vl": ModelSpec(
        key="paddleocr-vl",
        family="vl",
        description="PaddleOCR-VL (VLM) on OpenVINO — layout-aware OCR.",
        options={"model_id": "PaddlePaddle/PaddleOCR-VL"},
        requires_extra="vl",
    ),
}

DEFAULT_KEY = "ppocrv5"


def list_specs() -> list[dict[str, Any]]:
    """Serialisable summary of every registered model preset."""
    return [
        {
            "key": s.key,
            "family": s.family,
            "description": s.description,
            "requires_extra": s.requires_extra,
            "options": s.options,
        }
        for s in REGISTRY.values()
    ]


def create_model(
    key: str,
    device: str | None = None,
    overrides: dict[str, Any] | None = None,
) -> BaseOCRModel:
    """Instantiate (but do not load) the model for ``key``.

    ``overrides`` are merged over the preset options, so a caller can e.g.
    point a PP-OCR preset at custom model URLs or switch the VL repo id.
    """
    if key not in REGISTRY:
        raise KeyError(
            f"Unknown model '{key}'. Available: {sorted(REGISTRY)}"
        )
    spec = REGISTRY[key]
    opts = {**spec.options, **(overrides or {})}

    if spec.family == "ppocr":
        from models.ppocr.model import PPOCRModel

        return PPOCRModel(
            key=spec.key, description=spec.description, device=device, **opts
        )
    if spec.family == "vl":
        from models.paddleocr_vl.model import PaddleOCRVLModel

        return PaddleOCRVLModel(
            key=spec.key, description=spec.description, device=device, **opts
        )
    raise KeyError(f"Unknown model family '{spec.family}'")
