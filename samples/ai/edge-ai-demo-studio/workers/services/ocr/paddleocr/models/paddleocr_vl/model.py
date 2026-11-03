# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import contextlib
import functools
import inspect
import logging
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from model_downloader import ModelDownloadError, fetch_snapshot
from worker_common import CancelToken, openvino_compile_config, shared_model_lock

from config import MODELS_DIR
from core.device import get_core
from models.base import BaseOCRModel, TextCallback
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
    "PaddleOCR-VL needs torch, transformers, nncf, ... . "
    "Re-run the worker setup (setup.sh / setup.ps1), or run "
    "`uv sync --all-packages` in workers/."
)

# Written last by _convert() and required by _ir_ready() (list_models.py mirrors it). Bump the
# revision when an export fix invalidates older IRs, so they reconvert (rev2: transformers 5 fixes).
_EXPORT_MARKER = "export-rev2.done"


def _ensure_vendor_on_path() -> None:
    """Make the vendored helper modules importable by their absolute names."""
    path = str(_VENDOR_DIR)
    if path not in sys.path:
        sys.path.insert(0, path)


# transformers 5 re-derives rotary ``inv_freq`` via ``compute_default_rope_parameters``, which the
# 4.x-era vendored RotaryEmbedding classes lack. Appended to the remote-code copy only: ``_vendor/``
# stays byte-identical to upstream so the start scripts can re-fetch it.
_ROPE_COMPAT_PATCH = '''

# --- edge-ai-studio: transformers>=5 compatibility, appended by
# --- models/paddleocr_vl/model.py (see _ROPE_COMPAT_PATCH there).
def _compute_default_rope_parameters(self, config, device=None, **kwargs):
    return self.rope_init_fn(config, device, **kwargs)


for _rotary in (RotaryEmbedding, Ernie4_5RotaryEmbedding):
    if not hasattr(_rotary, "compute_default_rope_parameters"):
        _rotary.compute_default_rope_parameters = _compute_default_rope_parameters
'''


def _install_vendor_file(fname: str, dest_dir: Path) -> None:
    """Copy a vendored helper into ``dest_dir``, patched for transformers 5."""
    source = (_VENDOR_DIR / fname).read_text(encoding="utf-8")
    if (
        fname == "modeling_paddleocr_vl.py"
        and "compute_default_rope_parameters" not in source
    ):
        source += _ROPE_COMPAT_PATCH
    (dest_dir / fname).write_text(source, encoding="utf-8")


def _shim_prefill_cache(wrapper: Any) -> None:
    """Restore the "no cache on the first pass" contract the vendored OV wrapper expects.

    The wrapper prefills only when ``past_key_values is None``, but transformers 5 passes a cache
    from the start. So calls while ``past_len is None`` get ``None``, and ``generate`` resets
    ``past_len`` so each request prefills its own prompt. Idempotent.
    """
    if getattr(wrapper, "_eas_prefill_shimmed", False):
        return

    def without_cache_until_prefilled(method: Any) -> Any:
        # `past_key_values` may arrive positionally, so its index is needed as
        # well as its name (`self` is dropped: `args` below excludes it).
        parameters = list(inspect.signature(method).parameters)
        index = parameters.index("past_key_values") - 1

        @functools.wraps(method)
        def wrapped(self: Any, *args: Any, **kwargs: Any) -> Any:
            if getattr(self, "past_len", None) is None:
                if len(args) > index:
                    args = (*args[:index], None, *args[index + 1 :])
                else:
                    kwargs["past_key_values"] = None
            return method(self, *args, **kwargs)

        return wrapped

    for name in ("forward", "prepare_inputs_for_generation"):
        setattr(wrapper, name, without_cache_until_prefilled(getattr(wrapper, name)))

    generate = wrapper.generate

    @functools.wraps(generate)
    def generate_from_a_clean_state(self: Any, *args: Any, **kwargs: Any) -> Any:
        self.past_len = None
        return generate(self, *args, **kwargs)

    wrapper.generate = generate_from_a_clean_state
    wrapper._eas_prefill_shimmed = True


