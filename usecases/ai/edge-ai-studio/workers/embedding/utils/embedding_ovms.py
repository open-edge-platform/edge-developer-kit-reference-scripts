# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import json
import argparse
import subprocess #nosec -- used to spawn ovms in a secured environment
import time
import requests
import urllib.parse
from typing import List, TypedDict
from huggingface_hub import snapshot_download
from utils.export_model import export_embeddings_model, export_rerank_model
from utils.util import (
    validate_and_sanitize_cache_dir,
    create_cache_directory,
    validate_and_sanitize_model_id,
)

os.environ["TOKENIZERS_PARALLELISM"] = "false"


class ModelConfig(TypedDict):
    """Type definition for model configuration dictionary."""

    model_id: str
    device: str
    task: str


def download_model(model_id: str, model_dir: str):
    """
    Download the model from Hugging Face Hub if it is not already present.
    """
    try:
        print(f"Downloading model: {model_id}...")
        path = snapshot_download(repo_id=model_id, cache_dir=model_dir)
        return path
    except Exception as e:
        print(f"Error downloading {model_id}: {e}")
        raise RuntimeError(f"Failed to download model {model_id}")


def prepare_model_env(
    model_id: str,
    model_dir: str,
    task: str,
    device: str = "CPU",
    precision: str = "int8",
    version: str = "1",
):
    print(f"Preparing model environment for {model_id} ...")
    validated_model_id = validate_and_sanitize_model_id(model_id)
    config_file_path = os.path.join(model_dir, "config.json")

    if not os.path.exists(model_dir):
        os.makedirs(model_dir, exist_ok=True)

    try:
        task_parameters = {
            "target_device": device,
        }

        if task == "embeddings":
            export_embeddings_model(
                model_repository_path=model_dir,
                source_model=validated_model_id,
                model_name=validated_model_id,
                precision=precision,
                version=version,
                task_parameters=task_parameters,
                config_file_path=config_file_path,
            )
        elif task == "rerank":
            export_rerank_model(
                model_repository_path=model_dir,
                source_model=validated_model_id,
                model_name=validated_model_id,
                precision=precision,
                version=version,
                task_parameters=task_parameters,
                config_file_path=config_file_path,
            )
        print(f"Model exported successfully to {model_dir}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        raise RuntimeError(f"Failed to prepare model environment for {model_dir}")


def setup_ovms_environment():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    embedding_dir = os.path.dirname(script_dir)
    ovms_dir = os.path.join(os.path.dirname(embedding_dir), "thirdparty", "ovms")
    env = {}

    # Windows-specific environment setup
    if os.name == "nt":  # Windows
        # Set OVMS environment variables as per official documentation
        os.environ["OVMS_DIR"] = ovms_dir

        # Set PYTHONHOME to the Python directory within OVMS
        python_home_dir = os.path.join(ovms_dir, "python")
        if not os.path.exists(python_home_dir):
            print(f"Error: PYTHONHOME directory not found at {python_home_dir}")
            raise RuntimeError(
                f"PYTHONHOME directory not found at {python_home_dir}. Please ensure the correct ovms version is downloaded"
            )

        os.environ["PYTHONHOME"] = python_home_dir

        # Update PATH to include OVMS_DIR and PYTHONHOME
        current_path = os.environ.get("PATH", "")
        os.environ["PATH"] = f"{ovms_dir};{python_home_dir};{current_path}"

        # Check if ovms.exe exists in the OVMS_DIR
        ovms_executable = os.path.join(ovms_dir, "ovms.exe")
        if not os.path.exists(ovms_executable):
            print(f"Error: OVMS executable not found at {ovms_executable}")
            print(f"Available files in {ovms_dir}:")
            if os.path.exists(ovms_dir):
                for file in os.listdir(ovms_dir):
                    print(f"  - {file}")
            raise RuntimeError(f"OVMS executable not found at {ovms_executable}")
        return ovms_executable
    else:  # Linux/Unix
        env["LD_LIBRARY_PATH"] = os.path.join(ovms_dir, "lib")
        env["PATH"] = f"{os.path.join(ovms_dir, 'bin')}"
        env["PYTHONPATH"] = os.path.join(ovms_dir, "lib", "python")

        # Check if http/HTTP and https/HTTPS proxies are set in the environment
        for proxy_var in ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"]:
            if proxy_var in os.environ:
                env[proxy_var] = os.environ[proxy_var]
        return "ovms", env


def start_model_serving(
    port: int,
    model_dir: str,
    model_list: List[ModelConfig],
    background: bool = False,
):
    print("Setting environment for model serving ...")
    ovms, env = setup_ovms_environment()

    # Create/Replace config.json file in model_dir defining mediapipe_config_list
    config_file_path = os.path.join(model_dir, "config.json")
    mediapipe_config_list = []
    for model in model_list:
        model_id = model["model_id"]

        mediapipe_config = {
            "name": model_id,
            "base_path": model_id,
        }
        mediapipe_config_list.append(mediapipe_config)
    config_data = {
        "mediapipe_config_list": mediapipe_config_list,
        "model_config_list": [],
    }
    with open(config_file_path, "w") as config_file:
        json.dump(config_data, config_file, indent=4)
    print(f"Created/Updated config file at {config_file_path}")

    serving_command = [
        ovms,
        "--rest_port",
        str(port),
        "--config_path",
        config_file_path,
    ]

    print("Starting model serving...")
    print(f"Command: {serving_command}")
    try:
        if background:
            # Start the process in the background and return the process object
            process = subprocess.Popen(serving_command, env=env)

            # Check if process started successfully
            if process.poll() is not None:
                print(f"OVMS process failed to start (exit code: {process.returncode})")
                raise RuntimeError("OVMS process failed to start")

            print(f"OVMS process started with PID: {process.pid}")
            return process
        else:
            subprocess.run(serving_command, check=True, text=True, env=env)
    except subprocess.CalledProcessError as e:
        print(f"Model serving command failed with error: {e}")
        raise RuntimeError("Failed to start model serving")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        raise RuntimeError("Failed to start model serving")


def wait_for_model_ready(
    port: int, model_id: str, timeout: int = 60, check_interval: float = 1.0
):
    """
    Wait for the OVMS server to be ready by checking the model health endpoint.

    Args:
        port: The port the server is running on
        model_id: The model ID to check readiness for
        timeout: Maximum time to wait in seconds
        check_interval: Time between checks in seconds

    Returns:
        True if server is ready, False if timeout
    """
    start_time = time.time()

    print(f"Checking OVMS server readiness on port {port}")
    encoded_model_name = urllib.parse.quote(model_id, safe="")
    health_url = f"http://localhost:{port}/v2/models/{encoded_model_name}/ready"

    while time.time() - start_time < timeout:
        try:
            response = requests.get(health_url, timeout=5)
            print(f"Model health check for '{model_id}': {response.status_code}")
            if response.status_code == 200:
                print(f"OVMS server is ready with model: {model_id}")
                return True
            else:
                print(f"Response body: {response.text}")
        except requests.exceptions.RequestException as e:
            print(f"Model health check failed for '{model_id}': {e}")

        elapsed = time.time() - start_time
        print(f"Still waiting for model readiness... ({elapsed:.1f}s/{timeout}s)")
        time.sleep(check_interval)

    print(f"Timeout waiting for OVMS server to be ready on port {port}")
    return False


def parse_args():
    parser = argparse.ArgumentParser(description="Embedding Worker")
    parser.add_argument(
        "--port",
        type=int,
        default=5951,
        help="Port for the worker to listen on",
    )
    parser.add_argument(
        "--embedding-model-id",
        type=str,
        required=True,
        help="Path to the embedding model directory or Hugging Face model name",
    )
    parser.add_argument(
        "--embedding-device",
        type=str,
        default="CPU",
        help="Device to run the embedding model on (e.g., CPU, GPU, NPU)",
    )
    parser.add_argument(
        "--reranker-model-id",
        type=str,
        required=True,
        help="Path to the reranker model directory or Hugging Face model name",
    )
    parser.add_argument(
        "--reranker-device",
        type=str,
        default="CPU",
        help="Device to run the reranker model on (e.g., CPU, GPU, NPU)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    embedding_model_id = args.embedding_model_id
    embedding_device = str(args.embedding_device).upper()
    reranker_model_id = args.reranker_model_id
    reranker_device = str(args.reranker_device).upper()
    serving_port = args.port

    model_list: List[ModelConfig] = [
        {
            "model_id": embedding_model_id,
            "device": embedding_device,
            "task": "embeddings",
        },
        {"model_id": reranker_model_id, "device": reranker_device, "task": "rerank"},
    ]

    # Setup and start the server (blocking mode for CLI usage)
    model_dir = setup_ovms_server(model_list, serving_port)

    # Start serving (blocking) - use the first model in the list
    try:
        start_model_serving(
            port=serving_port,
            model_dir=model_dir,
            model_list=model_list,
            background=False,
        )
    except Exception as e:
        print(f"Error starting model serving: {e}")
        raise RuntimeError(f"Failed to start model serving: {e}")


# model_list type


def setup_ovms_server(model_list: List[ModelConfig], serving_port: int = 5951):
    """
    Setup and prepare the OVMS server without starting it (for use in FastAPI lifespan).

    Args:
        model_list: List of model configurations with keys: model_id, device, task
        device: Device to run on (CPU, GPU, NPU, etc.)
        serving_port: Port for the OVMS server

    Returns:
        config_path: Path to the model config file needed for starting the server
    """

    # Sanity check for port for int and is between 5000-6000
    if not (5000 <= serving_port <= 6000):
        raise ValueError(
            f"Invalid port: {serving_port}. Port must be an integer between 5000 and 6000."
        )

    # Sanity check for device value
    for model in model_list:
        device = model["device"]
        base_device = device.split(":")[0].split(".")[0].upper()
        if base_device not in ["CPU", "GPU", "NPU", "HETERO"]:
            raise ValueError(
                f"Invalid device type: {device}. Supported devices are CPU, GPU, NPU, HETERO."
            )

    # Set project root as two levels above this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))

    # Set cache directories inside project root
    model_cache_dir = os.path.join(project_root, "models", "huggingface")
    os.environ["HF_HOME"] = model_cache_dir
    app_cache_dir = os.path.join(project_root, "models", "ovms", "embedding")

    # Validate and sanitize the cache directories
    model_cache_dir = validate_and_sanitize_cache_dir(model_cache_dir)
    app_cache_dir = validate_and_sanitize_cache_dir(app_cache_dir)

    # Create the directories if they don't exist
    create_cache_directory(model_cache_dir)
    create_cache_directory(app_cache_dir)

    model_dir = app_cache_dir
    os.makedirs(model_dir, exist_ok=True)

    for model in model_list:
        model_id = model["model_id"]
        device = model["device"]
        task = model["task"]

        model_name = model_id.split("/")[-1]
        model_provider = model_id.split("/")[0] if "/" in model_id else "local"

        if model_provider == "OpenVINO":
            try:
                ovms, env = setup_ovms_environment()
                pull_command = [
                    ovms,
                    "--pull",
                    "--source_model",
                    model_id,
                    "--model_repository_path",
                    model_dir,
                    "--task",
                    task,
                    "--target_device",
                    device,
                ]
                subprocess.run(pull_command, check=True, text=True, env=env)
            except Exception as e:
                print(f"Error pulling OpenVINO model {model_id}: {e}")
                raise RuntimeError(f"Failed to pull OpenVINO model {model_id}")
        else:
            try:
                validated_model_id = validate_and_sanitize_model_id(model_id)
                download_model(validated_model_id, model_cache_dir)
            except Exception as e:
                print(f"Error downloading model {validated_model_id}: {e}")
                raise RuntimeError(f"Failed to download model {validated_model_id}")

            # Convert model
            try:
                prepare_model_env(
                    model_id=validated_model_id,
                    model_dir=model_dir,
                    task=task,
                    device=device,
                )
                model_dir = os.path.join(model_dir, model_provider, model_name)
            except Exception as e:
                print(f"Error preparing model environment: {e}")
                raise RuntimeError(f"Failed to prepare model environment: {e}")
        print(f"Model {model_id} is ready in {model_dir}")

    return app_cache_dir


def start_ovms_background(
    embedding_model_id: str,
    embedding_device: str,
    reranker_model_id: str,
    reranker_device: str,
    serving_port: int = 5951,
):
    """
    Start the OVMS server in the background (for use in FastAPI lifespan).

    Args:
        embedding_model_id: The Hugging Face model ID for embeddings
        embedding_device: Device to run embeddings on (CPU, GPU, NPU, etc.)
        reranker_model_id: The Hugging Face model ID for reranking
        reranker_device: Device to run reranker on (CPU, GPU, NPU, etc.)
        serving_port: Port for the OVMS server

    Returns:
        process: The subprocess.Popen object for the OVMS server
    """
    model_list: List[ModelConfig] = [
        {
            "model_id": embedding_model_id,
            "device": embedding_device,
            "task": "embeddings",
        },
        {"model_id": reranker_model_id, "device": reranker_device, "task": "rerank"},
    ]

    # Setup the server environment
    model_dir = setup_ovms_server(model_list, serving_port)

    # Start serving in background
    try:
        process = start_model_serving(
            port=serving_port,
            model_dir=model_dir,
            model_list=model_list,
            background=True,
        )
        return process
    except Exception as e:
        print(f"Error starting model serving: {e}")
        raise RuntimeError(f"Failed to start model serving: {e}")


if __name__ == "__main__":
    main()
