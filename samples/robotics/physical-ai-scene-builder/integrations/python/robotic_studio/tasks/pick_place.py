# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""MuJoCo geometry and success criteria for pick-and-place.

The scripted SO-101 controller (demo quality gate) and the Evaluate worker (policy success check)
both use these functions, so "placed" means the same thing in datasets and in evaluation.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from ..policy_environment import TaskStatus

OBJECT_SETTLE_SPEED = 0.01
OBJECT_SETTLE_ANGULAR_SPEED = math.radians(5.0)
OBJECT_SETTLE_QUIET_SECONDS = 0.2
DEFAULT_PLACEMENT_HALF_EXTENTS = (0.02, 0.02)
DEFAULT_OFF_TABLE_MARGIN = 0.05

__all__ = [
    "DEFAULT_OFF_TABLE_MARGIN",
    "DEFAULT_PLACEMENT_HALF_EXTENTS",
    "OBJECT_SETTLE_ANGULAR_SPEED",
    "OBJECT_SETTLE_QUIET_SECONDS",
    "OPENING_CONTACT_ALLOWANCE",
    "OBJECT_SETTLE_SPEED",
    "PickPlaceSuccessCheck",
    "Placement",
    "TaskStatus",
    "container_interior_half_extents",
    "evaluate_placement",
    "gripper_touches",
    "placement_offset",
    "source_footprint_extents",
]


def _id(mujoco: Any, model: Any, object_type: Any, name: str, label: str) -> int:
    index = int(mujoco.mj_name2id(model, object_type, name))
    if index < 0:
        raise ValueError(f"No MuJoCo {label} named '{name}' exists.")
    return index


def _body_id(mujoco: Any, model: Any, name: str) -> int:
    return _id(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, name, "body")


def _geom_ids_for_body(model: Any, body_id: int) -> list[int]:
    """Geoms attached to ``body_id`` or any of its descendants."""
    result = []
    parents = np.asarray(model.body_parentid)
    for geom_id, owner_value in enumerate(np.asarray(model.geom_bodyid)):
        owner = int(owner_value)
        while owner > 0 and owner != body_id:
            owner = int(parents[owner])
        if owner == body_id:
            result.append(geom_id)
    return result


def _axial_geom_types(mujoco: Any) -> tuple[int, int]:
    return int(mujoco.mjtGeom.mjGEOM_CYLINDER), int(mujoco.mjtGeom.mjGEOM_CAPSULE)


def source_footprint_extents(
    mujoco: Any, model: Any, data: Any, source_body: str, container_rotation: np.ndarray
) -> np.ndarray:
    """Conservative source-object half-extents in the container's local frame."""
    source_id = _body_id(mujoco, model, source_body)
    source_position = np.asarray(data.xpos[source_id], dtype=np.float64)
    extents = np.zeros(3, dtype=np.float64)
    for geom_id in _geom_ids_for_body(model, source_id):
        geom_rotation = np.asarray(data.geom_xmat[geom_id], dtype=np.float64).reshape(3, 3)
        relative_center = container_rotation.T @ (np.asarray(data.geom_xpos[geom_id]) - source_position)
        geom_axes = container_rotation.T @ geom_rotation
        geom_type = int(model.geom_type[geom_id])
        size = np.asarray(model.geom_size[geom_id], dtype=np.float64)
        if geom_type == int(mujoco.mjtGeom.mjGEOM_BOX):
            radius = np.abs(geom_axes) @ size[:3]
        elif geom_type == int(mujoco.mjtGeom.mjGEOM_SPHERE):
            radius = np.full(3, float(size[0]))
        elif hasattr(mujoco.mjtGeom, "mjGEOM_ELLIPSOID") and geom_type == int(mujoco.mjtGeom.mjGEOM_ELLIPSOID):
            radius = np.sqrt((geom_axes**2) @ (size[:3] ** 2))
        elif geom_type in _axial_geom_types(mujoco):
            # Exact bounds of a cylinder or capsule at any tilt; its bounding sphere would reject a
            # cylinder lying inside the container (radius + half-length exceeds the opening).
            axis = geom_axes[:, 2]
            across = np.sqrt(np.clip(1.0 - axis**2, 0.0, 1.0))
            capsule = geom_type == int(mujoco.mjtGeom.mjGEOM_CAPSULE)
            radius = float(size[1]) * np.abs(axis) + float(size[0]) * (1.0 if capsule else across)
        else:
            # A bounding sphere is conservative for other primitives and mesh geoms.
            radius = np.full(3, float(model.geom_rbound[geom_id]))
        extents = np.maximum(extents, np.abs(relative_center) + radius)
    return extents