def _shim_rope_default() -> None:
    """Restore the 'default' RoPE init removed in transformers 5, verbatim from 4.x.

    The 5.x replacement uses an instance-based convention, so an alias won't do.
    """
    try:
        from transformers.modeling_rope_utils import ROPE_INIT_FUNCTIONS

        if "default" in ROPE_INIT_FUNCTIONS:
            return

        def _compute_default_rope_parameters(
            config, device=None, seq_len=None, **_kwargs
        ):
            import torch

            base = getattr(config, "rope_theta", 10000.0)
            partial_rotary_factor = getattr(config, "partial_rotary_factor", 1.0)
            head_dim = getattr(config, "head_dim", None) or (
                config.hidden_size // config.num_attention_heads
            )
            dim = int(head_dim * partial_rotary_factor)
            inv_freq = 1.0 / (
                base
                ** (
                    torch.arange(0, dim, 2, dtype=torch.int64)
                    .to(device=device, dtype=torch.float)
                    / dim
                )
            )
            return inv_freq, 1.0

        ROPE_INIT_FUNCTIONS["default"] = _compute_default_rope_parameters
    except Exception:  # pragma: no cover - transformers layout changed again
        pass

    # transformers 5.x also removed the legacy tuple-cache conversion API the
    # 4.x-era modeling code round-trips through; reinstate it.
    try:
        from transformers.cache_utils import DynamicCache

        if not hasattr(DynamicCache, "to_legacy_cache"):

            def _to_legacy_cache(self):
                return tuple(
                    (layer.keys, layer.values) for layer in self.layers
                )

            DynamicCache.to_legacy_cache = _to_legacy_cache

        if not hasattr(DynamicCache, "from_legacy_cache"):

            @classmethod
            def _from_legacy_cache(cls, past_key_values):
                cache = cls()
                if past_key_values is not None:
                    for idx, (keys, values) in enumerate(past_key_values):
                        cache.update(keys, values, idx)
                return cache

            DynamicCache.from_legacy_cache = _from_legacy_cache
    except Exception:  # pragma: no cover - transformers layout changed again
        pass


@functools.cache
def _callback_streamer_class():
    """A ``TextStreamer`` that hands text to a callback and raises ``JobCancelled`` once cancelled.

    Passed through the vendored ``chat()``'s ``generation_config``, so no vendored patch is needed.
    Raising (not a stopping criterion) keeps a cancelled pass from looking finished. Built on first
    use: transformers is only importable with the VL extras.
    """
    from transformers import TextStreamer

    class CallbackStreamer(TextStreamer):
        def __init__(
            self,
            tokenizer: Any,
            on_text: TextCallback | None,
            cancel: CancelToken | None,
        ) -> None:
            # With `inputs_embeds` generate() first puts an empty prompt;
            # skip it, and drop special tokens as the final batch_decode does.
            super().__init__(tokenizer, skip_prompt=True, skip_special_tokens=True)
            self._on_text = on_text
            self._cancel = cancel

        def put(self, value: Any) -> None:
            if self._cancel is not None:
                self._cancel.check()
            super().put(value)

        def on_finalized_text(self, text: str, stream_end: bool = False) -> None:
            if text and self._on_text is not None:
                self._on_text(text)

    return CallbackStreamer


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
            self.is_initialized = True
        else:
            self.keys = torch.cat([self.keys, key_states], dim=-2)
            self.values = torch.cat([self.values, value_states], dim=-2)
        return self.keys, self.values

    DynamicLayer.update = _traceable_update
    try:
        yield
    finally:
        DynamicLayer.update = original_update


def _rederive_vision_buffers(model: Any) -> None:
    """Recompute vision-tower buffers that transformers 5 leaves uninitialised.

    Loading from the meta device leaves ``inv_freq`` and ``position_ids`` as garbage, which the
    export bakes into ``vision.xml`` (fluent text that isn't in the image).
    """
    import torch

    vision = model.visual.vision_model
    vision.encoder.rotary_pos_emb.rope_init()
    embeddings = vision.embeddings
    embeddings.position_ids = torch.arange(embeddings.num_positions).expand((1, -1))


