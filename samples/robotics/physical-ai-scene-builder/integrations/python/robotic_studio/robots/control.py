# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Shared controller-facing API implemented by remote and in-process control clients."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol, runtime_checkable

from ..teleoperation.client import JointInfo, RecordingAttempt, StateSnapshot


class LocalReplica(Protocol):
    """Controller-side MuJoCo replica used for IK; ``synchronize`` copies a snapshot into ``data``."""

    @property
    def model(self) -> Any: ...

    @property
    def data(self) -> Any: ...

    def synchronize(self, snapshot: StateSnapshot) -> None: ...


@runtime_checkable
class ControlTarget(Protocol):
    """The narrow controller surface for stepping and recording a robot task.

    Implemented by :class:`~robotic_studio.teleoperation.Teleoperation` (ZeroMQ worker) and
    :class:`~robotic_studio.teleoperation.LocalTeleoperation` (in-process). Data members are
    read-only properties so both attribute- and property-backed implementations conform.
    """

    @property
    def profile(self) -> Mapping[str, Any]:
        """The session teleoperation profile."""
        ...

    @property
    def local(self) -> LocalReplica:
        """A separate local replica (``model``, ``data``, ``synchronize``) for IK."""
        ...

    @property
    def joints(self) -> Mapping[str, JointInfo]:
        """Named joints with their qpos/qvel slices, ranges, and actuators."""
        ...

    @property
    def current_state(self) -> StateSnapshot:
        """The latest authoritative snapshot."""
        ...

    @property
    def command_outcome_unknown(self) -> bool:
        """True after a command timed out and its effect on the session is unknown."""
        ...

    @property
    def recording_attempt(self) -> RecordingAttempt | None:
        """Index and seed of the recording started last, if any."""
        ...

    def step(
        self,
        *,
        joints: Mapping[str, Any] | None = None,
        actuators: Mapping[str, Any] | None = None,
        physics_steps: int = 1,
        kinematic_state: Mapping[str, Any] | None = None,
    ) -> StateSnapshot: ...

    def select_initial_state(self, state_id: str) -> StateSnapshot: ...

    def start_recording(self) -> str: ...

    def stop_recording(
        self, *, save: bool = True, metadata: Mapping[str, Any] | None = None
    ) -> Mapping[str, Any] | None: ...

    def discard_recording(self) -> None: ...
