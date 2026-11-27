# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np

from .native_scene import (
    NativeMuJoCoUnavailable,
    NativeScene,
    configure_headless_rendering,
)
from .backdrop import (
    BackdropCamera,
    BackdropError,
    BackdropSpec,
    IntelXPUBackdropRenderer,
    camera_from_mujoco,
    resolve_backdrop_asset,
)
from .model_randomization import ModelRandomizationError, ModelRandomizer, is_model_rule
from .randomization import sample_task_randomization

# drop_onto_support: search 30 cm down and 5 cm up, stop within 0.5 mm of the support.
DROP_MAX_DISTANCE = 0.30
DROP_MAX_LIFT = 0.05
DROP_CONTACT_GAP = 5e-4
# A support's nearest point lies below the body: within about 45 degrees of straight down.
DROP_BELOW_SLOPE = 0.7
DROP_MAX_ITERATIONS = 32
# rest_on_support: settle for at most 2 s, until still (1 cm/s, 0.2 rad/s) for 0.1 s.
SETTLE_MAX_SECONDS = 2.0
SETTLE_STILL_SECONDS = 0.1
SETTLE_LINEAR_SPEED = 0.01
SETTLE_ANGULAR_SPEED = 0.2
SETTLE_LIFT_CLEARANCE = 2e-5


class NativeEnvironmentError(RuntimeError):
    pass


class NativeNameResolutionError(NativeEnvironmentError):
    pass


class NativeActionError(ValueError):
    pass


@dataclass(frozen=True)
class NativeCameraSpec:
    camera: str
    output_name: str
    width: int
    height: int


@dataclass(frozen=True)
class NativeActionTarget:
    name: str
    actuator_name: str
    actuator_index: int
    joint_name: str | None
    joint_index: int | None
    control_range: tuple[float, float] | None


@dataclass(frozen=True)
class NativeObservation:
    state: np.ndarray
    qpos: np.ndarray
    qvel: np.ndarray
    simulation_time: float
    body_positions: Mapping[str, np.ndarray]
    site_positions: Mapping[str, np.ndarray]
    images: Mapping[str, np.ndarray]
    body_quaternions: Mapping[str, np.ndarray] = field(default_factory=dict)


@dataclass(frozen=True)
class NativeResetInfo:
    seed: int | None
    samples: tuple[Mapping[str, Any], ...]


def _load_mujoco() -> object:
    configure_headless_rendering()
    try:
        import mujoco
    except ModuleNotFoundError as error:
        raise NativeMuJoCoUnavailable(
            "Native MuJoCo requires the optional 'teleoperation' dependencies."
        ) from error
    return mujoco


def _scalar(value: Any) -> int:
    return int(np.asarray(value).reshape(-1)[0])


