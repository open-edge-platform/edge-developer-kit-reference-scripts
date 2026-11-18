# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from robotic_studio.teleoperation import JointInfo, StateSnapshot


@dataclass(frozen=True)
class JointMapping:
    ros_name: str
    joint: JointInfo


def joint_mapping(
    joints: Mapping[str, JointInfo],
    ros_names: Sequence[str] = (),
    studio_names: Sequence[str] = (),
) -> tuple[JointMapping, ...]:
    if bool(ros_names) != bool(studio_names) or len(ros_names) != len(studio_names):
        raise ValueError("ros_joint_names and studio_joint_names must have matching lengths.")
    if not ros_names:
        studio_names = tuple(name for name, joint in joints.items() if joint.joint_type in {"hinge", "slide"})
        ros_names = studio_names
    if not ros_names:
        raise ValueError("The scene has no named scalar joints.")
    if len(set(ros_names)) != len(ros_names) or len(set(studio_names)) != len(studio_names):
        raise ValueError("Joint mappings must have unique ROS and Studio names.")
    result = []
    for ros_name, studio_name in zip(ros_names, studio_names, strict=True):
        if not ros_name or not studio_name:
            raise ValueError("Joint names must be non-empty.")
        if studio_name not in joints:
            raise ValueError(f"Unknown Studio joint '{studio_name}'.")
        joint = joints[studio_name]
        if joint.joint_type not in {"hinge", "slide"}:
            raise ValueError(f"Joint '{studio_name}' is not a scalar hinge/slide joint.")
        result.append(JointMapping(ros_name, joint))
    if not any(item.joint.controllable for item in result):
        raise ValueError("The joint mapping has no unambiguous position-controlled joint.")
    return tuple(result)


def position_targets(
    mapping: Sequence[JointMapping], names: Sequence[str], positions: Sequence[float]
) -> dict[str, float]:
    if not names or len(names) != len(positions) or len(set(names)) != len(names):
        raise ValueError("Commands need unique joint names and one position per name.")
    by_name = {item.ros_name: item.joint for item in mapping}
    result = {}
    for name, position in zip(names, positions, strict=True):
        joint = by_name.get(name)
        if joint is None:
            raise ValueError(f"Unknown ROS joint '{name}'.")
        if not joint.controllable:
            raise ValueError(f"Joint '{name}' has no unambiguous profile-declared position actuator.")
        if not math.isfinite(position):
            raise ValueError(f"Position for '{name}' must be finite.")
        if joint.range is not None and not joint.range[0] <= position <= joint.range[1]:
            raise ValueError(f"Position for '{name}' is outside joint limits {joint.range}.")
        if joint.position_control_range is not None and not joint.position_control_range[0] <= position <= joint.position_control_range[1]:
            raise ValueError(f"Position for '{name}' is outside actuator limits {joint.position_control_range}.")
        result[joint.name] = float(position)
    return result


def joint_values(
    mapping: Sequence[JointMapping], snapshot: StateSnapshot
) -> tuple[list[str], list[float], list[float]]:
    names, positions, velocities = [], [], []
    for item in mapping:
        qpos = snapshot.qpos[item.joint.qpos_slice]
        qvel = snapshot.qvel[item.joint.qvel_slice]
        if qpos.shape != (1,) or qvel.shape != (1,):
            raise ValueError(f"Scalar state slices for '{item.ros_name}' do not match the snapshot.")
        position, velocity = float(qpos[0]), float(qvel[0])
        if not math.isfinite(position) or not math.isfinite(velocity):
            raise ValueError(f"State for '{item.ros_name}' is non-finite.")
        names.append(item.ros_name)
        positions.append(position)
        velocities.append(velocity)
    return names, positions, velocities


def stamp_parts(simulation_time: float) -> tuple[int, int]:
    if not math.isfinite(simulation_time) or simulation_time < 0:
        raise ValueError("Simulation time must be finite and non-negative.")
    if simulation_time >= 2_147_483_648:
        raise ValueError("Simulation time exceeds the ROS timestamp range.")
    nanoseconds = round(simulation_time * 1_000_000_000)
    seconds, remainder = divmod(nanoseconds, 1_000_000_000)
    if seconds > 2_147_483_647:
        raise ValueError("Simulation time exceeds the ROS timestamp range.")
    return seconds, remainder
