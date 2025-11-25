# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import sys
# if getattr(sys, 'frozen', False):
#     sys.stdout = open(os.devnull, "w")

import threading
import argparse

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from modules.utils import get_resource_path
from modules.tray_app import InferenceServerTrayApp

from modules.llamacpp.cli import LlamaManagerCLI
from routers.llamacpp_api_router import create_llamacpp_api_router
from routers.llamacpp_openai_proxy_router import create_llamacpp_openai_proxy_router

from modules.ovms.cli import OVMSManagerCLI
from routers.ovms_api_router import create_ovms_api_router
from routers.ovms_openai_proxy_router import create_ovms_openai_proxy_router

argparser = argparse.ArgumentParser()
argparser.add_argument("--backend", default="llamacpp", help="Inference Backend (eg: ovms / llamacpp)")
args = argparser.parse_args()

if args.backend == "llamacpp":
    index_file = "index.html"
    manager = LlamaManagerCLI(verified_model_path=get_resource_path("verified.yaml"), models_directory="models/GGUF")
    create_api_router = create_llamacpp_api_router
    create_openai_proxy_router = create_llamacpp_openai_proxy_router
else:
    index_file = "index_ov.html"
    manager = OVMSManagerCLI(verified_model_path=get_resource_path("verified.yaml"), models_directory="models/OV")
    create_api_router = create_ovms_api_router
    create_openai_proxy_router = create_ovms_openai_proxy_router

def start_server():
    manager.start_server()

@asynccontextmanager
async def lifespan(app: FastAPI):
    server_thread = threading.Thread(target=start_server)
    server_thread.start()
    
    yield

    print("FastAPI shutdown: Stopping Inference server thread...")

app = FastAPI(
    title="Inference Server Manager API", 
    description="API to control and configure Inference Server (Start, Stop, Download, Config Management).", 
    version="0.0.1",
    lifespan=lifespan
)

app.mount("/static", StaticFiles(directory=get_resource_path("static")), name="static")
app.mount("/webfonts", StaticFiles(directory=get_resource_path("static/webfonts")), name="webfonts")

@app.get("/", include_in_schema=False)
async def root():
    html_path = get_resource_path(f"./static/{index_file}")
    return FileResponse(html_path)

api_router = create_api_router(manager)
app.include_router(api_router)
openai_router = create_openai_proxy_router(manager)
app.include_router(openai_router)

if __name__ == "__main__":
    tray_app = InferenceServerTrayApp(app, manager)
    tray_app.start(False)
