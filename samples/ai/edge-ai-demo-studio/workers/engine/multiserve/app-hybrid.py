# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import sys
import logging
import signal
import atexit

import threading
import argparse
import uvicorn

from fastapi import FastAPI
from contextlib import asynccontextmanager

from modules.utils import get_resource_path

from modules.llamacpp.cli import LlamaManagerCLI
from routers.log_router import create_log_router

from modules.ovms.cli import OVMSManagerCLI
from modules.utils import validate_and_sanitize_dir

from routers.main_proxy_router import create_main_proxy_router

VERSION = "v0.0.17"
MULTISERVE_BACKEND = os.getenv("MULTISERVE_BACKEND", "hybrid")
MODELS_DIR = "models"
LOGS_DIR = "logs"

argparser = argparse.ArgumentParser()
argparser.add_argument("--tray", action="store_true", help="Run with Tray mode")
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

llamacpp_manager = LlamaManagerCLI(
    verified_model_path=get_resource_path("verified.yaml"),
    models_directory=f"{MODELS_DIR}/GGUF",
    logs_dir=LOGS_DIR,
    port=int(args.port) + 1,
)
ovms_manager = OVMSManagerCLI(
    verified_model_path=get_resource_path("verified.yaml"),
    models_directory=f"{MODELS_DIR}/OV",
    logs_dir=LOGS_DIR,
    rest_port=int(args.port),
)


_cleanup_done = False
_cleanup_lock = threading.Lock()


def _force_kill_children():
    """Forcefully kill all child inference server processes.

    Uses SIGKILL to ensure child processes are terminated quickly,
    preventing orphaned processes when the parent is killed by the
    process handler (which sends SIGKILL after a short grace period).
    """
    global _cleanup_done
    with _cleanup_lock:
        if _cleanup_done:
            return
        _cleanup_done = True

    # Kill llama.cpp server processes
    for task, server_info in list(llamacpp_manager.manager.running_servers.items()):
        process = server_info.get("process")
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=5)

    # Kill OVMS server process
    ovms_proc = ovms_manager.ovms_manager.server_process
    if ovms_proc and ovms_proc.poll() is None:
        ovms_proc.kill()
        ovms_proc.wait(timeout=5)


def _signal_handler(signum, frame):
    """Handle SIGTERM/SIGINT by killing child processes and exiting."""
    _force_kill_children()
    sys.exit(0)


signal.signal(signal.SIGTERM, _signal_handler)
signal.signal(signal.SIGINT, _signal_handler)
atexit.register(_force_kill_children)


def start_server():
    llamacpp_manager.start_server()
    ovms_manager.start_server()


def stop_server():
    llamacpp_manager.stop_servers()
    ovms_manager.stop_servers()


@asynccontextmanager
async def lifespan(app: FastAPI):
    server_thread = threading.Thread(target=start_server)
    server_thread.start()

    yield

    stop_server()
    print("FastAPI shutdown: Stopping Inference server thread...")


app = FastAPI(
    title="Inference Server Manager API",
    description="API to control and configure Inference Server (Start, Stop, Download, Config Management).",
    version="0.0.1",
    lifespan=lifespan,
)

main_router = create_main_proxy_router(llamacpp_manager, ovms_manager)
app.include_router(main_router)
log_router = create_log_router(backend=MULTISERVE_BACKEND, logs_dir=LOGS_DIR)
app.include_router(log_router, prefix="/v1", tags=["logs"])

if __name__ == "__main__":
    print(f"App Version: {VERSION}, Mode: {MULTISERVE_BACKEND}")
    print(f"Server running on http://127.0.0.1:{args.port}")

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level=f"{'info' if args.debug else 'warning'}",
        factory=False,
    )
