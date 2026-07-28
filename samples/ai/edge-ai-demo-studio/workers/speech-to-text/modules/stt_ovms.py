# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import glob
import os
import subprocess  # nosec -- used to spawn ovms in a secured environment
import sys
import threading
import time

import requests
import urllib.parse

# Global variable to track the OVMS subprocess for cleanup
ovms_process = None
cleanup_in_progress = threading.Lock()


def cleanup_ovms_process():
    """Cleanup function to gracefully terminate the OVMS subprocess."""
    global ovms_process

    if not cleanup_in_progress.acquire(blocking=False):
        return

    try:
        if ovms_process is not None and ovms_process.poll() is None:
            print("Shutting down OVMS subprocess...")
            try:
                if hasattr(ovms_process, "terminate"):
                    ovms_process.terminate()
                    print("Sent SIGTERM to OVMS process...")

                try:
                    ovms_process.wait(timeout=10)
                    print("OVMS process terminated gracefully.")
                except subprocess.TimeoutExpired:
                    print("OVMS process didn't terminate gracefully, sending SIGKILL...")
                    if hasattr(ovms_process, "kill"):
                        ovms_process.kill()
                        ovms_process.wait(timeout=5)
                    print("OVMS process force killed.")

            except subprocess.TimeoutExpired:
                print("OVMS process didn't respond to SIGKILL, may be in unrecoverable state")
            except Exception as e:
                print(f"Error during OVMS cleanup: {e}")
            finally:
                ovms_process = None
    finally:
        cleanup_in_progress.release()


def _get_ovms_paths():
    """
    Get OVMS and optimum venv paths for the speech-to-text worker.
    OVMS binary: workers/thirdparty/ovms
    Optimum venv: workers/speech-to-text/thirdparty/.venv
    """
    utils_dir = os.path.dirname(os.path.abspath(__file__))
    worker_dir = os.path.dirname(utils_dir)   # workers/speech-to-text/
    workers_dir = os.path.dirname(worker_dir)  # workers/
    ovms_dir = os.path.join(workers_dir, "thirdparty", "ovms")
    optimum_venv_path = os.path.join(worker_dir, "thirdparty", ".venv")
    return ovms_dir, optimum_venv_path


def _get_export_script_paths():
    """Get paths to export_model.py and its venv Python."""
    utils_dir = os.path.dirname(os.path.abspath(__file__))
    worker_dir = os.path.dirname(utils_dir)   # workers/speech-to-text/
    thirdparty_dir = os.path.join(worker_dir, "thirdparty")
    if os.name == "nt":
        venv_bin = os.path.join(thirdparty_dir, ".venv", "Scripts")
    else:
        venv_bin = os.path.join(thirdparty_dir, ".venv", "bin")
    export_script = os.path.join(thirdparty_dir, "export_model.py")
    return venv_bin, export_script


def _is_preconverted_ov_model(model_id: str) -> bool:
    """Return True for models already in OpenVINO IR format.

    Heuristic: the id starts with 'OpenVINO/' or ends with '-ov'. These repos
    ship .xml/.bin weights and are served via OVMS pull mode instead of
    optimum-cli export.
    """
    return model_id.startswith("OpenVINO/") or model_id.endswith("-ov")


