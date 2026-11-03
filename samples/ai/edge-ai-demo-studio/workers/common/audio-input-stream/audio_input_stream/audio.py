# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""PCM <-> WAV container helpers."""

import io
import wave

import numpy as np

from audio_input_stream.config import SAMPLE_RATE


def pcm_to_wav_bytes(pcm: np.ndarray) -> bytes:
    """Wrap int16 PCM samples into an in-memory WAV container."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.astype(np.int16).tobytes())
    return buffer.getvalue()
