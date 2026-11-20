# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Reusable WebSocket handler for pseudo-streaming audio transcription (or other analysis).

Segments live microphone audio into utterances with Silero VAD and sends each one's transcript,
from a caller-supplied ``transcribe`` callback, back over the same socket. A worker that analyses
the audio otherwise (speaker diarization) passes an ``UtteranceProcessor`` instead: it sees every
frame, and answers the newest utterance with its own message.

Wire protocol:
- Client -> server: binary frames of little-endian int16 PCM, mono, 16 kHz; optionally a JSON
  text frame ``{"event": "stop"}`` to flush the pending utterance before closing. Other JSON
  events (``{"event": "config", ...}``) go to the processor, if any.
- Query params (optional, per connection): ``language``, ``latency_log``, ``word_timestamps`` and
  the tuning keys of ``config.DEFAULT_CONFIG``.
- Server -> client (JSON text):
    ``{"type": "ready"}``                       once the socket is open
    ``{"type": "speech_start"}``                when speech is first detected
    ``{"type": "speech_end", "queued"}``        when the utterance is cut (pause or max length);
                                                ``queued`` is false when dropped as too short
    ``{"type": "transcript", "text", "start", "end", "latency"}``  per queued utterance,
                                                ``text`` empty when nothing was recognised
    ``{"type": "words", "start", "end", "words"}``  with ``word_timestamps`` and an ``align``
                                                callback: an utterance's word timings
                                                (``[{"word", "start", "end"}]``, seconds of
                                                received audio), after its transcript; none when
                                                alignment failed
    ``{"type": "error", "message"}``            on a per-utterance failure
    ``{"type": "done"}``                        after a client "stop" flush
  With a processor, its message replaces ``transcript`` (with ``start``, ``end`` and ``latency``
  added). Utterances that queue up while it is busy are answered together, by one message for the
  newest: a processor that analyses all the audio so far covers the older ones too. Closing the
  socket without a "stop" drops the pending utterance rather than processing it.
"""

import asyncio
import json
import logging
import time
from typing import Awaitable, Callable, Optional, Protocol

import numpy as np
from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect

from audio_input_stream.config import DEFAULT_CONFIG, HEALTH_LOG_INTERVAL_S, SAMPLE_RATE
from audio_input_stream.latency import LatencyTracker
from audio_input_stream.segmenter import UtteranceSegmenter
from audio_input_stream.vad import AlgoOptions, SileroVadOptions

logger = logging.getLogger("uvicorn.error")

# How long a "stop" waits for word timings still being aligned before answering "done".
ALIGN_FLUSH_TIMEOUT_S = 10.0


class UtteranceProcessor(Protocol):
    """A per-connection analysis of the live audio, driven by the VAD's utterances."""

    def configure(self, event: dict) -> None:
        """A client event other than "stop"; raises ``ValueError`` for one it rejects."""

    def add_audio(self, frame: np.ndarray) -> None:
        """Every received int16 frame, in order: the audio the utterances are cut from."""

    async def process(self, utterance: dict) -> dict:
        """The message (with its ``type``) answering ``utterance`` (``utterance``, ``start``,
        ``end``: the PCM and its seconds of received audio), and every one queued before it."""

    def close(self) -> None:
        """The socket closed: abandon any work in progress."""


def _tuned(query_params, defaults: dict, name: str, cast: type):
    """``defaults[name]``, overridable per connection by a query param (no worker restart)."""
    raw = query_params.get(name)
    if raw is None:
        return defaults[name]
    try:
        if cast is bool:
            return raw.strip().lower() not in ("0", "false", "no", "off", "")
        return cast(raw)
    except ValueError:
        logger.warning(f"Ignoring invalid {name}={raw!r}")
        return defaults[name]