def container_interior_half_extents(
    mujoco: Any,
    model: Any,
    data: Any,
    container_body: str,
    container_rotation: np.ndarray,
    interior_site: str | None = None,
) -> np.ndarray | None:
    """X/Y half-extents of the container opening, or ``None`` when none can be inferred.

    Prefers an explicit interior box site on the container, then rectangular box walls.
    """
    container_id = _body_id(mujoco, model, container_body)
    if interior_site is not None:
        site_id = int(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, interior_site))
        if site_id >= 0:
            if int(np.asarray(model.site_bodyid)[site_id]) != container_id:
                raise ValueError(
                    f"Container interior site '{interior_site}' must be attached to '{container_body}'."
                )
            site_rotation = np.asarray(data.site_xmat[site_id], dtype=np.float64).reshape(3, 3)
            if not np.allclose(site_rotation, container_rotation, atol=1e-5):
                raise ValueError(f"Container interior site '{interior_site}' must align with the container frame.")
            size = np.asarray(model.site_size[site_id], dtype=np.float64)
            if size.shape[0] < 2 or np.any(size[:2] <= 0):
                raise ValueError(f"Container interior site '{interior_site}' needs positive X/Y half-extents.")
            return size[:2].copy()
    center_position = np.asarray(data.xpos[container_id], dtype=np.float64)
    interior = np.full(2, np.inf, dtype=np.float64)
    found = [False, False]
    for geom_id in _geom_ids_for_body(model, container_id):
        if int(model.geom_type[geom_id]) != int(mujoco.mjtGeom.mjGEOM_BOX):
            continue
        rotation = np.asarray(data.geom_xmat[geom_id], dtype=np.float64).reshape(3, 3)
        axes = container_rotation.T @ rotation
        center = container_rotation.T @ (np.asarray(data.geom_xpos[geom_id]) - center_position)
        radius = np.abs(axes) @ np.asarray(model.geom_size[geom_id], dtype=np.float64)[:3]
        for axis in range(2):
            # A wall sits away from the centre and extends across the other horizontal axis.
            other = 1 - axis
            if abs(float(center[axis])) <= radius[axis] or radius[other] < 2.0 * radius[axis]:
                continue
            bound = abs(float(center[axis])) - radius[axis]
            if bound > 0:
                interior[axis] = min(interior[axis], bound)
                found[axis] = True
    return interior if all(found) else None


def placement_offset(
    mujoco: Any, model: Any, data: Any, source_body: str, container_body: str
) -> tuple[np.ndarray, np.ndarray]:
    """Source centre in the container frame, and the container rotation matrix."""
    source_id = _body_id(mujoco, model, source_body)
    container_id = _body_id(mujoco, model, container_body)
    rotation = np.asarray(data.xmat[container_id], dtype=np.float64).reshape(3, 3)
    offset = rotation.T @ (np.asarray(data.xpos[source_id]) - np.asarray(data.xpos[container_id]))
    return offset, rotation


# An object resting against a container wall reaches the opening edge exactly, and MuJoCo contacts
# overlap by a fraction of a millimetre, so the footprint may pass the opening by this much. It is
# well under the wall thickness, so an object lying across the rim still fails.
OPENING_CONTACT_ALLOWANCE = 0.002


@dataclass(frozen=True)
class Placement:
    """Geometric placement verdict; settling and finger contact are checked separately."""

    inside: bool
    offset: np.ndarray
    footprint: np.ndarray
    opening: np.ndarray | None


def evaluate_placement(
    mujoco: Any,
    model: Any,
    data: Any,
    source_body: str,
    container_body: str,
    placement_half_extents: Sequence[float],
    interior_site: str | None = None,
) -> Placement:
    """The source centre is within tolerance, its footprint fits the opening, and it is above the base."""
    offset, rotation = placement_offset(mujoco, model, data, source_body, container_body)
    footprint = source_footprint_extents(mujoco, model, data, source_body, rotation)
    opening = container_interior_half_extents(mujoco, model, data, container_body, rotation, interior_site)
    centre_offset = np.abs(offset[:2])
    outside = bool(np.any(centre_offset > np.asarray(placement_half_extents, dtype=np.float64)))
    if opening is not None:
        outside = outside or bool(np.any(centre_offset + footprint[:2] > opening + OPENING_CONTACT_ALLOWANCE))
    return Placement(not outside and float(offset[2]) > 0.0, offset, footprint, opening)


def gripper_touches(
    mujoco: Any, model: Any, data: Any, source_body: str, finger_geoms: Sequence[str]
) -> bool:
    """True when any named finger geom is in contact with the source object."""
    source_geoms = set(_geom_ids_for_body(model, _body_id(mujoco, model, source_body)))
    fingers = {_id(mujoco, model, mujoco.mjtObj.mjOBJ_GEOM, name, "geom") for name in finger_geoms}
    for contact_index in range(int(data.ncon)):
        contact = data.contact[contact_index]
        first, second = int(contact.geom1), int(contact.geom2)
        if (first in fingers and second in source_geoms) or (second in fingers and first in source_geoms):
            return True
    return False


