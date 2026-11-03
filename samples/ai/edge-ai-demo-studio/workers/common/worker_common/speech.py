# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Speech sent as it is synthesized, so playback starts once the first sentence is ready.

Not re-exported from ``worker_common``: it needs numpy, which the lightest workers do not install.
"""

from __future__ import annotations

import base64
import itertools
import re
import struct
import subprocess # nosec B404 - secured ffmpeg command 
import threading
import time
from contextlib import nullcontext
from dataclasses import dataclass
from typing import Iterable, Iterator, Literal

import numpy as np
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from worker_common.audio import ffmpeg_binary, transcode_wav
from worker_common.log import get_logger
from worker_common.openai_compat import speech_media_type
from worker_common.perf import server_timing
from worker_common.sse import sse_event, sse_response

logger = get_logger(__name__)

#: ``stream_format`` values: the audio bytes themselves, or OpenAI's events.
StreamFormat = Literal["audio", "sse"]

#: One synthesized piece: mono float samples in [-1, 1] and their sample rate.
Piece = tuple[np.ndarray, int]

#: RIFF and ``data`` size of a WAV whose length is not known yet.
UNKNOWN_WAV_SIZE = 0xFFFFFFFF

#: Longest text handed to a model in one call when splitting, in characters.
MAX_SENTENCE_CHARS = 400

# ── Sentences ────────────────────────────────────────────────────

# The end of a sentence: terminal punctuation (plus closing quotes/brackets)
# before whitespace, CJK terminal punctuation, or a line break.
_SENTENCE_END = re.compile(
    r"[.!?…]+[\"'”’»)\]]*(?=\s)|[。！？]+[\"'”’」』)\]]*|\n+"
)

# Words a full stop follows without ending the sentence (English and Malay).
_ABBREVIATIONS = frozenset(
    {
        "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "no",
        "fig", "approx", "dept", "inc", "ltd", "co", "corp", "mt", "jan",
        "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov",
        "dec", "en", "pn", "tn", "hj", "sdn", "bhd", "jln", "kg",
    }
)

# Initials and dotted abbreviations ("J", "e.g", "U.S") before a full stop.
_DOTTED = re.compile(r"(?:[^\W\d_]\.)+[^\W\d_]|[^\W\d_]")

# Where an over-long sentence is broken, best first.
_CLAUSE_BREAKS = (", ", "; ", ": ", "，", "；", "、")


def _ends_with_abbreviation(text: str) -> bool:
    words = text.split()
    if not words:
        return False
    word = words[-1].lstrip("\"'“‘([")
    if word == "I":  # "... than I." ends a sentence
        return False
    return word.lower() in _ABBREVIATIONS or bool(_DOTTED.fullmatch(word))


def _wrap(sentence: str, max_chars: int) -> list[str]:
    """``sentence`` in parts of at most ``max_chars``, broken at a clause or word boundary if possible."""
    parts = []
    while len(sentence) > max_chars:
        cut = max(sentence.rfind(mark, 0, max_chars) for mark in _CLAUSE_BREAKS)
        if cut > max_chars // 3:
            cut += 1  # keep the punctuation with the first part
        else:
            cut = sentence.rfind(" ", 0, max_chars)
            if cut <= max_chars // 3:
                cut = max_chars
        parts.append(sentence[:cut].strip())
        sentence = sentence[cut:].strip()
    if sentence:
        parts.append(sentence)
    return [part for part in parts if part]


def split_sentences(text: str, max_chars: int = MAX_SENTENCE_CHARS) -> list[str]:
    """``text`` as its sentences, none longer than ``max_chars``.

    A full stop after a known abbreviation or an initial ("Dr.", "e.g.",
    "J.") does not end a sentence; a line break always does.
    """
    sentences = []
    start = 0
    for match in _SENTENCE_END.finditer(text):
        mark = match.group().rstrip("\"'”’»)]")
        if mark == "." and _ends_with_abbreviation(text[start : match.start()]):
            continue
        sentences.append(text[start : match.end()])
        start = match.end()
    sentences.append(text[start:])
    return [
        part
        for sentence in sentences
        if sentence.strip()
        for part in _wrap(sentence.strip(), max_chars)
    ]


# ── Audio encoding ───────────────────────────────────────────────


def pcm16(samples: np.ndarray) -> bytes:
    """Float samples in [-1, 1] as signed 16-bit little-endian PCM."""
    return (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()


def wav_header(sample_rate: int, data_size: int | None = None) -> bytes:
    """The 44-byte header of a 16-bit mono PCM WAV.

    Without ``data_size`` both sizes are :data:`UNKNOWN_WAV_SIZE`, which
    readers of a streamed WAV take as "until the end of the body".
    """
    riff = UNKNOWN_WAV_SIZE if data_size is None else 36 + data_size
    data = UNKNOWN_WAV_SIZE if data_size is None else data_size
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", riff, b"WAVE",
        b"fmt ", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16,
        b"data", data,
    )


def decode_wav(raw: bytes) -> Piece:
    """A PCM or float WAV file as mono float samples and its sample rate.

    Tolerates the placeholder sizes of a streamed WAV (the data then runs to
    the end of ``raw``) and chunks other than ``fmt `` and ``data``.
    """
    if len(raw) < 12 or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
        raise ValueError("not a WAV file")
    offset = 12
    code = channels = rate = bits = 0
    data = None
    while offset + 8 <= len(raw):
        chunk_id = raw[offset : offset + 4]
        (size,) = struct.unpack_from("<I", raw, offset + 4)
        body = offset + 8
        if chunk_id == b"fmt " and size >= 16:
            code, channels, rate, _, _, bits = struct.unpack_from("<HHIIHH", raw, body)
            if code == 0xFFFE and size >= 26:  # WAVE_FORMAT_EXTENSIBLE
                (code,) = struct.unpack_from("<H", raw, body + 24)
        elif chunk_id == b"data":
            end = body + size if 0 < size <= len(raw) - body else len(raw)
            data = raw[body:end]
            break
        offset = body + size + (size & 1)
    dtype = {(1, 16): "<i2", (1, 32): "<i4", (3, 32): "<f4", (3, 64): "<f8"}.get((code, bits))
    if data is None or not rate or dtype is None:
        raise ValueError(f"unsupported WAV (format {code}, {bits}-bit, rate {rate})")
    width = np.dtype(dtype).itemsize * max(channels, 1)
    samples = np.frombuffer(data[: len(data) - len(data) % width], dtype=dtype)
    if samples.dtype.kind == "i":
        samples = samples / float(np.iinfo(samples.dtype).max + 1)
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples.astype(np.float32), rate


def encode_audio(samples: np.ndarray, sample_rate: int, response_format: str) -> bytes:
    """A whole file in one of OpenAI's six formats; ``pcm`` stays at the model's own sample rate."""
    fmt = response_format.lower()
    pcm = pcm16(samples)
    if fmt == "pcm":
        return pcm
    wav = wav_header(sample_rate, len(pcm)) + pcm
    return wav if fmt == "wav" else transcode_wav(wav, fmt)


# ffmpeg output for formats whose per-piece encodings concatenate into one stream. MP3's ID3 tag
# and info frame must not repeat mid-stream, so they are left out.
_PIECE_OUTPUT = {
    "mp3": [
        "-c:a", "libmp3lame", "-b:a", "128k",
        "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3",
    ],
    "aac": ["-c:a", "aac", "-b:a", "128k", "-f", "adts"],
}


def _encode_piece(samples: np.ndarray, sample_rate: int, fmt: str) -> bytes:
    binary = ffmpeg_binary()
    if binary is None:
        raise RuntimeError(
            "ffmpeg was not found, so audio can only be returned as WAV or PCM; "
            "run the repository's setup script to install it"
        )
    command = [
        binary, "-hide_banner", "-loglevel", "error",
        "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "-",
        "-map_metadata", "-1", *_PIECE_OUTPUT[fmt], "-",
    ]
    result = subprocess.run(
        command, input=pcm16(samples), stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if result.returncode != 0 or not result.stdout:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(f"ffmpeg failed to encode {fmt}: {message}")
    return result.stdout


def retime(piece: Piece, speed: float) -> Piece:
    """``piece`` played ``speed`` times as fast at the same pitch, for models without speed control."""
    samples, sample_rate = piece
    if abs(speed - 1.0) < 1e-3 or not samples.size:
        return piece
    pcm = pcm16(samples)
    wav = transcode_wav(wav_header(sample_rate, len(pcm)) + pcm, "wav", speed=speed)
    return decode_wav(wav)


def join_pieces(pieces: Iterable[Piece]) -> Piece:
    """All pieces as one signal; a 500 when the model produced none."""
    collected = list(pieces)
    if not collected:
        raise HTTPException(status_code=500, detail="No audio generated")
    return np.concatenate([samples for samples, _ in collected]), collected[0][1]


def encode_stream(pieces: Iterable[Piece], response_format: str) -> Iterator[bytes]:
    """The bytes of a ``response_format`` file, as each piece arrives."""
    fmt = response_format.lower()
    if fmt in ("wav", "pcm"):
        header = fmt == "wav"
        for samples, sample_rate in pieces:
            body = pcm16(samples)
            if header:
                body = wav_header(sample_rate) + body
                header = False
            yield body
    elif fmt in _PIECE_OUTPUT:
        for samples, sample_rate in pieces:
            yield _encode_piece(samples, sample_rate, fmt)
    else:
        yield encode_audio(*join_pieces(pieces), fmt)


# ── Requests ─────────────────────────────────────────────────────


class SpeechRequest(BaseModel):
    """OpenAI's ``POST /v1/audio/speech`` body; workers subclass it for their ``model``/``voice`` defaults."""

    model: str = Field(default="", description="The model; each worker serves one.")
    input: str = Field(..., description="The text to generate audio for.")
    voice: str = Field(default="", description="The voice; GET /v1/audio/voices lists them.")
    response_format: Literal["mp3", "opus", "aac", "flac", "wav", "pcm"] = Field(
        default="mp3", description="The format to return audio in."
    )
    stream: bool = Field(
        default=True,
        description="Send the audio sentence by sentence as it is synthesized "
        "(wav with unknown-length sizes, raw pcm, mp3/aac per sentence; "
        "opus/flac once complete) instead of all at once.",
    )
    stream_format: StreamFormat = Field(
        default="audio",
        description="'audio' sends the audio bytes; 'sse' sends OpenAI's "
        "speech.audio.delta events and a final speech.audio.done.",
    )
    speed: float = Field(default=1.0, ge=0.25, le=4.0, description="Speed, 0.25 to 4.0.")
    instructions: str | None = Field(
        default=None,
        description="Accepted for OpenAI compatibility and ignored: these models "
        "have no prompt-steerable delivery.",
    )


