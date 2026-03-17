# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import re
import argparse
import subprocess  # nosec -- used to spawn ovms in a secured environment
import sys
import time
import threading
from huggingface_hub import snapshot_download
from modelscope import snapshot_download as ms_snapshot_download
from utils.util import (
    validate_and_sanitize_cache_dir,
    create_cache_directory,
    validate_and_sanitize_model_id,
)
import requests
import urllib.parse
import subprocess  # nosec -- used as a catch exception type only

# Global variable to track the OVMS subprocess for cleanup
ovms_process = None
cleanup_in_progress = threading.Lock()


def cleanup_ovms_process():
    """
    Cleanup function to gracefully terminate the OVMS subprocess.
    """
    global ovms_process

    # Prevent multiple cleanup attempts
    if not cleanup_in_progress.acquire(blocking=False):
        return

    try:
        if ovms_process is not None and ovms_process.poll() is None:
            print("Shutting down OVMS subprocess...")
            try:
                # Send SIGTERM first for graceful shutdown
                if hasattr(ovms_process, "terminate"):
                    ovms_process.terminate()
                    print("Sent SIGTERM to OVMS process...")

                # Wait for up to 10 seconds for graceful shutdown
                try:
                    ovms_process.wait(timeout=10)
                    print("OVMS process terminated gracefully.")
                except subprocess.TimeoutExpired:
                    # If graceful termination fails, send SIGKILL
                    print(
                        "OVMS process didn't terminate gracefully, sending SIGKILL..."
                    )
                    if hasattr(ovms_process, "kill"):
                        ovms_process.kill()
                        # Wait a bit more for the kill to take effect
                        ovms_process.wait(timeout=5)
                    print("OVMS process force killed.")

            except subprocess.TimeoutExpired:
                print(
                    "OVMS process didn't respond to SIGKILL, may be in unrecoverable state"
                )
            except Exception as e:
                print(f"Error during OVMS cleanup: {e}")
            finally:
                ovms_process = None
    finally:
        cleanup_in_progress.release()


def download_model(model_id: str, model_dir: str, source: str = "huggingface") -> str:
    """
    Download the model from Hugging Face Hub if it is not already present.
    """
    try:
        print(f"Downloading model: {model_id}...")
        if source == "modelscope":
            path = ms_snapshot_download(repo_id=model_id, local_dir=model_dir)
        else:
            path = snapshot_download(repo_id=model_id, local_dir=model_dir)
        return os.path.join(path, model_id)
    except Exception as e:
        print(f"Error downloading {model_id}: {e}")
        raise RuntimeError(f"Failed to download model {model_id}")


def export_model(model_path: str, model_dir: str, params: str = None):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    python_source = (
        os.path.join(".venv", "bin", "python3")
        if os.name != "nt"
        else os.path.join(".venv", "Scripts", "python.exe")
    )
    command = [
        os.path.join(script_dir, python_source),
        "thirdparty/export_model.py",
        "image_generation",
        "--source_model",
        model_path,
        "--model_repository_path",
        model_dir,
    ]
    if params:
        command.extend(params.split())
    command.extend(
        [
            "--extra_quantization_params",
            "--library diffusers",
        ]
    )

    print("-" * 50)
    print(command)

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
        env=os.environ.copy(),
    )
    for line in process.stdout:
        print(line, end="")
    process.wait()
    if process.returncode != 0:
        raise RuntimeError(f"Model export failed with exit code {process.returncode}")


