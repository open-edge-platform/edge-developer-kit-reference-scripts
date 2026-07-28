# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import os
import subprocess  # nosec -- used to run ffmpeg in secured environment
import wave

import ffmpeg
import numpy as np
import soundfile as sf
from pydub import AudioSegment

logger = logging.getLogger("uvicorn.error")


def get_local_ffmpeg_path():
    """Get the path to the locally installed ffmpeg in thirdparty folder."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workers_dir = os.path.dirname(script_dir)
    project_root = os.path.dirname(os.path.dirname(workers_dir))
    thirdparty_dir = os.path.join(project_root, "thirdparty")

    # Try Windows first
    ffmpeg_exe = os.path.join(thirdparty_dir, "ffmpeg", "bin", "ffmpeg.exe")
    if os.path.exists(ffmpeg_exe):
        return ffmpeg_exe

    # Try Linux/Mac
    ffmpeg_bin = os.path.join(thirdparty_dir, "ffmpeg", "bin", "ffmpeg")
    if os.path.exists(ffmpeg_bin):
        return ffmpeg_bin

    return None


def get_local_ffprobe_path():
    """Get the path to the locally installed ffprobe in thirdparty folder."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workers_dir = os.path.dirname(script_dir)
    project_root = os.path.dirname(os.path.dirname(workers_dir))
    thirdparty_dir = os.path.join(project_root, "thirdparty")

    for name in ("ffprobe.exe", "ffprobe"):
        path = os.path.join(thirdparty_dir, "ffmpeg", "bin", name)
        if os.path.exists(path):
            return path

    return None


