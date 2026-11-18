# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Pure conversion and fingerprinting for the SO-101 simulation-to-real bridge.

No hardware imports: the calibration command that talks to a real arm lives in
``robotic_studio.real.so101_calibrate`` (``hardware`` extra).

Conversion chain for body joints::

    policy value -> sim radians  q   = inverse of the profile's action/state mapping
    sim radians  -> real degrees deg = sign * (q + zeroOffsetRad) * 180 / pi

The gripper maps linearly: ``real = scale * policy + offset``.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

BRIDGE_FORMAT = "robotic-studio-so101-bridge"


class CalibrationError(ValueError):
    """A bridge or LeRobot calibration file is invalid or incompatible."""


@dataclass(frozen=True)
class JointBridge:
    sign: int = 1
    zero_offset_rad: float = 0.0


def field_joint_name(field: Mapping[str, Any]) -> str:
    """Bare joint name (``shoulder_pan``) from a description state/action field.

    Prefers the resolved MuJoCo source name, dropping any ``robot_1__`` namespace prefix.
    """
    name = str(field.get("name", "")).removesuffix(".pos")
    source = field.get("source")
    if isinstance(source, Mapping) and source.get("name"):
        name = str(source["name"]).rsplit("__", 1)[-1]
    return name


def file_sha256(path: str | Path) -> str:
    """``sha256:<hex>`` digest of a file, as stored in ``lerobotCalibrationSha256``."""
    return "sha256:" + hashlib.sha256(Path(path).read_bytes()).hexdigest()


