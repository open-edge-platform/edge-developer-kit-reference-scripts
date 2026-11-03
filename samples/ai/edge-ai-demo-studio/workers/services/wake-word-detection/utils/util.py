# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
from pathlib import Path
import string

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
