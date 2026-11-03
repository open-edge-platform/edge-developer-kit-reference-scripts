# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Embeddings worker: the OEP ``multimodal-embedding-serving`` app (fetched into thirdparty/ by
oep-setup.sh) plus the worker contract and an OpenAI-compatible ``POST /v1/embeddings``.

Upstream's ``POST /embeddings`` writes video inputs to ``<tmp>/videoQnA`` (uuid4 names), shared by
all instances; the path is fixed at import, baked into default arguments, so it isn't redirected.
"""

from __future__ import annotations

import argparse
import base64
import importlib
import os
import sys
import types
from pathlib import Path
from typing import Any

from worker_common import (
    add_instance_args,
    server_timing,
    timed,
    get_logger,
    install_models_routes,
    install_openai_errors,
    models_dir,
    serve,
    use_shared_hf_cache,
)
from worker_common.oep import (
    UpstreamState,
    enter_upstream_dir,
    failed_app,
    install_healthcheck,
    pinned_tag,
    upstream_app_dir,
    utf8_console,
    wrap_lifespan,
)

SERVICE_ID = "embeddings"
UPSTREAM_NAME = "multimodal-embedding-serving"
CATALOG_WORKER = "services/embeddings"
DEFAULT_PORT = 8007
DEFAULT_MODEL = "CLIP/clip-vit-b-16"
# Qwen export weight formats; fp16 keeps the checkpoint's 16-bit weights. No int4: upstream asks
# for it with load_in_4bit, which optimum-intel ignores.
PRECISIONS = ["fp16", "int8"]
DEFAULT_PRECISION = "int8"
# OpenVINO performance hints upstream passes through OV_PERFORMANCE_MODE.
PERFORMANCE_MODES = ["LATENCY", "THROUGHPUT"]

# Bare names work too (upstream's get_model_config searches every family); these are other
# likely spellings.
MODEL_ALIASES = {
    "clip": DEFAULT_MODEL,
    "siglip": "SigLIP/siglip2-vit-b-16",
    "siglip2": "SigLIP/siglip2-vit-b-16",
    "qwen3-embedding": "QwenText/qwen3-embedding-0.6b",
    "qwen/qwen3-embedding-0.6b": "QwenText/qwen3-embedding-0.6b",
    "qwen/qwen3-embedding-4b": "QwenText/qwen3-embedding-4b",
    "qwen/qwen3-embedding-8b": "QwenText/qwen3-embedding-8b",
}

WORKER_DIR = Path(__file__).resolve().parent
UPSTREAM_TAG = pinned_tag(CATALOG_WORKER)
APP_DIR = upstream_app_dir(WORKER_DIR, CATALOG_WORKER)
MODELS_DIR = Path(os.environ.get("EMBEDDINGS_MODELS_DIR") or models_dir("embeddings"))

utf8_console()
# Before upstream's import-time logging.basicConfig(level=DEBUG), which is then a no-op, so the
# worker log stays at INFO.
logger = get_logger(SERVICE_ID)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=f"{SERVICE_ID} worker (OEP {UPSTREAM_NAME})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help="Upstream model id, e.g. CLIP/clip-vit-b-16, SigLIP/siglip2-vit-b-16, "
        "QwenText/qwen3-embedding-0.6b (GET /models lists them)",
    )
    parser.add_argument(
        "--device",
        default="AUTO",
        help="AUTO (OpenVINO selects: a discrete GPU, then an integrated GPU, then the CPU) | CPU | GPU | NPU",
    )
    parser.add_argument(
        "--precision",
        default=DEFAULT_PRECISION,
        choices=PRECISIONS,
        help=f"Weight format of a Qwen text model's export (default: {DEFAULT_PRECISION})",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="Inputs per inference (INFER_BATCH_SIZE; default: 64 on GPU, else 16). "
        "The NPU's graphs keep their static batch of 16",
    )
    parser.add_argument(
        "--performance-mode",
        type=str.upper,
        choices=PERFORMANCE_MODES,
        default=None,
        help="OpenVINO performance hint (OV_PERFORMANCE_MODE; default: THROUGHPUT on GPU, else LATENCY)",
    )
    parser.add_argument(
        "--model-cache",
        action="store_true",
        help="Keep compiled OpenVINO blobs on CPU and GPU too, for faster restarts "
        "(OV_ENABLE_MODEL_CACHE; upstream caches on the NPU only)",
    )
    add_instance_args(parser)
    # parse_known_args so flags meant for the multiserve engine (or a future
    # sibling worker) degrade to a warning rather than killing the worker.
    args, unknown = parser.parse_known_args(argv)
    if unknown:
        logger.warning("ignoring unrecognised arguments: %s", " ".join(unknown))
    if args.batch_size is not None and args.batch_size < 1:
        parser.error("--batch-size must be at least 1")
    return args


def _resolve_model(model: str) -> str:
    name = model.strip()
    return MODEL_ALIASES.get(name.lower(), name)


def _publish_native_environment(args: argparse.Namespace) -> None:
    """Translate worker flags into upstream's ``EMBEDDING_*`` settings.

    Must run before upstream is imported: its pydantic ``Settings`` is built at import time.
    ``setdefault`` lets values exported by the shell win over the defaults; the tuning flags
    (the instance's Runtime Settings) win over both.
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    # Hugging Face downloads go to the shared cache; the legacy one under models/embeddings
    # moves into it.
    moved = use_shared_hf_cache(MODELS_DIR / "huggingface")
    if moved:
        logger.info(moved)
    device = str(args.device).upper()
    overrides = {
        "EMBEDDING_MODEL_NAME": _resolve_model(args.model),
        "EMBEDDING_DEVICE": device,
        "EMBEDDING_USE_OV": "true",
        # Converted OpenVINO IR (and the compiled-blob cache on NPU).
        "EMBEDDING_OV_MODELS_DIR": str(MODELS_DIR / "ov-models"),
        # Same per-device defaults upstream's setup.sh exports for compose.
        "OV_PERFORMANCE_MODE": "THROUGHPUT" if device.startswith("GPU") else "LATENCY",
        "INFER_BATCH_SIZE": "64" if device.startswith("GPU") else "16",
        "PREPROCESS_WORKERS": "8",
    }
    for key, value in overrides.items():
        os.environ.setdefault(key, value)
    chosen = {
        "INFER_BATCH_SIZE": None if args.batch_size is None else str(args.batch_size),
        "OV_PERFORMANCE_MODE": args.performance_mode,
        "OV_ENABLE_MODEL_CACHE": "1" if args.model_cache else None,
    }
    for key, value in chosen.items():
        if value is not None:
            os.environ[key] = value


def _stub_optional_package(name: str, submodules: dict[str, list[str]] | None = None) -> None:
    """Stub a package this worker doesn't ship, so upstream's eager handler imports succeed.

    Choosing that model family then fails at load time with a clear message.
    """
    try:
        importlib.import_module(name)
        return
    except ImportError:
        pass

    message = (
        f"the '{name}' package is not installed in this worker "
        f"(see workers/{CATALOG_WORKER}/README.md); choose a CLIP, SigLIP or QwenText model"
    )

    def _unavailable(*_args: Any, **_kwargs: Any) -> Any:
        raise ImportError(message)

    def _make(mod_name: str, attrs: list[str]) -> types.ModuleType:
        module = types.ModuleType(mod_name)
        module.__doc__ = f"Edge AI Studio placeholder: {message}"
        for attr in attrs:
            setattr(module, attr, _unavailable)
        return module

    root = _make(name, [])
    root.__path__ = []  # mark as a package so submodule imports resolve
    sys.modules[name] = root
    for sub, attrs in (submodules or {}).items():
        full = f"{name}.{sub}"
        module = _make(full, attrs)
        sys.modules[full] = module
        setattr(root, sub, module)
    logger.info("optional upstream dependency '%s' not installed; its model family is disabled", name)


ARGS = _parse_args()
_publish_native_environment(ARGS)
ACTIVE_MODEL = os.environ["EMBEDDING_MODEL_NAME"]
ACTIVE_DEVICE = os.environ["EMBEDDING_DEVICE"]

STATE = UpstreamState()
_UPSTREAM: dict[str, Any] = {"module": None}


def _load_upstream_app():
    # Upstream is the package `src` (relative imports inside) and is launched
    # from its own directory in the container (`gunicorn src.app:app`).
    enter_upstream_dir(APP_DIR, "src/app.py")
    _stub_optional_package("mobileclip")
    _stub_optional_package("cn_clip", {"clip": ["load_from_name", "available_models", "tokenize"]})
    module = importlib.import_module("src.app")
    # get_model_config copies the preset when startup builds the handler, so setting
    # weight_format between import and startup picks the export (and its <FORMAT> dir).
    for preset in importlib.import_module("src.models.config").MODEL_CONFIGS.get("QwenText", {}).values():
        preset["weight_format"] = ARGS.precision
    _UPSTREAM["module"] = module
    return module.app


try:
    app = _load_upstream_app()
except Exception as exc:  # noqa: BLE001 - surfaced through /healthcheck
    app = failed_app(SERVICE_ID, STATE, exc, logger)
else:
    # Upstream converts the model into the shared ov-models on startup.
    wrap_lifespan(
        app,
        STATE,
        logger,
        f"{UPSTREAM_NAME} ({UPSTREAM_TAG}) with {ACTIVE_MODEL} on {ACTIVE_DEVICE}",
        model_lock=MODELS_DIR / ".oep-startup",
    )


from fastapi import HTTPException, Response  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402
from pydantic import BaseModel, ConfigDict, Field  # noqa: E402


def _embedding_model():
    """Upstream's loaded ``EmbeddingModel`` (a module global set at startup)."""
    module = _UPSTREAM["module"]
    return getattr(module, "embedding_model", None) if module is not None else None


def _capabilities() -> dict[str, Any] | None:
    model = _embedding_model()
    if model is None:
        return None
    return {
        "modalities": model.get_supported_modalities(),
        "supports_text": model.supports_text(),
        "supports_image": model.supports_image(),
        "supports_video": model.supports_video(),
    }


def _health_info() -> dict[str, Any]:
    info: dict[str, Any] = {
        "service": SERVICE_ID,
        "upstream": UPSTREAM_NAME,
        "upstream_tag": UPSTREAM_TAG,
        "active_model": ACTIVE_MODEL,
        "device": ACTIVE_DEVICE,
        "precision": ARGS.precision,
        "port": ARGS.port,
    }
    capabilities = _capabilities() if STATE.ready else None
    if capabilities:
        info["capabilities"] = capabilities
    return info


install_healthcheck(app, STATE, _health_info)


# OpenAI-compatible POST /v1/embeddings, as multiserve serves it, plus typed image items.
# Upstream's own POST /embeddings takes one typed input and returns a bare vector.


class EmbeddingInputItem(BaseModel):
    """One typed item of the extended OpenAI ``input`` list."""

    model_config = ConfigDict(extra="ignore")

    type: str = Field(description="text | image_base64 | image_url")
    text: str | None = None
    image_base64: str | None = None
    image_url: str | None = None


class OpenAIEmbeddingsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore", protected_namespaces=())

    model: str | None = None
    input: str | EmbeddingInputItem | list[str | EmbeddingInputItem]
    encoding_format: str = "float"


def _normalise_input(raw: str | EmbeddingInputItem | list[str | EmbeddingInputItem]) -> list[tuple[str, str]]:
    items = raw if isinstance(raw, list) else [raw]
    out: list[tuple[str, str]] = []
    for item in items:
        if isinstance(item, str):
            out.append(("text", item))
            continue
        kind = item.type.strip().lower()
        if kind == "text":
            if item.text is None:
                raise HTTPException(status_code=400, detail="text item needs a 'text' field")
            out.append(("text", item.text))
        elif kind == "image_base64":
            if not item.image_base64:
                raise HTTPException(status_code=400, detail="image_base64 item needs 'image_base64'")
            out.append(("image_base64", item.image_base64))
        elif kind == "image_url":
            if not item.image_url:
                raise HTTPException(status_code=400, detail="image_url item needs 'image_url'")
            out.append(("image_url", item.image_url))
        else:
            raise HTTPException(status_code=400, detail=f"unsupported input type '{item.type}'")
    if not out:
        raise HTTPException(status_code=400, detail="'input' must not be empty")
    return out


def _encode_vector(vector: list[float], encoding_format: str) -> list[float] | str:
    if encoding_format == "float":
        return [float(v) for v in vector]
    import numpy as np

    return base64.b64encode(np.asarray(vector, dtype=np.float32).tobytes()).decode("ascii")


async def openai_embeddings(
    request: OpenAIEmbeddingsRequest, response: Response
) -> dict[str, Any]:
    if not STATE.ready:
        raise HTTPException(status_code=503, detail="Model is still loading")
    model = _embedding_model()
    if model is None:
        raise HTTPException(status_code=503, detail="Model is not initialized")
    encoding_format = (request.encoding_format or "float").lower()
    if encoding_format not in ("float", "base64"):
        raise HTTPException(status_code=400, detail="encoding_format must be 'float' or 'base64'")
    if request.model and request.model != ACTIVE_MODEL:
        # Multiserve clients send their own model id; answer with the loaded one instead of
        # failing like upstream's route does.
        logger.warning("requested model %r differs from the loaded %r", request.model, ACTIVE_MODEL)

    items = _normalise_input(request.input)
    vectors: list[list[float] | None] = [None] * len(items)
    # Model time for the app's Live metrics (Server-Timing).
    inference_seconds = 0.0

    text_positions = [i for i, (kind, _) in enumerate(items) if kind == "text"]
    if text_positions:
        texts = [items[i][1] for i in text_positions]
        try:
            with timed() as clock:
                text_vectors = await run_in_threadpool(model.embed_documents, texts)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"text embedding failed: {exc}") from exc
        inference_seconds += clock.seconds
        for position, vector in zip(text_positions, text_vectors, strict=True):
            vectors[position] = vector

    for position, (kind, value) in enumerate(items):
        if kind == "text":
            continue
        if not model.supports_image():
            raise HTTPException(
                status_code=400,
                detail=f"Image inputs are not supported by the active model '{ACTIVE_MODEL}'",
            )
        try:
            with timed() as clock:
                if kind == "image_base64":
                    vectors[position] = await run_in_threadpool(
                        model.get_image_embedding_from_base64, value
                    )
                else:
                    vectors[position] = await model.get_image_embedding_from_url(value)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"image embedding failed: {exc}") from exc
        inference_seconds += clock.seconds

    response.headers.update(server_timing(inference_seconds))
    data = [
        {
            "object": "embedding",
            "index": index,
            "embedding": _encode_vector(vector or [], encoding_format),
        }
        for index, vector in enumerate(vectors)
    ]
    return {
        "object": "list",
        "data": data,
        "model": ACTIVE_MODEL,
        "usage": {"prompt_tokens": 0, "total_tokens": 0},
    }


app.add_api_route(
    "/v1/embeddings",
    openai_embeddings,
    methods=["POST"],
    tags=["OpenAI-compatible"],
    summary="Create embeddings (OpenAI request/response shape; input items may also be image_base64 / image_url)",
)

# Model ids contain a slash, which the helper's path converter handles. Upstream registers no
# exception handlers, so this wrapper adds the error envelope (`error` and `detail`).
install_models_routes(app, lambda: [ACTIVE_MODEL], owned_by=UPSTREAM_NAME)
install_openai_errors(app)


if __name__ == "__main__":
    serve(app, ARGS, log_level="info")