def export_speech2text_model(
    model_id: str,
    model_repository_path: str,
    model_name: str,
    target_device: str = "CPU",
    precision: str = "fp32",
    source: str = "huggingface",
    enable_word_timestamps: bool = True,
) -> str:
    """
    Export a STT model for OVMS speech2text serving using export_model.py.
    Skips the export if the model directory already exists.

    Args:
        model_id: HuggingFace or ModelScope model ID (e.g. openai/whisper-tiny).
        model_repository_path: Root directory for the model repository.
        model_name: Model name registered in OVMS (typically same as model_id).
        target_device: Inference device for the exported model (default: CPU).
        precision: Weight format — fp32, fp16, int8, or int4 (default: fp32).
        source: 'huggingface' or 'modelscope'.
        enable_word_timestamps: Export with word-level timestamp support.
    """
    # model_name may contain "/" (e.g. openai/whisper-tiny) — split for os.path.join
    model_name_parts = model_name.split("/") if "/" in model_name else [model_name]
    model_dir = os.path.join(model_repository_path, *model_name_parts)

    if os.path.isdir(model_dir):
        print(f"Model already exists at {model_dir}. Skipping export.")
        return

    os.makedirs(model_repository_path, exist_ok=True)

    venv_bin, export_script = _get_export_script_paths()
    python_exe = os.path.join(venv_bin, "python.exe" if os.name == "nt" else "python")

    if not os.path.exists(python_exe):
        raise RuntimeError(
            f"Optimum venv Python not found at {python_exe}. "
            "Please run start.sh (or start.ps1) first to set up the venv."
        )
    if not os.path.exists(export_script):
        raise RuntimeError(
            f"export_model.py not found at {export_script}. "
            "Please run start.sh (or start.ps1) first."
        )

    env = os.environ.copy()
    # export_model.py shells out to `optimum-cli`, which lives in the optimum
    # venv's bin/Scripts dir — prepend it to PATH so the subprocess finds it.
    env["PATH"] = venv_bin + os.pathsep + env.get("PATH", "")
    env["VIRTUAL_ENV"] = os.path.dirname(venv_bin)
    if source == "modelscope":
        env["HF_ENDPOINT"] = "https://www.modelscope.cn/models"

    command = [
        python_exe,
        export_script,
        "speech2text",
        "--source_model",
        model_id,
        "--weight-format",
        precision,
        "--model_name",
        model_name,
        "--target_device",
        target_device,
        "--model_repository_path",
        model_repository_path,
    ]
    if enable_word_timestamps:
        command.append("--enable_word_timestamps")

    print(f"Exporting speech2text model: {model_id}")
    print(f"Command: {' '.join(command)}")

    process = subprocess.Popen(  # nosec
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
        env=env,
    )
    for line in process.stdout:
        stripped = line.strip()
        if stripped:
            print(stripped)
    process.wait()

    if process.returncode != 0:
        raise RuntimeError(
            f"Model export failed with exit code {process.returncode}"
        )

    print(f"Model {model_id} exported successfully to {model_dir}")


def setup_ovms_environment():
    """
    Build the environment for running the OVMS binary (serving and `--pull`).

    Starts from os.environ.copy() so that proxy settings, HF_TOKEN, and any
    other shell variables already set by the user are preserved, then prepends
    the OVMS and optimum venv paths. This also ensures Git-LFS weights are fully
    fetched during pull. Mirrors the image-generation worker's setup.

    Returns:
        tuple: (ovms_executable path, env dict)
    """
    ovms_dir, optimum_venv_path = _get_ovms_paths()
    env = os.environ.copy()

    if os.name == "nt":  # Windows
        python_home_dir = os.path.join(ovms_dir, "python")
        optimum_venv_scripts = os.path.join(optimum_venv_path, "Scripts")
        env["OVMS_DIR"] = ovms_dir
        env["PYTHONHOME"] = python_home_dir
        current_path = env.get("PATH", "")
        env["PATH"] = f"{optimum_venv_scripts};{ovms_dir};{python_home_dir};{current_path}"
        ovms_executable = os.path.join(ovms_dir, "ovms.exe")
    else:  # Linux/Unix
        optimum_venv_bin = os.path.join(optimum_venv_path, "bin")
        optimum_site_packages_list = glob.glob(
            os.path.join(optimum_venv_path, "lib", "python*", "site-packages")
        )
        env["LD_LIBRARY_PATH"] = os.path.join(ovms_dir, "lib")
        current_path = env.get("PATH", "")
        env["PATH"] = f"{optimum_venv_bin}:{os.path.join(ovms_dir, 'bin')}:{current_path}"
        ovms_python_lib = os.path.join(ovms_dir, "lib", "python")
        if optimum_site_packages_list:
            env["PYTHONPATH"] = f"{optimum_site_packages_list[0]}:{ovms_python_lib}"
        else:
            env["PYTHONPATH"] = ovms_python_lib
        ovms_executable = os.path.join(ovms_dir, "bin", "ovms")

    if not os.path.exists(ovms_executable):
        raise RuntimeError(f"OVMS executable not found at {ovms_executable}")

    return ovms_executable, env