class PickPlaceSuccessCheck:
    """Stateful per-episode success check, advanced after every completed policy step."""

    def __init__(
        self,
        mujoco: Any,
        model: Any,
        data: Any,
        task: Mapping[str, Any],
        finger_geoms: Sequence[str] = (),
    ) -> None:
        self.mujoco = mujoco
        self.source_body = str(task["sourceBody"])
        self.container_body = str(task["containerBody"])
        self.interior_site = str(task.get("interiorSite") or f"{self.container_body}__generation_interior")
        self.half_extents = np.asarray(
            task.get("placementHalfExtents", DEFAULT_PLACEMENT_HALF_EXTENTS), dtype=np.float64
        )
        self.settle_seconds = float(task.get("settleSeconds", OBJECT_SETTLE_QUIET_SECONDS))
        max_steps = task.get("maxEpisodeSteps")
        self.max_episode_steps = None if max_steps is None else int(max_steps)
        self.terminate_on_success = bool(task.get("terminateOnSuccess", True))
        self.off_table_margin = float(task.get("offTableMargin", DEFAULT_OFF_TABLE_MARGIN))
        self.finger_geoms = tuple(finger_geoms)
        for name in self.finger_geoms:
            _id(mujoco, model, mujoco.mjtObj.mjOBJ_GEOM, name, "geom")
        self.source_id = _body_id(mujoco, model, self.source_body)
        _body_id(mujoco, model, self.container_body)
        joint_count = int(np.asarray(model.body_jntnum)[self.source_id])
        joint_start = int(np.asarray(model.body_jntadr)[self.source_id])
        if joint_count != 1 or int(np.asarray(model.jnt_type)[joint_start]) != int(mujoco.mjtJoint.mjJNT_FREE):
            raise ValueError(f"Pick-place source body '{self.source_body}' must have exactly one free joint.")
        self.reset(model, data)

    def _metrics(self, offset: Sequence[float], speed: float, placed: bool) -> dict[str, float]:
        return {
            "placementErrorX": float(abs(offset[0])),
            "placementErrorY": float(abs(offset[1])),
            "sourceSpeed": float(speed),
            "quietSeconds": float(self.quiet_seconds),
            "fingerCheck": float(bool(self.finger_geoms)),
            "placementValid": float(placed),
        }

    def reset(self, model: Any, data: Any) -> TaskStatus:
        """Record the source's reset height and clear the quiet timer."""
        self.initial_height = float(np.asarray(data.xpos[self.source_id])[2])
        self.last_time = float(data.time)
        self.quiet_seconds = 0.0
        self.steps = 0
        self.status = TaskStatus(metrics=self._metrics((0.0, 0.0), 0.0, False))
        return self.status

    def update(self, model: Any, data: Any) -> TaskStatus:
        """Advance the check after one completed step; quiet time accumulates in simulation time."""
        self.steps += 1
        placement = evaluate_placement(
            self.mujoco, model, data, self.source_body, self.container_body, self.half_extents, self.interior_site
        )
        velocity = np.asarray(data.cvel[self.source_id], dtype=np.float64).reshape(-1)
        angular_speed = float(np.linalg.norm(velocity[:3]))
        linear_speed = float(np.linalg.norm(velocity[3:]))
        current_time = float(data.time)
        delta = max(0.0, current_time - self.last_time)
        self.last_time = current_time
        if linear_speed <= OBJECT_SETTLE_SPEED and angular_speed <= OBJECT_SETTLE_ANGULAR_SPEED:
            self.quiet_seconds += delta
        else:
            self.quiet_seconds = 0.0
        touching = bool(self.finger_geoms) and gripper_touches(
            self.mujoco, model, data, self.source_body, self.finger_geoms
        )
        # A source resting inside a sunken container is never "off the table".
        off_table = (
            not placement.inside
            and float(np.asarray(data.xpos[self.source_id])[2]) < self.initial_height - self.off_table_margin
        )
        success = placement.inside and self.quiet_seconds >= self.settle_seconds and not touching
        truncated = self.max_episode_steps is not None and self.steps >= self.max_episode_steps
        terminated = off_table or (success and self.terminate_on_success)
        if off_table:
            reason = "object_off_table"
        elif success:
            reason = "success"
        elif truncated:
            reason = "max_steps"
        else:
            reason = None
        self.status = TaskStatus(
            success=success,
            terminated=terminated,
            truncated=truncated,
            reason=reason,
            metrics=self._metrics(placement.offset, linear_speed, placement.inside),
        )
        return self.status
