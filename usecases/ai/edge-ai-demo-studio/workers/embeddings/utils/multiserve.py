# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import time
import logging
import requests
import subprocess  # nosec
from typing import Optional

# Setup paths relative to this script location
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EMBEDDING_DIR = os.path.dirname(SCRIPT_DIR)
WORKERS_DIR = os.path.dirname(EMBEDDING_DIR)
MULTISERVE_DIR = os.path.join(WORKERS_DIR, "engine", "multiserve")
THIRDPARTY_DIR = os.path.join(WORKERS_DIR, "thirdparty")
UV_PATH = os.path.join(THIRDPARTY_DIR, "uv", "uv.exe" if os.name == "nt" else "uv")

logger = logging.getLogger("uvicorn.error")


def _wait_for_health(port: int, timeout: int = 60) -> bool:
    """Wait for the multiserve health endpoint to be OK."""
    health_url = f"http://localhost:{port}/v1/health"
    start_time = time.time()

    while time.time() - start_time < timeout:
        try:
            response = requests.get(health_url, timeout=2)
            if response.status_code == 200:
                data = response.json()
                if data.get("health") == "OK":
                    return True
        except requests.RequestException:
            pass

        time.sleep(1)

    return False


def start_multiserve_background(
    backend: str,
    serving_port: int = 5951,
    models_dir: Optional[str] = None,
    logs_dir: Optional[str] = None,
):
    """
    Start the multiserve app in background and initialize embedding/reranker models.
    """

    # Check if UV exists
    if not os.path.exists(UV_PATH):
        raise RuntimeError(f"UV executable not found at {UV_PATH}")

    if not os.path.exists(MULTISERVE_DIR):
        raise RuntimeError(f"Multiserve directory not found at {MULTISERVE_DIR}")

    # 1. Start Process
    env = os.environ.copy()
    env["MULTISERVE_BACKEND"] = backend
    # Ensure UTF-8 for python
    env["PYTHONIOENCODING"] = "utf-8"

    cmd = [
        UV_PATH,
        "run",
        "app.py",
        "--headless",
        "--debug",
        "--port",
        str(serving_port),
        "--model-dir",
        models_dir or "",
        "--logs-dir",
        logs_dir or "",
    ]

    logger.info(f"Starting multiserve process: {' '.join(cmd)}")

    process = subprocess.Popen(
        cmd,
        cwd=MULTISERVE_DIR,
        env=env,
        # Inherit stdout/stderr to see logs in the worker output
    )

    # 2. Wait for Health
    logger.info(f"Waiting for multiserve health on port {serving_port}...")
    if not _wait_for_health(serving_port, timeout=60):
        logger.error("Multiserve failed to start (health check timeout)")
        process.kill()
        raise RuntimeError("Multiserve failed to start")

    logger.info("Multiserve is healthy.")

    return process
