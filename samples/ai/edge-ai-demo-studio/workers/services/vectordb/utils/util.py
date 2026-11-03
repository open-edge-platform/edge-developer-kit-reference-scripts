# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
from pathlib import Path
import string
import re

MAX_PATH_LENGTH = 4096


def validate_and_sanitize_cache_dir(cache_dir: str) -> str:
    """Return ``cache_dir`` resolved to an absolute path; ValueError if it looks like path manipulation."""
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
    """Create the cache directory with user-only (0o700) permissions if missing; ValueError on failure."""
    if not os.path.exists(cache_dir):
        try:
            os.makedirs(cache_dir, mode=0o700, exist_ok=True)
        except OSError as e:
            raise ValueError(f"Failed to create model cache directory: {e}")


def validate_and_sanitize_model_id(model_id: str) -> str:
    """Return ``model_id`` (``org/model`` or a bare name) stripped; ValueError if it could be a path."""
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
        if not re.match(r"^[a-zA-Z0-9._-]+$", model_name):
            raise ValueError(f"Invalid characters in model name: {model_name}")
    else:
        if not re.match(r"^[a-zA-Z0-9._-]+$", model_id):
            raise ValueError(f"Invalid characters in model ID: {model_id}")

    return model_id
