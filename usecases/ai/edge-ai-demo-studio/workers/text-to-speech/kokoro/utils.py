# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
from pathlib import Path
import string

MAX_PATH_LENGTH = 4096


def create_cache_directory(cache_dir: str) -> None:
    """
    Create the cache directory with secure permissions if it doesn't exist.

    Args:
        cache_dir: The validated cache directory path to create

    Raises:
        ValueError: If directory creation fails
    """
    if not os.path.exists(cache_dir):
        try:
            # Create directory with user-only permissions (700)
            os.makedirs(cache_dir, mode=0o700, exist_ok=True)
        except OSError as e:
            raise ValueError(f"Failed to create model cache directory: {e}")


def validate_and_sanitize_cache_dir(cache_dir: str) -> str:
    """
    Validate and sanitize a cache directory path to prevent path manipulation attacks.

    Args:
        cache_dir: The cache directory path to validate

    Returns:
        str: The validated and normalized cache directory path

    Raises:
        ValueError: If the path is invalid or poses security risks
    """
    # Basic validation
    if not cache_dir or not isinstance(cache_dir, str):
        raise ValueError("Invalid model cache directory: must be a valid string path")

    # Convert to absolute path and resolve any symbolic links/relative paths
    try:
        # Expand user directory (~) and resolve relative paths
        cache_dir = os.path.expanduser(cache_dir)
        cache_dir = os.path.abspath(cache_dir)

        # Use pathlib for additional validation
        cache_path = Path(cache_dir).resolve()
        cache_dir = str(cache_path)
    except (OSError, ValueError) as e:
        raise ValueError(f"Invalid model cache directory path: {e}")

    # Security check: ensure the path doesn't contain dangerous patterns
    # Check for directory traversal attempts
    if ".." in cache_dir:
        raise ValueError(
            "Model cache directory cannot contain '..' (directory traversal)"
        )

    # Define allowed base directories for cache
    allowed_base_dirs = [
        os.path.expanduser("~"),  # User home directory
        "/tmp",  # Temporary directory
        "/var/cache",  # System cache directory
        "/opt",  # Optional software directory
    ]

    # Check if the resolved path is within allowed directories
    path_is_allowed = False
    for allowed_base in allowed_base_dirs:
        try:
            allowed_resolved = Path(allowed_base).resolve()
            try:
                if Path(cache_dir).resolve().is_relative_to(allowed_resolved):
                    path_is_allowed = True
                    break
            except AttributeError:  # Fallback for Python < 3.9
                if str(allowed_resolved) in str(Path(cache_dir).resolve()):
                    if (
                        Path(cache_dir).resolve().parts[: len(allowed_resolved.parts)]
                        == allowed_resolved.parts
                    ):
                        path_is_allowed = True
                        break
        except (OSError, ValueError):
            continue

    if not path_is_allowed:
        raise ValueError(
            f"Model cache directory must be within allowed locations: {allowed_base_dirs}. "
            f"Attempted path: {cache_dir}"
        )

    # Additional security checks for sensitive system directories
    sensitive_paths = [
        "/etc",
        "/usr",
        "/bin",
        "/sbin",
        "/boot",
        "/sys",
        "/proc",
        "/dev",
        "/root",
    ]
    if any(cache_dir.startswith(sensitive) for sensitive in sensitive_paths):
        raise ValueError(
            f"Invalid model cache directory: {cache_dir} points to a sensitive system directory"
        )

    # Ensure the directory name is reasonable (not too long, valid characters)
    if len(cache_dir) > MAX_PATH_LENGTH:  # Increased from 255 to accommodate full paths
        raise ValueError("Model cache directory path is too long (>4096 characters)")

    # Check for valid characters (avoid control characters and potentially dangerous chars)
    # Include platform-specific path separators and Windows drive letter colon
    valid_chars = string.ascii_letters + string.digits + "/-._~" + os.sep
    if os.name == "nt":  # Add ':' for Windows drive letters
        valid_chars += ":"
    if not all(c in valid_chars for c in cache_dir):
        raise ValueError("Model cache directory contains invalid characters")

    return cache_dir
