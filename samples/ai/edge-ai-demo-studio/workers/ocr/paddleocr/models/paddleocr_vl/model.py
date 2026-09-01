# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import contextlib
import logging
import shutil
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from config import MODELS_DIR
from core.device import get_core
from models.base import BaseOCRModel
from models.result import OCRResult

logger = logging.getLogger(__name__)

_VENDOR_DIR = Path(__file__).resolve().parent / "_vendor"

# Task -> prompt string (matches the upstream notebook / gradio helper).
PROMPTS = {
    "ocr": "OCR:",
    "table": "Table Recognition:",
    "formula": "Formula Recognition:",
    "chart": "Chart Recognition:",
}

_INSTALL_HINT = (
    "PaddleOCR-VL needs torch, transformers, nncf, datasets, ... . "
    "Re-run the worker setup (setup.sh / setup.ps1), or run "
    "`uv sync` in workers/ocr/paddleocr."
)


def _ensure_vendor_on_path() -> None:
    """Make the vendored helper modules importable by their absolute names."""
    path = str(_VENDOR_DIR)
    if path not in sys.path:
        sys.path.insert(0, path)


@contextlib.contextmanager
def _ov_traceable_dynamic_cache():
    try:
        import torch
        from transformers.cache_utils import DynamicLayer
    except Exception:  # pragma: no cover - unexpected transformers layout
        yield
        return

    original_update = DynamicLayer.update

    def _traceable_update(self, key_states, value_states, cache_kwargs=None):
        if self.keys is None or self.keys.numel() == 0:
            self.keys = key_states
            self.values = value_states
        else:
            self.keys = torch.cat([self.keys, key_states], dim=-2)
            self.values = torch.cat([self.values, value_states], dim=-2)
        return self.keys, self.values

    DynamicLayer.update = _traceable_update
    try:
        yield
    finally:
        DynamicLayer.update = original_update


