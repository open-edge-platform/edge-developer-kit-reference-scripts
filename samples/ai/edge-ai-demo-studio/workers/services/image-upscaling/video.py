# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Upscaling whole video files frame by frame, keeping the frame rate and the audio."""

from __future__ import annotations

from fractions import Fraction

import av
import numpy as np
from PIL import Image
from worker_common import get_logger

logger = get_logger(__name__)


def probe_video(input_path):
    """(width, height, n_frames_estimate) of the video stream, as displayed (rotation applied)."""
    with av.open(str(input_path)) as container:
        stream = container.streams.video[0]
        rate = stream.average_rate or stream.guessed_rate
        n_frames = stream.frames
        if not n_frames and stream.duration and rate:
            n_frames = int(stream.duration * stream.time_base * rate)
        width, height = stream.codec_context.width, stream.codec_context.height
        frame = next(container.decode(stream), None)
        if frame is not None:
            width, height = frame.width, frame.height
            if (frame.rotation or 0) % 180 == 90:
                width, height = height, width
        return width, height, n_frames or 0


def output_size(width: int, height: int, outscale: float) -> tuple[int, int]:
    """The encoded size: ``outscale`` times the (even-cropped) input, rounded down to even pixels."""
    width, height = width - width % 2, height - height % 2
    return int(width * outscale) // 2 * 2, int(height * outscale) // 2 * 2


def upscale_video_file(upscale_frame, input_path, output_path, outscale, progress_cb=None, cancel=None):
    """Upscale every frame of ``input_path`` into an .mp4 at ``outscale`` times its size.

    ``upscale_frame(rgb)`` runs the model on one frame (H, W, 3 uint8). ``progress_cb(fraction,
    frames_done, frames_total)`` runs after every frame; a cancelled ``cancel`` raises JobCancelled,
    leaving the output incomplete for the caller to delete.
    """
    with av.open(str(input_path)) as src, av.open(str(output_path), "w") as out:
        in_v = src.streams.video[0]
        rate = in_v.average_rate or in_v.guessed_rate or Fraction(25, 1)
        total_frames = in_v.frames
        if not total_frames and in_v.duration:
            total_frames = int(in_v.duration * in_v.time_base * rate)

        out_v = out.add_stream("libx264", rate=rate)
        out_v.pix_fmt = "yuv420p"
        out_v.options = {"crf": "18", "preset": "veryfast"}
        if in_v.sample_aspect_ratio:
            out_v.sample_aspect_ratio = in_v.sample_aspect_ratio
        in_a = next((s for s in src.streams if s.type == "audio"), None)
        out_a = out.add_stream_from_template(in_a) if in_a else None

        rotation_quarters = None
        size = None
        index = 0
        for frame in src.decode(in_v):
            if cancel:
                cancel.check()
            arr = frame.to_ndarray(format="rgb24")
            if rotation_quarters is None:
                # Bake the display rotation (phone recordings) in, so the output plays upright everywhere.
                angle = frame.rotation or 0
                rotation_quarters = round(angle / 90) % 4 if angle % 90 == 0 else 0
            if rotation_quarters:
                arr = np.rot90(arr, k=rotation_quarters)
            # yuv420p H.264 needs even dimensions: crop at most one pixel.
            h, w = arr.shape[:2]
            arr = np.ascontiguousarray(arr[: h - h % 2, : w - w % 2])
            if size is None:
                size = output_size(w, h, outscale)
                # The encoder defaults to 640x480 and PyAV silently rescales to it: set the real size first.
                out_v.width, out_v.height = size
            up = upscale_frame(arr)
            if up.shape[1::-1] != size:
                up = np.asarray(Image.fromarray(up).resize(size, Image.Resampling.LANCZOS))
            video_frame = av.VideoFrame.from_ndarray(up, format="rgb24")
            video_frame.pts = index
            video_frame.time_base = 1 / Fraction(rate)
            out.mux(out_v.encode(video_frame))
            index += 1
            if progress_cb and total_frames:
                progress_cb(min(index / total_frames, 1.0), index, max(total_frames, index))
        out.mux(out_v.encode())

        if in_a is not None:
            if cancel:
                cancel.check()
            with av.open(str(input_path)) as src_audio:
                audio_stream = next(s for s in src_audio.streams if s.type == "audio")
                for packet in src_audio.demux(audio_stream):
                    if packet.dts is None:
                        continue
                    packet.stream = out_a
                    out.mux(packet)

    if size is None:
        raise ValueError("The video has no frames")
    logger.info(f"Upscaled {input_path} -> {output_path}: {index} frames at {size[0]}x{size[1]}")
    return {"frames": index, "fps": float(rate), "output_width": size[0], "output_height": size[1]}
