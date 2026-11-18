# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

SO101_JOINT_RANGES_RAD = {
    "shoulder_pan": (-1.9198621771937616, 1.9198621771937634),
    "shoulder_lift": (-1.7453292519943295, 1.7453292519943295),
    "elbow_flex": (-1.69, 1.69),
    "wrist_flex": (-1.65806, 1.65806),
    "wrist_roll": (-2.7438472969992493, 2.841206309382605),
}
SO101_GRIPPER_RANGE_RAD = (-0.17453292519943295, 1.7453292519943295)


class SO101Adapter:
    """Bindings and conventions used by the bundled SO-101 arm demonstrations."""

    robot_id = "so101"
    arm_joint_suffixes = (
        "shoulder_pan",
        "shoulder_lift",
        "elbow_flex",
        "wrist_flex",
        "wrist_roll",
    )
    end_effector_site = "gripperframe"
    gripper_action = "gripper"
    home_wrist_roll_degrees = -90.0

    def resolve_gripper_binding(self, bindings: Sequence[Any], override: str | None = None) -> Any:
        action_name = override or self.gripper_action
        matches = [
            binding
            for binding in bindings
            if binding.action_name == action_name
            or binding.action_name.rsplit("__", 1)[-1].lower() == action_name.lower()
        ]
        if len(matches) != 1:
            raise RuntimeError(
                f"SO-101 adapter expected one gripper action named '{action_name}'. "
                "Pass --gripper-action explicitly to override the adapter binding."
            )
        return matches[0]

    def resolve_end_effector_site(self, mujoco: Any, model: Any, *, override: str | None = None) -> str:
        requested = override or self.end_effector_site
        object_type = mujoco.mjtObj.mjOBJ_SITE
        exact_id = int(mujoco.mj_name2id(model, object_type, requested))
        if exact_id >= 0:
            return requested
        matches = []
        for index in range(int(model.nsite)):
            name = mujoco.mj_id2name(model, object_type, index)
            if isinstance(name, str) and name.endswith(f"__{requested}"):
                matches.append(name)
        if len(matches) != 1:
            raise RuntimeError(
                f"SO-101 adapter expected one end-effector site named '{requested}'."
            )
        return matches[0]

    def resolve_arm_bindings(
        self,
        bindings: Sequence[Any],
        override: Sequence[str] | None = None,
    ) -> tuple[Any, ...]:
        if override:
            result: list[Any] = []
            for joint_name in override:
                matches = [binding for binding in bindings if binding.joint_name == joint_name]
                if len(matches) != 1:
                    raise RuntimeError(f"Expected one action binding for IK joint '{joint_name}'.")
                result.append(matches[0])
            return tuple(result)

        result = []
        for suffix in self.arm_joint_suffixes:
            matches = [
                binding
                for binding in bindings
                if binding.joint_name is not None
                and binding.joint_name.rsplit("__", 1)[-1].lower() == suffix
            ]
            if len(matches) != 1:
                raise RuntimeError(
                    f"SO-101 adapter expected exactly one action binding for '{suffix}'. "
                    "Pass --arm-joints explicitly to override the adapter bindings."
                )
            result.append(matches[0])
        return tuple(result)

    def home_joint_target(self, client: Any, wrist_roll_degrees: float | None = None) -> tuple[str, float]:
        degrees = self.home_wrist_roll_degrees if wrist_roll_degrees is None else wrist_roll_degrees
        if not math.isfinite(degrees):
            raise ValueError("wrist_roll_degrees must be finite.")
        matches = [
            name
            for name in client.joints
            if name.rsplit("__", 1)[-1].lower() == "wrist_roll"
        ]
        if len(matches) != 1:
            raise RuntimeError("SO-101 adapter expected exactly one wrist_roll joint.")
        return matches[0], math.radians(float(degrees))


SO101 = SO101Adapter()
