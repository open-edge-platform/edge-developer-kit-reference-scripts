# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""OpenAI ``/v1/audio/transcriptions`` answer shapes shared by the built-in speech-to-text backends.

``verbose_json`` segments and words, ``timestamp_granularities[]`` validation, and the srt / vtt
renderings of a transcript.
"""

from __future__ import annotations

import wave
from typing import Any, Optional

from fastapi import HTTPException

__all__ = [
    "RESPONSE_FORMATS",
    "granularities",
    "normalize_segments",
    "normalize_words",
    "parse_bool",
    "segments_or_whole",
    "to_srt",
    "to_vtt",
    "wav_duration",
]

RESPONSE_FORMATS = ("json", "text", "verbose_json", "srt", "vtt")


def parse_bool(value: Optional[str]) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def granularities(raw: Optional[list[str]]) -> list[str]:
    """Validated ``timestamp_granularities[]``; a comma-separated single value is split too."""
    if not raw:
        return []
    out: list[str] = []
    for entry in raw:
        for value in str(entry).split(","):
            value = value.strip().lower()
            if not value:
                continue
            if value not in ("segment", "word"):
                raise HTTPException(
                    status_code=400,
                    detail="timestamp_granularities[] must be 'segment' or 'word'",
                )
            if value not in out:
                out.append(value)
    return out


def normalize_words(raw: list) -> list[dict[str, Any]]:
    """Word timings in OpenAI's ``verbose_json`` word shape."""
    words = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        words.append(
            {
                "word": str(item.get("word") or "").strip(),
                "start": float(item.get("start") or 0.0),
                "end": float(item.get("end") or 0.0),
            }
        )
    return words


def normalize_segments(raw: list) -> list[dict[str, Any]]:
    """Segments in OpenAI's ``verbose_json`` shape.

    openai-python fails to parse a segment missing any typed field, so absent ones get neutral defaults.
    """
    segments = []
    for index, seg in enumerate(raw):
        if not isinstance(seg, dict):
            continue
        start = float(seg.get("start") or 0.0)
        tokens = seg.get("tokens")
        segments.append(
            {
                "id": seg.get("id", index),
                # Whisper's decoder offset, in frames of 10 ms. When it is missing, deriving it from
                # `start` keeps it consistent with the timings.
                "seek": int(seg.get("seek", int(start * 100))),
                "start": start,
                "end": float(seg.get("end") or 0.0),
                "text": str(seg.get("text") or "").strip(),
                "tokens": list(tokens) if isinstance(tokens, (list, tuple)) else [],
                "temperature": float(seg.get("temperature") or 0.0),
                "avg_logprob": float(seg.get("avg_logprob") or 0.0),
                "compression_ratio": float(seg.get("compression_ratio") or 0.0),
                "no_speech_prob": float(seg.get("no_speech_prob") or 0.0),
            }
        )
    return segments


def segments_or_whole(raw: Any, text: str, duration: float) -> list[dict[str, Any]]:
    """Segments in OpenAI's shape, or one segment spanning the audio.

    A model without timestamps still needs segments: verbose_json always carries them and srt/vtt need cues.
    """
    segments = normalize_segments(raw or [])
    if segments or not text:
        return segments
    return normalize_segments([{"start": 0.0, "end": duration, "text": text}])


def wav_duration(wav_path: str) -> float:
    try:
        with wave.open(wav_path, "rb") as wav:
            return round(wav.getnframes() / float(wav.getframerate() or 1), 3)
    except Exception:  # noqa: BLE001
        return 0.0


def _timestamp(seconds: float, separator: str) -> str:
    total_ms = int(round(max(seconds, 0.0) * 1000))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


def _cues(segments: list[dict[str, Any]], text: str) -> list[dict[str, Any]]:
    if segments:
        return [s for s in segments if s["text"]]
    return [{"start": 0.0, "end": 0.0, "text": text}] if text else []


def to_srt(segments: list[dict[str, Any]], text: str) -> str:
    lines = []
    for index, cue in enumerate(_cues(segments, text), start=1):
        lines.append(str(index))
        lines.append(f"{_timestamp(cue['start'], ',')} --> {_timestamp(cue['end'], ',')}")
        lines.append(cue["text"])
        lines.append("")
    return "\n".join(lines)


def to_vtt(segments: list[dict[str, Any]], text: str) -> str:
    lines = ["WEBVTT", ""]
    for cue in _cues(segments, text):
        lines.append(f"{_timestamp(cue['start'], '.')} --> {_timestamp(cue['end'], '.')}")
        lines.append(cue["text"])
        lines.append("")
    return "\n".join(lines)
