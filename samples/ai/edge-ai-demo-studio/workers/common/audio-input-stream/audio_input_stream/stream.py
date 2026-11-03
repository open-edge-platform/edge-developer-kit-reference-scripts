# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Reusable WebSocket handler for pseudo-streaming audio transcription.

Segments live microphone audio into utterances with Silero VAD and sends each one's transcript,
from a caller-supplied ``transcribe`` callback, back over the same socket.

Wire protocol:
- Client -> server: binary frames of little-endian int16 PCM, mono, 16 kHz; optionally a JSON
  text frame ``{"event": "stop"}`` to flush the pending utterance before closing.
- Query params (optional, per connection): ``language``, ``latency_log`` and the tuning keys of
  ``config.DEFAULT_CONFIG``.
- Server -> client (JSON text):
    ``{"type": "ready"}``                       once the socket is open
    ``{"type": "speech_start"}``                when speech is first detected
    ``{"type": "speech_end", "queued"}``        when the utterance is cut (pause or max length);
                                                ``queued`` is false when dropped as too short
    ``{"type": "transcript", "text", "start", "end", "latency"}``  per queued utterance,
                                                ``text`` empty when nothing was recognised
    ``{"type": "error", "message"}``            on a per-utterance failure
    ``{"type": "done"}``                        after a client "stop" flush
"""

import asyncio
import json
import logging
import time
from typing import Callable

import numpy as np
from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect

from audio_input_stream.config import DEFAULT_CONFIG, HEALTH_LOG_INTERVAL_S, SAMPLE_RATE
from audio_input_stream.latency import LatencyTracker
from audio_input_stream.segmenter import UtteranceSegmenter
from audio_input_stream.vad import AlgoOptions, SileroVadOptions

logger = logging.getLogger("uvicorn.error")


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
    transcribe: Callable[[np.ndarray, str], str],
    defaults: dict = DEFAULT_CONFIG,
) -> None:
    """Drive one ``/v1/audio/stream`` WebSocket session end-to-end.

    ``vad_model`` comes from ``get_silero_model()``. ``transcribe`` is a blocking
    ``(pcm, language) -> text`` call, run in a thread so it never stalls audio ingestion.
    """
    await websocket.accept()

    def tuned(name: str, cast: type = float):
        return _tuned(websocket.query_params, defaults, name, cast)

    language = tuned("language", str)
    latency_log = tuned("latency_log", bool)

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

    async def handle_utterance(item: dict) -> None:
        pcm = item["utterance"]
        audio_s = len(pcm) / SAMPLE_RATE
        speech_end = item["speech_end"]
        t_dequeued = time.perf_counter()
        queue_ms = (t_dequeued - item["enqueued"]) * 1000.0
        endpoint_ms = (item["enqueued"] - speech_end) * 1000.0
        try:
            text = await asyncio.to_thread(transcribe, pcm, language)
            stt_ms = (time.perf_counter() - t_dequeued) * 1000.0
            text = (text or "").strip()
            e2e_ms = (time.perf_counter() - speech_end) * 1000.0
            # Sent even when empty: every queued utterance is answered, so a
            # client can tell when nothing is being transcribed any more.
            await websocket.send_json(
                {
                    "type": "transcript",
                    "text": text,
                    "start": item["start"],
                    "end": item["end"],
                    "latency": {
                        "endpoint_ms": round(endpoint_ms),
                        "queue_ms": round(queue_ms),
                        "stt_ms": round(stt_ms),
                        "e2e_ms": round(e2e_ms),
                    },
                }
            )
            tracker.record_utterance(
                audio_s=audio_s,
                endpoint_ms=endpoint_ms,
                queue_ms=queue_ms,
                stt_ms=stt_ms,
                e2e_ms=e2e_ms,
                lag_ms=segmenter.ingest_lag_s() * 1000.0,
                reason=item["reason"] if text else f"{item['reason']}/empty",
                chars=len(text),
            )
        except Exception as error:
            logger.error(f"Streaming transcription failed: {error}")
            try:
                await websocket.send_json(
                    {"type": "error", "message": str(error)}
                )
            except Exception:
                pass

    async def stt_worker() -> None:
        while True:
            item = await stt_queue.get()
            try:
                if item is None:
                    return
                await handle_utterance(item)
            finally:
                stt_queue.task_done()

    def enqueue(item: dict) -> None:
        item["enqueued"] = time.perf_counter()
        stt_queue.put_nowait(item)

    stt_consumer = asyncio.create_task(stt_worker())
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
                    event = json.loads(message["text"]).get("event")
                except json.JSONDecodeError:
                    event = None
                if event == "stop":
                    pending = segmenter.flush()
                    if pending is not None:
                        enqueue(pending)
                    await stt_queue.join()
                    await websocket.send_json({"type": "done"})
                    break
    except WebSocketDisconnect:
        logger.info("Audio input stream client disconnected")
    except Exception as error:
        logger.error(f"Audio input stream socket error: {error}")
    finally:
        try:
            pending = segmenter.flush()
            if pending is not None:
                enqueue(pending)
            await asyncio.wait_for(stt_queue.join(), timeout=30)
        except Exception:
            pass
        stt_queue.put_nowait(None)
        try:
            await asyncio.wait_for(stt_consumer, timeout=5)
        except Exception:
            stt_consumer.cancel()
        tracker.log_summary()
        if latency_log and segmenter.dropped_short:
            logger.info(
                "[latency] dropped %d short utterance(s) this session",
                segmenter.dropped_short,
            )
