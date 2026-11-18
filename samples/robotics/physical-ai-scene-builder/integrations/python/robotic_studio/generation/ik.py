# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np

from .native_scene import NativeMuJoCoUnavailable

IKFailureReason = Literal["invalid_target", "non_convergence"]


class IKConfigurationError(ValueError):
    pass


@dataclass(frozen=True)
class IKSolveResult:
    success: bool
    joint_positions: np.ndarray
    iterations: int
    position_error: float
    orientation_error: float
    reason: IKFailureReason | None = None
    message: str | None = None

    @property
    def failure_reason(self) -> IKFailureReason | None:
        return self.reason


@dataclass(frozen=True)
class _JointBinding:
    name: str
    joint_id: int
    qpos_address: int
    dof_address: int
    lower: float
    upper: float
    limited: bool


def _load_mujoco() -> object:
    try:
        import mujoco
    except ModuleNotFoundError as error:
        raise NativeMuJoCoUnavailable(
            "Native IK requires the optional 'teleoperation' dependencies."
        ) from error
    return mujoco


def _as_vector(value: Sequence[float] | np.ndarray, size: int, label: str) -> np.ndarray:
    array = np.asarray(value, dtype=np.float64)
    if array.shape != (size,) or not np.all(np.isfinite(array)):
        raise ValueError(f"{label} must be a finite vector with {size} values.")
    return array


def _as_delta(value: float | Sequence[float], size: int, label: str) -> np.ndarray:
    array = np.asarray(value, dtype=np.float64)
    if array.ndim == 0:
        array = np.full(size, float(array))
    if array.shape != (size,) or not np.all(np.isfinite(array)) or np.any(array <= 0):
        raise ValueError(f"{label} must contain positive finite values for every joint.")
    return array


def _quaternion_to_matrix(quaternion: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(quaternion))
    if norm <= np.finfo(np.float64).eps:
        raise ValueError("Orientation quaternion must have non-zero length.")
    w, x, y, z = quaternion / norm
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


def _as_orientation(value: Sequence[float] | np.ndarray) -> np.ndarray:
    array = np.asarray(value, dtype=np.float64)
    if array.shape == (4,):
        return _quaternion_to_matrix(array)
    if array.shape != (3, 3) or not np.all(np.isfinite(array)):
        raise ValueError("Orientation must be a finite 3x3 matrix or wxyz quaternion.")
    if not np.allclose(array.T @ array, np.eye(3), atol=1e-4) or np.linalg.det(array) <= 0:
        raise ValueError("Orientation matrix must be a proper rotation matrix.")
    return array.copy()


