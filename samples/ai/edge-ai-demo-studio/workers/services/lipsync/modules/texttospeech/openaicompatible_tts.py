# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import requests

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

            try:
                # Whatever has arrived, as it arrives: a fixed read size
                # would hold a sentence back until the next one fills it.
                for chunk in res.iter_content(chunk_size=None):
                    if chunk and self.state == AudioState.RUNNING:
                        yield chunk
            finally:
                res.close()

        except Exception as e:
            getLogger().info(e)

    def speak(self, message, metadata={}):
        getLogger("TTS").info(f"{message} {metadata}")
        if len(message) > 0:
            self.message_queue.put((message, metadata, self.generation))

    def stop(self):
        self.interrupt()
        with self.message_queue.mutex:
            self.message_queue.queue.clear()

    def inference(self, signal_event):
        while not signal_event.is_set():
            try:
                message, metadata, generation = self.message_queue.get(
                    block=True, timeout=1
                )
                if generation != self.generation:
                    continue
                voice = metadata.get("voice") or "af_heart"
                model = metadata.get("model") or "kokoro"
                speed = metadata.get("speed") or "1.0"
                metadata["message"] = message
                self.stream_tts(
                    self.openai_compatible_tts(message, voice, model, speed),
                    metadata,
                    generation,
                )

                self.state = AudioState.RUNNING
            except:
                continue
