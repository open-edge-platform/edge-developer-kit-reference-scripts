# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import math
import numpy as np
import asyncio
import time
import json

from openai import OpenAI
from threading import Event, Thread
from av import AudioFrame, VideoFrame

from worker_common import studio_address

from modules.base.constants import CONSTANTS
from modules.base.logger import getLogger
from modules.base.webrtc import WebRTCStreamer, drop_newest_frames

from modules.lipsync.wav2lip.wav2lip_avatar import Wav2lipAvatar
from modules.lipsync.musetalk.musetalk_avatar import MuseTalkAvatar
from modules.texttospeech.openaicompatible_tts import OpenAICompatibleTTSModule

AVATAR_MODELS = {
    "wav2lip": Wav2lipAvatar,
    "musetalk": MuseTalkAvatar,
}

# Minimum batches kept ahead of playback during speech (on the track or in the pipeline): a
# cushion against slow batches, which Stop discards.
BACKLOG_BATCHES = 2.0

# Frames ahead also cover this many batch inferences beyond the batch in flight, so playback
# doesn't run dry. Inference keeps up when a batch plays for at least this many inferences of it.
INFERENCE_MARGIN = 1.5

# Frames ahead while no speech is queued and inference keeps up (or half an idle batch, if more).
# Silent batches are made just in time because new speech queues behind them; dropping them
# instead makes the head jump along its idle loop. If inference lags, the speech limit applies.
IDLE_BACKLOG_FRAMES = 4

# How often a backpressure wait checks the backlog again and, when it began
# with no speech queued, whether speech has arrived.
BACKLOG_POLL_SECONDS = 0.005