@dataclass
class SpeechStats:
    """What one request cost and produced; per request, so concurrent requests never mix their times."""

    inference_seconds: float = 0.0
    audio_seconds: float = 0.0

    def log(self) -> None:
        if self.audio_seconds > 0:
            logger.info(
                "Synthesized %.2f s of audio in %.3f s (RTF %.3f)",
                self.audio_seconds,
                self.inference_seconds,
                self.inference_seconds / self.audio_seconds,
            )


def measured(
    pieces: Iterable[Piece],
    stats: SpeechStats,
    lock: threading.Lock | None = None,
) -> Iterator[Piece]:
    """``pieces`` as mono float32, timed into ``stats``, empty ones dropped.

    ``lock`` is taken per piece, so a short request can finish while a long one is still streaming.
    """
    source = iter(pieces)
    guard = lock if lock is not None else nullcontext()
    try:
        while True:
            with guard:
                started = time.perf_counter()
                try:
                    samples, sample_rate = next(source)
                except StopIteration:
                    return
                finally:
                    stats.inference_seconds += time.perf_counter() - started
            samples = np.asarray(samples, dtype=np.float32).reshape(-1)
            if samples.size:
                stats.audio_seconds += samples.size / sample_rate
                yield samples, sample_rate
    finally:
        # A client that went away stops the synthesis of what is left.
        close = getattr(source, "close", None)
        if close is not None:
            close()