def resample(audio: np.ndarray, src_sample_rate: int, dst_sample_rate: int) -> np.ndarray:
    # Downmix multi-channel to mono
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = audio.astype(np.float32)
    if src_sample_rate == dst_sample_rate:
        return audio
    try:
        from math import gcd
        from scipy.signal import resample_poly
        g = gcd(int(src_sample_rate), int(dst_sample_rate))
        return resample_poly(audio, int(dst_sample_rate) // g, int(src_sample_rate) // g).astype(np.float32)
    except Exception as e:
        logger.warning(f"scipy resample_poly failed: {e}; falling back to np.interp")
    duration = len(audio) / src_sample_rate
    x_old = np.linspace(0, duration, len(audio), dtype=np.float32)
    x_new = np.linspace(0, duration, int(duration * dst_sample_rate), dtype=np.float32)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def ensure_wav(in_path: str, out_wav: str) -> bool:
    """Convert arbitrary audio file to 16k mono 16-bit WAV.
    Tries soundfile first (fast path for WAV/FLAC/OGG/AIFF), then pydub with local ffmpeg,
    then ffmpeg directly. Returns True on success.
    """
    # Avoid in-place conversion: if paths overlap, rename the input first
    if os.path.abspath(in_path) == os.path.abspath(out_wav):
        new_in = in_path + ".orig"
        os.replace(
            in_path, new_in
        )  # os.replace is atomic and overwrites on all platforms (unlike os.rename on Windows)
        in_path = new_in

    # Fast path: soundfile can natively decode WAV/FLAC/OGG/AIFF without ffmpeg
    try:
        data, fs = sf.read(in_path, dtype="float32", always_2d=False)
        resampled = resample(data, fs, 16000)
        pcm = (np.clip(resampled, -1.0, 1.0) * 32767).astype(np.int16)
        with wave.open(out_wav, "wb") as wf:
            wf.setnchannels(1)
            wf.setframerate(16000)
            wf.setsampwidth(2)
            wf.writeframes(pcm.tobytes())
        logger.info(f"Converted {in_path} -> {out_wav} using soundfile+scipy")
        return True
    except Exception as e:
        logger.warning(f"soundfile fast path failed for {in_path}: {e}; trying pydub")

    # Point pydub at the bundled thirdparty ffmpeg before trying
    import pydub.utils as _pydub_utils
    local_ffmpeg_for_pydub = get_local_ffmpeg_path()
    local_ffprobe_for_pydub = get_local_ffprobe_path()
    if local_ffmpeg_for_pydub:
        AudioSegment.converter = local_ffmpeg_for_pydub
    if local_ffprobe_for_pydub:
        _pydub_utils.get_prober_name = lambda: local_ffprobe_for_pydub

    try:
        audio = AudioSegment.from_file(in_path)
        audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
        audio.export(out_wav, format="wav")
        logger.info(f"Converted {in_path} -> {out_wav} using pydub")
        return True
    except Exception as e:
        logger.warning(
            f"pydub failed to process {in_path}: {e}; trying ffmpeg-python fallback"
        )
    # Try ffmpeg-python if installed
    try:
        (
            ffmpeg.input(in_path)
            .output(out_wav, format="wav", acodec="pcm_s16le", ac=1, ar="16k")
            .run(overwrite_output=True, quiet=True)
        )
        # Verify the output file was actually created
        if os.path.exists(out_wav) and os.path.getsize(out_wav) > 0:
            logger.info(f"Converted {in_path} -> {out_wav} using ffmpeg-python")
            return True
        else:
            logger.warning(
                f"ffmpeg completed but output file {out_wav} was not created or is empty"
            )
            return False
    except Exception as e:
        logger.warning(
            f"ffmpeg-python failed to process {in_path}: {e}; trying local ffmpeg fallback"
        )

    # Try local ffmpeg from thirdparty folder
    local_ffmpeg = get_local_ffmpeg_path()
    if local_ffmpeg:
        try:
            subprocess.run(
                [
                    local_ffmpeg,
                    "-i",
                    in_path,
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-c:a",
                    "pcm_s16le",
                    "-y",
                    out_wav,
                ],
                check=True,
                capture_output=True,
            )

            if os.path.exists(out_wav) and os.path.getsize(out_wav) > 0:
                logger.info(f"Converted {in_path} -> {out_wav} using local ffmpeg")
                return True
            else:
                logger.warning(
                    f"Local ffmpeg completed but output file {out_wav} was not created or is empty"
                )
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            logger.warning(
                f"Local ffmpeg failed to process {in_path}: {e}; trying system ffmpeg fallback"
            )

    # Try system ffmpeg as last resort
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-i",
                in_path,
                "-ar",
                "16000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                "-y",
                out_wav,
            ],
            check=True,
            capture_output=True,
        )

        if os.path.exists(out_wav) and os.path.getsize(out_wav) > 0:
            logger.info(f"Converted {in_path} -> {out_wav} using system ffmpeg")
            return True
        else:
            logger.warning(
                f"System ffmpeg completed but output file {out_wav} was not created or is empty"
            )
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        logger.warning(f"System ffmpeg failed to process {in_path}: {e}")

    logger.error(
        "No available converter succeeded (pydub, ffmpeg-python, local ffmpeg, or system ffmpeg)."
    )
    return False


def wav_read(wav_name):
    with wave.open(wav_name, "rb") as wav:
        if wav.getsampwidth() != 2:
            raise RuntimeError(f"wav file {wav_name} does not have int16 format")
        freq = wav.getframerate()
        data = wav.readframes(wav.getnframes())
        x = np.frombuffer(data, dtype=np.int16)
        x = x.astype(np.float32) * (1.0 / np.iinfo(np.int16).max)
        if wav.getnchannels() > 1:
            x = x.reshape(-1, wav.getnchannels())
            x = x.mean(1)
    return x, freq


def wav_write(wav_name, x, freq):
    x = np.clip(x, -1, +1)
    x = (x * np.iinfo(np.int16).max).astype(np.int16)
    with wave.open(wav_name, "wb") as wav:
        wav.setnchannels(1)
        wav.setframerate(freq)
        wav.setsampwidth(2)
        wav.writeframes(x.tobytes())
