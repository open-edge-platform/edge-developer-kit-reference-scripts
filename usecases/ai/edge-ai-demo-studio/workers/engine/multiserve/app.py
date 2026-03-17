# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import sys
import logging

# if getattr(sys, 'frozen', False):
#     sys.stdout = open(os.devnull, "w")

import threading
import argparse
import uvicorn

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from modules.utils import get_resource_path

from modules.llamacpp.cli import LlamaManagerCLI
from routers.llamacpp_api_router import create_llamacpp_api_router
from routers.llamacpp_openai_proxy_router import create_llamacpp_openai_proxy_router
from routers.log_router import create_log_router
from routers.general_router import create_general_router

from modules.ovms.cli import OVMSManagerCLI
from routers.ovms_api_router import create_ovms_api_router
from routers.ovms_openai_proxy_router import create_ovms_openai_proxy_router
from modules.utils import validate_and_sanitize_dir

VERSION = "v0.0.15"
MULTISERVE_BACKEND = os.getenv("MULTISERVE_BACKEND", "llamacpp")
MODELS_DIR = "models"
LOGS_DIR = "logs"

argparser = argparse.ArgumentParser()
argparser.add_argument("--headless", action="store_true", help="Run in headless mode")
argparser.add_argument("--port", type=int, default=9090, help="Port to run the server")
argparser.add_argument("--debug", action="store_true", help="Enable debug logging")
argparser.add_argument("--model-dir", type=str, help="Path to model dir")
argparser.add_argument("--logs-dir", type=str, help="Path to logs dir")

argparser.add_argument(
    "--version", action="store_true", help="View application version"
)
argparser.add_argument(
    "--deps-version", action="store_true", help="View dependencies version"
)

args = argparser.parse_args()
MODELS_DIR = validate_and_sanitize_dir(args.model_dir) if args.model_dir else MODELS_DIR
LOGS_DIR = validate_and_sanitize_dir(args.logs_dir) if args.logs_dir else LOGS_DIR

logger = logging.getLogger(__name__)
if args.debug:
    logging.basicConfig(
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
else:
    logging.basicConfig(level=logging.WARNING)

if MULTISERVE_BACKEND == "llamacpp":
    index_file = "index.html"
    manager = LlamaManagerCLI(
        verified_model_path=get_resource_path("verified.yaml"),
        models_directory=os.path.join(MODELS_DIR, "GGUF"),
        logs_dir=LOGS_DIR,
        port=int(args.port),
    )
    create_api_router = create_llamacpp_api_router
    create_openai_proxy_router = create_llamacpp_openai_proxy_router
else:
    index_file = "index_ov.html"
    manager = OVMSManagerCLI(
        verified_model_path=get_resource_path("verified.yaml"),
        models_directory=os.path.join(MODELS_DIR, "OV"),
        logs_dir=LOGS_DIR,
        rest_port=int(args.port),
    )
    create_api_router = create_ovms_api_router
    create_openai_proxy_router = create_ovms_openai_proxy_router


def start_server():
    manager.start_server()


@asynccontextmanager
async def lifespan(app: FastAPI):
    server_thread = threading.Thread(target=start_server)
    server_thread.start()

    yield

    manager.stop_servers()
    print("FastAPI shutdown: Stopping Inference server thread...")


app = FastAPI(
    title="Inference Server Manager API",
    description="API to control and configure Inference Server (Start, Stop, Download, Config Management).",
    version="0.0.1",
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory=get_resource_path("static")), name="static")
app.mount(
    "/webfonts",
    StaticFiles(directory=get_resource_path("static/webfonts")),
    name="webfonts",
)


@app.get("/", include_in_schema=False)
async def root():
    html_path = get_resource_path(f"./static/{index_file}")
    return FileResponse(html_path)


api_router = create_api_router(manager)
app.include_router(api_router)
openai_router = create_openai_proxy_router(manager)
app.include_router(openai_router)
log_router = create_log_router(backend=MULTISERVE_BACKEND, logs_dir=LOGS_DIR)
app.include_router(log_router, prefix="/v1", tags=["logs"])

general_router = create_general_router(models_dir=MODELS_DIR)
app.include_router(general_router)

if __name__ == "__main__":
    deps_versions = manager.get_dependencies_versions()
    if args.version:
        print(f"{VERSION}-{deps_versions.get("backend")}")
        sys.exit(0)

    if args.deps_version:
        print(deps_versions)
        sys.exit(0)

    print(f"App Version: {VERSION}")
    print(f"Server running on http://127.0.0.1:{args.port}")

    if not args.headless:
        from modules.tray_app import InferenceServerTrayApp

        tray_app = InferenceServerTrayApp(app, manager)
        tray_app.start(args.port)
    else:
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=args.port,
            log_level=f"{'info' if args.debug else 'warning'}",
            factory=False,
        )
