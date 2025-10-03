# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import copy
import numpy as np
import asyncio
import time

from openai import OpenAI
from threading import Event, Thread
from av import AudioFrame, VideoFrame

from modules.base.logger import getLogger
from modules.base.webrtc import WebRTCStreamer

from modules.lipsync.wav2lip.wav2lip_avatar import Wav2lipAvatar
from modules.texttospeech.openaicompatible_tts import OpenAICompatibleTTSModule


class WebRTCAvatar(WebRTCStreamer):
    def __init__(self, avatar_id, configs, tts_port, device):
        super().__init__()

        self.configs = configs
        self.history = []

        if self.configs.get("avatar_type", "wav2lip") == "wav2lip":
            self.avatar = Wav2lipAvatar(
                avatar_id=avatar_id, configs=configs, device=device
            )
        else:
            getLogger().error("Lipsync model not supported!")
            exit(1)

        self.tts = OpenAICompatibleTTSModule(
            message_queue=self.avatar.message_queue,
            audio_queue=self.avatar.audio_input_queue,
            batch_size=self.avatar.batch_size,
            configs=self.configs,
            url=f"http://localhost:{tts_port}/v1",
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

    def sleep_track(self, track):
        if track:
            track.sleep(self.avatar.batch_size)

    def llm_clear_history(self):
        self.history = []

    def llm_stop_response(self):
        self.tts.stop()
        self.avatar.stop()

    def echo(self, text, voice, model, speed):
        self.tts.speak(text, {"voice": voice, "model": model, "speed": speed})

    def webrtc(self, signal_event, loop, video_track, audio_track):
        while not signal_event.is_set():
            try:
                video_frame, audio_frame = self.avatar.combined_frame_queue.get(
                    block=True, timeout=1
                )
            except:
                continue

            image = video_frame

            image[0, :] &= 0xFE
            new_frame = VideoFrame.from_ndarray(image, format="bgr24")
            asyncio.run_coroutine_threadsafe(video_track.queue.put(new_frame), loop)

            for af in audio_frame:
                oframe, _, _ = af
                frame = copy.deepcopy(oframe)
                frame = (frame * 32767).astype(np.int16)
                new_frame = AudioFrame(
                    format="s16", layout="mono", samples=frame.shape[0]
                )
                new_frame.planes[0].update(frame.tobytes())
                new_frame.sample_rate = 16000
                asyncio.run_coroutine_threadsafe(audio_track.queue.put(new_frame), loop)

    def stream(self, signal_event, loop=None, video_track=None, audio_track=None):
        Thread(target=self.tts.inference, args=(signal_event,)).start()
        Thread(target=self.avatar.start, args=(signal_event,)).start()
        Thread(
            target=self.webrtc, args=(signal_event, loop, video_track, audio_track)
        ).start()

        while not signal_event.is_set():
            self.avatar.text_to_speech()
            self.sleep_track(video_track)
