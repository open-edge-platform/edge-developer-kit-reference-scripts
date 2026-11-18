# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""AV1 MP4 encoding and decoding for recorded camera frames.

Raw recordings store each camera of an episode as one MP4 instead of raw pixel arrays: a 640x480
frame is about 5 KB of AV1 instead of 900 KB of RGB. Frame ``i`` of the video is recorded frame
``i`` of the episode; the stream's nominal rate is the capture FPS.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

import numpy as np

RAW_VIDEO_CODEC = "av1"
RAW_VIDEO_PIX_FMT = "yuv420p"
# Slightly finer than the converted dataset (CRF 30) so re-encoding for training loses little.
RAW_VIDEO_CRF = 25
# A keyframe every second keeps seeking (review scrubbing, random access) cheap.
VIDEO_GOP_FRAMES = 30
SVT_AV1_PRESET = 8
# SVT-AV1 aborts the whole process on very small frames; libaom handles them.
SVT_AV1_MIN_DIMENSION = 64


class VideoCodecError(RuntimeError):
    pass


def _require_av() -> Any:
    try:
        import av
    except ModuleNotFoundError as error:  # pragma: no cover - av ships with the teleoperation extra.
        raise VideoCodecError(
            "Video recording requires PyAV. Install the optional 'teleoperation' extra."
        ) from error
    return av


def av1_encoder(width: int, height: int) -> str:
    """Return the AV1 encoder safe for this frame size (SVT-AV1 for normal camera frames)."""
    fast = min(width, height) >= SVT_AV1_MIN_DIMENSION and width % 2 == 0 and height % 2 == 0
    return "libsvtav1" if fast else "libaom-av1"


def encode_video(
    path: str | Path,
    frames: Iterable[np.ndarray],
    *,
    fps: int,
    crf: int = RAW_VIDEO_CRF,
    gop: int = VIDEO_GOP_FRAMES,
) -> dict[str, Any]:
    """Encode uint8 HxWx3 RGB frames to an AV1 MP4 and return its stream description."""
    av = _require_av()
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    container = av.open(str(destination), mode="w", format="mp4")
    stream = None
    count = 0
    shape: tuple[int, int] | None = None
    try:
        for frame in frames:
            array = np.asarray(frame)
            if array.dtype != np.uint8 or array.ndim != 3 or array.shape[2] != 3:
                raise VideoCodecError("Video frames must be uint8 HxWx3 RGB arrays.")
            if stream is None:
                height, width = int(array.shape[0]), int(array.shape[1])
                shape = (height, width)
                encoder = av1_encoder(width, height)
                stream = container.add_stream(encoder, rate=int(fps))
                stream.width = width
                stream.height = height
                stream.pix_fmt = RAW_VIDEO_PIX_FMT
                options = {"crf": str(crf), "g": str(gop)}
                options.update({"preset": str(SVT_AV1_PRESET)} if encoder == "libsvtav1" else {"cpu-used": "8"})
                stream.options = options
            elif (int(array.shape[0]), int(array.shape[1])) != shape:
                raise VideoCodecError("Every frame of a video must have the same size.")
            for packet in stream.encode(av.VideoFrame.from_ndarray(np.ascontiguousarray(array), format="rgb24")):
                container.mux(packet)
            count += 1
        if stream is None:
            raise VideoCodecError("A video needs at least one frame.")
        for packet in stream.encode():
            container.mux(packet)
    finally:
        container.close()
    assert shape is not None
    return {
        "codec": RAW_VIDEO_CODEC,
        "pixFmt": RAW_VIDEO_PIX_FMT,
        "crf": crf,
        "gop": gop,
        "fps": int(fps),
        "width": shape[1],
        "height": shape[0],
        "frameCount": count,
    }


def decode_video(path: str | Path) -> Iterator[np.ndarray]:
    """Yield the RGB frames of an MP4 in order."""
    av = _require_av()
    container = av.open(str(path), mode="r")
    try:
        for frame in container.decode(video=0):
            yield frame.to_ndarray(format="rgb24")
    finally:
        container.close()
