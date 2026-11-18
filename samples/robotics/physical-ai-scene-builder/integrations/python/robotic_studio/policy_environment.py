# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Structural interface shared by simulated and real policy environments."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import numpy as np


@dataclass(frozen=True)
class TaskStatus:
    """Worker-side task verdict after a completed step (``None`` on real robots)."""

    success: bool = False
    terminated: bool = False
    truncated: bool = False
    reason: str | None = None
    metrics: Mapping[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "terminated": self.terminated,
            "truncated": self.truncated,
            "reason": self.reason,
            "metrics": dict(self.metrics),
        }


@dataclass(frozen=True)
class Observation:
    """One coherent state and camera observation from a completed physics step."""

    state: np.ndarray
    images: Mapping[str, np.ndarray]
    episode_id: str
    step_id: int
    simulation_time: float
    physics_steps: int
    scene_fingerprint: str = ""
    task: TaskStatus | None = None


@dataclass(frozen=True)
class ResetInfo:
    seed: int | None
    samples: tuple[Mapping[str, Any], ...]


@runtime_checkable
class PolicyEnvironment(Protocol):
    backend: str

    def describe(self) -> Mapping[str, Any]: ...
    def acquire(self) -> None: ...
    def reset(self, seed: int | None = None) -> tuple[Observation, ResetInfo]: ...
    def step(self, action: Sequence[float] | np.ndarray, physics_steps: int | None = None) -> Observation: ...
    def stop(self) -> None: ...
    def release(self) -> None: ...
    def close(self) -> None: ...
