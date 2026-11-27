# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Command offsets that make compliant position servos settle at the requested joint angles.

A position servo holds a joint with a force proportional to the error between its command and the
joint angle, so under load it settles short of the command by ``load / gain``. The real SO-101
servos are soft enough that the arm sags by several degrees under its own weight. Controllers that
plan joint angles add these offsets to their commands so the arm reaches the planned pose.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from .bindings import ActionBinding, clamp

# Share of the remaining joint error added to the trim per simulated second while the target is still.
TRIM_RATE = 5.0
# Largest trim, in joint units: enough for joint friction, small enough not to push through contact.
TRIM_LIMIT = 0.05
# Errors below this are left alone so the trim does not hunt around friction.
TRIM_DEADBAND = 2e-4
# A target that moves less than this between commands counts as still.
STILL_TARGET = 1e-5
# A joint already closing this share of its error per simulated second needs no more trim; adding
# it anyway overshoots and hunts around the target.
CLOSING_RATE = 2.0
# Commanded joint speed at which the full dry-friction lead applies; slower moves get a share.
FRICTION_SPEED = 0.02


class ServoCompensation:
    """Offsets for joints driven by MuJoCo position actuators (``<position>``).

    The offset of each joint is the static load at its target over the servo gain, the servo's
    viscous and dry-friction lag for the commanded speed, and a trim toward the measured joint
    angle that removes what friction leaves once the target stops moving. Bindings without a
    scalar joint or a position actuator are passed through unchanged.
    """

    def __init__(self, mujoco: Any, model: Any, bindings: Sequence[ActionBinding]) -> None:
        self._mujoco = mujoco
        self._model = model
        self._data = mujoco.MjData(model)
        self._bindings: list[ActionBinding] = []
        stiffness: list[float] = []
        viscous: list[float] = []
        friction: list[float] = []
        for binding in bindings:
            if binding.joint_id is None or binding.qpos_address is None:
                continue
            actuator = binding.actuator_id
            gain = float(model.actuator_gainprm[actuator, 0])
            position_servo = (
                int(model.actuator_biastype[actuator]) == int(mujoco.mjtBias.mjBIAS_AFFINE)
                and gain > 0.0
                and np.isclose(float(model.actuator_biasprm[actuator, 1]), -gain)
            )
            if not position_servo:
                continue
            gear = float(model.actuator_gear[actuator, 0])
            dof = int(model.jnt_dofadr[binding.joint_id])
            self._bindings.append(binding)
            stiffness.append(gain * gear)
            # Joint damping and the servo's velocity gain both resist the commanded speed.
            viscous.append(float(model.dof_damping[dof]) - float(model.actuator_biasprm[actuator, 2]) * gear)
            friction.append(float(model.dof_frictionloss[dof]))
        self._stiffness = np.asarray(stiffness, dtype=np.float64)
        self._viscous = np.asarray(viscous, dtype=np.float64)
        self._friction = np.asarray(friction, dtype=np.float64)
        self._qpos = np.asarray([binding.qpos_address for binding in self._bindings], dtype=np.intp)
        self._dof = np.asarray(
            [int(model.jnt_dofadr[binding.joint_id]) for binding in self._bindings], dtype=np.intp
        )
        self._trim = np.zeros(len(self._bindings), dtype=np.float64)
        self._previous: np.ndarray | None = None
        self._measured: np.ndarray | None = None
        self.saturated: dict[str, bool] = {}

    def reset(self) -> None:
        self._trim[:] = 0.0
        self._previous = None
        self._measured = None

    def _static_load(self, targets: np.ndarray, qpos: np.ndarray) -> np.ndarray:
        """Generalized force each joint must hold at rest in the target configuration."""
        data = self._data
        np.asarray(data.qpos)[:] = qpos
        np.asarray(data.qpos)[self._qpos] = targets
        np.asarray(data.qvel)[:] = 0.0
        self._mujoco.mj_forward(self._model, data)
        return np.asarray(data.qfrc_bias)[self._dof] - np.asarray(data.qfrc_passive)[self._dof]

    def command(
        self,
        targets: Mapping[str, float],
        qpos: Any,
        physics_steps: int = 1,
    ) -> dict[str, float]:
        """Return ``targets`` with compensated values for the servo-driven joints.

        ``targets`` maps action names to planned joint angles, ``qpos`` is the measured
        generalized position before this command (``None`` before the first measurement, which
        passes the targets through), and ``physics_steps`` is how long the command is held.
        """
        command = {name: float(value) for name, value in targets.items()}
        if not self._bindings or qpos is None:
            return command
        period = physics_steps * float(self._model.opt.timestep)
        measured_qpos = np.asarray(qpos, dtype=np.float64)
        planned = np.asarray([command[binding.action_name] for binding in self._bindings], dtype=np.float64)
        offset = self._static_load(planned, measured_qpos) / self._stiffness
        if self._previous is None:
            still = np.ones(len(planned), dtype=bool)
        else:
            delta = planned - self._previous
            still = np.abs(delta) <= STILL_TARGET
            if period > 0.0:
                speed = delta / period
                lag = self._viscous * speed + self._friction * np.clip(speed / FRICTION_SPEED, -1.0, 1.0)
                offset += lag / self._stiffness
        self._previous = planned
        measured = measured_qpos[self._qpos]
        error = planned - measured
        closing = (
            np.zeros(len(planned), dtype=bool)
            if self._measured is None or period <= 0.0
            else (measured - self._measured) * np.sign(error) > CLOSING_RATE * period * np.abs(error)
        )
        self._measured = measured.copy()
        update = still & ~closing & (np.abs(error) > TRIM_DEADBAND)
        gain = min(1.0, TRIM_RATE * period)
        self._trim[update] = np.clip(self._trim[update] + gain * error[update], -TRIM_LIMIT, TRIM_LIMIT)
        for index, binding in enumerate(self._bindings):
            wanted = planned[index] + offset[index] + self._trim[index]
            value = clamp(wanted, binding.control_range)
            limited = value != wanted
            if limited and update[index]:
                # A saturated servo cannot use more trim; keep what the range allows.
                self._trim[index] = value - planned[index] - offset[index]
            self.saturated[binding.action_name] = limited
            command[binding.action_name] = value
        return command