class PaddleOCRVLModel(BaseOCRModel):
    """PaddleOCR-VL family wrapped as a uniform OCR model."""

    # Generation takes tens of seconds on a CPU; report the text as it comes.
    streams_text = True

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
        lang: str | None = None,
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
        # Accepted for parity with the PP-OCR presets and ignored: there is no dictionary to swap.
        self.lang = lang
        # One cache dir per model id (slashes flattened).
        self._cache_dir = MODELS_DIR / "paddleocr_vl" / model_id.replace("/", "__")
        self._model = None  # OVPaddleOCRVLForCausalLM instance

    # Loading / conversion

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

        _shim_rope_default()

        # transformers 5.x GenerationMixin calls these on every model during
        # generate(); the OV wrapper predates them. No-ops are correct — the
        # wrapper has no MoE experts to re-dispatch.
        wrapper = vl.OVPaddleOCRVLForCausalLM
        if not hasattr(wrapper, "get_experts_implementation"):
            wrapper.get_experts_implementation = lambda self: {"": None}
        if not hasattr(wrapper, "set_experts_implementation"):
            wrapper.set_experts_implementation = (
                lambda self, experts_implementation: None
            )
        _shim_prefill_cache(wrapper)

        if not self._ir_ready():
            # _convert() writes straight into _cache_dir, so serialise across processes and
            # re-check: another instance may have finished meanwhile.
            with shared_model_lock(self._cache_dir):
                if not self._ir_ready():
                    self._convert(vl)

        core = get_core()
        # The wrapper compiles with its own properties, so ours go on the Core: AUTO's stateful LLM
        # needs its CPU fallbacks off, a pinned CPU its thread count (openvino_compile_config).
        # set_property rejects DEVICE_PROPERTIES, so those go on each device.
        config = openvino_compile_config(self.device)
        for name, properties in config.pop("DEVICE_PROPERTIES", {}).items():
            core.set_property(name, properties)
        if config:
            core.set_property(self.device, config)
        self._model = vl.OVPaddleOCRVLForCausalLM(
            core=core,
            ov_model_path=str(self._cache_dir),
            device=self.device,
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
            _EXPORT_MARKER,
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
            _install_vendor_file(fname, snapshot)

        self._cache_dir.mkdir(parents=True, exist_ok=True)
        converter = vl.PaddleOCR_VL_OV(
            pretrained_model_path=str(snapshot),
            ov_model_path=str(self._cache_dir),
            device=self.device,
            llm_int4_compress=self.llm_int4,
            llm_int8_compress=self.llm_int8,
            vision_int8_quant=self.vision_int8,
        )
        # transformers 5 loads bf16, but the export traces with float32 inputs: upcast (exact) so
        # the IR matches the notebook's.
        converter.model.float()
        _rederive_vision_buffers(converter.model)
        with _ov_traceable_dynamic_cache():
            converter.export_paddleocr_vl_to_ov()
        converter.close()

        # The runtime loader resolves remote code from the cache dir, so the
        # modeling/image-processing files must live there too.
        for fname in (
            "modeling_paddleocr_vl.py",
            "image_processing_paddleocr_vl.py",
        ):
            _install_vendor_file(fname, self._cache_dir)
        (self._cache_dir / _EXPORT_MARKER).touch()
        logger.info(f"[{self.name}] Conversion complete -> {self._cache_dir}")

    def _download_snapshot(self) -> Path:
        """Fetch the source model, trying HuggingFace then ModelScope."""
        local_dir = MODELS_DIR / "paddleocr_vl" / "_source" / self.model_id.replace("/", "__")
        try:
            return fetch_snapshot(self.model_id, local_dir, source="huggingface")
        except ModelDownloadError as hf_exc:
            logger.warning(f"[{self.name}] HF download failed: {hf_exc}")
            try:
                return fetch_snapshot(self.model_id, local_dir, source="modelscope")
            except ModelDownloadError as ms_exc:
                raise RuntimeError(
                    f"Could not download '{self.model_id}' from HuggingFace "
                    f"({hf_exc}) or ModelScope ({ms_exc})."
                )

    # Inference

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
        on_text = kwargs.get("on_text")
        cancel = kwargs.get("cancel")
        if on_text is not None or cancel is not None:
            generation_config["streamer"] = _callback_streamer_class()(
                self._model.tokenizer, on_text, cancel
            )
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
                # Not a selectable dimension here — see __init__.
                "language": "auto",
            },
        )

    def _teardown(self) -> None:
        if self._model is not None:
            try:
                self._model.close()
            except Exception:
                pass
        self._model = None
