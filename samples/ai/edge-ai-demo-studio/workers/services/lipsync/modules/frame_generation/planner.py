# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Planning for RIFE frame generation in the lipsync worker.

When measured inference FPS can't reach the avatar frame rate, only every N-th frame is inferred
and the rest are interpolated by the frame generation service. The planner benchmarks that
service on the exact schedule (which also warms it).
"""

import json
import os
from dataclasses import dataclass, field
from threading import Lock

from modules.base.logger import getLogger

DEFAULT_AVATAR_FPS = 25.0
MAX_MULTIPLIER = 4  # never interpolate more than 3 consecutive frames
# 15% headroom for audio, frame merging and round-trips sharing the same wall clock.
LOAD_MARGIN = 0.85


def get_avatar_fps(avatar_path):
    """Source video frame rate from the avatar's config.json, else the default (older avatars)."""
    try:
        with open(os.path.join(avatar_path, "config.json")) as f:
            fps = float(json.load(f).get("fps") or 0)
        if fps > 0:
            return fps
    except Exception:
        pass
    return DEFAULT_AVATAR_FPS


def keyframe_positions(batch_size, multiplier):
    """Batch indices that get real inference; both endpoints, so every gap has anchors in-batch."""
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
    """Shared by every lipsync session: whether frame generation is on, keyframes, and the client."""

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


def plan_frame_generation(
    client,
    avatar_fps,
    inference_fps,
    batch_size,
    image_size,
    max_output_fps=None,
):
    """Decide whether (and how densely) to interpolate, given measured speeds.

    Targets ``avatar_fps``, capped at ``max_output_fps``; the plan is disabled when inference alone
    reaches it.
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

    # A single-frame gap benchmark doubles as warmup on the service side and
    # gives a conservative per-frame throughput estimate.
    estimated_fg_fps = client.benchmark(image_size, [1])

    if inference_fps >= target_fps:
        plan.framegen_fps = estimated_fg_fps
        log.info(
            f"FPS summary: avatar={avatar_fps:.1f}, wav2lip inference="
            f"{inference_fps:.1f}, frame generation~{estimated_fg_fps:.1f} "
            f"(single-pair estimate), total={inference_fps:.1f}"
        )
        log.info(
            "Frame generation not needed: inference alone matches the avatar "
            f"frame rate, so 0 of every {batch_size} frames need "
            "interpolation."
        )
        return plan

    # Lowest multiplier (most real frames) that fits in real time, by the single-pair estimate;
    # the chosen schedule is then measured for real.
    budget = LOAD_MARGIN * batch_size / target_fps

    def batch_cost(multiplier, fg_fps):
        n_keyframes = len(keyframe_positions(batch_size, multiplier))
        return (
            n_keyframes / inference_fps + (batch_size - n_keyframes) / fg_fps
        )

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
    framegen_fps = client.benchmark(
        image_size, _schedule_gaps(batch_size, multiplier)
    )
    effective_fps = batch_size / batch_cost(multiplier, framegen_fps)

    plan.enabled = True
    plan.multiplier = multiplier
    plan.keyframes = positions
    plan.generator = client
    # Serializes sessions' interpolate calls so batches stay ordered; the
    # service additionally serializes inference on its side.
    plan.lock = Lock()
    plan.framegen_fps = framegen_fps
    plan.effective_fps = effective_fps

    log.info(
        f"FPS summary: avatar={avatar_fps:.1f}, wav2lip inference="
        f"{inference_fps:.1f}, frame generation={framegen_fps:.1f}, "
        f"total~{effective_fps:.1f}"
    )
    log.info(
        f"Frame generation enabled via {client.base_url}: {len(positions)} of "
        f"every {batch_size} frames inferred (multiplier {multiplier}), the "
        f"remaining {batch_size - len(positions)} interpolated => "
        f"~{effective_fps:.1f} FPS effective."
    )
    if effective_fps < target_fps:
        log.warning(
            f"Frame generation cannot fully reach the avatar frame rate of "
            f"{target_fps:.1f} FPS: ~{effective_fps:.1f} FPS achievable with "
            f"frame generation vs {inference_fps:.1f} FPS without; playback "
            "may stutter."
        )
    return plan
