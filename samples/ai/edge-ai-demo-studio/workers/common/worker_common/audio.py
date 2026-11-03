# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""The ffmpeg bundled with the repository (``<repo>/thirdparty/ffmpeg/bin``), and transcoding through it.

pydub workers reach it through PATH or :func:`configure_pydub`; :func:`transcode_wav` drives it directly
for environments without pydub.
"""

from __future__ import annotations

import os
import shutil
import subprocess  # nosec B404 - secured ffmpeg command 
from pathlib import Path

from worker_common.openai_compat import SPEECH_RESPONSE_FORMATS
from worker_common.paths import thirdparty_dir

__all__ = [
    "add_ffmpeg_to_path",
    "configure_pydub",
    "decode_to_pcm16",
    "ffmpeg_bin_dir",
    "ffmpeg_binary",
    "ffprobe_binary",
    "transcode_wav",
]

# ffmpeg output arguments per `response_format` (`wav` is the input). `pcm` is 24 kHz s16le mono,
# as OpenAI documents.
_FFMPEG_OUTPUT = {
    "mp3": ["-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3"],
    "opus": ["-c:a", "libopus", "-b:a", "64k", "-f", "opus"],
    # ffmpeg has no muxer named "aac"; raw AAC is the ADTS container.
    "aac": ["-c:a", "aac", "-b:a", "128k", "-f", "adts"],
    "flac": ["-c:a", "flac", "-f", "flac"],
    "pcm": ["-c:a", "pcm_s16le", "-ar", "24000", "-ac", "1", "-f", "s16le"],
}


def ffmpeg_bin_dir() -> Path | None:
    """``<repo>/thirdparty/ffmpeg/bin`` when the project setup installed it."""
    bin_dir = thirdparty_dir("ffmpeg", "bin")
    return bin_dir if bin_dir.is_dir() else None


def _bundled_or_path(name: str) -> str | None:
    bundled = thirdparty_dir("ffmpeg", "bin", name)
    for candidate in (bundled, Path(str(bundled) + ".exe")):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return shutil.which(name)


def ffmpeg_binary() -> str | None:
    """Path to a usable ffmpeg, bundled copy first; None when there is none, so callers can degrade to WAV."""
    return _bundled_or_path("ffmpeg")


def ffprobe_binary() -> str | None:
    """Path to a usable ffprobe, preferring the copy bundled with the repo."""
    return _bundled_or_path("ffprobe")


def add_ffmpeg_to_path() -> str | None:
    """Put the bundled ffmpeg directory first on PATH, once; returns it, or None when it is missing."""
    bin_dir = ffmpeg_bin_dir()
    if bin_dir is None:
        return None
    current = os.environ.get("PATH", "")
    entries = current.split(os.pathsep) if current else []
    if str(bin_dir) not in entries:
        os.environ["PATH"] = os.pathsep.join([str(bin_dir), *entries])
    return str(bin_dir)


def configure_pydub() -> bool:
    """Point pydub's converter and prober at the bundled ffmpeg/ffprobe, so decoding needs no system ffmpeg.

    Returns False, changing nothing, when pydub is not installed.
    """
    try:
        import pydub.utils
        from pydub import AudioSegment
    except ImportError:
        return False
    ffmpeg = ffmpeg_binary()
    ffprobe = ffprobe_binary()
    if ffmpeg:
        AudioSegment.converter = ffmpeg
    if ffprobe:
        pydub.utils.get_prober_name = lambda: ffprobe
    return True


def decode_to_pcm16(data: bytes, sample_rate: int) -> bytes:
    """Any audio ffmpeg reads, as mono s16le PCM at ``sample_rate``; RuntimeError if ffmpeg fails."""
    binary = ffmpeg_binary()
    if binary is None:
        raise RuntimeError(
            "ffmpeg was not found, so the audio cannot be decoded; "
            "run the repository's setup script to install it"
        )
    command = [
        binary, "-hide_banner", "-loglevel", "error", "-i", "-",
        "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", str(sample_rate), "-",
    ]
    result = subprocess.run(
        command, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(f"ffmpeg could not decode the audio: {message}")
    return result.stdout


def _atempo_filter(speed: float) -> list[str]:
    """An ``atempo`` chain for ``speed``: one atempo accepts 0.5-2.0, OpenAI's speed runs 0.25-4.0."""
    if abs(speed - 1.0) < 1e-3:
        return []
    factors = []
    remaining = speed
    while remaining > 2.0:
        factors.append(2.0)
        remaining /= 2.0
    while remaining < 0.5:
        factors.append(0.5)
        remaining /= 0.5
    factors.append(remaining)
    return ["-filter:a", ",".join(f"atempo={f:.6f}" for f in factors)]


def transcode_wav(wav_bytes: bytes, response_format: str, *, speed: float = 1.0) -> bytes:
    """Re-encode WAV audio to one of :data:`SPEECH_RESPONSE_FORMATS`; ``wav`` at speed 1.0 is returned as is.

    Raises RuntimeError when ffmpeg is missing or fails, so callers answer 500 rather than mislabelled bytes.
    """
    fmt = str(response_format).lower()
    if fmt not in SPEECH_RESPONSE_FORMATS:
        raise ValueError(f"unsupported response_format '{response_format}'")

    tempo = _atempo_filter(float(speed))
    if fmt == "wav" and not tempo:
        return wav_bytes

    binary = ffmpeg_binary()
    if binary is None:
        raise RuntimeError(
            "ffmpeg was not found, so audio can only be returned as WAV; "
            "run the repository's setup script to install it"
        )

    output = ["-f", "wav"] if fmt == "wav" else _FFMPEG_OUTPUT[fmt]
    # stdin to stdout, so nothing touches disk.
    command = [binary, "-hide_banner", "-loglevel", "error", "-i", "-", *tempo, *output, "-"]
    try:
        result = subprocess.run(
            command,
            input=wav_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        message = (exc.stderr or b"").decode("utf-8", "replace").strip()
        raise RuntimeError(f"ffmpeg failed to encode {fmt}: {message}") from exc
    if not result.stdout:
        raise RuntimeError(f"ffmpeg produced no output for {fmt}")
    return result.stdout