class PaddleOCRVLModel(BaseOCRModel):
    """PaddleOCR-VL family wrapped as a uniform OCR model."""

    def __init__(
        self,
        key: str,
        description: str,
        model_id: str,
        device: str | None = None,
        llm_int8: bool = True,
        llm_int4: bool = False,
        vision_int8: bool = False,
        max_new_tokens: int = 512,
        **extra: Any,
    ) -> None:
        super().__init__(device=device, **extra)
        self.name = key
        self.description = description
        self.model_id = model_id
        self.llm_int8 = bool(llm_int8) and not llm_int4
        self.llm_int4 = bool(llm_int4)
        self.vision_int8 = bool(vision_int8)
        self.max_new_tokens = int(max_new_tokens)
        # One cache dir per model id (slashes flattened).
        self._cache_dir = MODELS_DIR / "paddleocr_vl" / model_id.replace("/", "__")
        self._model = None  # OVPaddleOCRVLForCausalLM instance

    # ── Loading / conversion ───────────────────────────────────────────────

    def load(self) -> None:
        if self.device.split(".")[0].upper() == "NPU":
            raise RuntimeError(
                f"{self.name} does not support NPU. Load it on CPU or GPU, or "
                f"pick a PP-OCR preset (ppocrv5 / ppocrv5-server / ppocrv3) to "
                f"run OCR on the NPU."
            )
        _ensure_vendor_on_path()
        try:
            import ov_paddleocr_vl as vl  # noqa: WPS433 (vendored module)
        except ImportError as exc:  # missing torch/transformers/nncf/...
            raise RuntimeError(f"{_INSTALL_HINT}\n(import error: {exc})")

        if not self._ir_ready():
            self._convert(vl)

        core = get_core()
        self._model = vl.OVPaddleOCRVLForCausalLM(
            core=core,
            ov_model_path=str(self._cache_dir),
            device=self.device if self.device != "AUTO" else "CPU",
            llm_int4_compress=self.llm_int4,
            llm_int8_compress=self.llm_int8,
            vision_int8_quant=self.vision_int8,
            llm_int8_quant=self.llm_int8,
        )
        logger.info(f"[{self.name}] VL model ready from {self._cache_dir}")

    def _llm_xml(self) -> str:
        if self.llm_int4:
            return "llm_stateful_int4.xml"
        if self.llm_int8:
            return "llm_stateful_int8.xml"
        return "llm_stateful.xml"

    def _ir_ready(self) -> bool:
        required = [
            "vision_int8.xml" if self.vision_int8 else "vision.xml",
            "llm_embd.xml",
            self._llm_xml(),
            "config.json",
        ]
        return all((self._cache_dir / f).exists() for f in required)

    def _convert(self, vl) -> None:
        """One-time: download the source model and export OpenVINO IR."""
        logger.info(
            f"[{self.name}] Converting {self.model_id} to OpenVINO IR "
            f"(one-time, this is slow)..."
        )
        snapshot = self._download_snapshot()
        # Match the notebook: overwrite the repo's remote code with the
        # vendored (patched) versions so conversion behaviour is identical.
        for fname in (
            "modeling_paddleocr_vl.py",
            "image_processing_paddleocr_vl.py",
        ):
            shutil.copy(_VENDOR_DIR / fname, snapshot / fname)

        self._cache_dir.mkdir(parents=True, exist_ok=True)
        converter = vl.PaddleOCR_VL_OV(
            pretrained_model_path=str(snapshot),
            ov_model_path=str(self._cache_dir),
            device=self.device if self.device != "AUTO" else "CPU",
            llm_int4_compress=self.llm_int4,
            llm_int8_compress=self.llm_int8,
            vision_int8_quant=self.vision_int8,
        )
        with _ov_traceable_dynamic_cache():
            converter.export_paddleocr_vl_to_ov()
        converter.close()

        # The runtime loader resolves remote code from the cache dir, so the
        # modeling/image-processing files must live there too.
        for fname in (
            "modeling_paddleocr_vl.py",
            "image_processing_paddleocr_vl.py",
        ):
            shutil.copy(_VENDOR_DIR / fname, self._cache_dir / fname)
        logger.info(f"[{self.name}] Conversion complete -> {self._cache_dir}")

    def _download_snapshot(self) -> Path:
        """Fetch the source model, trying HuggingFace then ModelScope."""
        try:
            from huggingface_hub import snapshot_download

            return Path(snapshot_download(self.model_id))
        except Exception as hf_exc:
            logger.warning(f"[{self.name}] HF download failed: {hf_exc}")
            try:
                from modelscope import snapshot_download as ms_download

                return Path(ms_download(self.model_id))
            except Exception as ms_exc:
                raise RuntimeError(
                    f"Could not download '{self.model_id}' from HuggingFace "
                    f"({hf_exc}) or ModelScope ({ms_exc})."
                )

    # ── Inference ──────────────────────────────────────────────────────────

    def warmup(self) -> None:
        # Skip: a real generate pass is expensive and loading already compiles
        # every sub-model. The first request pays the (small) first-token cost.
        logger.info(f"[{self.name}] Warmup skipped for VL model")

    def _infer(self, image: np.ndarray, **kwargs: Any) -> OCRResult:
        from PIL import Image

        task = str(kwargs.get("task", "ocr")).lower()
        if task not in PROMPTS:
            raise ValueError(
                f"Unknown VL task '{task}'. Choose from {sorted(PROMPTS)}."
            )
        max_new_tokens = int(kwargs.get("max_new_tokens", self.max_new_tokens))

        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(rgb)
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": pil_image},
                    {"type": "text", "text": PROMPTS[task]},
                ],
            }
        ]
        generation_config = {
            "bos_token_id": self._model.tokenizer.bos_token_id,
            "eos_token_id": self._model.tokenizer.eos_token_id,
            "pad_token_id": self._model.tokenizer.pad_token_id,
            "max_new_tokens": max_new_tokens,
            "do_sample": False,
        }
        response, _ = self._model.chat(
            messages=messages, generation_config=generation_config
        )

        return OCRResult(
            model=self.name,
            regions=[],  # VL returns structured text, not per-box geometry
            full_text=response,
            extra={
                "task": task,
                "model_id": self.model_id,
                "device": self.device,
            },
        )

    def _teardown(self) -> None:
        if self._model is not None:
            try:
                self._model.close()
            except Exception:
                pass
        self._model = None
