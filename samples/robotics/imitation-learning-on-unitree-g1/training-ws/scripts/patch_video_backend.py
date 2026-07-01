"""Monkey-patch lerobot video decoding to use PyAV directly.

torchvision.io.VideoReader has been removed in recent torchvision versions,
and torchcodec has ABI incompatibility with PyTorch XPU builds.
This patch replaces decode_video_frames_torchvision with a direct PyAV
implementation so that --dataset.video_backend pyav works.

Usage:
    python -c "import patch_video_backend" && lerobot-train ...
    # OR
    python patch_video_backend.py  (followed by lerobot-train in same process)

Intended to be imported before lerobot-train runs, e.g. via a wrapper script.
"""

import av
import torch
import numpy as np
import lerobot.datasets.video_utils as video_utils


def decode_video_frames_pyav(
    video_path,
    timestamps,
    tolerance_s,
    backend="pyav",
    log_loaded_timestamps=False,
):
    """Decode video frames using PyAV directly (no torchvision.io.VideoReader)."""
    video_path = str(video_path)

    container = av.open(video_path)
    stream = container.streams.video[0]
    stream.codec_context.thread_type = "AUTO"

    time_base = float(stream.time_base)
    fps = float(stream.average_rate) if stream.average_rate else 30.0

    first_ts = min(timestamps)
    last_ts = max(timestamps)

    # Seek to just before the first requested timestamp
    seek_ts = max(0, int(first_ts / time_base))
    container.seek(seek_ts, stream=stream, backward=True)

    loaded_frames = []
    loaded_ts = []

    for frame in container.decode(video=0):
        pts = float(frame.pts * time_base) if frame.pts is not None else frame.time
        if pts is None:
            continue

        img = frame.to_ndarray(format="rgb24")
        tensor = torch.from_numpy(img).permute(2, 0, 1)  # HWC -> CHW
        loaded_frames.append(tensor)
        loaded_ts.append(pts)

        if pts >= last_ts:
            break

    container.close()

    if not loaded_frames:
        raise video_utils.FrameTimestampError(
            f"No frames could be loaded from video: {video_path}"
        )

    query_ts = torch.tensor(timestamps)
    loaded_ts = torch.tensor(loaded_ts)

    # Find closest frame for each query timestamp
    dist = torch.cdist(query_ts[:, None], loaded_ts[:, None], p=1)
    min_, argmin_ = dist.min(1)

    is_within_tol = min_ < tolerance_s
    if not is_within_tol.all():
        raise video_utils.FrameTimestampError(
            f"One or several query timestamps unexpectedly violate the tolerance "
            f"({min_[~is_within_tol]} > {tolerance_s=})."
            " It means that the closest frame that can be loaded from the video is too far away in time."
            " This might be due to synchronization issues with timestamps during data collection."
            " To be safe, we advise to ignore this item during training."
            f"\nqueried timestamps: {query_ts}"
            f"\nloaded timestamps: {loaded_ts}"
            f"\nvideo: {video_path}"
            f"\nbackend: pyav (patched)"
        )

    closest_frames = torch.stack([loaded_frames[idx] for idx in argmin_])

    # Convert to float32 in [0,1] range
    closest_frames = closest_frames.type(torch.float32) / 255.0

    if len(timestamps) != len(closest_frames):
        raise video_utils.FrameTimestampError(
            f"Number of retrieved frames ({len(closest_frames)}) does not match "
            f"number of queried timestamps ({len(timestamps)})"
        )

    return closest_frames


# Apply the monkey patch
video_utils.decode_video_frames_torchvision = decode_video_frames_pyav
print("[patch_video_backend] Patched decode_video_frames_torchvision with direct PyAV implementation")
