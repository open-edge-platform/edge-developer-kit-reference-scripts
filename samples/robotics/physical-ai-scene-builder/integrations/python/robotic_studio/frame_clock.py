# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Fixed-rate control clock shared by recording, teleoperation, and evaluation.

A dataset frame is one controller command, so the control rate must equal the dataset frame rate
(30 FPS by default, like LeRobot recordings). A frame period is rarely a whole number of MuJoCo
timesteps (1/30 s is 16.67 steps of 2 ms), so :class:`FrameClock` spreads the remainder across
frames: at 2 ms it advances 17, 16, 17, ... physics steps (50 every 3 frames). Frame ``k``
always starts at the physics step nearest ``k / fps``, so the average rate is exact and no frame is
off by more than half a timestep.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

DEFAULT_CAPTURE_FPS = 30
MIN_CAPTURE_FPS = 1
MAX_CAPTURE_FPS = 120


def validate_capture_fps(value: Any, label: str = "captureFps") -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not MIN_CAPTURE_FPS <= value <= MAX_CAPTURE_FPS:
        raise ValueError(f"{label} must be an integer from {MIN_CAPTURE_FPS} to {MAX_CAPTURE_FPS}.")
    return value


def capture_fps_from_profile(profile: Mapping[str, Any] | None, default: int = DEFAULT_CAPTURE_FPS) -> int:
    """Return the profile's dataset frame rate, or ``default`` for profiles that predate it."""
    value = profile.get("captureFps") if isinstance(profile, Mapping) else None
    return default if value is None else validate_capture_fps(value)


class FrameClock:
    """Physics steps per frame so frames land on a fixed ``fps`` grid of simulated time."""

    def __init__(self, fps: float, timestep: float) -> None:
        if not isinstance(fps, (int, float)) or isinstance(fps, bool) or not math.isfinite(fps) or fps <= 0:
            raise ValueError("fps must be positive and finite.")
        if not isinstance(timestep, (int, float)) or not math.isfinite(timestep) or timestep <= 0:
            raise ValueError("timestep must be positive and finite.")
        self.fps = float(fps)
        self.timestep = float(timestep)
        self.steps_per_frame = 1.0 / (self.fps * self.timestep)
        if self.steps_per_frame < 1.0 - 1e-9:
            raise ValueError(
                f"{fps:g} FPS is faster than the {timestep:g} s physics timestep allows "
                f"(at most {1.0 / timestep:g} FPS)."
            )
        self.frame = 0

    @property
    def period(self) -> float:
        """Nominal simulated seconds per frame."""
        return 1.0 / self.fps

    def _boundary(self, frame: int) -> int:
        # The epsilon keeps exact halves (and float noise around integers) rounding consistently.
        return math.floor(frame * self.steps_per_frame + 0.5 + 1e-9)

    def next_physics_steps(self) -> int:
        """Return the physics steps for the next frame and advance the clock."""
        steps = self._boundary(self.frame + 1) - self._boundary(self.frame)
        self.frame += 1
        return max(1, steps)

    def reset(self) -> None:
        self.frame = 0
