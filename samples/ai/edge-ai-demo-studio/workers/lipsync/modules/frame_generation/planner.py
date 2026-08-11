# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Startup planning for RIFE frame generation in the lipsync worker.

At service startup the worker measures how many frames per second the Wav2Lip
model can infer on the chosen device and compares it with the avatar video's
frame rate. When inference alone cannot keep up (or the user forces it on),
frame generation is enabled: only every N-th frame is inferred by Wav2Lip and
the frames between keyframes are filled by the RIFE interpolator.

The planner loads and warms the frame generation model once, verifies the
combined pipeline can reach the target frame rate, and logs the avatar FPS,
the measured Wav2Lip inference FPS and the measured frame generation FPS.
"""

import json
import os
import shutil
import time
from dataclasses import dataclass, field
from glob import glob
from threading import Lock

import numpy as np

from modules.base.logger import getLogger

RIFE_MODEL_PATH = "models/rife/flownet.safetensors"
DEFAULT_AVATAR_FPS = 25.0
MAX_MULTIPLIER = 4  # never interpolate more than 3 consecutive frames
# Keep 15% headroom when judging real-time feasibility: audio processing,
# frame merging and queue handoffs share the same wall clock.
LOAD_MARGIN = 0.85

_GENERATOR_CACHE = {}
_CACHE_LOCK = Lock()


def download_rife_model(model_path=RIFE_MODEL_PATH, source="huggingface"):
    """Fetch the RIFE flownet safetensors weights if not already present."""
    if os.path.exists(model_path):
        return model_path

    getLogger(__file__).info("Downloading RIFE frame generation model...")
    if source == "modelscope":
        from modelscope import snapshot_download

        repo_dir = snapshot_download(
            "TensorForger/RIFE-safetensors", allow_patterns=["flownet.safetensors"]
        )
        src = os.path.join(repo_dir, "flownet.safetensors")
    else:
        from huggingface_hub import hf_hub_download

        src = hf_hub_download("TensorForger/RIFE-safetensors", "flownet.safetensors")

    os.makedirs(os.path.dirname(model_path), exist_ok=True)
    shutil.copy(src, model_path)
    getLogger(__file__).info(f"RIFE model ready at {model_path}")
    return model_path


def get_avatar_fps(avatar_path):
    """Frame rate of the avatar's source video, recorded in its config.json by
    the avatar generator; falls back to the pipeline default for avatars
    generated before fps was recorded."""
    try:
        with open(os.path.join(avatar_path, "config.json")) as f:
            fps = float(json.load(f).get("fps") or 0)
        if fps > 0:
            return fps
    except Exception:
        pass
    return DEFAULT_AVATAR_FPS


def get_shared_frame_generator(device, model_path=RIFE_MODEL_PATH):
    """Load (once) and share an OpenVINO frame generator and its inference lock.

    The lock must be held around interpolate_gaps because the underlying
    inference request is not thread-safe and is shared by every session.
    """
    key = device.lower()
    with _CACHE_LOCK:
        entry = _GENERATOR_CACHE.get(key)
        if entry is None:
            download_rife_model(model_path)
            from modules.frame_generation.frame_generator_ov import (
                OpenVINOFrameGenerator,
            )

            generator = OpenVINOFrameGenerator(device, model_path)
            entry = {"generator": generator, "lock": Lock()}
            _GENERATOR_CACHE[key] = entry
        return entry["generator"], entry["lock"]


def release_shared_frame_generator(device):
    """Drop the cached generator (e.g. when auto mode decides it is unneeded)."""
    with _CACHE_LOCK:
        _GENERATOR_CACHE.pop(device.lower(), None)


def keyframe_positions(batch_size, multiplier):
    """Indices inside a batch that get real Wav2Lip inference; the rest are
    interpolated. Both batch endpoints are keyframes so every interpolated
    frame has real anchors on both sides within the batch."""
    positions = list(range(0, batch_size, multiplier))
    if positions[-1] != batch_size - 1:
        positions.append(batch_size - 1)
    return positions


def _schedule_gaps(batch_size, multiplier):
    """Sizes of the interpolation gaps (in frames) for one batch."""
    positions = keyframe_positions(batch_size, multiplier)
    return [
        positions[j + 1] - positions[j] - 1
        for j in range(len(positions) - 1)
        if positions[j + 1] - positions[j] > 1
    ]


@dataclass
class FrameGenPlan:
    """Decision shared with every lipsync session: whether frame generation is
    on, which batch positions are Wav2Lip keyframes, and the shared generator."""

    enabled: bool = False
    multiplier: int = 1
    keyframes: list = field(default_factory=list)
    generator: object = None
    lock: object = None
    avatar_fps: float = DEFAULT_AVATAR_FPS
    target_fps: float = DEFAULT_AVATAR_FPS
    inference_fps: float = 0.0
    framegen_fps: float = 0.0
    effective_fps: float = 0.0


def _benchmark_frames(avatar_path, image_size, count):
    """Consecutive avatar face crops resized to the interpolator's input size,
    matching the float BGR [0, 255] frames lip_sync feeds it at runtime.

    Wav2lip avatars store pre-cropped faces in face_images; MuseTalk avatars
    only keep full_images, whose resized frames still contain the face. Cycles
    when the avatar has fewer frames than the schedule needs; falls back to
    flat synthetic frames if no avatar image can be read (interpolation time
    is content-independent, so only realism is lost, not accuracy).
    """
    try:
        import cv2

        for subdir in ("face_images", "full_images"):
            pattern = os.path.join(avatar_path, subdir, "*.[jpJP][pnPN]*[gG]")
            paths = sorted(
                glob(pattern),
                key=lambda p: int(os.path.splitext(os.path.basename(p))[0]),
            )[:count]
            images = [img for p in paths if (img := cv2.imread(p)) is not None]
            if images:
                return [
                    cv2.resize(
                        images[i % len(images)], (image_size, image_size)
                    ).astype(np.float32)
                    for i in range(count)
                ]
    except Exception:
        pass
    getLogger(__file__).warning(
        f"No readable avatar images under {avatar_path}; benchmarking frame "
        "generation on synthetic frames."
    )
    return [
        np.full((image_size, image_size, 3), 64.0 + 32.0 * i, dtype=np.float32)
        for i in range(count)
    ]


def measure_framegen_fps(generator, image_size, gap_sizes, avatar_path, rounds=3):
    """Median interpolated frames/sec on the exact schedule lip_sync will use,
    fed with the avatar's own face frames.

    Also serves as the schedule-specific warmup: it primes any lazily-compiled
    static shapes (NPU) before the first real batch arrives.
    """
    frames = _benchmark_frames(avatar_path, image_size, len(gap_sizes) + 1)
    gaps = [(frames[i], frames[i + 1], n) for i, n in enumerate(gap_sizes)]

    generator.interpolate_gaps(gaps)
    times = []
    for _ in range(rounds):
        start = time.perf_counter()
        results = generator.interpolate_gaps(gaps)
        times.append(time.perf_counter() - start)

    produced = sum(len(r) for r in results)
    return produced / sorted(times)[len(times) // 2]


def plan_frame_generation(
    mode,
    device,
    avatar_path,
    avatar_fps,
    inference_fps,
    batch_size,
    image_size,
    max_output_fps=None,
    model_path=RIFE_MODEL_PATH,
):
    """Decide whether (and how densely) to interpolate, given measured speeds.

    Args:
        mode: "auto" | "on" | "off".
        device: device for the frame generation model.
        avatar_path: avatar directory; its face frames feed the benchmark.
        avatar_fps: frame rate of the avatar's source video (the target).
        inference_fps: measured Wav2Lip frames/sec on the inference device.
        batch_size: frames per lipsync batch.
        image_size: face crop size the interpolator will run on.
        max_output_fps: hard cap of the streaming pipeline, if any.

    Returns:
        FrameGenPlan
    """
    log = getLogger(__file__)

    target_fps = avatar_fps
    if max_output_fps and target_fps > max_output_fps:
        log.info(
            f"Avatar video is {avatar_fps:.1f} FPS but the streaming pipeline is "
            f"capped at {max_output_fps:.1f} FPS; targeting {max_output_fps:.1f} FPS."
        )
        target_fps = max_output_fps

    plan = FrameGenPlan(
        avatar_fps=avatar_fps,
        target_fps=target_fps,
        inference_fps=inference_fps,
        effective_fps=inference_fps,
    )

    if mode == "off":
        log.info(
            f"FPS summary: avatar={avatar_fps:.1f}, wav2lip inference="
            f"{inference_fps:.1f}, frame generation=off"
        )
        if inference_fps < target_fps:
            log.warning(
                f"Frame generation is off but Wav2Lip inference "
                f"({inference_fps:.1f} FPS) is below the avatar frame rate "
                f"({target_fps:.1f} FPS); playback may stutter."
            )
        return plan

    # Load and warm the generator on the requested device so the measurement
    # (and, if enabled, the first real batch) runs on a ready model.
    generator, lock = get_shared_frame_generator(device, model_path)
    frame_time = generator.warm_up(image_size)
    estimated_fg_fps = 1.0 / frame_time

    if mode == "auto" and inference_fps >= target_fps:
        plan.framegen_fps = estimated_fg_fps
        log.info(
            f"FPS summary: avatar={avatar_fps:.1f}, wav2lip inference="
            f"{inference_fps:.1f}, frame generation~{estimated_fg_fps:.1f} "
            f"(single-pair estimate)"
        )
        log.info(
            "Frame generation not needed: inference alone matches the avatar "
            "frame rate; releasing the frame generation model."
        )
        release_shared_frame_generator(device)
        return plan

    # Pick the lowest multiplier whose keyframe inference + interpolation fits
    # in real time (lowest = most real frames). The single-pair warmup time is
    # a conservative throughput estimate for this selection; the chosen
    # schedule is then measured for real.
    budget = LOAD_MARGIN * batch_size / target_fps

    def batch_cost(multiplier, fg_fps):
        n_keyframes = len(keyframe_positions(batch_size, multiplier))
        return n_keyframes / inference_fps + (batch_size - n_keyframes) / fg_fps

    multiplier = next(
        (
            m
            for m in range(2, MAX_MULTIPLIER + 1)
            if batch_cost(m, estimated_fg_fps) <= budget
        ),
        None,
    )
    feasible = multiplier is not None
    if not feasible:
        multiplier = min(
            range(2, MAX_MULTIPLIER + 1),
            key=lambda m: batch_cost(m, estimated_fg_fps),
        )

    positions = keyframe_positions(batch_size, multiplier)
    framegen_fps = measure_framegen_fps(
        generator, image_size, _schedule_gaps(batch_size, multiplier), avatar_path
    )
    effective_fps = batch_size / batch_cost(multiplier, framegen_fps)

    plan.enabled = True
    plan.multiplier = multiplier
    plan.keyframes = positions
    plan.generator = generator
    plan.lock = lock
    plan.framegen_fps = framegen_fps
    plan.effective_fps = effective_fps

    log.info(
        f"FPS summary: avatar={avatar_fps:.1f}, wav2lip inference="
        f"{inference_fps:.1f}, frame generation={framegen_fps:.1f}"
    )
    log.info(
        f"Frame generation enabled on {device}: {len(positions)} of every "
        f"{batch_size} frames inferred (multiplier {multiplier}), the rest "
        f"interpolated => ~{effective_fps:.1f} FPS effective."
    )
    if effective_fps < target_fps:
        log.warning(
            f"Frame generation cannot fully reach the avatar frame rate of "
            f"{target_fps:.1f} FPS: ~{effective_fps:.1f} FPS achievable with "
            f"frame generation vs {inference_fps:.1f} FPS without; playback "
            "may stutter."
        )
    return plan