class DampedLeastSquaresIK:
    def __init__(
        self,
        model: object,
        data: object,
        joint_names: Sequence[str],
        end_effector_site: str,
        *,
        damping: float = 0.05,
        max_joint_delta: float | Sequence[float] = 0.1,
        position_tolerance: float = 1e-4,
        orientation_tolerance: float = 1e-3,
        max_iterations: int = 100,
    ) -> None:
        mujoco = _load_mujoco()
        names = tuple(joint_names)
        if not names or any(not isinstance(name, str) or not name.strip() for name in names):
            raise IKConfigurationError("At least one named arm joint is required.")
        if len(set(names)) != len(names):
            raise IKConfigurationError("IK joint names must be unique.")
        if not isinstance(end_effector_site, str) or not end_effector_site.strip():
            raise IKConfigurationError("An end-effector site name is required.")
        if not np.isfinite(damping) or damping <= 0:
            raise IKConfigurationError("IK damping must be a positive finite number.")
        if not np.isfinite(position_tolerance) or position_tolerance <= 0:
            raise IKConfigurationError("Position tolerance must be a positive finite number.")
        if not np.isfinite(orientation_tolerance) or orientation_tolerance <= 0:
            raise IKConfigurationError("Orientation tolerance must be a positive finite number.")
        if not isinstance(max_iterations, int) or isinstance(max_iterations, bool) or max_iterations < 1:
            raise IKConfigurationError("IK max_iterations must be a positive integer.")

        self.model = model
        self.data = data
        self._mujoco = mujoco
        self.damping = float(damping)
        self.position_tolerance = float(position_tolerance)
        self.orientation_tolerance = float(orientation_tolerance)
        self.max_iterations = max_iterations
        self._joints = tuple(self._resolve_joint(name) for name in names)
        self._max_joint_delta = _as_delta(max_joint_delta, len(self._joints), "max_joint_delta")
        try:
            self.site_id = int(np.asarray(model.site(end_effector_site).id).reshape(-1)[0])
        except Exception as error:
            raise IKConfigurationError(
                f"No end-effector site named '{end_effector_site}' exists in the MuJoCo model."
            ) from error
        self.end_effector_site = end_effector_site

    @property
    def joint_names(self) -> tuple[str, ...]:
        return tuple(joint.name for joint in self._joints)

    def _resolve_joint(self, name: str) -> _JointBinding:
        try:
            joint = self.model.joint(name)
        except Exception as error:
            raise IKConfigurationError(
                f"No IK joint named '{name}' exists in the MuJoCo model."
            ) from error
        joint_type = int(np.asarray(joint.type).reshape(-1)[0])
        if joint_type not in (
            self._mujoco.mjtJoint.mjJNT_HINGE,
            self._mujoco.mjtJoint.mjJNT_SLIDE,
        ):
            raise IKConfigurationError(f"IK joint '{name}' must be a hinge or slide joint.")
        limited = bool(np.asarray(joint.limited).reshape(-1)[0])
        joint_range = np.asarray(joint.range, dtype=np.float64).reshape(-1)
        if limited and (
            joint_range.shape != (2,)
            or not np.all(np.isfinite(joint_range))
            or joint_range[0] > joint_range[1]
        ):
            raise IKConfigurationError(f"IK joint '{name}' has invalid model limits.")
        return _JointBinding(
            name=name,
            joint_id=int(np.asarray(joint.id).reshape(-1)[0]),
            qpos_address=int(np.asarray(joint.qposadr).reshape(-1)[0]),
            dof_address=int(np.asarray(joint.dofadr).reshape(-1)[0]),
            lower=float(joint_range[0]) if limited else -np.inf,
            upper=float(joint_range[1]) if limited else np.inf,
            limited=limited,
        )

    def _joint_positions(self) -> np.ndarray:
        qpos = np.asarray(self.data.qpos, dtype=np.float64)
        return np.array([qpos[joint.qpos_address] for joint in self._joints], dtype=np.float64)

    def _snapshot(self) -> np.ndarray:
        signature = self._mujoco.mjtState.mjSTATE_FULLPHYSICS
        state = np.empty(self._mujoco.mj_stateSize(self.model, signature), dtype=np.float64)
        self._mujoco.mj_getState(self.model, self.data, state, signature)
        return state

    def _restore(self, state: np.ndarray) -> None:
        signature = self._mujoco.mjtState.mjSTATE_FULLPHYSICS
        self._mujoco.mj_setState(self.model, self.data, state, signature)
        self._mujoco.mj_forward(self.model, self.data)

    def _errors(
        self,
        target_position: np.ndarray,
        target_orientation: np.ndarray | None,
        orientation_axes: tuple[int, ...],
    ) -> tuple[np.ndarray, np.ndarray]:
        current_position = np.asarray(self.data.site_xpos[self.site_id], dtype=np.float64)
        position_error = target_position - current_position
        if target_orientation is None:
            return position_error, np.zeros(3, dtype=np.float64)
        current_orientation = np.asarray(self.data.site_xmat[self.site_id], dtype=np.float64).reshape(3, 3)
        orientation_error = 0.5 * sum(
            (
                np.cross(current_orientation[:, axis], target_orientation[:, axis])
                for axis in orientation_axes
            ),
            start=np.zeros(3, dtype=np.float64),
        )
        return position_error, orientation_error

    def _result(
        self,
        success: bool,
        joint_positions: np.ndarray,
        iterations: int,
        position_error: float,
        orientation_error: float,
        reason: IKFailureReason | None = None,
        message: str | None = None,
    ) -> IKSolveResult:
        return IKSolveResult(
            success=success,
            joint_positions=np.asarray(joint_positions, dtype=np.float64).copy(),
            iterations=iterations,
            position_error=float(position_error),
            orientation_error=float(orientation_error),
            reason=reason,
            message=message,
        )

    def solve(
        self,
        target_position: Sequence[float] | np.ndarray,
        target_orientation: Sequence[float] | np.ndarray | None = None,
        *,
        orientation_weight: float = 0.3,
        require_orientation: bool = True,
        orientation_axes: Sequence[int] | None = None,
        position_tolerance: float | None = None,
        max_iterations: int | None = None,
        max_joint_delta: float | Sequence[float] | None = None,
        preserve_state: bool = False,
    ) -> IKSolveResult:
        initial_positions = self._joint_positions()
        try:
            position_target = _as_vector(target_position, 3, "target_position")
            orientation_target = None if target_orientation is None else _as_orientation(target_orientation)
            selected_orientation_axes = tuple(range(3)) if orientation_axes is None else tuple(orientation_axes)
            if (
                not selected_orientation_axes
                or len(set(selected_orientation_axes)) != len(selected_orientation_axes)
                or any(
                    isinstance(axis, bool) or not isinstance(axis, int) or axis not in range(3)
                    for axis in selected_orientation_axes
                )
            ):
                raise ValueError("orientation_axes must contain unique axis indices 0, 1, or 2.")
            if not np.isfinite(orientation_weight) or orientation_weight < 0:
                raise ValueError("orientation_weight must be a non-negative finite number.")
            if not isinstance(require_orientation, bool):
                raise ValueError("require_orientation must be a boolean.")
            position_limit = (
                self.position_tolerance
                if position_tolerance is None
                else float(position_tolerance)
            )
            if not np.isfinite(position_limit) or position_limit <= 0:
                raise ValueError("position_tolerance must be a positive finite number.")
            iteration_limit = self.max_iterations if max_iterations is None else max_iterations
            if not isinstance(iteration_limit, int) or isinstance(iteration_limit, bool) or iteration_limit < 1:
                raise ValueError("max_iterations must be a positive integer.")
            delta_limit = (
                self._max_joint_delta
                if max_joint_delta is None
                else _as_delta(max_joint_delta, len(self._joints), "max_joint_delta")
            )
        except ValueError as error:
            return self._result(
                False,
                initial_positions,
                0,
                np.inf,
                np.inf,
                "invalid_target",
                str(error),
            )

        state = self._snapshot()
        position_error_norm = np.inf
        orientation_error_norm = np.inf if orientation_target is not None else 0.0
        joint_positions = initial_positions.copy()
        for iteration in range(iteration_limit):
            self._mujoco.mj_forward(self.model, self.data)
            position_error, orientation_error = self._errors(
                position_target,
                orientation_target,
                selected_orientation_axes,
            )
            position_error_norm = float(np.linalg.norm(position_error))
            orientation_error_norm = float(np.linalg.norm(orientation_error))
            position_converged = position_error_norm <= position_limit
            orientation_converged = (
                orientation_target is None or orientation_error_norm <= self.orientation_tolerance
            )
            if position_converged and (
                orientation_converged
                or orientation_target is None
                or not require_orientation
            ):
                joint_positions = self._joint_positions()
                if preserve_state:
                    self._restore(state)
                return self._result(
                    True,
                    joint_positions,
                    iteration,
                    position_error_norm,
                    orientation_error_norm,
                )

            jacobian_position = np.zeros((3, self.model.nv), dtype=np.float64)
            jacobian_rotation = np.zeros((3, self.model.nv), dtype=np.float64)
            self._mujoco.mj_jacSite(
                self.model,
                self.data,
                jacobian_position,
                jacobian_rotation,
                self.site_id,
            )
            dof_addresses = [joint.dof_address for joint in self._joints]
            if orientation_target is None:
                jacobian = jacobian_position[:, dof_addresses]
                error_vector = position_error
            else:
                jacobian = np.vstack(
                    (jacobian_position[:, dof_addresses], orientation_weight * jacobian_rotation[:, dof_addresses])
                )
                error_vector = np.concatenate((position_error, orientation_weight * orientation_error))
            normal_matrix = jacobian.T @ jacobian + self.damping**2 * np.eye(len(self._joints))
            try:
                joint_delta = np.linalg.solve(normal_matrix, jacobian.T @ error_vector)
            except np.linalg.LinAlgError:
                joint_delta = np.linalg.lstsq(normal_matrix, jacobian.T @ error_vector, rcond=None)[0]
            if not np.all(np.isfinite(joint_delta)):
                break
            joint_delta = np.clip(joint_delta, -delta_limit, delta_limit)
            qpos = np.asarray(self.data.qpos)
            for joint_index, joint in enumerate(self._joints):
                next_position = float(qpos[joint.qpos_address] + joint_delta[joint_index])
                if joint.limited:
                    next_position = float(np.clip(next_position, joint.lower, joint.upper))
                qpos[joint.qpos_address] = next_position

        self._mujoco.mj_forward(self.model, self.data)
        position_error, orientation_error = self._errors(
            position_target,
            orientation_target,
            selected_orientation_axes,
        )
        position_error_norm = float(np.linalg.norm(position_error))
        orientation_error_norm = float(np.linalg.norm(orientation_error))
        if not require_orientation and position_error_norm <= position_limit:
            return self._result(
                True,
                self._joint_positions(),
                iteration_limit,
                position_error_norm,
                orientation_error_norm,
            )
        self._restore(state)
        return self._result(
            False,
            initial_positions,
            iteration_limit,
            position_error_norm,
            orientation_error_norm,
            "non_convergence",
            (
                f"IK did not converge for site '{self.end_effector_site}' after "
                f"{iteration_limit} iterations (position error {position_error_norm:.6g}, "
                f"orientation error {orientation_error_norm:.6g})."
            ),
        )
