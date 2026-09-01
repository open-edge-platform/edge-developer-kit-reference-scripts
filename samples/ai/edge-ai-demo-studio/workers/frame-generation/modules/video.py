# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""FPS upscaling / slow motion of whole video files with the RIFE interpolator.

Decodes the source video and generates `multiplier - 1` intermediate frames
between every pair of consecutive frames. In "fps" mode the result is encoded
at `multiplier x` the original frame rate (same duration, smoother motion) and
the audio track, if any, is remuxed unchanged. In "slowmo" mode the result
keeps the original frame rate (duration stretches by `multiplier x`) and audio
is dropped, as it cannot be stretched meaningfully.
"""

from fractions import Fraction

import av
import numpy as np

from modules.logger import getLogger

# Pairs interpolated per model call. Full frames are much larger than the
# face crops the lipsync path uses, so keep the batch small to bound memory.
GAP_CHUNK = 4


def probe_video(input_path):
    """Return (fps, n_frames_estimate) for the video stream."""
    with av.open(input_path) as container:
        stream = container.streams.video[0]
        rate = stream.average_rate or stream.guessed_rate
        n_frames = stream.frames
        if not n_frames and stream.duration and rate:
            n_frames = int(stream.duration * stream.time_base * rate)
        return float(rate) if rate else None, n_frames or 0


def interpolate_video_file(
    generator,
    lock,
    input_path,
    output_path,
    multiplier,
    mode="fps",
    progress_cb=None,
):
    """Interpolate input_path with RIFE, for FPS upscaling or slow motion.

    Frames are never rescaled: the output keeps the source resolution, with
    two display-fidelity exceptions. Rotation metadata (phone videos) is
    baked into the pixels so the output plays upright without relying on a
    display matrix, and odd dimensions are cropped by one pixel because
    yuv420p H.264 requires even sizes. Anamorphic sources keep their sample
    aspect ratio, so the displayed proportions match the original.

    Args:
        generator: OpenVINOFrameGenerator (shared, not thread-safe).
        lock: lock serializing access to the generator.
        input_path: source video path.
        output_path: output .mp4 path.
        multiplier: integer frame multiplier (>= 2).
        mode: "fps" (multiplier x frame rate, same duration, audio kept) or
            "slowmo" (same frame rate, multiplier x duration, audio dropped).
        progress_cb: optional callable(fraction_done: float).
    """
    n_fill = multiplier - 1
    slowmo = mode == "slowmo"

    with av.open(str(input_path)) as src, av.open(str(output_path), "w") as out:
        in_v = src.streams.video[0]
        in_rate = in_v.average_rate or in_v.guessed_rate or Fraction(25, 1)
        out_rate = Fraction(in_rate) if slowmo else Fraction(in_rate) * multiplier

        total_frames = in_v.frames
        if not total_frames and in_v.duration:
            total_frames = int(in_v.duration * in_v.time_base * in_rate)

        out_v = out.add_stream("libx264", rate=out_rate)
        out_v.pix_fmt = "yuv420p"
        out_v.options = {"crf": "20", "preset": "veryfast"}
        # Anamorphic sources: keep the pixel aspect ratio so the displayed
        # proportions match the original without resampling any pixels.
        if in_v.sample_aspect_ratio:
            out_v.sample_aspect_ratio = in_v.sample_aspect_ratio

        # Slow motion drops audio: the stretched timeline has no meaningful
        # audio track to carry over.
        in_a = (
            None
            if slowmo
            else next((s for s in src.streams if s.type == "audio"), None)
        )
        out_a = out.add_stream_from_template(in_a) if in_a else None

        state = {"index": 0, "decoded": 0}

        def emit(arr):
            frame = av.VideoFrame.from_ndarray(
                np.clip(arr, 0, 255).astype(np.uint8), format="rgb24"
            )
            frame.pts = state["index"]
            frame.time_base = Fraction(1, 1) / out_rate
            state["index"] += 1
            out.mux(out_v.encode(frame))

        def flush_pairs(pairs):
            if not pairs:
                return
            gaps = [(a, b, n_fill) for a, b in pairs]
            with lock:
                fills = generator.interpolate_gaps(gaps)
            for (a, _), fill in zip(pairs, fills):
                emit(a)
                for f in fill:
                    emit(f)
            state["decoded"] += len(pairs)
            if progress_cb and total_frames:
                progress_cb(min(state["decoded"] / total_frames, 1.0))

        rotation_quarters = None

        def prepare(frame):
            """Decoded frame -> upright, even-dimensioned rgb24 ndarray."""
            nonlocal rotation_quarters
            arr = frame.to_ndarray(format="rgb24")
            if rotation_quarters is None:
                # frame.rotation is the display-matrix angle in degrees
                # counterclockwise (phone recordings); bake it into the
                # pixels so the output plays upright everywhere. Only
                # right-angle rotations occur in practice.
                angle = frame.rotation or 0
                rotation_quarters = (
                    round(angle / 90) % 4 if angle % 90 == 0 else 0
                )
                if rotation_quarters:
                    getLogger(__file__).info(
                        f"Applying {angle} degree display rotation from "
                        "source metadata"
                    )
            if rotation_quarters:
                arr = np.rot90(arr, k=rotation_quarters)
            # yuv420p H.264 requires even dimensions; crop at most 1 pixel.
            h, w = arr.shape[:2]
            if (h % 2) or (w % 2):
                arr = arr[: h - h % 2, : w - w % 2]
            return np.ascontiguousarray(arr)

        # The encoder stream defaults to 640x480 and PyAV silently rescales
        # every frame to the stream size, so the real dimensions must be set
        # from the first prepared frame before anything is encoded.
        dims_set = False
        prev = None
        pending = []
        for frame in src.decode(in_v):
            arr = prepare(frame)
            if not dims_set:
                out_v.width, out_v.height = arr.shape[1], arr.shape[0]
                dims_set = True
            if prev is not None:
                pending.append((prev, arr))
                if len(pending) >= GAP_CHUNK:
                    flush_pairs(pending)
                    pending = []
            prev = arr

        flush_pairs(pending)
        if prev is not None:
            emit(prev)
        out.mux(out_v.encode())

        if in_a is not None:
            with av.open(str(input_path)) as src_audio:
                audio_stream = next(
                    s for s in src_audio.streams if s.type == "audio"
                )
                for packet in src_audio.demux(audio_stream):
                    if packet.dts is None:
                        continue
                    packet.stream = out_a
                    out.mux(packet)

    getLogger(__file__).info(
        f"Interpolated {input_path} -> {output_path} ({mode}): "
        f"{float(in_rate):.2f} FPS x{multiplier} => {float(out_rate):.2f} FPS, "
        f"{state['index']} frames"
    )
    return {
        "mode": mode,
        "multiplier": multiplier,
        "input_fps": float(in_rate),
        "output_fps": float(out_rate),
        "frames": state["index"],
    }
