# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Robot-agnostic helpers that bind a teleoperation profile to a local MuJoCo model.

Robot adapters and task controllers use these to translate profile action names into actuator,
joint, and qpos addresses, and to look up bodies, sites, and geoms by their namespaced names.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass(frozen=True)
class ActionBinding:
    """One profile action field resolved against the local MuJoCo model."""

    action_name: str
    actuator_name: str
    actuator_id: int
    joint_name: str | None
    joint_id: int | None
    qpos_address: int | None
    control_range: tuple[float, float] | None


def model_id(mujoco: Any, model: Any, object_type: Any, name: str, label: str) -> int:
    object_id = int(mujoco.mj_name2id(model, object_type, name))
    if object_id < 0:
        raise RuntimeError(f"No {label} named '{name}' exists in the scene.")
    return object_id


def short_name(name: str) -> str:
    """Return a name without its robot-instance namespace, for example ``robot_1__gripper``."""
    return name.rsplit("__", 1)[-1].lower()


def _finite_range(value: Any) -> tuple[float, float] | None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)) or len(value) != 2:
        return None
    if not all(isinstance(item, (int, float)) and np.isfinite(item) for item in value):
        return None
    lower, upper = float(value[0]), float(value[1])
    return (lower, upper) if lower <= upper else None


def resolve_action_bindings(mujoco: Any, model: Any, profile: Mapping[str, Any]) -> tuple[ActionBinding, ...]:
    fields = profile.get("action")
    if not isinstance(fields, list) or not fields:
        raise RuntimeError("The teleoperation profile does not declare any action fields.")
    bindings: list[ActionBinding] = []
    for index, value in enumerate(fields):
        if not isinstance(value, Mapping):
            raise RuntimeError(f"Action field {index} is not an object.")
        action_name = value.get("name")
        actuator_name = value.get("actuator")
        if not isinstance(action_name, str) or not action_name:
            raise RuntimeError(f"Action field {index} has no name.")
        if not isinstance(actuator_name, str) or not actuator_name:
            raise RuntimeError(f"Action field '{action_name}' has no actuator.")
        actuator_id = model_id(mujoco, model, mujoco.mjtObj.mjOBJ_ACTUATOR, actuator_name, "actuator")
        joint_id: int | None = None
        joint_name: str | None = None
        qpos_address: int | None = None
        if int(model.actuator_trntype[actuator_id]) == int(mujoco.mjtTrn.mjTRN_JOINT):
            joint_id = int(model.actuator_trnid[actuator_id, 0])
            joint_name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, joint_id)
            if not isinstance(joint_name, str) or not joint_name:
                raise RuntimeError(f"Actuator '{actuator_name}' has no named joint transmission.")
            qpos_address = int(model.jnt_qposadr[joint_id])
        model_range = None
        if bool(model.actuator_ctrllimited[actuator_id]):
            model_range = _finite_range(model.actuator_ctrlrange[actuator_id])
        bindings.append(
            ActionBinding(
                action_name=action_name,
                actuator_name=actuator_name,
                actuator_id=actuator_id,
                joint_name=joint_name,
                joint_id=joint_id,
                qpos_address=qpos_address,
                control_range=_finite_range(value.get("controlRange")) or model_range,
            )
        )
    return tuple(bindings)


def resolve_name_by_suffix(
    mujoco: Any,
    model: Any,
    object_type: Any,
    count: int,
    requested: str,
    label: str,
) -> str:
    """Resolve an exact name, or a unique namespaced name ending in ``__<requested>``."""
    exact_id = int(mujoco.mj_name2id(model, object_type, requested))
    if exact_id >= 0:
        return requested
    matches: list[str] = []
    for index in range(count):
        name = mujoco.mj_id2name(model, object_type, index)
        if isinstance(name, str) and (short_name(name) == requested.lower() or name.endswith(f"__{requested}")):
            matches.append(name)
    if len(matches) != 1:
        if not matches:
            raise RuntimeError(f"No {label} named '{requested}' or matching that suffix exists.")
        raise RuntimeError(f"More than one {label} matches '{requested}': {matches}.")
    return matches[0]


def resolve_body(mujoco: Any, model: Any, requested: str, label: str = "body") -> str:
    return resolve_name_by_suffix(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, int(model.nbody), requested, label)


def find_optional_site(mujoco: Any, model: Any, requested: str) -> str | None:
    try:
        return resolve_name_by_suffix(mujoco, model, mujoco.mjtObj.mjOBJ_SITE, int(model.nsite), requested, "site")
    except RuntimeError:
        return None


def find_geom_suffix(mujoco: Any, model: Any, suffix: str) -> str | None:
    matches: list[str] = []
    for index in range(int(model.ngeom)):
        name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM, index)
        if isinstance(name, str) and (short_name(name) == suffix or name.endswith(f"__{suffix}")):
            matches.append(name)
    if len(matches) > 1:
        raise RuntimeError(f"More than one geom matches '{suffix}': {matches}.")
    return matches[0] if matches else None


def body_position(mujoco: Any, model: Any, data: Any, body_name: str) -> np.ndarray:
    body_id = model_id(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, body_name, "body")
    return np.asarray(data.xpos[body_id], dtype=np.float64).copy()


def body_quaternion(mujoco: Any, model: Any, data: Any, body_name: str) -> np.ndarray:
    body_id = model_id(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, body_name, "body")
    quaternion = np.empty(4, dtype=np.float64)
    mujoco.mju_mat2Quat(quaternion, np.asarray(data.xmat[body_id], dtype=np.float64))
    return quaternion


def site_position(mujoco: Any, model: Any, data: Any, site_name: str | None) -> np.ndarray | None:
    if site_name is None:
        return None
    site_id = model_id(mujoco, model, mujoco.mjtObj.mjOBJ_SITE, site_name, "site")
    return np.asarray(data.site_xpos[site_id], dtype=np.float64).copy()


def clamp(value: float, control_range: tuple[float, float] | None) -> float:
    if control_range is None:
        return float(value)
    return float(np.clip(value, control_range[0], control_range[1]))


def has_free_joint(mujoco: Any, model: Any, body_name: str) -> bool:
    body_id = model_id(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, body_name, "body")
    start = int(model.body_jntadr[body_id])
    count = int(model.body_jntnum[body_id])
    return any(
        int(model.jnt_type[joint]) == int(mujoco.mjtJoint.mjJNT_FREE) for joint in range(start, start + count)
    )