def prepare_model_env(
    model_path: str, model_dir: str, device: str = "CPU", precision: str = "int4"
):
    print(f"Preparing model environment for {model_path} ...")
    if not os.path.exists(model_path):
        os.makedirs(model_path, exist_ok=True)

    try:
        task_parameters = ""
        if "." in device:
            device = device.split(".")[0]
        if device == "NPU":
            device = "NPU NPU NPU"
            task_parameters += " --resolution 512x512"
        task_parameters += f" --target_device {device}"
        export_model(model_path, model_dir, task_parameters)
        print(f"Model exported successfully to {model_path}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        raise RuntimeError(f"Failed to prepare model environment for {model_path}")


def setup_ovms_environment():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    image_gen_dir = os.path.dirname(script_dir)
    ovms_dir = os.path.join(os.path.dirname(image_gen_dir), "thirdparty", "ovms")
    env = {}
    env["HF_TOKEN"] = os.environ.get("HF_TOKEN", "")
    env["HF_ENDPOINT"] = os.environ.get("HF_ENDPOINT", "")

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
        return ovms_executable, None
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
    model_path: str,
    model_id: str,
    device: str,
    background: bool = False,
):
    global ovms_process

    print("Setting environment for model serving ...")
    ovms, env = setup_ovms_environment()

    serving_command = [
        ovms,
        "--rest_port",
        str(port),
        "--source_model",
        model_id,
        "--model_repository_path",
        model_path,
        "--task",
        "image_generation",
        "--target_device",
        device,
    ]

    # Add NPU-specific parameters if using NPU or mixed devices
    if "NPU" in device.upper():
        serving_command.extend(["--resolution", "512x512"])

    print("Starting model serving...")
    print(f"Command: {serving_command}")

    try:
        if background:
            # Start the process in the background and return the process object
            ovms_process = subprocess.Popen(
                serving_command,
                text=True,
                env=env,
                preexec_fn=(
                    os.setsid if hasattr(os, "setsid") else None
                ),  # Create new process group
                stdout=subprocess.DEVNULL,  # Suppress output in background mode
                stderr=subprocess.DEVNULL,  # Suppress output in background mode
                stdin=subprocess.DEVNULL,  # No input needed
            )

            # Check if process started successfully
            if ovms_process.poll() is not None:
                print(
                    f"OVMS process failed to start (exit code: {ovms_process.returncode})"
                )
                raise RuntimeError("OVMS process failed to start")

            print(f"OVMS process started with PID: {ovms_process.pid}")
            return ovms_process
        else:
            # Use Popen with output piped to current session for real-time monitoring
            ovms_process = subprocess.Popen(
                serving_command,
                text=True,
                env=env,
                preexec_fn=(
                    os.setsid if hasattr(os, "setsid") else None
                ),  # Create new process group
                stdout=None,  # Inherit stdout from parent (shows in current session)
                stderr=None,  # Inherit stderr from parent (shows in current session)
                stdin=None,  # Inherit stdin from parent
            )
            print(f"OVMS process started with PID: {ovms_process.pid}")
            print("OVMS output will be displayed below (Ctrl+C to stop):")
            print("-" * 50)

            # Wait for the process to complete (this will block until the process is terminated)
            try:
                return_code = ovms_process.wait()
                print("-" * 50)
                print(f"OVMS process exited with code: {return_code}")

            except KeyboardInterrupt:
                print("\nReceived keyboard interrupt during process monitoring...")
                raise

    except subprocess.CalledProcessError as e:
        print(f"Model serving command failed with error: {e}")
        cleanup_ovms_process()
        raise RuntimeError("Failed to start model serving")
    except KeyboardInterrupt:
        print("Received keyboard interrupt, shutting down...")
        cleanup_ovms_process()
        sys.exit(0)
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        cleanup_ovms_process()
        raise RuntimeError("Failed to start model serving")
    finally:
        # Ensure cleanup happens even if something goes wrong
        if not background and ovms_process and ovms_process.poll() is None:
            cleanup_ovms_process()


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


