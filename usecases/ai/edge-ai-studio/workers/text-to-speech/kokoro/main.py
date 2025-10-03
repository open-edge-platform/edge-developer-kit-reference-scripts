# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import argparse
import subprocess #nosec -- used to run a script to download model
import sys
import uvicorn

ESPEAK_NG_VERSION = "1.52.0"


def is_windows():
    """
    Check if the current operating system is Windows.
    """
    return os.name == "nt"


def download_kokoro_model(kokoro_dir, model_dir):
    """
    Download the Kokoro TTS model using the provided script.
    """
    script_path = os.path.join(kokoro_dir, "docker", "scripts", "download_model.py")
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"Download script not found: {script_path}")
    try:
        if is_windows():
            os.environ["PYTHONUTF8"] = "1"

        model_path = os.path.join(model_dir, "v1_0")
        subprocess.run(
            [sys.executable, script_path, "--output", model_path], check=True
        )
    except subprocess.CalledProcessError as e:
        print(f"Model download failed: {e}")
        raise RuntimeError(f"Failed to download model to {model_dir}")


def start_kokoro_server(kokoro_dir, port, model_dir, voices_dir):
    """
    Start the Kokoro FastAPI server with the specified port.
    """
    os.environ["USE_ONNX"] = "false"
    os.environ["PYTHONPATH"] = f"{kokoro_dir}:{kokoro_dir}/api"
    os.environ["MODEL_DIR"] = model_dir
    os.environ["VOICES_DIR"] = voices_dir
    os.environ["WEB_PLAYER_PATH"] = os.path.join(kokoro_dir, "web")

    if is_windows():
        os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = os.path.join(
            kokoro_dir,
            os.path.pardir,
            f"espeak-ng-{ESPEAK_NG_VERSION}",
            "src",
            "libespeak-ng",
            "libespeak-ng.dll",
        )
    else:
        os.environ["PHONEMIZER_ESPEAK_PATH"] = "/usr/bin"
        os.environ["PHONEMIZER_ESPEAK_DATA"] = "/usr/share/espeak-ng-data"
        os.environ["ESPEAK_DATA_PATH"] = "/usr/share/espeak-ng-data"
        os.environ["PYTHONUNBUFFERED"] = "1"

    # Change working directory to kokoro_dir
    os.chdir(kokoro_dir)
    # Ensure kokoro_dir is in sys.path
    if kokoro_dir not in sys.path:
        sys.path.insert(0, kokoro_dir)

    app_module = (
        "api.src.main:app"
        if os.path.exists(os.path.join(kokoro_dir, "api", "src", "main.py"))
        else "api.main:app"
    )
    try:
        uvicorn.run(
            app_module,
            host="0.0.0.0",
            port=port,
            env_file=None,
            reload=False,
            factory=False,
            log_level="info",
        )
    except Exception as e:
        print(f"Kokoro FastAPI server failed: {e}")
        raise RuntimeError("Failed to start model serving")


def parse_args():
    parser = argparse.ArgumentParser(description="Kokoro TTS Worker")
    parser.add_argument("--port", type=int, default=5002, help="Port to serve on")
    parser.add_argument(
        "--device",
        type=str,
        default="CPU",
        help="Device to use (only CPU is available)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    script_dir = os.path.dirname(os.path.abspath(__file__))
    kokoro_dir = os.path.join(script_dir, "thirdparty", "Kokoro-FastAPI")
    model_dir = os.path.join(kokoro_dir, "api", "src", "models")
    voices_dir = os.path.join(kokoro_dir, "api", "src", "voices", "v1_0")

    if not os.path.exists(model_dir):
        os.makedirs(model_dir, exist_ok=True)
    if not os.path.exists(voices_dir):
        os.makedirs(voices_dir, exist_ok=True)

    print(f"Downloading Kokoro TTS model to {model_dir} ...")
    download_kokoro_model(kokoro_dir, model_dir)

    print(f"Starting Kokoro FastAPI server on port {args.port} using device CPU ...")
    start_kokoro_server(kokoro_dir, args.port, model_dir, voices_dir)


if __name__ == "__main__":
    main()
