# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import requests
import resampy
import numpy as np

from modules.base.logger import getLogger
from modules.base.tts import TTSModule, AudioState


class OpenAICompatibleTTSModule(TTSModule):
    def __init__(self, message_queue, audio_queue, url, batch_size=16, configs={}):
        super().__init__(message_queue, audio_queue, batch_size)

        self.configs = configs
        self.server_url = url

    def openai_compatible_tts(self, message, voice, model, speed):
        req = {
            "model": model,
            "input": message,
            "voice": voice,
            "stream": True,
            "response_format": "wav",
            "download_format": "wav",
            "speed": speed,
            "return_download_link": False,
            "normalization_options": {
                "normalize": True,
                "unit_normalization": False,
                "url_normalization": True,
                "email_normalization": True,
                "optional_pluralization_normalization": True,
                "phone_normalization": True,
            },
        }
        getLogger("TTS").info(req)

        try:
            res = requests.post(
                f"{self.server_url}/audio/speech",
                json=req,
                stream=True,
                headers={"content-type": "application/json"},
            )
            if res.status_code != 200:
                getLogger("TTS").info(
                    f"TTS request failed with status code: {res.status_code}"
                )
                getLogger("TTS").info(f"Error response: {res.text}")
                return

            for chunk in res.iter_content(chunk_size=9600):
                if chunk and self.state == AudioState.RUNNING:
                    yield chunk

        except Exception as e:
            getLogger().info(e)

    def speak(self, message, metadata={}):
        print(message, metadata)
        if len(message) > 0:
            self.message_queue.put((message, metadata))

    def stop(self):
        with self.message_queue.mutex:
            self.message_queue.queue.clear()

    def inference(self, signal_event):
        while not signal_event.is_set():
            try:
                message, metadata = self.message_queue.get(block=True, timeout=1)
                voice = metadata.get("voice", "af_heart")
                model = metadata.get("model", "kokoro")
                speed = metadata.get("speed", "1.0")
                metadata["message"] = message
                self.stream_tts(
                    self.openai_compatible_tts(message, voice, model, speed), metadata
                )

                self.state = AudioState.RUNNING
            except:
                continue

    def stream_tts(self, audio_frame, metadata):
        for chunk in audio_frame:
            if chunk is not None and len(chunk) > 0:
                stream = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32767

                stream = resampy.resample(
                    x=stream,
                    sr_orig=24000,  # kokorotts sample rate
                    sr_new=self.sample_rate,  # target sample rate
                )

                index, stream_length = 0, stream.shape[0]
                while stream_length >= self.chunk_size:
                    self.audio_queue.put(
                        (stream[index : index + self.chunk_size], metadata)
                    )
                    stream_length -= self.chunk_size
                    index += self.chunk_size
                    getLogger("Test").info(f"stream -1: {self.audio_queue.qsize()}")

                # Handle remaining data that's smaller than chunk_size
                if stream_length > 0:
                    remaining_chunk = np.zeros(self.chunk_size, dtype=np.float32)
                    remaining_chunk[:stream_length] = stream[
                        index : index + stream_length
                    ]
                    self.audio_queue.put((remaining_chunk, metadata))
                    getLogger("Test").info(f"stream -2: {self.audio_queue.qsize()}")

        self.audio_queue.put((np.zeros(self.chunk_size, np.float32), metadata))
