# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import requests
import resampy
import numpy as np

from modules.base.logger import getLogger
from modules.base.tts import TTSModule, AudioState


class KokoroTTSModule(TTSModule):
    def __init__(self, message_queue, audio_queue, url, batch_size=16, configs={}):
        super().__init__(message_queue, audio_queue, batch_size)

        self.configs = configs
        self.server_url = url

    def kokoro_tts(self, message, language_code):
        selected_lang = (
            self.configs.get("kokorotts", {})
            .get("languages", {})
            .get(language_code, {})
        )
        voice = selected_lang.get("voice", "af_heart+af_sky")
        lang_code = selected_lang.get("lang_code", "a")

        req = {
            "model": "kokoro",
            "input": message,
            "voice": voice,
            "response_format": "pcm",
            "download_format": "pcm",
            "speed": 1,
            "stream": True,
            "return_download_link": False,
            "lang_code": lang_code,
            "normalization_options": {
                "normalize": True,
                "unit_normalization": False,
                "url_normalization": True,
                "email_normalization": True,
                "optional_pluralization_normalization": True,
                "phone_normalization": True,
            },
        }

        try:
            res = requests.post(
                f"{self.server_url}/audio/speech",
                json=req,
                stream=True,
                headers={"content-type": "application/json"},
            )
            if res.status_code != 200:
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
                language_code = metadata.get("language_code", "en_us")
                metadata["message"] = message
                self.stream_tts(self.kokoro_tts(message, language_code), metadata)

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
        self.audio_queue.put((np.zeros(self.chunk_size, np.float32), metadata))