def speech_events(body: Iterable[bytes], stats: SpeechStats) -> Iterator[bytes]:
    """OpenAI's ``speech.audio.delta`` / ``speech.audio.done`` events for ``body``."""
    try:
        for chunk in body:
            if chunk:
                audio = base64.b64encode(chunk).decode("ascii")
                yield sse_event(
                    {"type": "speech.audio.delta", "audio": audio},
                    event="speech.audio.delta",
                )
    except Exception as exc:  # noqa: BLE001 - reported to the client as an event
        logger.exception("Speech stream failed")
        yield sse_event({"detail": f"Speech generation failed: {exc}"}, event="error")
        return
    yield sse_event(
        {
            "type": "speech.audio.done",
            "duration": round(stats.audio_seconds, 3),
            "perf": {
                "seconds": round(stats.inference_seconds, 3),
                "audio_seconds": round(stats.audio_seconds, 3),
            },
        },
        event="speech.audio.done",
    )


def _logged(body: Iterable[bytes], stats: SpeechStats) -> Iterator[bytes]:
    yield from body
    stats.log()


async def speech_response(
    pieces: Iterable[Piece],
    response_format: str,
    *,
    stream: bool,
    stream_format: str = "audio",
    lock: threading.Lock | None = None,
    headers: dict[str, str] | None = None,
) -> Response:
    """The answer to ``POST /v1/audio/speech`` for ``pieces``, a generator doing the model work lazily.

    ``stream_format="sse"`` sends OpenAI's delta/done events, ``stream`` the growing file, otherwise the
    whole file with ``Server-Timing``. The first piece is made before responding, so an outright failure
    still gets an error status. Pieces run off the event loop under ``lock``: OpenVINO's compiled-model
    call and the G2P front ends are not thread-safe.
    """
    fmt = response_format.lower()
    stats = SpeechStats()
    source = measured(pieces, stats, lock)

    if stream_format != "sse" and not stream:
        samples, sample_rate = await run_in_threadpool(join_pieces, source)
        audio = await run_in_threadpool(encode_audio, samples, sample_rate, fmt)
        stats.log()
        return Response(
            content=audio,
            media_type=speech_media_type(fmt),
            # The model time, for the app's Live metrics.
            headers={**(headers or {}), **server_timing(stats.inference_seconds)},
        )

    first = await run_in_threadpool(next, source, None)
    if first is None:
        raise HTTPException(status_code=500, detail="No audio generated")
    body = _logged(encode_stream(itertools.chain([first], source), fmt), stats)
    if stream_format == "sse":
        return sse_response(speech_events(body, stats))
    return StreamingResponse(body, media_type=speech_media_type(fmt), headers=headers)
