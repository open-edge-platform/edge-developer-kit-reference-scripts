# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
from pathlib import Path
import string
import re

MAX_PATH_LENGTH = 4096


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


def validate_and_sanitize_model_id(model_id: str) -> str:
    """
    Validate and sanitize a model ID to prevent path manipulation attacks.

    Args:
        model_id: The model ID to validate (can be a Hugging Face model name or local path)

    Returns:
        str: The validated model ID

    Raises:
        ValueError: If the model ID is invalid or poses security risks
    """
    # Basic validation
    if not model_id or not isinstance(model_id, str):
        raise ValueError("Invalid model ID: must be a valid string")

    # Trim whitespace
    model_id = model_id.strip()

    if not model_id:
        raise ValueError("Invalid model ID: cannot be empty")

    # Check length (reasonable limit)
    if len(model_id) > 256:
        raise ValueError("Model ID is too long (>256 characters)")

    # Security check: prevent directory traversal
    if ".." in model_id:
        raise ValueError("Model ID cannot contain '..' (directory traversal)")

    # Prevent absolute paths starting with /
    if model_id.startswith("/"):
        raise ValueError("Model ID cannot be an absolute path")

    # Prevent Windows-style paths
    if "\\" in model_id:
        raise ValueError("Model ID cannot contain backslashes")

    # For Hugging Face model names (org/model format), validate format
    if "/" in model_id:
        parts = model_id.split("/")
        if len(parts) != 2:
            raise ValueError("Model ID with '/' must be in 'organization/model' format")

        organization, model_name = parts

        # Validate organization name
        if not organization:
            raise ValueError("Organization name cannot be empty")
        # Organization names: alphanumeric, hyphens, underscores
        if not re.match(r"^[a-zA-Z0-9_-]+$", organization):
            raise ValueError(f"Invalid characters in organization name: {organization}")

        # Validate model name - more permissive for HF models
        if not model_name:
            raise ValueError("Model name cannot be empty")
        # Model names: alphanumeric, hyphens, underscores, dots (for versions like 2.5)
        if not re.match(r"^[a-zA-Z0-9._-]+$", model_name):
            raise ValueError(f"Invalid characters in model name: {model_name}")
    else:
        # For local model names, validate characters
        if not re.match(r"^[a-zA-Z0-9._-]+$", model_id):
            raise ValueError(f"Invalid characters in model ID: {model_id}")

    return model_id
