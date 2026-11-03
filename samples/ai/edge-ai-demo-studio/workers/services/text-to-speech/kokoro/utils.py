# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import glob
import os
from pathlib import Path
import string

MAX_PATH_LENGTH = 4096

ESPEAK_LIB_PATTERNS = (
    "/usr/lib/*/libespeak-ng.so.1",
    "/usr/lib/libespeak-ng.so.1",
    "/usr/lib64/libespeak-ng.so.1",
    "/usr/local/lib/libespeak-ng.so.1",
)
ESPEAK_DATA_PATTERNS = (
    "/usr/lib/*/espeak-ng-data",
    "/usr/share/espeak-ng-data",
    "/usr/local/share/espeak-ng-data",
)


def _first_existing(patterns) -> str | None:
    for pattern in patterns:
        for match in sorted(glob.glob(pattern)):
            if os.path.exists(match):
                return match
    return None


def configure_system_espeak() -> None:
    """Point phonemizer/misaki at the system espeak-ng, by absolute path so an unrelated
    libespeak-ng.so on LD_LIBRARY_PATH (e.g. OVMS's, with an unreadable data path) is not used."""
    from misaki.espeak import EspeakWrapper

    lib_path = _first_existing(ESPEAK_LIB_PATTERNS)
    data_path = _first_existing(ESPEAK_DATA_PATTERNS)

    EspeakWrapper.set_library(lib_path)
    EspeakWrapper.set_data_path(data_path)

    os.environ["PHONEMIZER_ESPEAK_PATH"] = "/usr/bin"
    if lib_path:
        os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = lib_path
    if data_path:
        os.environ["PHONEMIZER_ESPEAK_DATA"] = data_path
        os.environ["ESPEAK_DATA_PATH"] = data_path


def create_cache_directory(cache_dir: str) -> None:
    """Create the cache directory with user-only (0o700) permissions if missing; ValueError on failure."""
    if not os.path.exists(cache_dir):
        try:
            os.makedirs(cache_dir, mode=0o700, exist_ok=True)
        except OSError as e:
            raise ValueError(f"Failed to create model cache directory: {e}")


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