def setup_ovms_server(
    model_id: str,
    device: str,
    precision: str,
    serving_port: int = 5006,
    source: str = "huggingface",
):
    """
    Setup and prepare the OVMS server without starting it (for use in FastAPI lifespan).

    Args:
        model_id: The image generation model ID
        device: Device to run on (CPU, GPU, NPU, etc.)
        precision: Model precision for quantization (fp32, fp16, int8, int4)
        serving_port: Port for the OVMS server

    Returns:
        tuple: (model_path, model_provider) needed for starting the server
    """
    # Sanity check for port for int and is between 5000-6000
    if not (5000 <= serving_port <= 6000):
        raise ValueError(
            f"Invalid port: {serving_port}. Port must be an integer between 5000 and 6000."
        )

    def is_valid_device(device: str) -> bool:
        base_device = device.split(":")[0].split(".")[0].upper()
        valid_devices = ["CPU", "GPU", "NPU", "HETERO"]
        if base_device not in valid_devices:
            return False
        return True

    # Sanity check for device value - support both single and mixed device configurations
    if " " in device:
        # Mixed device configuration (e.g., "NPU NPU GPU" for different pipeline stages)
        device_parts = device.split()
        for part in device_parts:
            if not is_valid_device(part):
                raise ValueError(
                    f"Invalid device type in mixed configuration: {part}. Supported devices are CPU, GPU, NPU, HETERO."
                )
    else:
        # Single device configuration
        if not is_valid_device(device):
            raise ValueError(
                f"Invalid device type: {device}. Supported devices are CPU, GPU, NPU, HETERO."
            )

    # Set project root as two levels above this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))

    # Set cache directories inside project root
    app_cache_dir = os.path.join(project_root, "models", "huggingface")
    model_cache_dir = os.path.join(project_root, "models", "ovms")

    # Validate and sanitize the cache directories
    app_cache_dir = validate_and_sanitize_cache_dir(app_cache_dir)
    model_cache_dir = validate_and_sanitize_cache_dir(model_cache_dir)

    # Create the directories if they don't exist
    create_cache_directory(app_cache_dir)
    create_cache_directory(model_cache_dir)

    model_dir = model_cache_dir

    model_provider = model_id.split("/")[0] if "/" in model_id else "local"
    model_name = model_id.split("/")[-1]

    try:
        validated_model_id = validate_and_sanitize_model_id(model_id)
        path = download_model(
            validated_model_id,
            os.path.join(
                app_cache_dir if not model_provider == "OpenVINO" else model_cache_dir,
                validated_model_id,
            ),
            source,
        )
    except Exception as e:
        print(f"Error downloading model {validated_model_id}: {e}")
        raise RuntimeError(f"Failed to download model {validated_model_id}")

    # Convert model
    if not model_provider == "OpenVINO":
        try:
            prepare_model_env(
                model_path=path,
                device=device,
                model_dir=model_dir,
                precision=precision,
            )
            model_dir = os.path.join(model_dir, model_provider, model_name)
        except Exception as e:
            print(f"Error preparing model environment: {e}")
            raise RuntimeError(f"Failed to prepare model environment: {e}")

    print(f"Model {model_id} is ready in {model_dir}")
    return model_dir


def start_ovms_background(
    model_id: str,
    device: str,
    precision: str,
    serving_port: int = 5006,
    source: str = "huggingface",
):
    """
    Start the OVMS server in the background (for use in FastAPI lifespan).

    Args:
        model_id: The image generation model ID
        device: Device to run on (CPU, GPU, NPU, etc.)
        precision: Model precision for quantization (fp32, fp16, int8, int4)
        serving_port: Port for the OVMS server

    Returns:
        process: The subprocess.Popen object for the OVMS server
    """
    # Setup the server environment
    model_path = setup_ovms_server(model_id, device, precision, serving_port, source)

    # Start serving in background
    try:
        process = start_model_serving(
            port=serving_port,
            model_path=model_path,
            model_id=model_id,
            device=device,
            background=True,
        )
        return process
    except Exception as e:
        print(f"Error starting model serving: {e}")
        raise RuntimeError(f"Failed to start model serving: {e}")


def parse_args():
    parser = argparse.ArgumentParser(description="Image Generation FastAPI Server")
    parser.add_argument(
        "--port",
        type=int,
        default=5007,
        help="Port for the FastAPI server to listen on",
    )
    parser.add_argument(
        "--model-id",
        type=str,
        required=True,
        help="Hugging Face image generation model name (e.g., OpenVINO/stable-diffusion-v1-5-int8-ov)",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="CPU",
        help="Device to run the model on (e.g., CPU, GPU, NPU) or mixed device configuration (e.g., 'NPU NPU GPU')",
    )
    parser.add_argument(
        "--precision",
        type=str,
        default="int8",
        choices=["fp32", "fp16", "int8", "int4"],
        help="Model precision for quantization (default: int8)",
    )
    return parser.parse_args()


def main():
    global CONFIG

    args = parse_args()
    model_id = args.model_id
    device = str(args.device).upper().strip()
    precision = args.precision
    port = args.port

    model_path = setup_ovms_server(
        model_id=model_id,
        device=device,
        precision=precision,
        serving_port=port,
    )

    try:
        start_model_serving(
            port=port,
            model_path=model_path,
            model_id=model_id,
            device=device,
            background=False,
        )
    except Exception as e:
        print(f"Error starting model serving: {e}")
        raise RuntimeError(f"Failed to start model serving: {e}")


if __name__ == "__main__":
    main()