def pull_stt_model(
    model_id: str,
    model_repository_path: str,
    device: str = "CPU",
    source: str = "huggingface",
):
    """
    Download a pre-converted OpenVINO speech2text model via `ovms --pull`.

    Runs as a dedicated blocking step so all LFS weights are fully downloaded
    before OVMS serving starts, preventing incomplete `.lfswip` files.
    """
    ovms_executable, env = setup_ovms_environment()

    command_env = env.copy()
    if source == "modelscope":
        command_env["HF_ENDPOINT"] = "https://www.modelscope.cn/models"

    pull_device = device.split(".")[0] if "." in device else device

    command = [
        ovms_executable,
        "--pull",
        "--model_repository_path",
        model_repository_path,
        "--source_model",
        model_id,
        "--task",
        "speech2text",
        "--target_device",
        pull_device,
    ]

    print(f"Running ovms --pull: {' '.join(command)}")

    process = subprocess.Popen(  # nosec
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
        env=command_env,
    )
    for line in process.stdout:
        stripped_line = line.strip()
        if stripped_line:
            print(stripped_line)
    process.wait()

    if process.returncode != 0:
        raise RuntimeError(f"ovms --pull failed with exit code {process.returncode}")

    print(f"Model {model_id} pulled successfully to {model_repository_path}")


def start_model_serving(
    port: int,
    config_path: str | None = None,
    background: bool = True,
    *,
    source_model: str | None = None,
    model_name: str | None = None,
    model_repository_path: str | None = None,
    target_device: str = "CPU",
):
    """
    Start the OVMS speech2text server.

    Two modes:
    - Config mode (default): pass *config_path* pointing to a config.json
      produced by export_model.py (used for standard openai/whisper-* models).
    - Pull mode: pass *source_model*, *model_name*, *model_repository_path*,
      and *target_device*. OVMS downloads and serves pre-converted OpenVINO
      models directly (e.g. OpenVINO/whisper-base-int8-ov).

    Args:
        port: REST port for OVMS.
        config_path: Path to config.json (config mode).
        background: If True, run as a background daemon and return the Popen object.
        source_model: HuggingFace model id for pull mode.
        model_name: Model name registered in OVMS for pull mode.
        model_repository_path: Local directory where OVMS caches pulled models.
        target_device: Inference device for pull mode (default: CPU).

    Returns:
        subprocess.Popen object if background=True, otherwise None.
    """
    global ovms_process

    print("Setting up environment for OVMS model serving ...")
    ovms, env = setup_ovms_environment()

    if source_model:
        if not model_repository_path or not model_name:
            raise ValueError("Pull mode requires model_repository_path and model_name")
        
        serving_command = [
            ovms,
            "--rest_port", str(port),
            "--source_model", source_model,
            "--model_repository_path", model_repository_path,
            "--model_name", model_name,
            "--task", "speech2text",
            "--target_device", target_device,
        ]
    else:
        if not config_path:
            raise ValueError("Config mode requires config_path")
        
        serving_command = [
            ovms,
            "--rest_port", str(port),
            "--config_path", config_path,
        ]

    print("Starting OVMS speech2text server ...")
    print(f"Command: {serving_command}")

    try:
        if background:
            ovms_process = subprocess.Popen(  # nosec
                serving_command,
                text=True,
                env=env,
                preexec_fn=(os.setsid if hasattr(os, "setsid") else None),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
            )
            if ovms_process.poll() is not None:
                raise RuntimeError(
                    f"OVMS process failed to start (exit code: {ovms_process.returncode})"
                )
            print(f"OVMS process started with PID: {ovms_process.pid}")
            return ovms_process
        else:
            ovms_process = subprocess.Popen(  # nosec
                serving_command,
                text=True,
                env=env,
                preexec_fn=(os.setsid if hasattr(os, "setsid") else None),
            )
            print(f"OVMS process started with PID: {ovms_process.pid}")
            try:
                return_code = ovms_process.wait()
                print(f"OVMS process exited with code: {return_code}")
            except KeyboardInterrupt:
                print("\nReceived keyboard interrupt during process monitoring...")
                raise

    except subprocess.CalledProcessError as e:
        print(f"Model serving command failed: {e}")
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
        if not background and ovms_process and ovms_process.poll() is None:
            cleanup_ovms_process()


