# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""In-process teleoperation target with the same controller-facing surface as Teleoperation."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np

from ..camera_clipping import apply_camera_clipping
from ..generation.dataset import EpisodeWriter
from ..generation.native_env import NativeEnvironment
from .client import (
    ActuatorInfo,
    InitialStateInfo,
    JointInfo,
    RecordingAttempt,
    StateSnapshot,
    Teleoperation,
    TeleoperationCommandError,
    _build_metadata,
    _Metadata,
)
from .session import TeleoperationSession


class LocalTeleoperation:
    """Drive an in-process :class:`TeleoperationSession` like a remote ``Teleoperation`` client.

    The session is authoritative; ``local`` is a separate MuJoCo replica for controller IK,
    compiled from the same bundle exactly as ``Teleoperation.connect`` does, so in-process and
    remote recordings behave the same. The in-process lease does not expire (there is no
    heartbeat), and ``close()`` releases it and closes the environment's renderers.
    """

    # Target resolution is shared with the remote client so errors use the same codes.
    _resolve_joint_target = Teleoperation._resolve_joint_target
    _resolve_actuator_target = Teleoperation._resolve_actuator_target
    _complete_targets = Teleoperation._complete_targets

    def __init__(
        self,
        environment: NativeEnvironment,
        profile: Mapping[str, Any],
        collection_dir: str | Path,
        *,
        mujoco_module: Any | None = None,
        writer: EpisodeWriter | None = None,
        client_id: str | None = None,
        local_model: Any | None = None,
        read_only_collection: bool = False,
        session: TeleoperationSession | None = None,
    ) -> None:
        if mujoco_module is None:
            import mujoco as mujoco_module
        self.environment = environment
        self.profile = dict(profile)
        if local_model is None:
            bundle = getattr(environment.scene, "bundle", None)
            scene_path = getattr(bundle, "scene_path", None)
            if scene_path is None:
                raise ValueError("LocalTeleoperation requires a scene bundle or explicit local_model.")
            local_model = mujoco_module.MjModel.from_xml_path(str(scene_path))
            apply_camera_clipping(mujoco_module, local_model)
        self.local_model = local_model
        self.local_data = mujoco_module.MjData(self.local_model)
        self._mujoco = mujoco_module
        self.local = type("LocalReplica", (), {})()
        self.local.model = self.local_model
        self.local.data = self.local_data
        self.local.synchronize = self._synchronize
        self._closed = False
        self._sequence = 0
        self._recording_attempt: RecordingAttempt | None = None
        self._metadata: _Metadata = _build_metadata(mujoco_module, self.local_model, self.profile)
        self.joints: Mapping[str, JointInfo] = self._metadata.joints
        self.actuators: Mapping[str, ActuatorInfo] = self._metadata.actuators
        self.session = session or TeleoperationSession(
            environment,
            self.profile,
            collection_dir,
            writer=writer,
            read_only=read_only_collection,
            lease_timeout=None,
        )
        self.client_id = client_id or f"local-teleoperation-{uuid.uuid4()}"
        # In-process clients have no heartbeat thread, so their lease must not expire.
        self.lease_id = self.session.acquire(self.client_id, expires=False)
        self._current_state = self._snapshot()
        self.local.synchronize(self._current_state)

    @property
    def recording(self) -> bool:
        return self.session.recording

    @property
    def action_names(self) -> tuple[str, ...]:
        return self._metadata.action_names

    @property
    def initial_states(self) -> tuple[InitialStateInfo, ...]:
        return tuple(
            InitialStateInfo(
                state_id=state.state_id,
                label=state.label,
                index=state.index,
                seed=state.seed,
                created_at=state.created_at,
                randomization=state.source_randomization,
                qpos=np.asarray(state.qpos, dtype=np.float64),
                qvel=np.asarray(state.qvel, dtype=np.float64),
                ctrl=np.asarray(state.ctrl, dtype=np.float64),
            )
            for state in self.session.collection.states
        )

    def _require_metadata(self) -> _Metadata:
        return self._metadata

    def _snapshot(self) -> StateSnapshot:
        snapshot = self.session.snapshot()
        self._sequence += 1
        return StateSnapshot(
            sequence=self._sequence,
            step_id=int(snapshot["stepId"]),
            state_revision=int(snapshot["stateRevision"]),
            state_id=str(snapshot["stateId"]),
            simulation_time=float(snapshot["simulationTime"]),
            qpos=snapshot["qpos"],
            qvel=snapshot["qvel"],
            ctrl=snapshot["ctrl"],
            body_positions=snapshot["bodyPositions"],
            body_quaternions=snapshot["bodyQuaternions"],
            state=np.asarray(snapshot["state"], dtype=np.float64),
            action=np.asarray(snapshot["action"], dtype=np.float64),
            recording="recording" if snapshot["recording"] else "idle",
            images=snapshot["images"],
            episode_id=snapshot["episodeId"],
        )

    def _synchronize(self, snapshot: StateSnapshot) -> None:
        self.local.data.qpos[:] = snapshot.qpos
        self.local.data.qvel[:] = snapshot.qvel
        self.local.data.ctrl[:] = snapshot.ctrl
        self._mujoco.mj_forward(self.local.model, self.local.data)

    def _refresh(self) -> StateSnapshot:
        self._current_state = self._snapshot()
        self.local.synchronize(self._current_state)
        return self._current_state

    @property
    def current_state(self) -> StateSnapshot:
        return self._current_state

    def observe(self) -> StateSnapshot:
        return self._current_state

    def read(self) -> StateSnapshot:
        return self._current_state

    @property
    def recording_attempt(self) -> RecordingAttempt | None:
        """Index and seed of the recording started last (kept after it stops, like the remote client)."""
        return self._recording_attempt

    @property
    def command_outcome_unknown(self) -> bool:
        return False

    def step(
        self,
        *,
        joints: Mapping[str, Any] | None = None,
        actuators: Mapping[str, Any] | None = None,
        physics_steps: int = 1,
        kinematic_state: Mapping[str, Any] | None = None,
    ) -> StateSnapshot:
        if not isinstance(physics_steps, int) or isinstance(physics_steps, bool) or not 1 <= physics_steps <= 1_000:
            raise TeleoperationCommandError("PHYSICS_STEPS_INVALID", "physics_steps must be between 1 and 1000.")
        if kinematic_state is not None and not isinstance(kinematic_state, Mapping):
            raise TeleoperationCommandError("TARGET_INVALID", "kinematic_state must be a mapping.")
        targets = self._complete_targets(self._current_state, joints, actuators)
        self.session.step(
            self.client_id,
            self.lease_id,
            targets,
            physics_steps=physics_steps,
            kinematic_state=kinematic_state,
        )
        return self._refresh()

    def select_initial_state(self, state_id: str) -> StateSnapshot:
        self.session.select_state(self.client_id, self.lease_id, state_id)
        return self._refresh()

    def reset(self) -> StateSnapshot:
        self.session.reset(self.client_id, self.lease_id)
        return self._refresh()

    def start_recording(self) -> str:
        episode_id = self.session.start_recording(self.client_id, self.lease_id)
        attempt = self.session.recording_attempt
        self._recording_attempt = (
            None if attempt is None else RecordingAttempt(attempt["recordingIndex"], attempt["attemptSeed"])
        )
        self._current_state = self._snapshot()
        return episode_id

    def stop_recording(
        self, *, save: bool = True, metadata: Mapping[str, Any] | None = None
    ) -> Mapping[str, Any] | None:
        try:
            pending = self.session.stop_recording(self.client_id, self.lease_id)["pendingRecording"]
            if pending is None or not save:
                return pending
            return self.session.save_recording(self.client_id, self.lease_id, metadata=metadata)
        finally:
            self._current_state = self._snapshot()

    def discard_recording(self) -> None:
        try:
            self.session.discard_recording(self.client_id, self.lease_id)
        finally:
            self._current_state = self._snapshot()

    def release(self) -> None:
        if self.session.active_lease_id == self.lease_id:
            self.session.release(self.client_id, self.lease_id)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self.release()
        finally:
            self.environment.close()

    def __enter__(self) -> LocalTeleoperation:
        return self

    def __exit__(self, *_args: Any) -> None:
        self.close()
