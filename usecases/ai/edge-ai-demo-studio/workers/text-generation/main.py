# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import argparse
import subprocess  # nosec -- used to run optimum cli to convert model
import signal
import sys
import atexit
import time
import threading
from huggingface_hub import snapshot_download
from utils.export_model import export_text_generation_model
from utils.util import (
    validate_and_sanitize_cache_dir,
    create_cache_directory,
    validate_and_sanitize_model_id,
)

os.environ["TOKENIZERS_PARALLELISM"] = "false"

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


def signal_handler(signum, frame):
    """
    Signal handler for graceful shutdown.
    """
    print(f"Received signal {signum}, initiating shutdown...")

    # Avoid recursive signal handling
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)

    cleanup_ovms_process()

    # Give a moment for cleanup to complete
    time.sleep(1)

    print("Shutdown complete.")
    os._exit(0)  # Use os._exit to avoid potential atexit issues


def download_model(model_id: str):
    """
    Download the model from Hugging Face Hub if it is not already present.
    """
    try:
        print(f"Downloading model: {model_id}...")
        path = snapshot_download(repo_id=model_id)
        return path
    except Exception as e:
        print(f"Error downloading {model_id}: {e}")
        raise RuntimeError(f"Failed to download model {model_id}")


def prepare_model_env(
    model_id: str, model_dir: str, device: str = "CPU", precision: str = "int4"
):
    print(f"Preparing model environment for {model_id} ...")
    validated_model_id = validate_and_sanitize_model_id(model_id)
    config_file_path = os.path.join(model_dir, "config.json")

    if not os.path.exists(model_dir):
        os.makedirs(model_dir, exist_ok=True)

    try:
        task_parameters = {
            "target_device": device,
            "pipeline_type": "LM",
            "kv_cache_precision": None,
            "extra_quantization_params": None,
            "enable_prefix_caching": True,
            "dynamic_split_fuse": True,
            "max_num_batched_tokens": None,
            "max_num_seqs": "256",
            "cache_size": 10,
            "draft_source_model": None,
            "draft_model_name": None,
            "max_prompt_len": None,
            "ov_cache_dir": None,
            "prompt_lookup_decoding": None,
        }
        export_text_generation_model(
            source_model=validated_model_id,
            model_name=model_id,
            model_repository_path=model_dir,
            precision=precision,
            task_parameters=task_parameters,
            config_file_path=config_file_path,
        )
        print(f"Model exported successfully to {model_dir}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        raise RuntimeError(f"Failed to prepare model environment for {model_dir}")


def setup_ovms_environment():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    ovms_dir = os.path.join(os.path.dirname(script_dir), "thirdparty", "ovms")
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
        env = os.environ.copy()
        return ovms_executable, env
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
    port: int, model_path: str, model_id: str, model_provider: str, device: str
):
    global ovms_process

    print("Setting environment for model serving ...")
    ovms, env = setup_ovms_environment()

    if model_provider == "OpenVINO":
        serving_command = [
            ovms,
            "--rest_port",
            str(port),
            "--source_model",
            model_id,
            "--model_repository_path",
            model_path,
            "--task",
            "text_generation",
            "--target_device",
            device,
            "--cache_size",
            "2",
        ]
    else:
        serving_command = [
            ovms,
            "--rest_port",
            str(port),
            "--model_path",
            model_path,
            "--model_name",
            model_id,
        ]

    print("Starting model serving...")
    print(f"Command: {serving_command}")

    try:
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
        if ovms_process and ovms_process.poll() is None:
            cleanup_ovms_process()


def parse_args():
    parser = argparse.ArgumentParser(description="Text Generation Worker")
    parser.add_argument(
        "--model-id",
        type=str,
        required=True,
        help="Path to the model directory or Hugging Face model name",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5950,
        help="Port for the worker to listen on",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="CPU",
        help="Device to run the model on (e.g., CPU, GPU, NPU)",
    )
    return parser.parse_args()


def main():
    try:
        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, signal_handler)  # Ctrl+C
        signal.signal(signal.SIGTERM, signal_handler)  # Termination signal

        # Register atexit handler but use a simpler version to avoid issues
        atexit.register(lambda: cleanup_ovms_process() if ovms_process else None)

        args = parse_args()
        model_id = args.model_id
        model_provider = model_id.split("/")[0] if "/" in model_id else "local"
        model_name = model_id.split("/")[-1]
        device = str(args.device).upper()
        serving_port = args.port

        # Sanity check for port for int and is between 5000-6000
        if not (5000 <= serving_port <= 6000):
            raise ValueError(
                f"Invalid port: {serving_port}. Port must be an integer between 5000 and 6000."
            )

        # Sanity check for device value
        base_device = device.split(":")[0].split(".")[0].upper()
        if base_device not in ["CPU", "GPU", "NPU", "HETERO"]:
            raise ValueError(
                f"Invalid device type: {device}. Supported devices are CPU, GPU, NPU, HETERO."
            )

        # Set project root as two levels above this script
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))

        # Set cache directories inside project root
        app_cache_dir = os.path.join(project_root, "models", "ovms")

        # Validate and sanitize the cache directories
        app_cache_dir = validate_and_sanitize_cache_dir(app_cache_dir)

        # Create the directories if they don't exist
        create_cache_directory(app_cache_dir)

        model_dir = app_cache_dir
        os.makedirs(model_dir, exist_ok=True)

        if not model_provider == "OpenVINO":
            try:
                validated_model_id = validate_and_sanitize_model_id(model_id)
                download_model(validated_model_id)
            except Exception as e:
                print(f"Error downloading model {validated_model_id}: {e}")
                raise RuntimeError(f"Failed to download model {validated_model_id}")

            # Convert model
            try:
                prepare_model_env(
                    model_id=validated_model_id, model_dir=model_dir, device=device
                )
                model_dir = os.path.join(model_dir, model_provider, model_name)
            except Exception as e:
                print(f"Error preparing model environment: {e}")
                raise RuntimeError(f"Failed to prepare model environment: {e}")

        try:
            start_model_serving(
                port=serving_port,
                model_path=model_dir,
                model_id=model_id,
                model_provider=model_provider,
                device=device,
            )
        except Exception as e:
            print(f"Error starting model serving: {e}")
            raise RuntimeError(f"Failed to start model serving: {e}")

    except Exception as e:
        print(f"Fatal error in main: {e}")
        cleanup_ovms_process()
        sys.exit(1)
    except KeyboardInterrupt:
        print("Received keyboard interrupt in main, shutting down...")
        cleanup_ovms_process()
        sys.exit(0)


if __name__ == "__main__":
    main()