def start_stt_background(
    model_id: str,
    model_name: str,
    model_repository_path: str,
    precision: str,
    ovms_port: int,
    source: str = "huggingface",
    device: str = "CPU",
    enable_word_timestamps: bool = True,
):
    """
    Prepare and start OVMS in the background.

    For pre-converted OpenVINO models (id starts with 'OpenVINO/' or ends with
    '-ov') OVMS pull mode is used: the binary downloads the model directly from
    the OpenVINO HuggingFace organisation and generates the graph itself. No
    optimum-cli conversion step is needed.

    For standard models (e.g. openai/whisper-tiny) the existing optimum-cli
    export path is used.

    Args:
        model_id: HuggingFace or ModelScope model ID.
        model_name: Model name registered in OVMS (typically same as model_id).
        model_repository_path: Directory where OVMS stores model files.
        precision: Weight format for standard model export.
        ovms_port: Port for the OVMS REST server.
        source: Download source — 'huggingface' or 'modelscope'.
        enable_word_timestamps: Export with word-level timestamp support (standard path only).
        device: Inference device passed to OVMS (default: CPU).

    Returns:
        subprocess.Popen object for the OVMS server
    """
    # Prepare the model for serving (export or pull)
    if _is_preconverted_ov_model(model_id):
        pull_stt_model(
            model_id=model_id,
            model_repository_path=model_repository_path,
            device=device,
            source=source,
        )
    else:
        export_speech2text_model(
            model_id=model_id,
            model_repository_path=model_repository_path,
            model_name=model_name,
            target_device=device,
            precision=precision,
            source=source,
            enable_word_timestamps=enable_word_timestamps,
        )

    # Start the OVMS server in the background
    process = start_model_serving(
        port=ovms_port,
        background=True,
        source_model=model_id,
        model_name=model_name,
        model_repository_path=model_repository_path,
        target_device=device,
    )
    return process


def wait_for_model_ready(
    port: int,
    model_name: str,
    timeout: int = 180,
    check_interval: float = 2.0,
):
    """
    Poll the OVMS readiness endpoint until the model is ready or timeout.

    Args:
        port: OVMS REST port.
        model_name: Model name as registered in config.json.
        timeout: Maximum seconds to wait.
        check_interval: Seconds between readiness checks.

    Returns:
        True if the model is ready, False if timed out.
    """
    start_time = time.time()
    encoded_name = urllib.parse.quote(model_name, safe="")
    health_url = f"http://localhost:{port}/v2/models/{encoded_name}/ready"

    print(f"Checking OVMS readiness on port {port} for model '{model_name}'")

    while time.time() - start_time < timeout:
        try:
            response = requests.get(health_url, timeout=5)
            print(f"Model readiness check for '{model_name}': {response.status_code}")
            if response.status_code == 200:
                print(f"OVMS server is ready with model: {model_name}")
                return True
        except requests.exceptions.RequestException as e:
            print(f"Model readiness check failed: {e}")

        elapsed = time.time() - start_time
        print(f"Still waiting for model readiness... ({elapsed:.1f}s/{timeout}s)")
        time.sleep(check_interval)

    print(f"Timeout waiting for OVMS server on port {port}")
    return False
