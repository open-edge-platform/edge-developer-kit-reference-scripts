# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Audio decoding for the pyannote pipeline."""

import io
import logging
import os
import tempfile

import numpy as np
import soundfile as sf
import torch
from worker_common import configure_pydub

logger = logging.getLogger("uvicorn.error")

MAX_AUDIO_SIZE = 100 * 1024 * 1024  # 100 MB


def _load_audio_via_pydub(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """Decode audio bytes using pydub (requires ffmpeg for WebM/Opus/etc.)."""
    from pydub import AudioSegment

    # Point pydub at the bundled ffmpeg/ffprobe before decoding.
    configure_pydub()

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
    """Decode audio to a mono float32 array at its own sample rate.

    soundfile handles WAV/FLAC/OGG; pydub+ffmpeg covers the rest, e.g. MediaRecorder's WebM/Opus.
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
