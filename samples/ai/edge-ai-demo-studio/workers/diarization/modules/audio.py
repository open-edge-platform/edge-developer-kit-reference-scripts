# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Audio decoding helpers and thirdparty binary discovery."""

import io
import logging
import os
import tempfile

import numpy as np
import soundfile as sf
import torch

logger = logging.getLogger("uvicorn.error")

# Reject uploads larger than this before attempting to decode/process them.
MAX_AUDIO_SIZE = 100 * 1024 * 1024  # 100 MB


def _project_root() -> str:
    """Return the repository root (two levels above this file's package)."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(script_dir, "..", "..", ".."))


def _find_thirdparty_binary(*names: str) -> str | None:
    """Return the first existing path among `names` under thirdparty/ffmpeg/bin."""
    bin_dir = os.path.join(_project_root(), "thirdparty", "ffmpeg", "bin")
    for name in names:
        path = os.path.join(bin_dir, name)
        if os.path.exists(path):
            return path
    return None


def get_local_ffmpeg_path() -> str | None:
    """Return the path to the bundled ffmpeg binary, or None if not found."""
    return _find_thirdparty_binary("ffmpeg.exe", "ffmpeg")


def get_local_ffprobe_path() -> str | None:
    """Return the path to the bundled ffprobe binary, or None if not found."""
    return _find_thirdparty_binary("ffprobe.exe", "ffprobe")


def _load_audio_via_pydub(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """Decode audio bytes using pydub (requires ffmpeg for WebM/Opus/etc.)."""
    from pydub import AudioSegment
    import pydub.utils

    local_ffmpeg = get_local_ffmpeg_path()
    local_ffprobe = get_local_ffprobe_path()

    if local_ffmpeg:
        AudioSegment.converter = local_ffmpeg
    if local_ffprobe:
        pydub.utils.get_prober_name = lambda: local_ffprobe

    # Write to a temp file so ffmpeg can seek it
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        audio = AudioSegment.from_file(tmp_path)
        wav_io = io.BytesIO()
        audio.export(wav_io, format="wav")
        wav_io.seek(0)
        return sf.read(wav_io, dtype="float32", always_2d=False)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def load_audio_to_array(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """Load audio bytes into a numpy float32 array at the original sample rate.

    Tries soundfile first (fast path for WAV/FLAC/OGG). Falls back to
    pydub+ffmpeg for formats soundfile does not support, such as the
    WebM/Opus streams produced by the browser MediaRecorder API.
    """
    try:
        data, sample_rate = sf.read(
            io.BytesIO(audio_bytes), dtype="float32", always_2d=False
        )
    except Exception:
        logger.warning(
            "soundfile could not decode audio — retrying with pydub/ffmpeg fallback"
        )
        data, sample_rate = _load_audio_via_pydub(audio_bytes)
    if data.ndim > 1:
        data = data.mean(axis=1)
    return data, sample_rate


def prepare_audio_input(audio_bytes: bytes) -> dict:
    """Decode raw audio bytes into the waveform dict expected by pyannote pipelines."""
    audio_array, sample_rate = load_audio_to_array(audio_bytes)
    waveform = torch.tensor(audio_array).unsqueeze(0)
    return {"waveform": waveform, "sample_rate": sample_rate}