class WebRTCAvatar(WebRTCStreamer):
    def __init__(
        self,
        avatar_id,
        configs,
        device,
        ws_manager=None,
        use_int8=False,
        frame_gen_plan=None,
    ):
        super().__init__()

        self.configs = configs
        self.history = []
        self.ws_manager = ws_manager
        self.session_id = avatar_id
        self.is_processing = False
        self.last_queue_check_time = 0
        self.queue_check_interval = 0.5  # Check every 500ms
        self.loop = None  # Event loop will be set when stream starts

        avatar_type = self.configs.get("avatar_type", "wav2lip")
        avatar_cls = AVATAR_MODELS.get(avatar_type)
        if avatar_cls is None:
            getLogger().error(f"Lipsync model '{avatar_type}' not supported!")
            exit(1)
        self.avatar = avatar_cls(
            avatar_id=avatar_id,
            configs=configs,
            device=device,
            use_int8=use_int8,
            frame_gen_plan=frame_gen_plan,
        )

        self.tts = OpenAICompatibleTTSModule(
            message_queue=self.avatar.message_queue,
            audio_queue=self.avatar.audio_input_queue,
            batch_size=self.avatar.batch_size,
            configs=self.configs,
            url="",
        )

    def __del__(self):
        self.stop()

    def start(self):
        self.start_track(self.audio)
        self.start_track(self.video)

    def stop(self):
        self.stop_track(self.audio)
        self.stop_track(self.video)

    def start_track(self, track):
        super().start(track)

        if self.thread is None:
            self.thread_quit = Event()
            self.thread = Thread(
                target=self.stream,
                args=(
                    self.thread_quit,
                    asyncio.get_event_loop(),
                    self.video_track,
                    self.audio_track,
                ),
            )
            self.thread.start()

    def stop_track(self, track):
        super().stop(track)

        if self.thread is not None:
            self.thread_quit.set()
            self.thread.join()
            self.thread = None

    def inference_cover_frames(self):
        """Frames that play during INFERENCE_MARGIN batch inferences (0 until one is measured)."""
        return math.ceil(
            INFERENCE_MARGIN
            * self.avatar.batch_inference_seconds
            / CONSTANTS.VIDEO_PTIME
        )

    def inference_keeps_up(self):
        """Whether a batch plays for at least INFERENCE_MARGIN inferences of it."""
        return self.inference_cover_frames() <= self.avatar.batch_size

    def frames_ahead(self, track):
        """Frames ahead of playback: queued on ``track`` or anywhere in the pipeline."""
        avatar = self.avatar
        features = avatar.audio_feature_queue
        with features.mutex:
            waiting = sum(n_frames for n_frames, _ in features.queue)
        return (
            track.queue.qsize()
            + waiting
            + avatar.frames_in_lip_sync
            + avatar.result_frame_queue.qsize()
            + avatar.combined_frame_queue.qsize()
        )

    def backlog_limit(self):
        """Frames sleep_track() lets ahead of playback: the idle limit while no speech is queued and
        inference keeps up, else the speech limit.

        Talking frames still in the pipeline don't count as speech: the batch after them is silent.
        """
        avatar = self.avatar
        if avatar.audio_input_queue.empty() and self.inference_keeps_up():
            idle_batch = avatar.idle_batch_frames or avatar.batch_size
            return max(IDLE_BACKLOG_FRAMES, idle_batch // 2)
        return max(
            int(BACKLOG_BATCHES * avatar.batch_size),
            avatar.batch_size + self.inference_cover_frames(),
        )

    def short_of_a_batch(self):
        """Whether queued speech fills only part of a batch (a sentence's end, or a short one)."""
        queued = self.avatar.audio_input_queue.qsize()
        return 0 < queued < self.avatar.batch_size * 2

    def padding_margin(self):
        """Frames ahead at which the producer stops waiting for the next sentence and pads silence."""
        return IDLE_BACKLOG_FRAMES + 2 * self.inference_cover_frames()

    def sleep_track(self, track, signal_event):
        """Producer backpressure: wait while frames_ahead() exceeds backlog_limit(), and for a partial
        speech batch until padding_margin(), so the next sentence can fill it instead of silence.

        Polled every BACKLOG_POLL_SECONDS so frames Stop drops are made up at once.
        """
        if not track:
            return
        avatar = self.avatar
        limit = self.backlog_limit()
        idle = avatar.audio_input_queue.empty()
        while not signal_event.is_set():
            if idle and not avatar.audio_input_queue.empty():
                idle = False
                limit = self.backlog_limit()
            ahead = self.frames_ahead(track)
            if ahead <= limit and not (
                self.short_of_a_batch() and ahead > self.padding_margin()
            ):
                return
            time.sleep(BACKLOG_POLL_SECONDS)

    def llm_clear_history(self):
        self.history = []

    def llm_stop_response(self):
        self.tts.stop()
        self.avatar.stop()
        # The frames already on the tracks would otherwise keep the avatar
        # talking for as long as they take to play.
        if self.loop is not None:
            self.loop.call_soon_threadsafe(
                drop_newest_frames, self.video_track, self.audio_track
            )

    def echo(self, text, voice, model, speed, tts_url=None):
        if tts_url:
            # The app hands over the TTS instance's path on itself, so the
            # speech requests go through its proxy and count for that instance.
            self.tts.server_url = studio_address(tts_url)
        # Keep counting across overlapping requests; stats reset only once
        # the previous utterance finished (processing_complete reported).
        if not self.is_processing:
            self.avatar.reset_frame_stats()
        self._notify_status("processing_started")
        self.is_processing = True
        self.tts.speak(text, {"voice": voice, "model": model, "speed": speed})

    def process_audio(self, audio_data, metadata=None):
        """Queue raw 16 kHz mono audio for lipsync streaming; ``metadata`` carries the text overlay."""
        chunk_size = self.avatar.audio_chunk_size
        audio_chunks = []

        for i in range(0, len(audio_data), chunk_size):
            chunk = audio_data[i : i + chunk_size]
            if len(chunk) < chunk_size:
                padded_chunk = np.zeros(chunk_size, dtype=np.float32)
                padded_chunk[: len(chunk)] = chunk
                chunk = padded_chunk
            audio_chunks.append(chunk)

        # Keep counting across overlapping requests, as in echo().
        if not self.is_processing:
            self.avatar.reset_frame_stats()
        self._notify_status("processing_started")
        self.is_processing = True
        for chunk in audio_chunks:
            self.avatar.audio_input_queue.put((chunk, metadata))

        getLogger(__file__).info(
            f"Queued {len(audio_chunks)} audio chunks for processing"
        )

    def webrtc(self, signal_event, loop, video_track, audio_track):
        while not signal_event.is_set():
            try:
                video_frame, audio_frame = self.avatar.combined_frame_queue.get(
                    block=True, timeout=1
                )
            except:
                self._check_queue_status()
                continue

            image = video_frame

            image[0, :] &= 0xFE
            new_frame = VideoFrame.from_ndarray(image, format="bgr24")
            asyncio.run_coroutine_threadsafe(video_track.queue.put(new_frame), loop)

            for af in audio_frame:
                oframe, _, _ = af
                # Clip before the int16 conversion: a sample past full
                # scale would otherwise wrap around into a loud click.
                frame = (np.clip(oframe, -1.0, 1.0) * 32767).astype(np.int16)
                new_frame = AudioFrame(
                    format="s16", layout="mono", samples=frame.shape[0]
                )
                new_frame.planes[0].update(frame.tobytes())
                new_frame.sample_rate = 16000
                asyncio.run_coroutine_threadsafe(audio_track.queue.put(new_frame), loop)

    def _notify_status(self, status: str, extra: dict = None):
        """Send status update via WebSocket if manager is available."""
        if self.ws_manager and self.session_id and self.loop:
            try:
                message = json.dumps(
                    {
                        "type": "lipsync_status",
                        "status": status,
                        "timestamp": time.time(),
                        **(extra or {}),
                    }
                )
                asyncio.run_coroutine_threadsafe(
                    self.ws_manager.send_message(self.session_id, message), self.loop
                )
            except Exception as e:
                getLogger(__name__).debug(f"Failed to send WebSocket status: {e}")

    def _check_queue_status(self):
        """Check if all queues are empty and notify if processing is complete."""
        current_time = time.time()

        if current_time - self.last_queue_check_time < self.queue_check_interval:
            return

        self.last_queue_check_time = current_time

        if not self.is_processing:
            return

        # pending_talk_chunks covers the internal queues, which can look empty while batches are
        # still being inferred.
        audio_empty = self.avatar.audio_input_queue.empty()
        message_empty = self.avatar.message_queue.empty()
        frame_empty = self.avatar.combined_frame_queue.empty()
        talking_done = self.avatar.pending_talk_chunks == 0

        if audio_empty and message_empty and frame_empty and talking_done:
            self.is_processing = False
            inferred = self.avatar.frames_inferred
            interpolated = self.avatar.frames_interpolated
            self._notify_status(
                "processing_complete",
                {
                    "frames_total": inferred + interpolated,
                    "frames_inferred": inferred,
                    "frames_interpolated": interpolated,
                },
            )
            getLogger(__name__).info(
                f"Lipsync processing complete for session {self.session_id}: "
                f"{inferred + interpolated} frames total "
                f"({inferred} inferred, {interpolated} interpolated)"
            )

    def stream(self, signal_event, loop=None, video_track=None, audio_track=None):
        self.loop = loop  # Store the event loop for use in _notify_status
        Thread(target=self.tts.inference, args=(signal_event,)).start()
        Thread(target=self.avatar.start, args=(signal_event,)).start()
        Thread(
            target=self.webrtc, args=(signal_event, loop, video_track, audio_track)
        ).start()

        while not signal_event.is_set():
            self.avatar.text_to_speech(signal_event)
            self.sleep_track(video_track, signal_event)
            self._check_queue_status()
