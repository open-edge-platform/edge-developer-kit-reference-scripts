# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import requests

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
                language_code = metadata.get("language_code", "en_us")
                metadata["message"] = message
                self.stream_tts(
                    self.kokoro_tts(message, language_code), metadata, generation
                )

                self.state = AudioState.RUNNING
            except:
                continue
