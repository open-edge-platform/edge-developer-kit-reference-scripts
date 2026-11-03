# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import struct

from enum import Enum
from queue import Empty, Queue
from threading import Thread

import numpy as np
import resampy

from .constants import CONSTANTS
from .logger import getLogger


class AudioState(Enum):
    RUNNING = 0
    PAUSE = 1
    TALKING = 2
    SILENT = 3


# Sample rate assumed for a raw PCM response (no WAV header). Kokoro, the
# default TTS backend, synthesizes at 24 kHz.
DEFAULT_TTS_SAMPLE_RATE = 24000

# Linear fade applied to both ends of every sentence so one that is cut or
# padded at a non-zero sample does not click.
EDGE_FADE_SECONDS = 0.005

# A pause this long in a streamed TTS response ends a sentence: it only has to outlast the jitter
# between writes of one sentence, far shorter than synthesizing the next.
SENTENCE_GAP_SECONDS = 0.1

# How often a wait for the TTS response checks whether it was stopped.
CANCEL_POLL_SECONDS = 0.1

# WAV data sizes a streaming server writes before it knows the real size.
_UNKNOWN_WAV_SIZES = (0, 0xFFFFFFFF)

# Silence kept around each sentence's speech. TTS servers pad sentences (Kokoro: 0.2-0.35 s
# before, 0.4-1.1 s after), ~1 s of dead air back to back. Silence is SILENCE_REL_DB below the
# sentence's loudest 10 ms.
KEEP_SILENCE_BEFORE_SECONDS = 0.04
KEEP_SILENCE_AFTER_SECONDS = 0.18
SILENCE_REL_DB = -45.0


