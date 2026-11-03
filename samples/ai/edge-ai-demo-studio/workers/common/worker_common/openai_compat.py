# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""OpenAI API compatibility helpers: the error envelope and the ``/v1/models`` routes.

Both are additive, so they suit an app from :func:`worker_common.create_app`, a hand-built one or an
imported upstream app.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Iterable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

__all__ = [
    "SPEECH_RESPONSE_FORMATS",
    "error_type_for_status",
    "install_models_routes",
    "install_openai_errors",
    "model_object",
    "openai_error_body",
    "override_api_route",
    "pydub_export_kwargs",
    "speech_media_type",
]

# `response_format` values of OpenAI's POST /v1/audio/speech, in the API reference's order.
SPEECH_RESPONSE_FORMATS = ("mp3", "opus", "aac", "flac", "wav", "pcm")

_SPEECH_MEDIA_TYPES = {
    "mp3": "audio/mpeg",
    "opus": "audio/opus",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "pcm": "audio/pcm",
}

# pydub passes `format` to ffmpeg as the muxer name: for AAC that is `adts` (ffmpeg's `aac` is only
# a demuxer), and the adts muxer does not imply the codec.
_PYDUB_EXPORT = {
    "aac": {"format": "adts", "codec": "aac"},
}


def speech_media_type(response_format: str) -> str:
    """Content type for one of :data:`SPEECH_RESPONSE_FORMATS`."""
    return _SPEECH_MEDIA_TYPES.get(str(response_format).lower(), "audio/mpeg")


def pydub_export_kwargs(response_format: str) -> dict[str, str]:
    """Keyword arguments for ``pydub.AudioSegment.export``; only AAC differs from its own name."""
    fmt = str(response_format).lower()
    return dict(_PYDUB_EXPORT.get(fmt, {"format": fmt}))

# OpenAI's documented `error.type` values by status code.
_ERROR_TYPES = {
    400: "invalid_request_error",
    401: "authentication_error",
    403: "permission_error",
    404: "not_found_error",
    409: "conflict_error",
    413: "invalid_request_error",
    415: "invalid_request_error",
    422: "invalid_request_error",
    429: "rate_limit_error",
    500: "api_error",
    503: "api_error",
}


def error_type_for_status(status_code: int) -> str:
    """OpenAI ``error.type`` for an HTTP status code."""
    mapped = _ERROR_TYPES.get(status_code)
    if mapped:
        return mapped
    return "api_error" if status_code >= 500 else "invalid_request_error"


def _stringify(detail: Any) -> str:
    """Render a FastAPI ``detail`` (str, dict or list) as the single string ``error.message`` needs."""
    if isinstance(detail, str):
        return detail
    if isinstance(detail, dict):
        for key in ("message", "detail", "error"):
            value = detail.get(key)
            if isinstance(value, str):
                return value
    if isinstance(detail, (list, tuple)):
        parts = [_stringify(item) for item in detail]
        return "; ".join(part for part in parts if part)
    return str(detail)


def openai_error_body(
    message: Any,
    *,
    status_code: int = 500,
    error_type: str | None = None,
    param: str | None = None,
    code: str | None = None,
    detail: Any = None,
) -> dict[str, Any]:
    """Build a body carrying both the OpenAI ``error`` object and ``detail``.

    ``detail`` defaults to ``message``; pass it to keep a structured detail (a validation error list) as is.
    """
    text = _stringify(message)
    return {
        "error": {
            "message": text,
            "type": error_type or error_type_for_status(status_code),
            "param": param,
            "code": code,
        },
        "detail": text if detail is None else detail,
    }


def _error_field(error: Any) -> str | None:
    """Field path of one pydantic error for ``error.param``, without its leading request part (``body``)."""
    if not isinstance(error, dict):
        return None
    location = error.get("loc")
    if not isinstance(location, (list, tuple)) or not location:
        return None
    parts = [str(item) for item in location]
    # Only the *leading* element names the request part; a field genuinely
    # called "body" further down the path has to survive.
    if parts[0] in ("body", "query", "path", "header", "cookie"):
        parts = parts[1:]
    return ".".join(parts) or None


def _validation_param(errors: Any) -> str | None:
    """``error.param`` for a validation failure -- the first offending field."""
    if not isinstance(errors, (list, tuple)) or not errors:
        return None
    return _error_field(errors[0])


def _validation_message(errors: Any) -> str:
    """A readable ``error.message`` for a validation failure, like OpenAI's ("input: Field required")."""
    if not isinstance(errors, (list, tuple)) or not errors:
        return "Invalid request"
    messages = []
    for error in errors:
        text = error.get("msg") if isinstance(error, dict) else None
        if not text:
            text = _stringify(error)
        field = _error_field(error)
        messages.append(f"{field}: {text}" if field else str(text))
    return "; ".join(messages)