def _record(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


def _finite_values(value: Any, expected_shape: tuple[int, ...], label: str) -> np.ndarray:
    values = np.asarray(value, dtype=np.float64)
    if values.shape != expected_shape or not np.all(np.isfinite(values)):
        raise NativeEnvironmentError(f"{label} must contain finite values with shape {expected_shape}.")
    return values


class NativeEnvironment:
    def __init__(
        self,
        scene: NativeScene,
        *,
        task: Mapping[str, Any] | None = None,
        profile: Mapping[str, Any] | None = None,
        robot_expert: Mapping[str, Any] | None = None,
        action_fields: Sequence[Mapping[str, Any]] | None = None,
        physics_steps: int | None = None,
        cameras: Sequence[Mapping[str, Any] | NativeCameraSpec] | None = None,
        render_rgb: bool = False,
        body_names: Sequence[str] | None = None,
        site_names: Sequence[str] | None = None,
    ) -> None:
        self.scene = scene
        self.model = scene.model
        self.data = scene.data
        self._mujoco = _load_mujoco()
        self.task = task
        profile_record = _record(profile)
        if robot_expert is None and profile_record is not None:
            robot_expert = _record(profile_record.get("robotExpert"))
        self.robot_expert = robot_expert
        try:
            self.backdrop = BackdropSpec.from_profile(profile_record.get("backdrop")) if profile_record else None
        except ValueError as error:
            raise NativeEnvironmentError(str(error)) from error

        configured_steps = physics_steps
        if configured_steps is None and profile_record is not None:
            configured_steps = profile_record.get("physicsSteps")
        self.physics_steps = self._validate_physics_steps(configured_steps or 1)

        configured_cameras: Sequence[Mapping[str, Any] | NativeCameraSpec] | None = cameras
        if configured_cameras is None and profile_record is not None:
            profile_cameras = profile_record.get("cameras")
            if isinstance(profile_cameras, list):
                configured_cameras = profile_cameras
        self._camera_specs = self._resolve_camera_specs(configured_cameras or [])
        self._render_rgb = bool(render_rgb)
        self._renderers: dict[tuple[int, int], Any] = {}
        self._backdrop_renderer: Any = None
        self._backdrop_appearance: tuple[float, float, float] | None = None
        self._backdrop_body_id: int | None = None
        self._backdrop_asset_path: Any = None
        # With a backdrop the splat shows the floor, so (like the browser camera preview) MuJoCo
        # plane geoms are hidden from native RGB/depth renders. Collision is unaffected.
        self._hidden_render_geoms = np.zeros(0, dtype=np.int64)
        if self.backdrop is not None:
            self._configure_backdrop(self.backdrop)

        self._body_names = self._resolve_requested_names("body", body_names)
        self._site_names = self._resolve_requested_names("site", site_names)
        self._body_ids = {name: self.body_id(name) for name in self._body_names}
        self._site_ids = {name: self.site_id(name) for name in self._site_names}
        self._profile_action_ranges: dict[str, tuple[float, float] | None] = {}
        self._action_targets = (
            self._resolve_profile_action_targets(action_fields)
            if action_fields is not None
            else self._resolve_action_targets(robot_expert)
        )
        self._home_joint_positions = self._resolve_home_joint_positions(robot_expert)
        self._last_reset_info = NativeResetInfo(seed=None, samples=())
        self._model_randomizer = ModelRandomizer(
            self._mujoco,
            self.model,
            backdrop_body=None if self.backdrop is None else self.backdrop.body,
            backdrop_appearance=self._set_backdrop_appearance,
        )
        if self.backdrop is not None and self._render_rgb and self._camera_specs:
            # Fail at session prepare, not mid-recording, when the XPU backdrop cannot render.
            self._ensure_backdrop_renderer()

    @property
    def action_names(self) -> tuple[str, ...]:
        return tuple(self._action_targets)

    @property
    def action_targets(self) -> Mapping[str, NativeActionTarget]:
        return dict(self._action_targets)

    @property
    def last_reset_info(self) -> NativeResetInfo:
        return self._last_reset_info

    def _validate_physics_steps(self, value: Any) -> int:
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            raise NativeEnvironmentError("physics_steps must be a positive integer.")
        return value

    def _resolve_requested_names(self, kind: str, names: Sequence[str] | None) -> tuple[str, ...]:
        if names is None:
            return self._all_named(kind)
        resolved = tuple(names)
        if any(not isinstance(name, str) or not name.strip() for name in resolved):
            raise NativeNameResolutionError(f"Requested {kind} names must be non-empty strings.")
        if len(set(resolved)) != len(resolved):
            raise NativeNameResolutionError(f"Requested {kind} names must be unique.")
        return resolved

    def _all_named(self, kind: str) -> tuple[str, ...]:
        count_attribute = {"body": "nbody", "site": "nsite"}[kind]
        address_attribute = {"body": "name_bodyadr", "site": "name_siteadr"}[kind]
        count = int(getattr(self.model, count_attribute))
        addresses = np.asarray(getattr(self.model, address_attribute), dtype=np.int64)
        names = tuple(self._name_at(int(addresses[index])) for index in range(count))
        return tuple(name for name in names if name)

    def _name_at(self, address: int) -> str:
        raw_names = self.model.names
        if isinstance(raw_names, (bytes, bytearray)):
            names = np.frombuffer(raw_names, dtype=np.uint8)
        else:
            names = np.asarray(raw_names, dtype=np.int8).reshape(-1)
        end = address
        while end < len(names) and names[end] != 0:
            end += 1
        return bytes(int(value) & 0xFF for value in names[address:end]).decode("utf-8")

    def _named_id(self, kind: str, name: str) -> int:
        if not isinstance(name, str) or not name.strip():
            raise NativeNameResolutionError(f"{kind.capitalize()} name must be a non-empty string.")
        try:
            named_view = getattr(self.model, kind)(name)
            return _scalar(named_view.id)
        except Exception as error:
            raise NativeNameResolutionError(
                f"No {kind} named '{name}' exists in the native MuJoCo model."
            ) from error

    def body_id(self, name: str) -> int:
        return self._named_id("body", name)

    def site_id(self, name: str) -> int:
        return self._named_id("site", name)

    def camera_id(self, name: str) -> int:
        return self._named_id("camera", name)

    def joint_id(self, name: str) -> int:
        return self._named_id("joint", name)

    def actuator_id(self, name: str) -> int:
        return self._named_id("actuator", name)

    def sensor_id(self, name: str) -> int:
        return self._named_id("sensor", name)

    def _resolve_camera_specs(
        self,
        cameras: Sequence[Mapping[str, Any] | NativeCameraSpec],
    ) -> tuple[NativeCameraSpec, ...]:
        specs: list[NativeCameraSpec] = []
        seen_outputs: set[str] = set()
        for index, camera_value in enumerate(cameras):
            if isinstance(camera_value, NativeCameraSpec):
                spec = camera_value
            else:
                camera = _record(camera_value)
                if camera is None:
                    raise NativeEnvironmentError(f"Camera configuration at index {index} must be an object.")
                spec = NativeCameraSpec(
                    camera=str(camera.get("camera", "")),
                    output_name=str(camera.get("outputName", "")),
                    width=camera.get("width"),
                    height=camera.get("height"),
                )
            if (
                not spec.camera.strip()
                or not spec.output_name.strip()
                or not isinstance(spec.width, int)
                or not isinstance(spec.height, int)
                or spec.width < 1
                or spec.height < 1
            ):
                raise NativeEnvironmentError(f"Camera configuration at index {index} is invalid.")
            if spec.output_name in seen_outputs:
                raise NativeEnvironmentError(f"Camera output name '{spec.output_name}' is duplicated.")
            self.camera_id(spec.camera)
            seen_outputs.add(spec.output_name)
            specs.append(spec)
        return tuple(specs)

    def _control_range(self, actuator_index: int) -> tuple[float, float] | None:
        actuator = self.model.actuator(actuator_index)
        limited = bool(np.asarray(actuator.ctrllimited).reshape(-1)[0])
        if not limited:
            return None
        control_range = np.asarray(self.model.actuator_ctrlrange[actuator_index], dtype=np.float64)
        if control_range.shape != (2,) or not np.all(np.isfinite(control_range)) or control_range[0] > control_range[1]:
            raise NativeEnvironmentError(f"Actuator {actuator_index} has invalid control limits.")
        return float(control_range[0]), float(control_range[1])

    def _joint_is_scalar(self, joint_index: int, joint_name: str) -> None:
        joint_type = _scalar(np.asarray(self.model.jnt_type)[joint_index])
        if joint_type not in (
            self._mujoco.mjtJoint.mjJNT_HINGE,
            self._mujoco.mjtJoint.mjJNT_SLIDE,
        ):
            raise NativeEnvironmentError(f"Joint '{joint_name}' must be a scalar hinge or slide joint.")

    def _actuator_matches_joint(self, actuator_index: int, joint_index: int) -> bool:
        actuator = self.model.actuator(actuator_index)
        transmission_type = _scalar(actuator.trntype)
        if transmission_type != self._mujoco.mjtTrn.mjTRN_JOINT:
            return False
        transmission_id = _scalar(np.asarray(self.model.actuator_trnid)[actuator_index, 0])
        return transmission_id == joint_index

    def _is_position_actuator(self, actuator_index: int) -> bool:
        actuator = self.model.actuator(actuator_index)
        gain_type = _scalar(actuator.gaintype)
        bias_type = _scalar(actuator.biastype)
        if gain_type != self._mujoco.mjtGain.mjGAIN_FIXED or bias_type != self._mujoco.mjtBias.mjBIAS_AFFINE:
            return False
        gain_parameters = np.asarray(actuator.gainprm, dtype=np.float64).reshape(-1)
        bias_parameters = np.asarray(actuator.biasprm, dtype=np.float64).reshape(-1)
        return bool(
            len(gain_parameters) >= 1
            and len(bias_parameters) >= 2
            and np.isfinite(gain_parameters[0])
            and np.isfinite(bias_parameters[1])
            and np.isclose(bias_parameters[1], -gain_parameters[0])
        )

    def _find_position_actuator_for_joint(self, joint_name: str, joint_index: int) -> tuple[str, int]:
        try:
            named_index = self.actuator_id(joint_name)
        except NativeNameResolutionError:
            named_index = -1
        if (
            named_index >= 0
            and self._actuator_matches_joint(named_index, joint_index)
            and self._is_position_actuator(named_index)
        ):
            return joint_name, named_index
        matching = [
            index
            for index in range(int(self.model.nu))
            if self._actuator_matches_joint(index, joint_index) and self._is_position_actuator(index)
        ]
        if len(matching) == 1:
            index = matching[0]
            address = int(np.asarray(self.model.name_actuatoradr)[index])
            return self._name_at(address), index
        if not matching:
            raise NativeNameResolutionError(
                f"No position actuator connected to arm joint '{joint_name}' exists in the native model."
            )
        raise NativeNameResolutionError(
            f"Arm joint '{joint_name}' has multiple candidate actuators; name the position actuator explicitly."
        )

    def _resolve_action_targets(
        self,
        robot_expert: Mapping[str, Any] | None,
    ) -> dict[str, NativeActionTarget]:
        if robot_expert is None:
            return {}
        arm_joints = robot_expert.get("armJoints")
        gripper = _record(robot_expert.get("gripper"))
        if not isinstance(arm_joints, list) or not arm_joints or gripper is None:
            raise NativeEnvironmentError("robot_expert must define armJoints and gripper actuator bindings.")
        targets: dict[str, NativeActionTarget] = {}
        for joint_name_value in arm_joints:
            joint_name = str(joint_name_value)
            joint_index = self.joint_id(joint_name)
            self._joint_is_scalar(joint_index, joint_name)
            actuator_name, actuator_index = self._find_position_actuator_for_joint(joint_name, joint_index)
            if joint_name in targets:
                raise NativeEnvironmentError(f"Action target '{joint_name}' is duplicated.")
            targets[joint_name] = NativeActionTarget(
                name=joint_name,
                actuator_name=actuator_name,
                actuator_index=actuator_index,
                joint_name=joint_name,
                joint_index=joint_index,
                control_range=self._control_range(actuator_index),
            )

        gripper_name = str(gripper.get("actuator", ""))
        gripper_index = self.actuator_id(gripper_name)
        if not self._is_position_actuator(gripper_index):
            raise NativeNameResolutionError(
                f"Gripper actuator '{gripper_name}' must be a MuJoCo position actuator."
            )
        if gripper_name in targets:
            raise NativeEnvironmentError(f"Gripper action target '{gripper_name}' duplicates an arm action target.")
        targets[gripper_name] = NativeActionTarget(
            name=gripper_name,
            actuator_name=gripper_name,
            actuator_index=gripper_index,
            joint_name=None,
            joint_index=None,
            control_range=self._control_range(gripper_index),
        )
        return targets

    def _resolve_profile_action_targets(
        self,
        action_fields: Sequence[Mapping[str, Any]],
    ) -> dict[str, NativeActionTarget]:
        targets: dict[str, NativeActionTarget] = {}
        for index, field_value in enumerate(action_fields):
            field = _record(field_value)
            if field is None:
                raise NativeEnvironmentError(f"Action field at index {index} must be an object.")
            name = field.get("name")
            actuator_name = field.get("actuator")
            if not isinstance(name, str) or not name.strip():
                raise NativeEnvironmentError(f"Action field at index {index} needs a non-empty name.")
            if not isinstance(actuator_name, str) or not actuator_name.strip():
                raise NativeEnvironmentError(
                    f"Action field '{name}' needs a non-empty actuator name."
                )
            if name in targets:
                raise NativeEnvironmentError(f"Action field '{name}' is duplicated.")
            actuator_index = self.actuator_id(actuator_name)
            model_control_range = self._control_range(actuator_index)
            configured_range = field.get("controlRange")
            if configured_range is not None:
                configured = _finite_values(configured_range, (2,), f"Control range for '{name}'")
                if configured[0] > configured[1]:
                    raise NativeEnvironmentError(f"Control range for '{name}' is reversed.")
                if model_control_range is not None and (
                    configured[0] < model_control_range[0] or configured[1] > model_control_range[1]
                ):
                    raise NativeEnvironmentError(
                        f"Control range for '{name}' exceeds the native actuator range."
                    )
                self._profile_action_ranges[name] = (
                    float(configured[0]),
                    float(configured[1]),
                )
            else:
                self._profile_action_ranges[name] = model_control_range

            joint_name: str | None = None
            joint_index: int | None = None
            actuator = self.model.actuator(actuator_index)
            if _scalar(actuator.trntype) == self._mujoco.mjtTrn.mjTRN_JOINT:
                candidate_index = _scalar(np.asarray(self.model.actuator_trnid)[actuator_index, 0])
                joint_type = _scalar(np.asarray(self.model.jnt_type)[candidate_index])
                if joint_type in (self._mujoco.mjtJoint.mjJNT_HINGE, self._mujoco.mjtJoint.mjJNT_SLIDE):
                    joint_index = candidate_index
                    joint_name = self._name_at(
                        int(np.asarray(self.model.name_jntadr, dtype=np.int64)[candidate_index])
                    )
            targets[name] = NativeActionTarget(
                name=name,
                actuator_name=actuator_name,
                actuator_index=actuator_index,
                joint_name=joint_name,
                joint_index=joint_index,
                control_range=model_control_range,
            )
        if not targets:
            raise NativeEnvironmentError("At least one action field is required.")
        return targets

    def _resolve_home_joint_positions(
        self,
        robot_expert: Mapping[str, Any] | None,
    ) -> dict[str, float]:
        if robot_expert is None:
            return {}
        configured = robot_expert.get("homeJointPositions")
        if configured is None:
            return {}
        if not isinstance(configured, Mapping) or not configured:
            raise NativeEnvironmentError(
                "robot_expert.homeJointPositions must be a non-empty object."
            )
        positions: dict[str, float] = {}
        for name_value, value in configured.items():
            name = str(name_value)
            if name not in self._action_targets:
                raise NativeNameResolutionError(
                    f"Home-pose joint target '{name}' is unavailable in the native model."
                )
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not np.isfinite(value):
                raise NativeEnvironmentError(
                    f"Home-pose joint target '{name}' must be finite."
                )
            positions[name] = float(value)
        return positions

    def body_position(self, name: str) -> np.ndarray:
        body_index = self.body_id(name)
        return np.asarray(self.data.xpos[body_index], dtype=np.float64).copy()

    def body_rotation(self, name: str) -> np.ndarray:
        body_index = self.body_id(name)
        return np.asarray(self.data.xmat[body_index], dtype=np.float64).reshape(3, 3).copy()

    def quaternion_from_rotation(self, rotation: Sequence[Sequence[float]]) -> np.ndarray:
        matrix = _finite_values(rotation, (3, 3), "Rotation matrix")
        quaternion = np.empty(4, dtype=np.float64)
        self._mujoco.mju_mat2Quat(quaternion, matrix.reshape(-1))
        return quaternion

    def site_position(self, name: str) -> np.ndarray:
        site_index = self.site_id(name)
        return np.asarray(self.data.site_xpos[site_index], dtype=np.float64).copy()

    def site_rotation(self, name: str) -> np.ndarray:
        site_index = self.site_id(name)
        return np.asarray(self.data.site_xmat[site_index], dtype=np.float64).reshape(3, 3).copy()

    def geom_position(self, name: str) -> np.ndarray:
        try:
            geom_index = _scalar(np.asarray(self.model.geom(name).id))
        except Exception as error:
            raise NativeEnvironmentError(f"Native model has no geom named '{name}'.") from error
        return np.asarray(self.data.geom_xpos[geom_index], dtype=np.float64).copy()

    def joint_position(self, joint_name: str) -> float:
        try:
            target = self._action_targets[joint_name]
        except KeyError as error:
            raise NativeActionError(f"Unknown named joint target '{joint_name}'.") from error
        joint_index = target.joint_index
        if joint_index is None:
            raise NativeActionError(f"Action target '{joint_name}' is not connected to a joint.")
        qpos_address = _scalar(np.asarray(self.model.joint(joint_index).qposadr))
        return float(np.asarray(self.data.qpos)[qpos_address])

    def action_position(self, action_name: str) -> float:
        try:
            target = self._action_targets[action_name]
        except KeyError as error:
            raise NativeActionError(f"Unknown named action target '{action_name}'.") from error
        joint_index = target.joint_index
        if joint_index is None:
            actuator = self.model.actuator(target.actuator_index)
            if _scalar(actuator.trntype) != self._mujoco.mjtTrn.mjTRN_JOINT:
                raise NativeActionError(f"Action target '{action_name}' is not connected to a joint.")
            joint_index = _scalar(np.asarray(self.model.actuator_trnid)[target.actuator_index, 0])
        self._joint_is_scalar(joint_index, action_name)
        qpos_address = _scalar(np.asarray(self.model.jnt_qposadr)[joint_index])
        return float(np.asarray(self.data.qpos)[qpos_address])

    def _action_values(self, action: Mapping[str, float] | Sequence[float]) -> dict[str, float]:
        names = self.action_names
        if isinstance(action, Mapping):
            missing = [name for name in names if name not in action]
            unexpected = [str(name) for name in action if name not in self._action_targets]
            if missing or unexpected:
                details = []
                if missing:
                    details.append(f"missing {missing}")
                if unexpected:
                    details.append(f"unknown {unexpected}")
                raise NativeActionError("Named action targets do not match the resolved action space: " + ", ".join(details))
            return {name: float(action[name]) for name in names}
        values = np.asarray(action, dtype=np.float64)
        if values.shape != (len(names),):
            raise NativeActionError(f"Expected {len(names)} action values, received shape {values.shape}.")
        return {name: float(values[index]) for index, name in enumerate(names)}

    def validate_action(self, action: Mapping[str, float] | Sequence[float]) -> dict[str, float]:
        values = self._action_values(action)
        for name, value in values.items():
            if not np.isfinite(value):
                raise NativeActionError(f"Action target '{name}' must be finite.")
            configured_range = self._profile_action_ranges.get(name)
            if configured_range is not None and not configured_range[0] <= value <= configured_range[1]:
                raise NativeActionError(
                    f"Action target '{name}' is outside its configured range "
                    f"[{configured_range[0]}, {configured_range[1]}]."
                )
        return values

    def set_action(self, action: Mapping[str, float] | Sequence[float]) -> Mapping[str, float]:
        # Validate at the write boundary too: direct NativeEnvironment callers must not
        # bypass profile limits by skipping validate_action().
        values = self.validate_action(action)
        applied: dict[str, float] = {}
        controls = np.asarray(self.data.ctrl)
        for name, value in values.items():
            target = self._action_targets[name]
            if target.control_range is not None:
                value = float(np.clip(value, *target.control_range))
            controls[target.actuator_index] = value
            applied[name] = value
        return dict(applied)

    def set_joint_positions(self, positions: Mapping[str, float]) -> None:
        qpos = np.asarray(self.data.qpos)
        qvel = np.asarray(self.data.qvel)
        for joint_name, value in positions.items():
            target = self._action_targets.get(joint_name)
            if target is None:
                raise NativeActionError(f"Named kinematic joint target '{joint_name}' is unavailable.")
            if not np.isfinite(value):
                raise NativeActionError(f"Kinematic joint target '{joint_name}' must be finite.")
            joint_index = target.joint_index
            if joint_index is None:
                actuator = self.model.actuator(target.actuator_index)
                if _scalar(actuator.trntype) != self._mujoco.mjtTrn.mjTRN_JOINT:
                    raise NativeActionError(
                        f"Kinematic target '{joint_name}' is not connected to a joint."
                    )
                joint_index = _scalar(np.asarray(self.model.actuator_trnid)[target.actuator_index, 0])
            joint = self.model.joint(joint_index)
            joint_range = np.asarray(joint.range, dtype=np.float64).reshape(-1)
            limited = bool(np.asarray(joint.limited).reshape(-1)[0])
            applied = float(value)
            if limited:
                applied = float(np.clip(applied, joint_range[0], joint_range[1]))
            qpos[_scalar(np.asarray(joint.qposadr))] = applied
            qvel[_scalar(np.asarray(joint.dofadr))] = 0.0
        self._mujoco.mj_forward(self.model, self.data)

    def set_body_pose(
        self,
        name: str,
        position: Sequence[float],
        quaternion: Sequence[float] | None = None,
    ) -> None:
        body_index = self.body_id(name)
        joint_count = _scalar(np.asarray(self.model.body_jntnum)[body_index])
        if joint_count != 1:
            raise NativeEnvironmentError(f"Body '{name}' must have exactly one free joint.")
        joint_index = _scalar(np.asarray(self.model.body_jntadr)[body_index])
        if _scalar(np.asarray(self.model.jnt_type)[joint_index]) != self._mujoco.mjtJoint.mjJNT_FREE:
            raise NativeEnvironmentError(f"Body '{name}' does not have a free joint.")
        qpos_address = _scalar(np.asarray(self.model.jnt_qposadr)[joint_index])
        body_position = _finite_values(position, (3,), f"Position for body '{name}'")
        qpos = np.asarray(self.data.qpos)
        qvel = np.asarray(self.data.qvel)
        qpos[qpos_address : qpos_address + 3] = body_position
        if quaternion is not None:
            body_quaternion = _finite_values(quaternion, (4,), f"Quaternion for body '{name}'")
            length = float(np.linalg.norm(body_quaternion))
            if length <= np.finfo(np.float64).eps:
                raise NativeEnvironmentError(f"Quaternion for body '{name}' has zero length.")
            qpos[qpos_address + 3 : qpos_address + 7] = body_quaternion / length
        qvel_address = _scalar(np.asarray(self.model.jnt_dofadr)[joint_index])
        qvel[qvel_address : qvel_address + 6] = 0.0
        self._mujoco.mj_forward(self.model, self.data)

    def drop_onto_support(
        self,
        name: str,
        *,
        max_drop: float = DROP_MAX_DISTANCE,
        max_lift: float = DROP_MAX_LIFT,
    ) -> float | None:
        """Move free body ``name`` straight down (or up) until it rests on the geometry below it.

        A randomized x/y position keeps the authored height, so an object authored on a pad floats
        when its new spot is beside the pad, and sinks into it the other way round. This lowers the
        body by its distance to the nearest collidable geometry below it, repeatedly (conservative
        advancement), and first lifts it out of anything below that it overlaps. Nothing below
        within ``max_drop`` (beside the table) leaves the body where it was and returns None;
        otherwise returns the vertical change in metres (negative = lowered).
        """
        body_index = self.body_id(name)
        own, others = self._support_geoms(body_index)
        if not own or not others:
            return None
        start = self.body_position(name)
        position = start.copy()
        def gap_below(limit: float) -> float:
            return self._gap_below(own, others, float(position[2]), limit)

        for _ in range(DROP_MAX_ITERATIONS):
            gap = gap_below(max_drop)
            if gap < -DROP_CONTACT_GAP:
                position[2] += min(-gap + DROP_CONTACT_GAP, max_lift)
            elif gap >= max_drop and position[2] == start[2]:
                return None
            elif gap > DROP_CONTACT_GAP:
                position[2] -= gap - DROP_CONTACT_GAP * 0.5
            else:
                break
            if position[2] < start[2] - max_drop or position[2] > start[2] + max_lift:
                self.set_body_pose(name, start)
                return None
            self.set_body_pose(name, position)
        return float(position[2] - start[2])

    def _gap_below(self, own: list[int], others: list[int], body_z: float, limit: float) -> float:
        """Smallest distance from ``own`` geoms to geometry below them (negative: overlap)."""
        fromto = np.zeros(6, dtype=np.float64)
        nearest = limit
        for geom in own:
            for other in others:
                distance = float(self._mujoco.mj_geomDistance(self.model, self.data, geom, other, limit, fromto))
                if distance >= nearest:
                    continue
                if distance >= 0.0 and fromto[2] - fromto[5] < DROP_BELOW_SLOPE * distance:
                    continue  # beside or above the body: not a support
                if distance < 0.0 and float(self.data.geom_xpos[other][2]) >= body_z:
                    continue  # overlaps something whose centre is higher: not resting on it
                nearest = distance
        return nearest

    def rest_on_support(self, name: str, *, max_seconds: float = SETTLE_MAX_SECONDS) -> None:
        """Drop free body ``name`` onto the geometry below it, then let physics settle it alone.

        The drop handles flat supports exactly; the settle handles what geometry alone cannot,
        such as an object hanging over a pad edge tipping onto the table. With nothing below (the
        spot is beside the table) the body stays where it is. Otherwise physics runs until the
        body has been still for ``SETTLE_STILL_SECONDS`` (at most ``max_seconds``); then every
        other joint returns to where it was, so only this body moves, and all velocities are zero.
        """
        if self.drop_onto_support(name) is None:
            return
        body_index = self.body_id(name)
        joint_index = _scalar(np.asarray(self.model.body_jntadr)[body_index])
        qpos_address = _scalar(np.asarray(self.model.jnt_qposadr)[joint_index])
        dof_address = _scalar(np.asarray(self.model.jnt_dofadr)[joint_index])
        qpos = np.asarray(self.data.qpos)
        qvel = np.asarray(self.data.qvel)
        saved_qpos = qpos.copy()
        saved_ctrl = np.asarray(self.data.ctrl).copy()
        saved_act = np.asarray(self.data.act).copy()
        saved_time = float(self.data.time)
        timestep = float(self.model.opt.timestep)
        still_steps = max(1, round(SETTLE_STILL_SECONDS / timestep))
        still = 0
        for _ in range(max(1, round(max_seconds / timestep))):
            self._mujoco.mj_step(self.model, self.data)
            speed = qvel[dof_address : dof_address + 6]
            moving = (
                float(np.linalg.norm(speed[:3])) > SETTLE_LINEAR_SPEED
                or float(np.linalg.norm(speed[3:])) > SETTLE_ANGULAR_SPEED
            )
            still = 0 if moving else still + 1
            if still >= still_steps:
                break
        settled = qpos[qpos_address : qpos_address + 7].copy()
        qpos[:] = saved_qpos
        qpos[qpos_address : qpos_address + 7] = settled
        qvel[:] = 0.0
        np.asarray(self.data.ctrl)[:] = saved_ctrl
        np.asarray(self.data.act)[:] = saved_act
        np.asarray(self.data.qacc_warmstart)[:] = 0.0
        self.data.time = saved_time
        self._mujoco.mj_forward(self.model, self.data)
        # Soft contacts leave a resting body sunk a fraction of a millimetre into its support;
        # lift it out so the stored state starts without overlaps.
        own, others = self._support_geoms(body_index)
        sunk = self._gap_below(own, others, float(qpos[qpos_address + 2]), DROP_CONTACT_GAP)
        if sunk < 0.0:
            qpos[qpos_address + 2] += -sunk + SETTLE_LIFT_CLEARANCE
            self._mujoco.mj_forward(self.model, self.data)

    def _support_geoms(self, body_index: int) -> tuple[list[int], list[int]]:
        """Collidable geoms of the body's subtree, and the collidable geoms they could rest on."""
        parents = np.asarray(self.model.body_parentid)

        def in_subtree(index: int) -> bool:
            while index > 0:
                if index == body_index:
                    return True
                index = int(parents[index])
            return False

        contype = np.asarray(self.model.geom_contype)
        conaffinity = np.asarray(self.model.geom_conaffinity)
        types = np.asarray(self.model.geom_type)
        hfield = int(self._mujoco.mjtGeom.mjGEOM_HFIELD)
        bodies = np.asarray(self.model.geom_bodyid)
        own: list[int] = []
        others: list[int] = []
        for geom in range(int(self.model.ngeom)):
            if (contype[geom] == 0 and conaffinity[geom] == 0) or int(types[geom]) == hfield:
                continue
            (own if in_subtree(int(bodies[geom])) else others).append(geom)
        others = [
            other
            for other in others
            if any(contype[g] & conaffinity[other] or contype[other] & conaffinity[g] for g in own)
        ]
        return own, others

    def hinge_joint_for_action(self, action_name: str) -> int:
        """Return the hinge joint an action drives, or raise NativeActionError."""
        try:
            target = self._action_targets[action_name]
        except KeyError as error:
            raise NativeActionError(f"Unknown named action target '{action_name}'.") from error
        joint_index = target.joint_index
        if joint_index is None:
            actuator = self.model.actuator(target.actuator_index)
            if _scalar(actuator.trntype) != self._mujoco.mjtTrn.mjTRN_JOINT:
                raise NativeActionError(f"Action target '{action_name}' is not connected to a joint.")
            joint_index = _scalar(np.asarray(self.model.actuator_trnid)[target.actuator_index, 0])
        if _scalar(np.asarray(self.model.jnt_type)[joint_index]) != self._mujoco.mjtJoint.mjJNT_HINGE:
            raise NativeActionError(f"Action target '{action_name}' does not drive a hinge joint.")
        return joint_index

    def offset_joint_positions(self, offsets: Mapping[str, float]) -> dict[str, float]:
        """Move named hinge joints by ``offsets`` (radians) and hold them there at rest.

        Joint limits clamp the new positions. Position servos get the same target so the pose holds
        when physics resumes instead of snapping back to the old command. Returns the applied
        offsets after clamping.
        """
        qpos = np.asarray(self.data.qpos)
        qvel = np.asarray(self.data.qvel)
        controls = np.asarray(self.data.ctrl)
        applied: dict[str, float] = {}
        for action_name, offset in offsets.items():
            if not np.isfinite(offset):
                raise NativeActionError(f"Joint offset for '{action_name}' must be finite.")
            joint_index = self.hinge_joint_for_action(action_name)
            joint = self.model.joint(joint_index)
            address = _scalar(np.asarray(joint.qposadr))
            current = float(qpos[address])
            value = current + float(offset)
            if bool(np.asarray(joint.limited).reshape(-1)[0]):
                joint_range = np.asarray(joint.range, dtype=np.float64).reshape(-1)
                value = float(np.clip(value, joint_range[0], joint_range[1]))
            qpos[address] = value
            qvel[_scalar(np.asarray(joint.dofadr))] = 0.0
            target = self._action_targets[action_name]
            if self._is_position_actuator(target.actuator_index):
                control = value
                if target.control_range is not None:
                    control = float(np.clip(control, *target.control_range))
                controls[target.actuator_index] = control
            applied[action_name] = value - current
        self._mujoco.mj_forward(self.model, self.data)
        return applied

    def penetrating_contacts(self, tolerance: float = 1e-4) -> set[tuple[int, int]]:
        """Return geom pairs that currently overlap by more than ``tolerance`` metres."""
        pairs: set[tuple[int, int]] = set()
        for index in range(int(self.data.ncon)):
            contact = self.data.contact[index]
            if float(contact.dist) < -tolerance:
                first, second = int(contact.geom1), int(contact.geom2)
                pairs.add((min(first, second), max(first, second)))
        return pairs

    def restore_state(
        self,
        qpos: Sequence[float],
        qvel: Sequence[float],
        ctrl: Sequence[float],
        *,
        images: bool = True,
    ) -> NativeObservation:
        next_qpos = _finite_values(qpos, (int(self.model.nq),), "qpos")
        next_qvel = _finite_values(qvel, (int(self.model.nv),), "qvel")
        next_ctrl = _finite_values(ctrl, (int(self.model.nu),), "ctrl")
        np.asarray(self.data.qpos)[:] = next_qpos
        np.asarray(self.data.qvel)[:] = next_qvel
        np.asarray(self.data.ctrl)[:] = next_ctrl
        self._mujoco.mj_forward(self.model, self.data)
        return self.observe(images=images)

    def state_values(self, fields: Sequence[Mapping[str, Any]]) -> tuple[float, ...]:
        values: list[float] = []
        for index, field_value in enumerate(fields):
            field = _record(field_value)
            if field is None:
                raise NativeEnvironmentError(f"State field at index {index} must be an object.")
            source = _record(field.get("source"))
            if source is None:
                raise NativeEnvironmentError(f"State field at index {index} needs a source.")
            kind = source.get("kind")
            if kind in {"qpos", "qvel"}:
                joint_name = source.get("component")
                if not isinstance(joint_name, str) or not joint_name.strip():
                    raise NativeEnvironmentError(f"State field at index {index} has an invalid joint.")
                joint_index = self.joint_id(joint_name)
                self._joint_is_scalar(joint_index, joint_name)
                address_key = "jnt_qposadr" if kind == "qpos" else "jnt_dofadr"
                address = _scalar(np.asarray(getattr(self.model, address_key))[joint_index])
                source_values = self.data.qpos if kind == "qpos" else self.data.qvel
                value = float(np.asarray(source_values)[address])
            elif kind == "actuator":
                actuator_name = source.get("actuator")
                if not isinstance(actuator_name, str) or not actuator_name.strip():
                    raise NativeEnvironmentError(f"State field at index {index} has an invalid actuator.")
                actuator_index = self.actuator_id(actuator_name)
                actuator_value = str(source.get("value", "position"))
                if actuator_value == "position":
                    value = float(np.asarray(self.data.actuator_length)[actuator_index])
                elif actuator_value == "velocity":
                    value = float(np.asarray(self.data.actuator_velocity)[actuator_index])
                elif actuator_value == "force":
                    value = float(np.asarray(self.data.actuator_force)[actuator_index])
                else:
                    raise NativeEnvironmentError(
                        f"State actuator value '{actuator_value}' is unsupported."
                    )
            elif kind == "sensor":
                sensor_name = source.get("sensor")
                if not isinstance(sensor_name, str) or not sensor_name.strip():
                    raise NativeEnvironmentError(f"State field at index {index} has an invalid sensor.")
                sensor_index = self.sensor_id(sensor_name)
                address = _scalar(np.asarray(self.model.sensor_adr)[sensor_index])
                dimension = _scalar(np.asarray(self.model.sensor_dim)[sensor_index])
                component = source.get("component", 0)
                if not isinstance(component, int) or isinstance(component, bool) or not 0 <= component < dimension:
                    raise NativeEnvironmentError(
                        f"State sensor '{sensor_name}' component must be between 0 and {dimension - 1}."
                    )
                value = float(np.asarray(self.data.sensordata)[address + component])
            else:
                raise NativeEnvironmentError(f"State source kind '{kind}' is unsupported.")
            scale = field.get("scale", 1.0)
            offset = field.get("offset", 0.0)
            if not isinstance(scale, (int, float)) or isinstance(scale, bool) or not np.isfinite(scale):
                raise NativeEnvironmentError(f"State field at index {index} has an invalid scale.")
            if not isinstance(offset, (int, float)) or isinstance(offset, bool) or not np.isfinite(offset):
                raise NativeEnvironmentError(f"State field at index {index} has an invalid offset.")
            transformed = float(value * scale + offset)
            if not np.isfinite(transformed):
                raise NativeEnvironmentError(f"State field at index {index} produced a non-finite value.")
            values.append(transformed)
        return tuple(values)

    def restore_model_baseline(self) -> None:
        """Undo every model randomization (appearance and physics) applied since load."""
        self._model_randomizer.restore(self._scratch_data())

    def apply_model_rules(
        self, rules: Sequence[Mapping[str, Any]], samples: Sequence[Mapping[str, Any]]
    ) -> list[dict[str, Any]]:
        """Restore the model baseline, apply sampled model rules, and return the overrides written.

        The simulation state (qpos/qvel/ctrl/time) is preserved.
        """
        try:
            self._model_randomizer.restore(self._scratch_data())
            return self._model_randomizer.apply_rules(rules, samples, self._scratch_data())
        except ModelRandomizationError as error:
            raise NativeEnvironmentError(str(error)) from error

    def apply_model_overrides(self, overrides: Sequence[Mapping[str, Any]]) -> None:
        """Restore the model baseline and write stored override rows; the state is preserved."""
        try:
            self._model_randomizer.apply_overrides(overrides, self._scratch_data())
        except ModelRandomizationError as error:
            raise NativeEnvironmentError(str(error)) from error
        self._mujoco.mj_forward(self.model, self.data)

    def _scratch_data(self) -> Any:
        """Separate MjData for mj_setConst so the live simulation state is never disturbed."""
        if getattr(self, "_scratch", None) is None:
            self._scratch = self._mujoco.MjData(self.model)
        return self._scratch

    def reset(
        self,
        seed: int | None = None,
        randomization_samples: Sequence[Mapping[str, Any]] | None = None,
        *,
        images: bool = True,
    ) -> NativeObservation:
        task_rules = []
        if self.task is not None:
            candidate_rules = self.task.get("randomization")
            if isinstance(candidate_rules, list):
                task_rules = candidate_rules
        effective_seed = seed
        if randomization_samples is None and task_rules:
            effective_seed = 0 if seed is None else seed
            samples = sample_task_randomization(self.task, effective_seed)
        else:
            samples = [dict(sample) for sample in (randomization_samples or [])]
        if samples and not task_rules:
            raise NativeEnvironmentError("Randomization samples require task randomization rules.")
        if len(samples) != len(task_rules):
            raise NativeEnvironmentError(
                f"Expected {len(task_rules)} randomization samples, received {len(samples)}."
            )
        # Model rules change MjModel (and may refresh derived constants through scratch data), so
        # apply them before the state is reset; pose rules then act on the freshly reset state.
        model_pairs = [(rule, sample) for rule, sample in zip(task_rules, samples) if is_model_rule(rule)]
        try:
            self._model_randomizer.restore(self.data)
            self._model_randomizer.apply_rules(
                [rule for rule, _ in model_pairs], [sample for _, sample in model_pairs], self.data
            )
        except ModelRandomizationError as error:
            raise NativeEnvironmentError(str(error)) from error
        self._mujoco.mj_resetData(self.model, self.data)
        if self._home_joint_positions:
            self.set_joint_positions(self._home_joint_positions)
        for rule, sample in zip(task_rules, samples):
            if not is_model_rule(rule):
                self._apply_randomization_rule(rule, sample)
        self._mujoco.mj_forward(self.model, self.data)
        for rule in task_rules:
            if rule.get("kind") == "free-body-position" and rule.get("restOnSupport") is True:
                self.rest_on_support(str(rule["body"]))
        self._last_reset_info = NativeResetInfo(
            seed=effective_seed,
            samples=tuple({key: value for key, value in sample.items()} for sample in samples),
        )
        return self.observe(images=images)

    def _apply_randomization_rule(self, rule: Mapping[str, Any], sample: Mapping[str, Any]) -> None:
        kind = rule.get("kind")
        values = sample.get("values")
        expected_target = "source-object" if kind == "select-source-object" else rule.get("body", rule.get("joint"))
        if sample.get("target") != expected_target:
            raise NativeEnvironmentError(
                f"Randomization sample target '{sample.get('target')}' does not match rule target '{expected_target}'."
            )
        if kind == "select-source-object":
            if sample.get("selected") not in rule.get("candidates", []):
                raise NativeEnvironmentError("Selected source object is not one of the rule candidates.")
            _finite_values(values, (1,), "Source-object selection sample")
            return
        if kind in {"free-body-position", "free-body-orientation-euler", "free-body-orientation-quaternion"}:
            body_name = str(rule.get("body", ""))
            body_index = self.body_id(body_name)
            joint_count = _scalar(np.asarray(self.model.body_jntnum)[body_index])
            if joint_count != 1:
                if joint_count == 0:
                    raise NativeEnvironmentError(f"Body '{body_name}' does not have a free joint.")
                raise NativeEnvironmentError(
                    f"Body '{body_name}' must have exactly one free joint for body randomization."
                )
            joint_index = _scalar(np.asarray(self.model.body_jntadr)[body_index])
            joint_type = _scalar(np.asarray(self.model.jnt_type)[joint_index])
            if joint_type != self._mujoco.mjtJoint.mjJNT_FREE:
                raise NativeEnvironmentError(f"Body '{body_name}' does not have a free joint.")
            qpos_address = _scalar(np.asarray(self.model.jnt_qposadr)[joint_index])
            if kind == "free-body-position":
                position = _finite_values(values, (3,), f"Position sample for body '{body_name}'")
                np.asarray(self.data.qpos)[qpos_address : qpos_address + 3] = position
                return
            quaternion = _finite_values(values, (4,), f"Orientation sample for body '{body_name}'")
            length = float(np.linalg.norm(quaternion))
            if length <= np.finfo(np.float64).eps:
                raise NativeEnvironmentError(f"Orientation sample for body '{body_name}' has zero length.")
            np.asarray(self.data.qpos)[qpos_address + 3 : qpos_address + 7] = quaternion / length
            return
        if kind in {"joint-position", "joint-velocity"}:
            joint_name = str(rule.get("joint", ""))
            joint_index = self.joint_id(joint_name)
            self._joint_is_scalar(joint_index, joint_name)
            configured_range = np.asarray(rule.get("range"), dtype=np.float64)
            if kind == "joint-position":
                joint_view = self.model.joint(joint_name)
                limited = bool(np.asarray(joint_view.limited).reshape(-1)[0])
                joint_range = np.asarray(joint_view.range, dtype=np.float64).reshape(-1)
                if (
                    configured_range.shape != (2,)
                    or not np.all(np.isfinite(configured_range))
                    or limited
                    and (configured_range[0] < joint_range[0] or configured_range[1] > joint_range[1])
                ):
                    raise NativeEnvironmentError(
                        f"Randomization range for joint '{joint_name}' exceeds model limits "
                        f"[{joint_range[0]}, {joint_range[1]}]."
                    )
            value = float(_finite_values(values, (1,), f"Sample for joint '{joint_name}'")[0])
            if kind == "joint-position":
                if limited and not joint_range[0] <= value <= joint_range[1]:
                    raise NativeEnvironmentError(
                        f"Randomization range for joint '{joint_name}' exceeds model limits "
                        f"[{joint_range[0]}, {joint_range[1]}]."
                    )
                qpos_address = _scalar(np.asarray(self.model.jnt_qposadr)[joint_index])
                np.asarray(self.data.qpos)[qpos_address] = value
            else:
                dof_address = _scalar(np.asarray(self.model.jnt_dofadr)[joint_index])
                np.asarray(self.data.qvel)[dof_address] = value
            return
        raise NativeEnvironmentError(f"Unsupported randomization rule '{kind}'.")

    def step(
        self,
        action: Mapping[str, float] | Sequence[float] | None = None,
        *,
        physics_steps: int | None = None,
        observe: bool | Literal["state"] = True,
    ) -> NativeObservation:
        if observe not in (True, False, "state"):
            raise NativeEnvironmentError("observe must be true, false, or 'state'.")
        if action is not None:
            self.set_action(action)
        step_count = self.physics_steps if physics_steps is None else self._validate_physics_steps(physics_steps)
        for _ in range(step_count):
            self._mujoco.mj_step(self.model, self.data)
        return self.observe(images=observe is True)

    def _configure_backdrop(self, spec: BackdropSpec) -> None:
        body_index = int(self._mujoco.mj_name2id(self.model, self._mujoco.mjtObj.mjOBJ_BODY, spec.body))
        if body_index < 0:
            raise NativeEnvironmentError(
                f"profile.backdrop.body '{spec.body}' does not exist in the native MuJoCo model; "
                "the splat backdrop pose comes from that body."
            )
        if body_index == 0 or _scalar(np.asarray(self.model.body_weldid)[body_index]) != 0:
            raise NativeEnvironmentError(
                f"Backdrop body '{spec.body}' must be a static body (no joints) welded to the world."
            )
        try:
            self._backdrop_asset_path = resolve_backdrop_asset(self.scene.bundle, spec)
        except BackdropError as error:
            raise NativeEnvironmentError(str(error)) from error
        self._backdrop_body_id = body_index
        geom_types = np.asarray(self.model.geom_type)
        self._hidden_render_geoms = np.flatnonzero(
            geom_types == int(self._mujoco.mjtGeom.mjGEOM_PLANE)
        ).astype(np.int64)

    def _set_backdrop_appearance(self, values: tuple[float, float, float] | None) -> None:
        self._backdrop_appearance = values
        renderer = self._backdrop_renderer
        if renderer is None:
            return
        if values is None:
            renderer.reset_appearance()
        else:
            renderer.set_appearance(*values)

    def _ensure_backdrop_renderer(self) -> Any:
        if self._backdrop_renderer is None:
            assert self.backdrop is not None
            try:
                renderer = IntelXPUBackdropRenderer(
                    self._backdrop_asset_path,
                    scale=self.backdrop.scale,
                    rotation=self.backdrop.rotation,
                    cleanup=self.backdrop.cleanup,
                )
            except Exception as error:
                raise NativeEnvironmentError(f"Could not initialize Intel XPU backdrop rendering: {error}") from error
            if self._backdrop_appearance is not None:
                renderer.set_appearance(*self._backdrop_appearance)
            self._backdrop_renderer = renderer
        return self._backdrop_renderer

    def _update_render_scene(self, renderer: Any, camera: str) -> None:
        hidden = self._hidden_render_geoms
        if hidden.size == 0:
            renderer.update_scene(self.data, camera=camera)
            return
        # mjv_updateScene skips geoms whose rgba alpha is 0, so hide planes only while the
        # visual scene is built; the model's colors (and collisions) are left untouched.
        rgba = np.asarray(self.model.geom_rgba)
        saved_alpha = rgba[hidden, 3].copy()
        try:
            rgba[hidden, 3] = 0.0
            renderer.update_scene(self.data, camera=camera)
        finally:
            rgba[hidden, 3] = saved_alpha

    def _renderer(self, spec: NativeCameraSpec) -> Any:
        key = (spec.width, spec.height)
        renderer = self._renderers.get(key)
        if renderer is None:
            try:
                renderer = self._mujoco.Renderer(self.model, height=spec.height, width=spec.width)
            except Exception as error:
                raise NativeEnvironmentError(
                    f"Could not initialize native RGB rendering for camera '{spec.camera}'."
                ) from error
            self._renderers[key] = renderer
        return renderer

    def _backdrop_camera(self, renderer: Any, spec: NativeCameraSpec) -> BackdropCamera:
        camera_index = self.camera_id(spec.camera)
        # mjr_render uses the average of the two scene (eye) cameras in mono mode.
        eyes = renderer.scene.camera

        def frustum(name: str) -> float:
            return 0.5 * (float(getattr(eyes[0], name)) + float(getattr(eyes[1], name)))

        extent = float(np.asarray(self.model.stat.extent).reshape(-1)[0])
        near = float(np.asarray(self.model.vis.map.znear).reshape(-1)[0]) * extent
        return camera_from_mujoco(
            np.asarray(self.data.cam_xpos[camera_index], dtype=np.float64),
            np.asarray(self.data.cam_xmat[camera_index], dtype=np.float64),
            width=spec.width,
            height=spec.height,
            near=near,
            frustum_bottom=frustum("frustum_bottom"),
            frustum_top=frustum("frustum_top"),
            frustum_center=frustum("frustum_center"),
            frustum_width=frustum("frustum_width"),
            frustum_near=frustum("frustum_near"),
        )

    def _render_native(self, spec: NativeCameraSpec, *, depth: bool) -> tuple[np.ndarray, np.ndarray | None, Any]:
        """Render native RGB (and metric z-depth) for one camera from a single scene update."""
        renderer = self._renderer(spec)
        self._update_render_scene(renderer, spec.camera)
        rgb = np.asarray(renderer.render(), dtype=np.uint8).copy()
        if not depth:
            return rgb, None, renderer
        renderer.enable_depth_rendering()
        try:
            # Renderer returns metric camera z-depth (already linearized and scaled by extent).
            depth_image = np.asarray(renderer.render(), dtype=np.float32).copy()
        finally:
            renderer.disable_depth_rendering()
        return rgb, depth_image, renderer

    def _render_images(self, outputs: Collection[str] | None = None) -> dict[str, np.ndarray]:
        images: dict[str, np.ndarray] = {}
        for spec in self._camera_specs:
            if outputs is not None and spec.output_name not in outputs:
                continue
            try:
                if self.backdrop is None:
                    images[spec.output_name] = self._render_native(spec, depth=False)[0]
                    continue
                backdrop_renderer = self._ensure_backdrop_renderer()
                native_rgb, native_depth, renderer = self._render_native(spec, depth=True)
                camera = self._backdrop_camera(renderer, spec)
                body_index = self._backdrop_body_id
                images[spec.output_name] = backdrop_renderer.render(
                    camera,
                    np.asarray(self.data.xmat[body_index], dtype=np.float64).reshape(3, 3),
                    np.asarray(self.data.xpos[body_index], dtype=np.float64),
                    native_rgb,
                    native_depth,
                )
            except NativeEnvironmentError:
                raise
            except BackdropError as error:
                raise NativeEnvironmentError(
                    f"Could not render the backdrop for camera '{spec.camera}': {error}"
                ) from error
            except Exception as error:
                raise NativeEnvironmentError(f"Could not render native camera '{spec.camera}'.") from error
        return images

    def observe(self, *, images: bool = True, cameras: Collection[str] | None = None) -> NativeObservation:
        """Reads the current state without stepping; ``cameras`` limits rendering to those outputs."""
        qpos = np.asarray(self.data.qpos, dtype=np.float64).copy()
        qvel = np.asarray(self.data.qvel, dtype=np.float64).copy()
        state = np.concatenate((qpos, qvel)).astype(np.float32, copy=True)
        body_positions = {
            name: np.asarray(self.data.xpos[index], dtype=np.float64).copy()
            for name, index in self._body_ids.items()
        }
        site_positions = {
            name: np.asarray(self.data.site_xpos[index], dtype=np.float64).copy()
            for name, index in self._site_ids.items()
        }
        body_quaternions = {
            name: self.quaternion_from_rotation(
                np.asarray(self.data.xmat[index], dtype=np.float64).reshape(3, 3)
            )
            for name, index in self._body_ids.items()
        }
        rendered_images = self._render_images(cameras) if images and self._render_rgb else {}
        return NativeObservation(
            state=state,
            qpos=qpos,
            qvel=qvel,
            simulation_time=float(self.data.time),
            body_positions=body_positions,
            site_positions=site_positions,
            images=rendered_images,
            body_quaternions=body_quaternions,
        )

    def close(self) -> None:
        for renderer in self._renderers.values():
            close = getattr(renderer, "close", None)
            if callable(close):
                close()
        self._renderers.clear()
        self._backdrop_renderer = None
