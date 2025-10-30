# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from enum import Enum
from queue import Queue
from .constants import CONSTANTS

class AudioState(Enum):
    RUNNING = 0
    PAUSE = 1
    TALKING = 2
    SILENT = 3

class TTSModule:
    def __init__(self, message_queue, audio_queue, batch_size=16):
        self.fps = CONSTANTS.AUDIO_FPS
        self.sample_rate = CONSTANTS.AUDIO_SAMPLE_RATE
        self.chunk_size = CONSTANTS.AUDIO_CHUNK_SIZE
        self.batch_size = batch_size

        self.message_queue : Queue = message_queue
        self.audio_queue : Queue = audio_queue

        self.state : AudioState = AudioState.RUNNING

    def get_fps(self):
        return self.fps
    
    def get_sample_rate(self):
        return self.sample_rate

    def get_chunk_size(self):
        return self.chunk_size

    def text_to_audio(self, message : str, metadata=None):
        NotImplemented

    def stream_tts(self, audio_frame, metadata=None):
        NotImplemented