def jsonable(value: Any) -> Any:
    """JSON-safe copy of a value for an error body (a validation error's ``ctx`` can hold an exception)."""
    from fastapi.encoders import jsonable_encoder

    try:
        return jsonable_encoder(value)
    except Exception:  # noqa: BLE001 - the message matters more than the detail
        return _stringify(value)


def install_openai_errors(app: FastAPI) -> FastAPI:
    """Answer ``HTTPException`` and ``RequestValidationError`` with :func:`openai_error_body`.

    OpenAI SDKs read ``error`` and the frontend reads ``detail``. Status codes are unchanged (validation
    stays 422, not OpenAI's 400) because the frontend tells the two apart.
    """

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=openai_error_body(
                exc.detail,
                status_code=exc.status_code,
                detail=exc.detail,
            ),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exception(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        return JSONResponse(
            status_code=422,
            content=openai_error_body(
                _validation_message(errors),
                status_code=422,
                param=_validation_param(errors),
                # Keep FastAPI's structured list, which the frontend renders.
                detail=jsonable(errors),
            ),
        )

    return app


def override_api_route(
    app: FastAPI,
    path: str,
    endpoint: Callable[..., Any],
    *,
    methods: list[str],
    **kwargs: Any,
) -> None:
    """Register a route that answers ``path`` in place of one already there (e.g. in an upstream app).

    The new route goes first, since Starlette dispatches to the first match; deleting the old one would
    depend on FastAPI's router nesting, which changes between versions. The shadowed route is hidden from
    the OpenAPI schema, best effort.
    """
    app.add_api_route(path, endpoint, methods=methods, **kwargs)
    app.router.routes.insert(0, app.router.routes.pop())
    _hide_shadowed_routes(app, path, methods)


def _hide_shadowed_routes(app: FastAPI, path: str, methods: list[str]) -> None:
    """Best-effort ``include_in_schema = False`` on routes now unreachable."""
    wanted = {m.upper() for m in methods}
    seen: set[int] = set()

    def visit(routes: Iterable[Any], skip_first: bool) -> None:
        for index, route in enumerate(routes):
            if skip_first and index == 0:
                continue
            if id(route) in seen:
                continue
            seen.add(id(route))
            if getattr(route, "path", None) == path and wanted & set(getattr(route, "methods", ()) or ()):
                try:
                    route.include_in_schema = False
                except Exception:  # noqa: BLE001 - cosmetic only
                    pass
            nested = getattr(route, "original_router", None) or route
            sub_routes = getattr(nested, "routes", None)
            if sub_routes and nested is not route:
                visit(sub_routes, skip_first=False)

    try:
        visit(app.router.routes, skip_first=True)
    except Exception:  # noqa: BLE001 - cosmetic only
        pass


def model_object(
    model_id: str,
    *,
    owned_by: str = "edge-ai-studio",
    created: int | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """One entry of an OpenAI ``GET /v1/models`` list."""
    return {
        "id": model_id,
        "object": "model",
        "created": created if created is not None else int(time.time()),
        "owned_by": owned_by,
        **extra,
    }


def install_models_routes(
    app: FastAPI,
    list_models: Callable[[], Iterable[str]] | Iterable[str],
    *,
    owned_by: str = "edge-ai-studio",
    tags: list[str] | None = None,
) -> FastAPI:
    """Add OpenAI's ``GET /v1/models`` and ``GET /v1/models/{model}``.

    ``list_models`` may be a callable, so a model resolved later is reported live. The retrieve route
    matches the rest of the path so ids with a slash (``CLIP/clip-vit-b-16``) resolve.
    """
    # Pinned per process: `created` is the model's creation time and must not change per request.
    created = int(time.time())
    route_tags = tags if tags is not None else ["OpenAI-compatible"]

    def _models() -> list[str]:
        source = list_models() if callable(list_models) else list_models
        return [str(m) for m in source if m]

    def list_models_route() -> dict[str, Any]:
        return {
            "object": "list",
            "data": [model_object(m, owned_by=owned_by, created=created) for m in _models()],
        }

    def retrieve_model_route(model: str) -> dict[str, Any]:
        known = _models()
        if model not in known:
            raise StarletteHTTPException(
                status_code=404,
                detail=f"The model '{model}' does not exist",
            )
        return model_object(model, owned_by=owned_by, created=created)

    app.add_api_route(
        "/v1/models",
        list_models_route,
        methods=["GET"],
        tags=route_tags,
        summary="List the models this worker serves (OpenAI-compatible)",
    )
    app.add_api_route(
        "/v1/models/{model:path}",
        retrieve_model_route,
        methods=["GET"],
        tags=route_tags,
        summary="Retrieve one model (OpenAI-compatible)",
    )
    return app
