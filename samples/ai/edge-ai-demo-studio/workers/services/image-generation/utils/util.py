# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
from pathlib import Path
import string
import re

MAX_PATH_LENGTH = 4096


def get_sanitized_uv_path(raw_path_str: str) -> str:
    """Validate a uv path from an untrusted source (e.g. env vars), raising if it looks suspicious."""
    if not raw_path_str:
        raise ValueError("Path is empty.")

    # Absolute at once, to avoid relative-path ambiguity.
    try:
        path_obj = Path(raw_path_str).resolve()
    except Exception as e:
        raise ValueError(f"Invalid path format: {e}")

    # Strict filename allowlist: this is what breaks the taint for Coverity.
    allowed_names = {"uv", "uv.exe"}
    if path_obj.name.lower() not in allowed_names:
        raise ValueError(
            f"Security Check Failed: File must be named 'uv' or 'uv.exe', found '{path_obj.name}'"
        )

    clean_path = str(path_obj)
    if not re.match(r"^[a-zA-Z0-9_:/\.\\\s-]+$", clean_path):
        raise ValueError("Security Check Failed: Path contains illegal characters.")

    if not path_obj.is_file():
        raise FileNotFoundError(f"File does not exist: {clean_path}")

    if not os.access(path_obj, os.X_OK):
        raise PermissionError(f"File is not executable: {clean_path}")

    return clean_path


def validate_and_sanitize_cache_dir(cache_dir: str) -> str:
    """Validate and normalize a cache directory path against path manipulation (ValueError)."""
    if not cache_dir or not isinstance(cache_dir, str):
        raise ValueError("Invalid model cache directory: must be a valid string path")

    try:
        cache_dir = os.path.expanduser(cache_dir)
        cache_dir = os.path.abspath(cache_dir)

        cache_path = Path(cache_dir).resolve()
        cache_dir = str(cache_path)
    except (OSError, ValueError) as e:
        raise ValueError(f"Invalid model cache directory path: {e}")

    if ".." in cache_dir:
        raise ValueError(
            "Model cache directory cannot contain '..' (directory traversal)"
        )

    if len(cache_dir) > MAX_PATH_LENGTH:
        raise ValueError("Model cache directory path is too long (>4096 characters)")

    valid_chars = string.ascii_letters + string.digits + "/-._~ " + os.sep
    if os.name == "nt":  # Add ':' for Windows drive letters
        valid_chars += ":"
    if not all(c in valid_chars for c in cache_dir):
        raise ValueError("Model cache directory contains invalid characters")

    return cache_dir


def create_cache_directory(cache_dir: str) -> None:
    """Create the cache directory, user-only (700), if it doesn't exist; ValueError on failure."""
    if not os.path.exists(cache_dir):
        try:
            os.makedirs(cache_dir, mode=0o700, exist_ok=True)
        except OSError as e:
            raise ValueError(f"Failed to create model cache directory: {e}")


def validate_and_sanitize_model_id(model_id: str) -> str:
    """Validate a model id (Hugging Face ``org/name`` or a local name) against path manipulation."""
    if not model_id or not isinstance(model_id, str):
        raise ValueError("Invalid model ID: must be a valid string")

    model_id = model_id.strip()

    if not model_id:
        raise ValueError("Invalid model ID: cannot be empty")

    if len(model_id) > 256:
        raise ValueError("Model ID is too long (>256 characters)")

    if ".." in model_id:
        raise ValueError("Model ID cannot contain '..' (directory traversal)")

    if model_id.startswith("/"):
        raise ValueError("Model ID cannot be an absolute path")

    if "\\" in model_id:
        raise ValueError("Model ID cannot contain backslashes")

    if "/" in model_id:
        parts = model_id.split("/")
        if len(parts) != 2:
            raise ValueError("Model ID with '/' must be in 'organization/model' format")

        organization, model_name = parts

        if not organization:
            raise ValueError("Organization name cannot be empty")
        if not re.match(r"^[a-zA-Z0-9_-]+$", organization):
            raise ValueError(f"Invalid characters in organization name: {organization}")

        if not model_name:
            raise ValueError("Model name cannot be empty")
        # Dots allowed for versions like 2.5.
        if not re.match(r"^[a-zA-Z0-9._-]+$", model_name):
            raise ValueError(f"Invalid characters in model name: {model_name}")
    else:
        if not re.match(r"^[a-zA-Z0-9._-]+$", model_id):
            raise ValueError(f"Invalid characters in model ID: {model_id}")

    return model_id
