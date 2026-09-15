"""Chunked transcription service for long audio files.

Splits audio into ~30-second segments using ffmpeg, transcribes each chunk
independently via the whisper service, and yields partial results as they
complete. This enables near real-time UX for files up to 10+ minutes.

The approach:
1. Decode full audio to raw PCM via ffmpeg (fast, streaming)
2. Split PCM into fixed-size chunks (30s at 16kHz mono = 960,000 samples)
3. Transcribe each chunk independently
4. Yield {chunk_index, text, is_final} as each completes
"""

import io
import logging
import time
from typing import Any, AsyncGenerator, Dict

import numpy as np

from src.backend.services.pipeline_service import _audio_bytes_to_float32_16khz

logger = logging.getLogger(__name__)

CHUNK_DURATION_S = 30
SAMPLE_RATE = 16000
OVERLAP_S = 1
SAMPLES_PER_CHUNK = CHUNK_DURATION_S * SAMPLE_RATE
OVERLAP_SAMPLES = OVERLAP_S * SAMPLE_RATE


def split_into_chunks(pcm: np.ndarray) -> list:
    """Split PCM array into overlapping chunks of ~30 seconds."""
    chunks = []
    total_samples = len(pcm)
    step = SAMPLES_PER_CHUNK - OVERLAP_SAMPLES

    offset = 0
    while offset < total_samples:
        end = min(offset + SAMPLES_PER_CHUNK, total_samples)
        chunk = pcm[offset:end]
        # Skip very short trailing chunks (less than 1 second)
        if len(chunk) >= SAMPLE_RATE:
            chunks.append(chunk)
        offset += step

    logger.info("Split into %d chunks (%.1fs each, %.1fs overlap)",
                len(chunks), CHUNK_DURATION_S, OVERLAP_S)
    return chunks


def _chunk_to_wav_bytes(chunk: np.ndarray) -> bytes:
    """Convert float32 PCM chunk to WAV bytes for the whisper service."""
    from scipy.io import wavfile
    # Convert to int16 for WAV format
    int16_data = (np.clip(chunk, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    wavfile.write(buf, SAMPLE_RATE, int16_data)
    return buf.getvalue()


async def transcribe_chunks_streaming(
    audio_bytes: bytes,
    language: str,
    backend,
) -> AsyncGenerator[Dict[str, Any], None]:
    """Transcribe long audio in chunks, yielding results progressively.

    `backend` is a PipelineService instance with models loaded in-process.

    Yields dicts of the form:
    {
        "chunk_index": int,
        "total_chunks": int,
        "text": str,
        "cumulative_text": str,
        "progress": float (0.0-1.0),
        "is_final": bool,
        "duration_s": float (audio duration of this chunk),
    }
    """
    import asyncio

    def _do_transcribe(wav_bytes: bytes, lang: str) -> str:
        return backend._transcribe(wav_bytes, lang)

    start = time.perf_counter()

    # Step 1: Decode to PCM (one decode for everything)
    pcm = await asyncio.to_thread(_audio_bytes_to_float32_16khz, audio_bytes)
    total_duration_s = len(pcm) / SAMPLE_RATE

    # Short audio — transcribe directly, no chunking
    if total_duration_s <= 60:
        yield {
            "chunk_index": 0,
            "total_chunks": 1,
            "text": "",
            "cumulative_text": "",
            "progress": 0.05,
            "is_final": False,
            "stage": "transcribing",
            "duration_s": total_duration_s,
        }

        wav_bytes = await asyncio.to_thread(_chunk_to_wav_bytes, pcm)
        text = await asyncio.to_thread(_do_transcribe, wav_bytes, language)

        yield {
            "chunk_index": 0,
            "total_chunks": 1,
            "text": text,
            "cumulative_text": text,
            "progress": 1.0,
            "is_final": True,
            "duration_s": total_duration_s,
            "pcm": pcm,
        }
        return

    # Long audio — chunked path
    yield {
        "chunk_index": 0,
        "total_chunks": 1,
        "text": "",
        "cumulative_text": "",
        "progress": 0.05,
        "is_final": False,
        "stage": "transcribing",
        "duration_s": total_duration_s,
    }

    # Step 2: Split into chunks
    chunks = await asyncio.to_thread(split_into_chunks, pcm)
    total_chunks = len(chunks)

    # Step 3: Transcribe each chunk and yield progressive results
    cumulative_parts = []
    for i, chunk in enumerate(chunks):
        chunk_start = time.perf_counter()

        wav_bytes = await asyncio.to_thread(_chunk_to_wav_bytes, chunk)
        text = await asyncio.to_thread(_do_transcribe, wav_bytes, language)

        chunk_duration_s = len(chunk) / SAMPLE_RATE
        elapsed = time.perf_counter() - chunk_start
        logger.debug("Chunk %d/%d transcribed in %.1fs (audio: %.1fs)",
                     i + 1, total_chunks, elapsed, chunk_duration_s)

        if text and text.strip():
            cumulative_parts.append(text.strip())

        cumulative_text = " ".join(cumulative_parts)
        is_final = (i == total_chunks - 1)

        result = {
            "chunk_index": i,
            "total_chunks": total_chunks,
            "text": text.strip() if text else "",
            "cumulative_text": cumulative_text,
            "progress": (i + 1) / total_chunks,
            "is_final": is_final,
            "duration_s": chunk_duration_s,
        }
        if is_final:
            result["pcm"] = pcm
        yield result

    total_elapsed = time.perf_counter() - start
    logger.info("Chunked transcription complete: %d chunks, %.1fs total processing for %.1fs audio",
                total_chunks, total_elapsed, total_duration_s)
