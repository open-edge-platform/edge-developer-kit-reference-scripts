# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Scene checks for the SO-101 pick-and-place task.

Run these before generating data for a new or edited scene. They catch missing bindings, a source
object that cannot move, objects that start inside other geometry, cameras that will not be
recorded, and object positions the controller cannot reach. Passing the checks does not guarantee
an attempt succeeds; physics-only attempts remain the final test.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

import numpy as np

from ..bindings import (
    body_position,
    find_geom_suffix,
    find_optional_site,
    has_free_joint,
    resolve_action_bindings,
    resolve_body,
    site_position,
)
from ..overlaps import find_initial_overlaps
from .adapter import SO101
from .controller import PickPlaceController, PickPlaceError, PickPlaceTask, PickPlaceTuning

if TYPE_CHECKING:
    from ..control import ControlTarget


@dataclass(frozen=True)
class SceneIssue:
    level: Literal["error", "warning"]
    message: str
    hint: str = ""

    def __str__(self) -> str:
        text = f"{self.level.upper()}: {self.message}"
        return f"{text}\n    → {self.hint}" if self.hint else text


def _camera_issues(profile: Mapping[str, Any], require_cameras: bool) -> list[SceneIssue]:
    cameras = profile.get("cameras")
    names = [
        camera.get("outputName")
        for camera in cameras
        if isinstance(camera, Mapping) and isinstance(camera.get("outputName"), str)
    ] if isinstance(cameras, list) else []
    if profile.get("captureRgb") and names:
        return []
    level: Literal["error", "warning"] = "error" if require_cameras else "warning"
    return [
        SceneIssue(
            level,
            "The session does not record camera images, so its episodes cannot be converted for training.",
            "Add at least one camera to the scene, save it, and reopen Generate.",
        )
    ]


def check_scene(
    client: ControlTarget,
    mujoco: Any,
    task: PickPlaceTask = PickPlaceTask(),
    tuning: PickPlaceTuning = PickPlaceTuning(),
    *,
    require_cameras: bool = True,
) -> list[SceneIssue]:
    """Check robot bindings, task bodies, and cameras in the connected session's scene."""
    issues: list[SceneIssue] = []
    profile = client.profile if isinstance(client.profile, Mapping) else {}
    model = client.local.model
    issues.extend(_camera_issues(profile, require_cameras))

    try:
        bindings = resolve_action_bindings(mujoco, model, profile)
        SO101.resolve_arm_bindings(bindings, tuning.arm_joints)
        SO101.resolve_gripper_binding(bindings, tuning.gripper_action)
    except RuntimeError as error:
        issues.append(
            SceneIssue(
                "error",
                f"The scene's robot is not a recognized SO-101 arm: {error}",
                "Insert the SO-101 from the robot library, or use the generic joint-control example.",
            )
        )
    try:
        SO101.resolve_end_effector_site(mujoco, model, override=tuning.end_effector_site)
    except RuntimeError as error:
        issues.append(SceneIssue("error", str(error), "Use the SO-101 from the robot library."))
    if find_geom_suffix(mujoco, model, "fixed_finger_pad") is None or find_geom_suffix(
        mujoco, model, "moving_finger_pad"
    ) is None:
        issues.append(
            SceneIssue(
                "warning",
                "The gripper finger-pad geoms were not found; grasps will be less precise.",
                "Use the unmodified SO-101 gripper from the robot library.",
            )
        )

    for label, requested in (("object to pick", task.source_body), ("container", task.container_body)):
        try:
            name = resolve_body(mujoco, model, requested, label)
        except RuntimeError as error:
            issues.append(
                SceneIssue(
                    "error",
                    str(error),
                    "Pass the body name shown in the scene tree with --source-body or --container-body.",
                )
            )
            continue
        if label == "object to pick" and not has_free_joint(mujoco, model, name):
            issues.append(
                SceneIssue(
                    "error",
                    f"'{name}' cannot move because it has no free joint.",
                    "Select the object in Build and enable its free joint (movable object).",
                )
            )
    issues.extend(overlap_issues(mujoco, model, client.local.data))
    return issues


def overlap_issues(mujoco: Any, model: Any, data: Any) -> list[SceneIssue]:
    """Report movable objects that start inside other geometry in the given state."""
    return [
        SceneIssue("error", overlap.describe(), overlap.hint())
        for overlap in find_initial_overlaps(mujoco, model, data)
    ]


