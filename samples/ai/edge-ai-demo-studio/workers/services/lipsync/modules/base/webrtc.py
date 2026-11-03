# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import time
import asyncio

from threading import Event, Thread
from typing import Optional, Set, Union
from av.frame import Frame
from av.packet import Packet
from aiortc import MediaStreamTrack

from .constants import CONSTANTS

# A track that ran out of frames (inference below real time) and is this far behind its clock
# restarts the clock rather than catch up: a catch-up burst shows as a few frames of each batch,
# then the idle avatar sped up.
MAX_LAG_SECONDS = 0.1

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
        starved = self.queue.empty()
        frame = await self.queue.get()

        if self.readyState != "live":
            raise Exception

        if hasattr(self, "timestamp"):
            self.timestamp += int(CONSTANTS.AUDIO_PTIME * CONSTANTS.AUDIO_SAMPLE_RATE)
            self.frame_count += 1
            wait = (
                self.start_time + self.frame_count * CONSTANTS.AUDIO_PTIME - time.time()
            )
            if starved and wait < -MAX_LAG_SECONDS:
                self.start_time -= wait
            elif wait > 0:
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
        starved = self.queue.empty()
        frame = await self.queue.get()

        if self.readyState != "live":
            raise Exception

        if hasattr(self, "timestamp"):
            self.timestamp += int(CONSTANTS.VIDEO_PTIME * CONSTANTS.VIDEO_CLOCK_RATE)
            self.frame_count += 1
            wait = (
                self.start_time + self.frame_count * CONSTANTS.VIDEO_PTIME - time.time()
            )
            if starved and wait < -MAX_LAG_SECONDS:
                self.start_time -= wait
            elif wait > 0:
                await asyncio.sleep(wait)
        else:
            self.start_time = time.time()
            self.timestamp = 0

        frame.pts = self.timestamp
        frame.time_base = CONSTANTS.VIDEO_TIME_BASE

        return frame


def drop_newest_frames(video_track: VideoTrack, audio_track: AudioTrack) -> int:
    """Drop the newest queued video frames and the same duration of audio, keeping both in sync.

    Must run on the event loop that owns the track queues. Returns how many video frames went.
    """
    per_video = round(CONSTANTS.VIDEO_PTIME / CONSTANTS.AUDIO_PTIME)
    n = min(video_track.queue.qsize(), audio_track.queue.qsize() // per_video)
    if n <= 0:
        return 0
    for queue, drop in ((video_track.queue, n), (audio_track.queue, n * per_video)):
        kept = [queue.get_nowait() for _ in range(queue.qsize())][:-drop]
        for frame in kept:
            queue.put_nowait(frame)
    return n


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