def warm_up_resampler() -> None:
    """Compile resampy's kernel now (~0.3 s), so it doesn't hold up the first sentence."""
    resampy.resample(
        np.zeros(DEFAULT_TTS_SAMPLE_RATE // 10, dtype=np.float32),
        sr_orig=DEFAULT_TTS_SAMPLE_RATE,
        sr_new=CONSTANTS.AUDIO_SAMPLE_RATE,
    )


def trim_silence(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Trim TTS padding around the speech down to KEEP_SILENCE_BEFORE/AFTER_SECONDS.

    Under 100 ms or all silent comes back unchanged.
    """
    hop = max(1, sample_rate // 100)
    frames = samples.size // hop
    if frames < 10:
        return samples
    rms = np.sqrt(
        np.mean(np.square(samples[: frames * hop].reshape(frames, hop)), axis=1)
    )
    voiced = np.nonzero(rms > rms.max() * 10 ** (SILENCE_REL_DB / 20))[0]
    if voiced.size == 0:
        return samples
    start = max(0, voiced[0] * hop - int(KEEP_SILENCE_BEFORE_SECONDS * sample_rate))
    end = min(
        samples.size,
        (voiced[-1] + 1) * hop + int(KEEP_SILENCE_AFTER_SECONDS * sample_rate),
    )
    return samples[start:end]


class WavStreamDecoder:
    """Decode a TTS response body (WAV, or bare 16-bit LE PCM) into mono float32 as it arrives.

    ``feed`` returns the samples each piece completes. A streaming server's placeholder WAV data
    size means "until the body ends".
    """

    def __init__(self, default_sample_rate=DEFAULT_TTS_SAMPLE_RATE):
        self.sample_rate = default_sample_rate
        self.channels = 1
        self.dtype = np.int16
        self._pending = b""
        self._in_data = False
        self._format_read = False
        # Bytes of audio the header announced and not yet decoded; None when
        # the size is unknown.
        self._data_left = None

    def feed(self, raw: bytes) -> np.ndarray:
        self._pending += raw
        if not self._in_data and not self._read_header():
            return np.zeros(0, dtype=np.float32)

        width = np.dtype(self.dtype).itemsize * max(self.channels, 1)
        take = len(self._pending)
        if self._data_left is not None:
            take = min(take, self._data_left)
        take -= take % width
        data, self._pending = self._pending[:take], self._pending[take:]
        if self._data_left is not None:
            self._data_left -= take
            if self._data_left < width:
                # Anything after the announced audio is another RIFF chunk.
                self._data_left = 0
                self._pending = b""
        return self._to_float(data)

    def _read_header(self) -> bool:
        """Parse the WAV header; False while more of it has yet to arrive."""
        raw = self._pending
        if len(raw) < 12:
            # Too short to tell a WAV header from raw PCM yet.
            if raw[:4] == b"RIFF"[: len(raw[:4])]:
                return False
            self._in_data = True
            return True
        if raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
            self._in_data = True
            return True

        offset = 12
        while offset + 8 <= len(raw):
            chunk_id = raw[offset : offset + 4]
            (chunk_size,) = struct.unpack("<I", raw[offset + 4 : offset + 8])
            body = offset + 8
            if chunk_id == b"data":
                self._data_left = (
                    None if chunk_size in _UNKNOWN_WAV_SIZES else chunk_size
                )
                self._pending = raw[body:]
                self._in_data = True
                return True
            if chunk_id == b"fmt " and chunk_size >= 16 and not self._format_read:
                if body + 16 > len(raw):
                    return False
                self._read_format(raw[body : body + 16])
            # RIFF chunks are padded to an even length.
            offset = body + chunk_size + (chunk_size & 1)
        return False

    def _read_format(self, fmt: bytes):
        audio_format, channels, sample_rate, _, _, bits = struct.unpack("<HHIIHH", fmt)
        self._format_read = True
        self.channels = channels
        self.sample_rate = sample_rate
        if bits == 16:
            self.dtype = np.int16
        elif bits == 32 and audio_format == 3:
            self.dtype = np.float32
        elif bits == 32:
            self.dtype = np.int32
        else:
            getLogger("TTS").warning(
                f"Unsupported WAV sample format ({audio_format}, {bits} bit); "
                "decoding as 16-bit PCM"
            )

    def _to_float(self, data: bytes) -> np.ndarray:
        samples = np.frombuffer(data, dtype=self.dtype)
        if self.dtype == np.int16:
            samples = samples.astype(np.float32) / 32768
        elif self.dtype == np.int32:
            samples = samples.astype(np.float32) / 2147483648
        else:
            samples = samples.astype(np.float32)
        if self.channels > 1:
            samples = samples.reshape(-1, self.channels).mean(axis=1)
        return np.ascontiguousarray(samples)


def decode_audio_bytes(raw: bytes, default_sample_rate=DEFAULT_TTS_SAMPLE_RATE):
    """Decode a whole TTS response body into ``(samples, sample_rate)``."""
    decoder = WavStreamDecoder(default_sample_rate)
    samples = decoder.feed(raw)
    return samples, decoder.sample_rate


class TTSModule:
    def __init__(self, message_queue, audio_queue, batch_size=16):
        self.fps = CONSTANTS.AUDIO_FPS
        self.sample_rate = CONSTANTS.AUDIO_SAMPLE_RATE
        self.chunk_size = CONSTANTS.AUDIO_CHUNK_SIZE
        self.batch_size = batch_size

        self.message_queue: Queue = message_queue
        self.audio_queue: Queue = audio_queue

        self.state: AudioState = AudioState.RUNNING

        # Bumped by interrupt(): speech started under an older generation is
        # dropped instead of queued.
        self.generation = 0

    def get_fps(self):
        return self.fps

    def get_sample_rate(self):
        return self.sample_rate

    def get_chunk_size(self):
        return self.chunk_size

    def text_to_audio(self, message: str, metadata=None):
        NotImplemented

    def interrupt(self):
        """Drop the speech in progress, including the rest of the TTS response."""
        self.generation += 1

    def stream_tts(self, audio_frame, metadata=None, generation=None):
        """Turn one utterance's TTS response into pipeline audio chunks, a sentence at a time.

        Each sentence is queued whole as soon as it arrives, so the avatar starts speaking early and
        silence is never padded mid-sentence. It is resampled in one piece (no chunk-boundary
        discontinuities), faded at both ends and padded only at its end.
        """
        if generation is None:
            generation = self.generation

        decoder = WavStreamDecoder()
        # Samples too few to make a chunk wait for the next sentence.
        carried = np.zeros(0, dtype=np.float32)
        spoke = False
        for body in self._sentences(audio_frame, generation):
            samples = np.concatenate([carried, decoder.feed(body)])
            if samples.size * self.sample_rate < self.chunk_size * decoder.sample_rate:
                carried = samples
                continue
            carried = np.zeros(0, dtype=np.float32)
            chunks = self._sentence_chunks(samples, decoder.sample_rate, metadata)
            spoke = self._enqueue_chunks(chunks, generation) or spoke

        if carried.size * self.sample_rate >= decoder.sample_rate:
            # A last sentence (or a whole utterance) shorter than a chunk.
            chunks = self._sentence_chunks(carried, decoder.sample_rate, metadata)
            spoke = self._enqueue_chunks(chunks, generation) or spoke
        if spoke:
            self._enqueue_chunks(
                [(np.zeros(self.chunk_size, dtype=np.float32), metadata)], generation
            )

    def _sentences(self, body, generation):
        """The TTS response body, one ``bytes`` per sentence (split at SENTENCE_GAP_SECONDS pauses).

        Ends early, without waiting on the server, once interrupted.
        """
        arrived = Queue()
        end = object()

        def interrupted():
            return self.generation != generation

        def read():
            try:
                if not interrupted():
                    for chunk in body:
                        if interrupted():
                            break
                        if chunk:
                            arrived.put(chunk)
            except Exception as e:
                getLogger("TTS").warning(f"TTS response ended early: {e}")
            finally:
                # Closes the response too when ``body`` is a generator that
                # was left mid-way.
                close = getattr(body, "close", None)
                if close is not None:
                    try:
                        close()
                    except Exception:
                        pass
                arrived.put(end)

        Thread(target=read, name="tts-response", daemon=True).start()

        pieces = []
        while True:
            try:
                item = arrived.get(
                    timeout=SENTENCE_GAP_SECONDS if pieces else CANCEL_POLL_SECONDS
                )
            except Empty:
                if interrupted():
                    return
                if pieces:
                    yield b"".join(pieces)
                    pieces = []
                continue
            if item is end:
                if pieces and not interrupted():
                    yield b"".join(pieces)
                return
            pieces.append(item)

    def _sentence_chunks(self, samples, sample_rate, metadata):
        samples = trim_silence(samples, sample_rate)
        if sample_rate != self.sample_rate:
            samples = resampy.resample(
                x=samples, sr_orig=sample_rate, sr_new=self.sample_rate
            ).astype(np.float32)

        # Resampling can overshoot full scale; the WebRTC path converts to
        # int16, where anything past ±1.0 would wrap into a loud click.
        samples = np.clip(samples, -1.0, 1.0)

        fade = min(int(EDGE_FADE_SECONDS * self.sample_rate), samples.size // 2)
        if fade > 0:
            samples[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
            samples[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)

        padding = (-samples.size) % self.chunk_size
        if padding:
            samples = np.concatenate([samples, np.zeros(padding, dtype=np.float32)])

        return [
            (samples[i : i + self.chunk_size], metadata)
            for i in range(0, samples.size, self.chunk_size)
        ]

    def _enqueue_chunks(self, chunks, generation=None):
        """Queue a whole sentence in one step; False if ``generation`` was interrupted meanwhile.

        The consumer pads each batch with silence, so queuing chunk by chunk could splice silence
        into the middle of a sentence.
        """
        if not chunks:
            return False
        queue = self.audio_queue
        with queue.mutex:
            # Under the lock: a stop interrupts before the avatar clears the queue (under this
            # lock), so a sentence is either cleared with the rest or dropped here.
            if generation is not None and generation != self.generation:
                return False
            queue.queue.extend(chunks)
            queue.unfinished_tasks += len(chunks)
            queue.not_empty.notify_all()
        return True
