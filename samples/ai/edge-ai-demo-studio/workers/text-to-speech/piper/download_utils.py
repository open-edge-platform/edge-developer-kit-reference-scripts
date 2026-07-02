# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Voice download helpers for Piper, supporting Hugging Face and ModelScope.

Piper voice codes look like ``vi_VN-vais1000-medium`` and map to two files in
the ``rhasspy/piper-voices`` repository, laid out as::

    <lang_family>/<lang_code>/<voice_name>/<voice_quality>/<lang_code>-<voice_name>-<voice_quality>.onnx
    ... .onnx.json

This module resolves that layout and downloads the two files into a flat
``model_dir`` so that ``main.py`` can load ``<model_dir>/<voice>.onnx`` directly.
"""

import os
import re
import shutil
import logging
from pathlib import Path
from typing import Tuple

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


def _download_huggingface(voice: str, model_dir: str) -> None:
    """Download via Piper's own downloader (flat layout in model_dir)."""
    from piper.download_voices import download_voice

    download_voice(voice, Path(model_dir))


def _download_modelscope(voice: str, model_dir: str) -> None:
    """Download the two voice files from ModelScope and flatten them."""
    from modelscope import snapshot_download

    onnx_rel, json_rel = voice_rel_paths(voice)
    cache_dir = os.path.join(model_dir, ".modelscope")
    snapshot_dir = snapshot_download(
        PIPER_VOICES_REPO,
        revision="master",
        allow_patterns=[onnx_rel, json_rel],
        local_dir=cache_dir,
    )

    model_path, config_path = _flat_paths(voice, model_dir)
    shutil.copyfile(os.path.join(snapshot_dir, onnx_rel), model_path)
    shutil.copyfile(os.path.join(snapshot_dir, json_rel), config_path)


def ensure_voice(voice: str, model_dir: str, source: str = "huggingface") -> Tuple[str, str]:
    """Ensure a voice is available locally; download it if missing.

    :return: (model_path, config_path) at a flat layout under ``model_dir``.
    """
    os.makedirs(model_dir, exist_ok=True)
    model_path, config_path = _flat_paths(voice, model_dir)

    if os.path.exists(model_path) and os.path.exists(config_path):
        return model_path, config_path

    logger.info("Downloading Piper voice '%s' from %s...", voice, source)
    if source == "modelscope":
        _download_modelscope(voice, model_dir)
    else:
        _download_huggingface(voice, model_dir)

    if not (os.path.exists(model_path) and os.path.exists(config_path)):
        raise FileNotFoundError(
            f"Voice '{voice}' was not downloaded to expected paths: "
            f"{model_path}, {config_path}"
        )
    return model_path, config_path
