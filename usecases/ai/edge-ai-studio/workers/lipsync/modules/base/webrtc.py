# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import time
import asyncio

from threading import Event, Thread
from typing import Optional, Set, Union
from av.frame import Frame
from av.packet import Packet
from aiortc import MediaStreamTrack

from .constants import CONSTANTS

# Reference: 
# https://github.com/aiortc/aiortc/blob/main/src/aiortc/mediastreams.py
# https://github.com/aiortc/aiortc/blob/main/src/aiortc/contrib/media.py

class AudioTrack(MediaStreamTrack):
    start_time: float
    timestamp: int

    def __init__(self):
        super().__init__()
        self.queue = asyncio.Queue()
        self.frame_count = 0
        self.kind = "audio"

    async def recv(self) -> Union[Frame, Packet]:
        frame = await self.queue.get()

        if self.readyState != "live":
            raise Exception

        if hasattr(self, "timestamp"):
            self.timestamp += int(CONSTANTS.AUDIO_PTIME * CONSTANTS.AUDIO_SAMPLE_RATE)
            self.frame_count += 1
            wait = self.start_time + self.frame_count * CONSTANTS.AUDIO_PTIME - time.time()
            if wait > 0:
                await asyncio.sleep(wait)
        else:
            self.start_time = time.time()
            self.timestamp = 0

        frame.pts = self.timestamp
        frame.time_base = CONSTANTS.AUDIO_TIME_BASE
        
        return frame

class VideoTrack(MediaStreamTrack):
    start_time: float
    timestamp: int

    def __init__(self):
        super().__init__()
        self.queue = asyncio.Queue()
        self.frame_count = 0
        self.kind = "video"

    async def recv(self) -> Union[Frame, Packet]:
        frame = await self.queue.get()

        if self.readyState != "live":
            raise Exception

        if hasattr(self, "timestamp"):
            self.timestamp += int(CONSTANTS.VIDEO_PTIME * CONSTANTS.VIDEO_CLOCK_RATE)
            self.frame_count += 1
            wait = self.start_time + self.frame_count * CONSTANTS.VIDEO_PTIME - time.time()        
            if wait > 0:
                await asyncio.sleep(wait)
        else:
            self.start_time = time.time()
            self.timestamp = 0

        frame.pts = self.timestamp
        frame.time_base = CONSTANTS.VIDEO_TIME_BASE
        
        return frame
    
    def sleep(self, batch_size) -> None:
        if self.queue.qsize() >= 1.5 * batch_size:
            time.sleep(0.04 * self.queue.qsize() * 0.8)

class WebRTCStreamer:
    def __init__(self):
        self.thread: Optional[Thread] = None
        self.thread_quit: Optional[Event] = None
        
        self.started: Set[MediaStreamTrack] = set()

        self.audio_track = AudioTrack()
        self.video_track = VideoTrack()

    @property
    def audio(self) -> MediaStreamTrack:
        return self.audio_track

    @property
    def video(self) -> MediaStreamTrack:
        return self.video_track

    def get_av_tracks(self):
        return self.audio_track, self.video_track

    def start(self, track: Union[AudioTrack, VideoTrack]) -> None:
        self.started.add(track)
    
    def stop(self, track: Union[AudioTrack, VideoTrack]) -> None:
        self.started.discard(track)
