# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Piper voice downloads (Hugging Face or ModelScope), flattened into ``model_dir``.

A code like ``vi_VN-vais1000-medium`` is ``<lang_family>/<lang_code>/<voice_name>/<voice_quality>/
<code>.onnx`` (+ ``.onnx.json``) in ``rhasspy/piper-voices``; main.py loads ``<model_dir>/<code>.onnx``.
"""

import os
import re
import shutil
import logging
from typing import Tuple

from model_downloader import fetch_snapshot
from worker_common import shared_model_lock, staged_model_file

logger = logging.getLogger(__name__)

PIPER_VOICES_REPO = "rhasspy/piper-voices"

# lang_family before the first '_', region after it; voice_name is greedy so
# names containing '_' (e.g. "25hours_single") are kept intact, quality last.
_VOICE_PATTERN = re.compile(
    r"^(?P<lang_family>[^_]+)_(?P<lang_region>[^-]+)-(?P<voice_name>.+)-(?P<voice_quality>[^-]+)$"
)


def parse_voice(voice: str) -> dict:
    """Parse a Piper voice code into its components."""
    voice = voice.strip()
    match = _VOICE_PATTERN.match(voice)
    if not match:
        raise ValueError(
            f"Voice '{voice}' did not match pattern "
            "<language>-<name>-<quality> like 'vi_VN-vais1000-medium'"
        )
    lang_family = match.group("lang_family")
    lang_code = f"{lang_family}_{match.group('lang_region')}"
    return {
        "voice_code": voice,
        "lang_family": lang_family,
        "lang_code": lang_code,
        "voice_name": match.group("voice_name"),
        "voice_quality": match.group("voice_quality"),
    }


def voice_rel_paths(voice: str) -> Tuple[str, str]:
    """Return (onnx_rel_path, json_rel_path) inside the piper-voices repo."""
    p = parse_voice(voice)
    base = (
        f"{p['lang_family']}/{p['lang_code']}/{p['voice_name']}/{p['voice_quality']}/"
        f"{p['voice_code']}"
    )
    return f"{base}.onnx", f"{base}.onnx.json"


def _flat_paths(voice: str, model_dir: str) -> Tuple[str, str]:
    return (
        os.path.join(model_dir, f"{voice}.onnx"),
        os.path.join(model_dir, f"{voice}.onnx.json"),
    )


def _download_voice(voice: str, model_dir: str, source: str) -> None:
    """Fetch the two voice files from the hub and flatten them into model_dir."""
    onnx_rel, json_rel = voice_rel_paths(voice)
    cache_dir = os.path.join(model_dir, f".{source}")
    snapshot_dir = fetch_snapshot(
        PIPER_VOICES_REPO,
        cache_dir,
        source=source,
        allow_patterns=[onnx_rel, json_rel],
        # ModelScope's mirror of rhasspy/piper-voices publishes on `master`.
        revision="master" if source == "modelscope" else None,
    )

    # The .json first: ensure_voice takes the pair as present once both are,
    # and each lands whole (staged), never as a copy still being written.
    model_path, config_path = _flat_paths(voice, model_dir)
    for rel, final in ((json_rel, config_path), (onnx_rel, model_path)):
        with staged_model_file(final) as staged:
            shutil.copyfile(os.path.join(snapshot_dir, rel), staged)


def ensure_voice(voice: str, model_dir: str, source: str = "huggingface") -> Tuple[str, str]:
    """Download the voice if missing; return (model_path, config_path) flat under ``model_dir``."""
    os.makedirs(model_dir, exist_ok=True)
    model_path, config_path = _flat_paths(voice, model_dir)

    if os.path.exists(model_path) and os.path.exists(config_path):
        return model_path, config_path

    # Another instance may be fetching the same voice right now.
    with shared_model_lock(model_path):
        if not (os.path.exists(model_path) and os.path.exists(config_path)):
            logger.info("Downloading Piper voice '%s' from %s...", voice, source)
            _download_voice(voice, model_dir, source)

    if not (os.path.exists(model_path) and os.path.exists(config_path)):
        raise FileNotFoundError(
            f"Voice '{voice}' was not downloaded to expected paths: "
            f"{model_path}, {config_path}"
        )
    return model_path, config_path
