# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""FastAPI application factory for Local Lingua backend."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

import yaml
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles

from src.backend.api.routes import init_services, router
from src.backend.services.mission_cue_service import MissionCueService
from src.backend.services.model_registry import ModelRegistry
from src.backend.services.pipeline_service import PipelineService
from src.backend.storage import database as db
from src.backend.storage.database import init_db

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config.yaml"


class NoCacheStaticFiles(StaticFiles):
    """StaticFiles that forces revalidation so JS/CSS updates take effect

    without requiring a hard-refresh (many JS modules are imported by other
    modules with no cache-busting query string, so the browser can otherwise
    keep serving a stale cached copy indefinitely after a deployment).
    """

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response


def _load_config() -> dict:
    """Load config.yaml from the project root."""
    try:
        with open(_CONFIG_PATH, "r") as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        logger.error("Config file not found: %s", _CONFIG_PATH)
        return {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic for the FastAPI application."""
    # Startup
    logger.info("Initialising Local Lingua backend...")

    # Load configuration
    config = _load_config()
    logger.info("Configuration loaded from %s", _CONFIG_PATH)

    # Initialise SQLite database
    init_db()
    logger.info("Database initialised")

    # Initialise model registry from config.yaml, then re-apply any model and
    # target selections the user made previously. Must happen before the
    # pipeline is built, since PipelineService._load_models reads assignments.
    registry = ModelRegistry()
    rejected = registry.restore_assignments(db.get_model_assignments())
    for stage, reason in rejected.items():
        logger.warning("Saved selection for '%s' no longer valid: %s", stage, reason)
    logger.info("Model registry loaded")

    # Initialise pipeline service with config for model loading
    pipeline = PipelineService(registry=registry, config=config)
    logger.info("Pipeline service ready")

    # Initialise mission cue service (loads demo PDFs if available)
    mission_cues = MissionCueService()
    logger.info("Mission cue service ready (%d documents)", len(mission_cues.list_documents()))

    # Inject services into the router
    init_services(registry=registry, pipeline=pipeline, mission_cues=mission_cues)
    logger.info("API routes wired to services")

    yield

    # Shutdown
    logger.info("Local Lingua backend shutting down")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    app = FastAPI(
        title="Local Lingua API",
        description=(
            "Offline voice-based interactive translation and sentiment "
            "analysis backend for Intel Panther Lake hardware."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS middleware — restricted to localhost/loopback and private-network
    # origins, since the device may be reached via its LAN IP on port 7860.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=(
            r"^https?://(localhost|127\.0\.0\.1|\[::1\]"
            r"|10(?:\.\d{1,3}){3}"
            r"|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}"
            r"|192\.168(?:\.\d{1,3}){2})(?::\d+)?$"
        ),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include all API routes (must be before static mount so /api/* takes priority)
    app.include_router(router)

    # Serve demo voice samples if available (before the catch-all static mount)
    _samples_dir = Path(__file__).resolve().parents[2] / "voice_samples"
    if _samples_dir.is_dir():
        app.mount(
            "/voice_samples",
            StaticFiles(directory=str(_samples_dir)),
            name="voice_samples",
        )

    # Serve the custom HTML/CSS/JS frontend as static files
    _static_dir = Path(__file__).resolve().parents[1] / "frontend" / "static"
    if _static_dir.is_dir():
        app.mount("/", NoCacheStaticFiles(directory=str(_static_dir), html=True), name="static")

    return app


# Module-level app instance for uvicorn to pick up:
#   uvicorn src.backend.app:app --reload
app = create_app()