class So101Bridge:
    """Maps ``so101-normalized`` policy units to LeRobot's degree-based joint units."""

    JOINTS = (
        "shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll"
    )

    def __init__(
        self,
        joints: Mapping[str, JointBridge],
        *,
        gripper_scale: float = 1.0,
        gripper_offset: float = 0.0,
        lerobot_calibration_sha256: str | None = None,
        document: Mapping[str, Any] | None = None,
    ) -> None:
        if set(joints) != set(self.JOINTS):
            raise CalibrationError(f"Bridge must define exactly these joints: {', '.join(self.JOINTS)}.")
        # A negative scale is valid: some grippers report decreasing values while opening.
        if not math.isfinite(gripper_scale) or gripper_scale == 0 or not math.isfinite(gripper_offset):
            raise CalibrationError("Gripper scale must be non-zero and scale/offset must be finite.")
        self.joints = dict(joints)
        self.gripper_scale = float(gripper_scale)
        self.gripper_offset = float(gripper_offset)
        self.lerobot_calibration_sha256 = lerobot_calibration_sha256
        self.document = dict(document or {})

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> So101Bridge:
        if value.get("format") != BRIDGE_FORMAT or value.get("formatVersion") != 1:
            raise CalibrationError("Unsupported SO-101 bridge format or version.")
        robot_id = value.get("robotId")
        if robot_id is not None and (not isinstance(robot_id, str) or not robot_id.strip()):
            raise CalibrationError("robotId must be a non-empty string when provided.")
        joints_value = value.get("joints")
        if not isinstance(joints_value, Mapping):
            raise CalibrationError("Bridge joints must be an object.")
        joints: dict[str, JointBridge] = {}
        for name in cls.JOINTS:
            item = joints_value.get(name)
            if not isinstance(item, Mapping):
                raise CalibrationError(f"Bridge joint '{name}' is missing.")
            sign = item.get("sign", 1)
            offset = item.get("zeroOffsetRad", 0.0)
            if sign not in (-1, 1) or isinstance(sign, bool):
                raise CalibrationError(f"Bridge joint '{name}' sign must be -1 or 1.")
            if not isinstance(offset, (int, float)) or isinstance(offset, bool) or not math.isfinite(offset):
                raise CalibrationError(f"Bridge joint '{name}' zeroOffsetRad must be finite.")
            joints[name] = JointBridge(int(sign), float(offset))
        calibration_hash = value.get("lerobotCalibrationSha256")
        if calibration_hash is not None and (
            not isinstance(calibration_hash, str)
            or not calibration_hash.startswith("sha256:")
            or len(calibration_hash) != 71
            or any(character not in "0123456789abcdef" for character in calibration_hash[7:])
        ):
            raise CalibrationError("lerobotCalibrationSha256 must be a sha256: hexadecimal digest.")
        measured_at = value.get("measuredAt")
        if measured_at is not None and (not isinstance(measured_at, str) or not measured_at.strip()):
            raise CalibrationError("measuredAt must be a non-empty string when provided.")
        gripper = value.get("gripper", {})
        if not isinstance(gripper, Mapping):
            raise CalibrationError("Bridge gripper must be an object.")
        try:
            return cls(
                joints,
                gripper_scale=float(gripper.get("scale", 1.0)),
                gripper_offset=float(gripper.get("offset", 0.0)),
                lerobot_calibration_sha256=value.get("lerobotCalibrationSha256"),
                document=value,
            )
        except (TypeError, ValueError) as error:
            if isinstance(error, CalibrationError):
                raise
            raise CalibrationError("Bridge gripper scale and offset must be finite numbers.") from error

    @classmethod
    def load(cls, path: str | Path) -> So101Bridge:
        try:
            value = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise CalibrationError(f"Could not read SO-101 bridge '{path}'.") from error
        if not isinstance(value, Mapping):
            raise CalibrationError("SO-101 bridge document must be an object.")
        return cls.from_dict(value)

    def to_dict(self) -> dict[str, Any]:
        """Serializable bridge document, preserving extra fields such as ``homeResidualDeg``."""
        value = dict(self.document)
        value.update(
            {
                "format": BRIDGE_FORMAT,
                "formatVersion": 1,
                "joints": {
                    name: {"sign": joint.sign, "zeroOffsetRad": joint.zero_offset_rad}
                    for name, joint in self.joints.items()
                },
                "gripper": {"scale": self.gripper_scale, "offset": self.gripper_offset},
            }
        )
        if self.lerobot_calibration_sha256 is not None:
            value["lerobotCalibrationSha256"] = self.lerobot_calibration_sha256
        return value

    @staticmethod
    def _is_gripper(name: str) -> bool:
        return name == "gripper" or name.endswith("gripper")

    def policy_to_real(self, values: Sequence[float], description: Mapping[str, Any]) -> dict[str, float]:
        actions = description.get("actions", [])
        if len(values) != len(actions):
            raise CalibrationError("Policy action vector length does not match the simulation description.")
        result: dict[str, float] = {}
        for field, value in zip(actions, values, strict=True):
            name = field_joint_name(field)
            if self._is_gripper(name):
                result[f"{name}.pos"] = float(self.gripper_scale * float(value) + self.gripper_offset)
            elif name in self.joints:
                input_range = field.get("inputRange", (-100.0, 100.0))
                control_range = field.get("controlRange")
                if control_range is None or len(input_range) != 2 or len(control_range) != 2:
                    raise CalibrationError(f"Simulation action '{name}' must define inputRange and controlRange.")
                policy_value = float(value)
                if not input_range[0] <= policy_value <= input_range[1]:
                    raise CalibrationError(f"Policy action for '{name}' is outside inputRange.")
                width = float(input_range[1]) - float(input_range[0])
                radians = float(control_range[0]) if width == 0 else float(control_range[0]) + (
                    (policy_value - float(input_range[0])) / width
                ) * (float(control_range[1]) - float(control_range[0]))
                joint = self.joints[name]
                result[f"{name}.pos"] = joint.sign * (radians + joint.zero_offset_rad) * 180.0 / math.pi
        return result

    def real_to_policy(self, observation: Mapping[str, float], description: Mapping[str, Any]) -> np.ndarray:
        result = []
        for field in description.get("state", []):
            name = field_joint_name(field)
            if f"{name}.pos" not in observation:
                raise CalibrationError(f"Real observation is missing '{name}.pos'.")
            value = float(observation[f"{name}.pos"])
            if self._is_gripper(name):
                value = (value - self.gripper_offset) / self.gripper_scale
            elif name in self.joints:
                joint = self.joints[name]
                radians = joint.sign * value * math.pi / 180.0 - joint.zero_offset_rad
                value = radians * float(field.get("scale", 1.0)) + float(field.get("offset", 0.0))
            result.append(value)
        return np.asarray(result, dtype=np.float32)

    def sim_limits_deg(self, description: Mapping[str, Any]) -> dict[str, tuple[float, float]]:
        limits: dict[str, tuple[float, float]] = {}
        for field in description.get("actions", []):
            name = field_joint_name(field)
            if name in self.joints and field.get("controlRange"):
                low, high = (float(value) for value in field["controlRange"])
                correction = self.joints[name]
                degrees = [correction.sign * (value + correction.zero_offset_rad) * 180.0 / math.pi for value in (low, high)]
                limits[name] = tuple(sorted(degrees))
        return limits

    def fingerprint(self, calibration_path: str | Path | None = None) -> str:
        """SHA-256 over the bridge document plus, when given, the LeRobot calibration file bytes."""
        material = json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":")).encode()
        if calibration_path is not None:
            material += Path(calibration_path).read_bytes()
        return "sha256:" + hashlib.sha256(material).hexdigest()