def check_reachability(
    client: ControlTarget,
    mujoco: Any,
    task: PickPlaceTask = PickPlaceTask(),
    tuning: PickPlaceTuning = PickPlaceTuning(),
) -> SceneIssue | None:
    """Check for overlaps, then plan a grasp and a container approach from the current state.

    Neither check moves the robot.
    """
    model = client.local.model
    data = client.local.data
    overlaps = overlap_issues(mujoco, model, data)
    if overlaps:
        return overlaps[0]
    try:
        controller = PickPlaceController(client, mujoco, task, tuning)
    except (RuntimeError, ValueError) as error:
        return SceneIssue("error", str(error))
    source_reference = controller._reference_position(controller.source_body, controller.source_site).copy()
    try:
        controller._plan_grasp(source_reference)
    except PickPlaceError as error:
        hint = (
            "Move the object away from neighboring objects and container walls."
            if error.reason == "grasp_blocked"
            else "Move the object closer to the arm or reduce its randomization range."
        )
        return SceneIssue("error", str(error), hint)
    container_site = find_optional_site(mujoco, model, f"{controller.container_body}__generation_interior")
    container = site_position(mujoco, model, data, container_site)
    if container is None:
        container = body_position(mujoco, model, data, controller.container_body)
    above_container = np.asarray(container, dtype=np.float64) + [0.0, 0.0, tuning.lift_height]
    with controller._local_probe():
        result = controller.ik.solve(above_container, position_tolerance=0.005, preserve_state=False)
    if not result.success:
        return SceneIssue(
            "error",
            "The arm cannot reach above the container.",
            "Move the container closer to the arm.",
        )
    return None


def _axis_samples(value: Any, count: int) -> list[float]:
    low, high = (float(item) for item in value)
    return sorted({float(item) for item in np.linspace(low, high, count)})


def sweep_reachability(
    client: ControlTarget,
    mujoco: Any,
    task: PickPlaceTask = PickPlaceTask(),
    tuning: PickPlaceTuning = PickPlaceTuning(),
    *,
    samples_per_axis: int = 3,
) -> list[SceneIssue]:
    """Plan a grasp at the corners, edges, and centre of Generate's source randomization range.

    Uses the session's ``sourceRandomization`` (X/Y offsets in cm and yaw in degrees, relative to
    the object's current pose) and reports each unreachable sample as a warning. The local model is
    restored afterwards; the authoritative simulation is never moved.
    """
    if samples_per_axis < 2:
        raise ValueError("samples_per_axis must be at least 2")
    profile = client.profile if isinstance(client.profile, Mapping) else {}
    configuration = profile.get("sourceRandomization")
    if not isinstance(configuration, Mapping) or not configuration.get("enabled", False):
        return []
    model, data = client.local.model, client.local.data
    body_name = resolve_body(mujoco, model, task.source_body, "object to pick")
    body_id = int(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, body_name))
    qpos_address = int(model.jnt_qposadr[int(model.body_jntadr[body_id])])
    baseline = np.asarray(data.qpos).copy()
    base_position = baseline[qpos_address : qpos_address + 3].copy()
    base_rotation = baseline[qpos_address + 3 : qpos_address + 7].copy()
    samples = [
        (x_cm, y_cm, yaw_degrees)
        for x_cm in _axis_samples(configuration.get("xCm", (0, 0)), samples_per_axis)
        for y_cm in _axis_samples(configuration.get("yCm", (0, 0)), samples_per_axis)
        for yaw_degrees in _axis_samples(configuration.get("yawDegrees", (0, 0)), samples_per_axis)
    ]
    issues: list[SceneIssue] = []
    qpos = np.asarray(data.qpos)
    try:
        for x_cm, y_cm, yaw_degrees in samples:
            qpos[:] = baseline
            qpos[qpos_address : qpos_address + 3] = base_position + (x_cm / 100.0, y_cm / 100.0, 0.0)
            half_yaw = np.radians(yaw_degrees) / 2.0
            rotated = np.empty(4)
            mujoco.mju_mulQuat(rotated, base_rotation, np.asarray([np.cos(half_yaw), 0.0, 0.0, np.sin(half_yaw)]))
            qpos[qpos_address + 3 : qpos_address + 7] = rotated
            mujoco.mj_forward(model, data)
            controller = PickPlaceController(client, mujoco, task, tuning)
            try:
                controller._plan_grasp(
                    controller._reference_position(controller.source_body, controller.source_site).copy()
                )
            except PickPlaceError as error:
                issues.append(
                    SceneIssue(
                        "warning",
                        f"No grasp at x={x_cm:+.1f} cm, y={y_cm:+.1f} cm, yaw={yaw_degrees:+.0f} deg: {error}",
                        "Reduce the randomization range or move the object closer to the arm.",
                    )
                )
    finally:
        qpos[:] = baseline
        mujoco.mj_forward(model, data)
    return issues
