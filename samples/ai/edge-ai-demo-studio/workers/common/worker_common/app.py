# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""FastAPI application construction."""

from __future__ import annotations

import inspect
import json
import os
from contextlib import asynccontextmanager
from typing import Any, Callable, Iterable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from worker_common import startup

DEFAULT_CORS_ORIGINS = ["http://localhost"]


def _reporting_lifespan(lifespan: Callable[..., Any], *, ready_when_started: bool) -> Callable[..., Any]:
    """``lifespan`` with its outcome reported to the app's startup panel.

    A startup that raises is the failure summary unless a more specific one was reported. With the
    default ``/healthcheck`` a completed startup means ready, so the stage becomes "checking-readiness";
    a worker with its own readiness route may still be loading, so nothing is claimed for it.
    """

    @asynccontextmanager
    async def wrapped(app: FastAPI):
        started = False
        try:
            async with lifespan(app) as state:
                started = True
                if ready_when_started:
                    startup.report_stage("checking-readiness")
                yield state
        except Exception as exc:
            if not started and not startup.failure_reported():
                startup.report_failure(f"Startup failed: {type(exc).__name__}: {exc}")
            raise

    return wrapped


def cors_origins(default: Iterable[str] = DEFAULT_CORS_ORIGINS) -> list[str]:
    """Origins from ALLOWED_CORS (a JSON array); ``default`` when it is missing or malformed."""
    raw = os.getenv("ALLOWED_CORS")
    if not raw:
        return list(default)
    try:
        origins = json.loads(raw)
    except json.JSONDecodeError:
        return list(default)
    if isinstance(origins, str):
        return [origins]
    if isinstance(origins, list) and all(isinstance(o, str) for o in origins):
        return origins
    return list(default)


def create_app(
    title: str,
    *,
    lifespan: Callable[..., Any] | None = None,
    healthcheck: bool = True,
    allow_origins: Iterable[str] | None = None,
    allow_methods: Iterable[str] = ("*",),
    **kwargs: Any,
) -> FastAPI:
    """Build a worker's FastAPI app with CORS and, unless ``healthcheck=False``, GET /healthcheck -> "OK".

    The frontend polls /healthcheck to decide a worker is up; a worker that is ready only once its model
    loads passes ``healthcheck=False`` and serves its own route answering 503 until then.
    ``allow_origins`` defaults to ALLOWED_CORS. With startup reports enabled the lifespan's outcome is
    reported; generator lifespans are passed through untouched.
    """
    if (
        lifespan is not None
        and startup.enabled()
        and not inspect.isasyncgenfunction(lifespan)
        and not inspect.isgeneratorfunction(lifespan)
    ):
        lifespan = _reporting_lifespan(lifespan, ready_when_started=healthcheck)
    app = FastAPI(title=title, lifespan=lifespan, **kwargs)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allow_origins) if allow_origins is not None else cors_origins(),
        allow_credentials=True,
        allow_methods=list(allow_methods),
        allow_headers=["*"],
    )
    if healthcheck:
        @app.get("/healthcheck")
        def get_healthcheck() -> str:
            return "OK"

    return app
