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


def _ensure_model(
    backend,
    port: int,
    model_id: str,
    task: str,
    device: str,
    params: str,
    source: str = "huggingface",
):
    """Ensure a model is downloaded and started via the multiserve API."""
    base_url = f"http://localhost:{port}"

    try:
        logger.info(f"Downloading model {model_id} for task {task}...")
        resp = requests.post(
            f"{base_url}/v1/model/download/unverified",
            json={"repo_id": model_id, "task": task, "extra_params": params},
        )
        if resp.status_code != 200:
            logger.error(f"Failed to download model {model_id}: {resp.text}")
            raise RuntimeError(f"Failed to download model {model_id}")

        # Start
        logger.info(f"Starting model {model_id} on {device}...")
        body = {
            "repo_id": model_id,
            "task": task,
            "device": device,
            "source": source,
        }

        if backend == "llamacpp":
            body["context_size"] = 4096
        else:
            body["model_path"] = ""

        resp = requests.post(
            f"{base_url}/v1/start",
            json=body,
        )
        if resp.status_code != 200:
            logger.error(f"Failed to start model {model_id}: {resp.text}")
            raise RuntimeError(f"Failed to start model {model_id}: {resp.text}")

    except requests.RequestException as e:
        logger.error(f"Communication error with multiserve: {e}")
        raise RuntimeError(f"Communication error: {e}") from e


def start_multiserve_background(
    embedding_model_id: str,
    embedding_device: str,
    embedding_params: str,
    embedding_source: str,
    reranker_model_id: str,
    reranker_device: str,
    reranker_params: str,
    reranker_source: str,
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
    # Propagate HF token if present

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

    # 3. Initialize Models
    try:
        # Embedding
        # Task for embedding is "embeddings" (matches backend usually)
        _ensure_model(
            backend,
            serving_port,
            embedding_model_id,
            "embeddings",
            embedding_device,
            embedding_params,
            embedding_source,
        )

        # Reranker
        # Task for reranker is "rerank"
        _ensure_model(
            backend,
            serving_port,
            reranker_model_id,
            "rerank",
            reranker_device,
            reranker_params,
            reranker_source,
        )

    except Exception as e:
        logger.error(f"Error initializing models: {e}")
        process.kill()
        raise

    return process


def wait_for_model_ready(
    port: int,
    model_id: str,
    model_type: str,
    device: str,
    timeout: int = 120,
    check_interval: float = 1.0,
):
    """
    Check if a model is ready/loaded in multiserve.
    Compatible signature with embedding_ovms.wait_for_model_ready.
    """
    start_time = time.time()
    logger.info(f"Checking readiness for model {model_id} on port {port}")

    base_url = f"http://localhost:{port}"

    while time.time() - start_time < timeout:
        try:
            resp = requests.get(f"{base_url}/v1/status", timeout=2)
            if resp.status_code == 200:
                status = resp.json()
                found = False
                for model in status["status"]:
                    if (
                        model.get("task") == model_type
                        and model.get("repo_id") == model_id
                        and model.get("device") == device
                    ):
                        found = True
                        break
                if found:
                    logger.info(f"Model {model_id} is ready on port {port}")
                    return True
            else:
                logger.warning(
                    f"Error checking model list: {resp.status_code} {resp.text}"
                )

        except requests.RequestException:
            pass

        time.sleep(check_interval)

    logger.error(f"Timeout waiting for model {model_id} on port {port}")
    return False