async def handle_audio_stream(
    websocket: WebSocket,
    *,
    vad_model,
    transcribe: Optional[Callable[[np.ndarray, str], str]] = None,
    align: Optional[Callable[[np.ndarray, str, str], Awaitable[list[dict]]]] = None,
    processor: Optional[UtteranceProcessor] = None,
    defaults: dict = DEFAULT_CONFIG,
) -> None:
    """Drive one ``/v1/audio/stream`` WebSocket session end-to-end.

    ``vad_model`` comes from ``get_silero_model()``. ``transcribe`` is a blocking
    ``(pcm, language) -> text`` call, run in a thread so it never stalls audio ingestion.
    ``align`` is an async ``(pcm, language, text) -> [{"word", "start", "end"}]`` call (seconds from
    the utterance's start), used when the client asks for ``word_timestamps``. ``processor``
    replaces ``transcribe`` (see ``UtteranceProcessor``).
    """
    if (transcribe is None) == (processor is None):
        raise ValueError("pass exactly one of transcribe and processor")
    await websocket.accept()

    def tuned(name: str, cast: type = float):
        return _tuned(websocket.query_params, defaults, name, cast)

    language = tuned("language", str)
    latency_log = tuned("latency_log", bool)
    word_timestamps = align is not None and _tuned(
        websocket.query_params, {"word_timestamps": False}, "word_timestamps", bool
    )

    algo_options = AlgoOptions(
        audio_chunk_duration=tuned("audio_chunk_duration"),
        started_talking_threshold=tuned("started_talking_threshold"),
        speech_threshold=tuned("speech_threshold"),
        max_continuous_speech_s=tuned("max_continuous_speech_s"),
        pause_duration=tuned("pause_duration"),
    )
    vad_options = SileroVadOptions(
        threshold=tuned("vad_threshold"),
        min_speech_duration_ms=tuned("min_speech_duration_ms", int),
        min_silence_duration_ms=tuned("min_silence_duration_ms", int),
    )
    preroll_duration = tuned("preroll_duration")
    min_utterance_duration = tuned("min_utterance_duration")
    segmenter = UtteranceSegmenter(
        vad_model,
        algo_options,
        vad_options,
        preroll_duration=preroll_duration,
        min_utterance_duration=min_utterance_duration,
        latency_log=latency_log,
    )
    tracker = LatencyTracker(latency_log=latency_log)

    if latency_log:
        logger.info(
            "[latency] session started: language=%s chunk=%.2fs "
            "started_talking=%.2fs speech_threshold=%.2fs max_speech=%.1fs "
            "pause=%.2fs vad_threshold=%.2f "
            "min_silence=%dms preroll=%.2fs min_utterance=%.2fs",
            language,
            algo_options.audio_chunk_duration,
            algo_options.started_talking_threshold,
            algo_options.speech_threshold,
            algo_options.max_continuous_speech_s,
            algo_options.pause_duration,
            vad_options.threshold,
            vad_options.min_silence_duration_ms,
            preroll_duration,
            min_utterance_duration,
        )

    await websocket.send_json({"type": "ready"})

    # Transcription runs on its own task so a slow round trip never stalls ingestion; a single
    # consumer keeps utterances in order.
    stt_queue: asyncio.Queue = asyncio.Queue()
    # Alignment has its own consumer, so a slow aligner never delays the next transcript.
    align_queue: asyncio.Queue = asyncio.Queue()

    async def handle_alignment(item: dict) -> None:
        offset = item["start"]
        try:
            words = await align(item["utterance"], language, item["text"])
        except Exception as error:
            logger.error(f"Streaming word alignment failed: {error}")
            return
        if not words:
            return
        await websocket.send_json(
            {
                "type": "words",
                "start": item["start"],
                "end": item["end"],
                "words": [
                    {
                        "word": w["word"],
                        "start": round(offset + float(w["start"]), 3),
                        "end": round(offset + float(w["end"]), 3),
                    }
                    for w in words
                    if w.get("word") and w.get("start") is not None and w.get("end") is not None
                ],
            }
        )

    async def align_worker() -> None:
        while True:
            item = await align_queue.get()
            try:
                if item is None:
                    return
                await handle_alignment(item)
            except Exception:
                pass
            finally:
                align_queue.task_done()

    async def answer(
        item: dict, work: Callable[[], Awaitable[dict]], what: str
    ) -> Optional[dict]:
        """Sends ``work()``'s message for ``item``, with its bounds and latency; None if it failed."""
        speech_end = item["speech_end"]
        t_dequeued = time.perf_counter()
        queue_ms = (t_dequeued - item["enqueued"]) * 1000.0
        endpoint_ms = (item["enqueued"] - speech_end) * 1000.0
        try:
            message = await work()
        except Exception as error:
            logger.error(f"Streaming {what} failed: {error}")
            try:
                await websocket.send_json({"type": "error", "message": str(error)})
            except Exception:
                pass
            return None
        work_ms = (time.perf_counter() - t_dequeued) * 1000.0
        e2e_ms = (time.perf_counter() - speech_end) * 1000.0
        try:
            await websocket.send_json(
                {
                    **message,
                    "start": item["start"],
                    "end": item["end"],
                    "latency": {
                        "endpoint_ms": round(endpoint_ms),
                        "queue_ms": round(queue_ms),
                        "stt_ms": round(work_ms),
                        "e2e_ms": round(e2e_ms),
                    },
                }
            )
        except Exception:
            # The client has gone: nobody to answer.
            return None
        text = message.get("text")
        tracker.record_utterance(
            audio_s=len(item["utterance"]) / SAMPLE_RATE,
            endpoint_ms=endpoint_ms,
            queue_ms=queue_ms,
            stt_ms=work_ms,
            e2e_ms=e2e_ms,
            lag_ms=segmenter.ingest_lag_s() * 1000.0,
            reason=f"{item['reason']}/empty" if text == "" else item["reason"],
            chars=len(text or ""),
        )
        return message

    async def handle_utterance(item: dict) -> None:
        async def transcribed() -> dict:
            text = await asyncio.to_thread(transcribe, item["utterance"], language)
            # Sent even when empty: every queued utterance is answered, so a
            # client can tell when nothing is being transcribed any more.
            return {"type": "transcript", "text": (text or "").strip()}

        message = await answer(item, transcribed, "transcription")
        if message and word_timestamps and message["text"]:
            align_queue.put_nowait({**item, "text": message["text"]})

    async def handle_processed(item: dict) -> None:
        await answer(item, lambda: processor.process(item), "utterance processing")

    def newest_queued(item: dict) -> Optional[dict]:
        """``item``, or the newest utterance queued after it (the processor covers the rest)."""
        while not stt_queue.empty():
            newer = stt_queue.get_nowait()
            stt_queue.task_done()
            if newer is None:
                # The end-of-session marker: back in line, after this last utterance.
                stt_queue.put_nowait(None)
                break
            item = newer
        return item

    async def stt_worker() -> None:
        while True:
            item = await stt_queue.get()
            try:
                if item is None:
                    return
                if processor is not None:
                    await handle_processed(newest_queued(item))
                else:
                    await handle_utterance(item)
            finally:
                stt_queue.task_done()

    def enqueue(item: dict) -> None:
        item["enqueued"] = time.perf_counter()
        stt_queue.put_nowait(item)

    stt_consumer = asyncio.create_task(stt_worker())
    align_consumer = asyncio.create_task(align_worker())

    async def drain_alignment() -> None:
        try:
            await asyncio.wait_for(align_queue.join(), timeout=ALIGN_FLUSH_TIMEOUT_S)
        except asyncio.TimeoutError:
            logger.warning("Word alignment still pending after stop; answering without it")
    last_health_log = time.perf_counter()

    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if message.get("bytes") is not None:
                frame = np.frombuffer(message["bytes"], dtype=np.int16)
                if frame.size == 0:
                    continue
                if processor is not None:
                    processor.add_audio(frame)
                segmenter.add_frame(frame)
                if not segmenter.ready_to_evaluate():
                    continue
                result = await asyncio.to_thread(segmenter.evaluate)
                tracker.record_vad(result["vad_ms"])
                if result["speech_started"]:
                    await websocket.send_json({"type": "speech_start"})
                if result["speech_ended"]:
                    await websocket.send_json(
                        {
                            "type": "speech_end",
                            "queued": result["utterance"] is not None,
                        }
                    )
                if result["utterance"] is not None:
                    enqueue(result)

                now = time.perf_counter()
                if (
                    latency_log
                    and now - last_health_log >= HEALTH_LOG_INTERVAL_S
                ):
                    last_health_log = now
                    logger.info(
                        "[latency] stream health: ingest_lag=%.0fms vad_last=%.1fms "
                        "chunks=%d backlog=%d utterances=%d",
                        segmenter.ingest_lag_s() * 1000.0,
                        result["vad_ms"],
                        len(tracker.vad_ms),
                        stt_queue.qsize(),
                        tracker.count,
                    )

            elif message.get("text") is not None:
                try:
                    payload = json.loads(message["text"])
                except json.JSONDecodeError:
                    payload = None
                event = payload.get("event") if isinstance(payload, dict) else None
                if event and event != "stop" and processor is not None:
                    try:
                        processor.configure(payload)
                    except ValueError as error:
                        await websocket.send_json({"type": "error", "message": str(error)})
                    continue
                if event == "stop":
                    pending = segmenter.flush()
                    if pending is not None:
                        enqueue(pending)
                    await stt_queue.join()
                    await drain_alignment()
                    await websocket.send_json({"type": "done"})
                    break
    except WebSocketDisconnect:
        logger.info("Audio input stream client disconnected")
    except Exception as error:
        logger.error(f"Audio input stream socket error: {error}")
    finally:
        if processor is not None:
            # Unasked-for work would only hold up the worker's next request.
            processor.close()
        try:
            pending = segmenter.flush() if processor is None else None
            if pending is not None:
                enqueue(pending)
            await asyncio.wait_for(stt_queue.join(), timeout=30 if processor is None else 5)
        except Exception:
            pass
        stt_queue.put_nowait(None)
        try:
            await asyncio.wait_for(stt_consumer, timeout=5)
        except Exception:
            stt_consumer.cancel()
        # Nobody is left to send word timings to.
        align_consumer.cancel()
        tracker.log_summary()
        if latency_log and segmenter.dropped_short:
            logger.info(
                "[latency] dropped %d short utterance(s) this session",
                segmenter.dropped_short,
            )
