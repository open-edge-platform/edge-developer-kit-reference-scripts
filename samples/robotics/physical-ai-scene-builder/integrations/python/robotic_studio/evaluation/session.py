# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import math

import time
import uuid
from collections.abc import Collection, Mapping, Sequence
from typing import Any, Protocol

import numpy as np

from ..generation.native_env import NativeActionError, NativeEnvironment, NativeEnvironmentError, NativeObservation
from ..tasks.pick_place import PickPlaceSuccessCheck, TaskStatus

EVALUATION_MAX_PHYSICS_STEPS = 1_000
EVALUATION_LEASE_TIMEOUT_SECONDS = 10.0


class EvaluationSessionError(RuntimeError):
    def __init__(self, code: str, message: str, details: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = dict(details or {})


class EvaluationLeaseError(EvaluationSessionError):
    def __init__(self, message: str) -> None:
        super().__init__("LEASE_REQUIRED", message)


class EvaluationEpisodeError(EvaluationSessionError):
    def __init__(self, message: str) -> None:
        super().__init__("EPISODE_REQUIRED", message)


class EvaluationControl(Protocol):
    """Control operations supplied by a recording-capable shared worker."""

    def acquire(self, identity: bytes) -> str: ...
    def release(self) -> None: ...
    def ping(self) -> None: ...
    def revoke(self) -> None: ...
    def reset(self, seed: int | None) -> NativeObservation: ...
    def step(
        self, values: Mapping[str, float], physics_steps: int, *, images: bool = True
    ) -> NativeObservation: ...


def _finite(value: Any, name: str) -> float:
    number = float(value)
    if not np.isfinite(number):
        raise EvaluationSessionError("ACTION_NON_FINITE", f"Action '{name}' must be finite.")
    return number


def _range_value(value: float, low: float, high: float, name: str, policy: str) -> float:
    if low <= value <= high:
        return value
    if policy == "clip":
        return min(max(value, low), high)
    raise EvaluationSessionError(
        "ACTION_OUT_OF_RANGE", f"Action '{name}' is outside its input range [{low}, {high}]."
    )


# Start pose settle rule, matching the scripted SO-101 demonstrations' home-pose wait.
START_POSE_TOLERANCE = 0.005
START_POSE_REST = 1e-4
START_POSE_MAX_COMMANDS = 2000


def _remap_action_value(
    field: Mapping[str, Any],
    raw_value: float,
    policy: str,
) -> float:
    name = str(field["name"])
    value = _finite(raw_value, name)
    input_range = field.get("inputRange")
    control_range = field.get("controlRange")
    if input_range is not None:
        value = _range_value(value, float(input_range[0]), float(input_range[1]), name, policy)
    if input_range is not None and control_range is not None:
        input_width = float(input_range[1]) - float(input_range[0])
        control_width = float(control_range[1]) - float(control_range[0])
        value = (
            float(control_range[0])
            if input_width == 0
            else float(control_range[0]) + ((value - float(input_range[0])) / input_width) * control_width
        )
    elif control_range is not None:
        value = _range_value(value, float(control_range[0]), float(control_range[1]), name, policy)
    return value


class EvaluationSession:
    """Owns one native MuJoCo environment for one Evaluate worker process.

    Mirrors the lease/episode state machine that used to live in the browser's
    ``EvaluationSession`` (packages/mujoco/src/evaluationSession.ts), but backed by a headless
    ``NativeEnvironment`` instead of the WASM ``Simulation``.
    """

    def __init__(
        self,
        environment: NativeEnvironment,
        profile: Mapping[str, Any],
        *,
        session_id: str,
        scene_id: str,
        scene_fingerprint: str,
        profile_id: str,
        control: EvaluationControl | None = None,
    ) -> None:
        self.environment = environment
        self.profile = dict(profile)
        self.session_id = session_id
        self.scene_id = scene_id
        self.scene_fingerprint = scene_fingerprint
        self.profile_id = profile_id
        self._control = control
        self._state_fields: Sequence[Mapping[str, Any]] = list(profile.get("state", []))
        self._action_fields: Sequence[Mapping[str, Any]] = list(profile.get("action", []))
        self._cameras: Sequence[Mapping[str, Any]] = list(profile.get("cameras", []))
        if self.profile.get("inputConvention") not in {"raw", "so101-normalized"}:
            raise EvaluationSessionError(
                "PROFILE_INVALID",
                f"Unsupported evaluation input convention '{self.profile.get('inputConvention')}'.",
            )
        self._action_range_policy = str(profile.get("actionRangePolicy", "reject"))
        if self._action_range_policy not in {"reject", "clip"}:
            raise EvaluationSessionError("PROFILE_INVALID", "actionRangePolicy must be reject or clip.")
        baseline = profile.get("baseline", {"kind": "model-default"})
        if not isinstance(baseline, Mapping):
            raise EvaluationSessionError("PROFILE_INVALID", "Evaluation baseline must be an object.")
        if baseline.get("kind") != "model-default":
            raise EvaluationSessionError(
                "PROFILE_INVALID",
                "The native evaluator currently supports only the model-default reset baseline.",
                {"baseline": dict(baseline)},
            )
        self._baseline = dict(baseline)
        if not self._state_fields or not self._action_fields:
            raise EvaluationSessionError(
                "PROFILE_INVALID", "Evaluation profile must define state and action fields."
            )
        max_camera_pixels = 4_000_000
        for camera in self._cameras:
            if not isinstance(camera, Mapping):
                raise EvaluationSessionError("PROFILE_INVALID", "Camera configuration must be an object.")
            width, height = camera.get("width"), camera.get("height")
            if (
                not isinstance(width, int)
                or isinstance(width, bool)
                or not isinstance(height, int)
                or isinstance(height, bool)
                or width < 1
                or height < 1
                or width * height > max_camera_pixels
            ):
                raise EvaluationSessionError(
                    "PROFILE_INVALID", f"Camera '{camera.get('camera')}' resolution is invalid or too large."
                )
        self._status = "connected"
        # Resolve every semantic source before advertising a worker as ready.
        self._resolved_state = [
            self._resolve_state_source(field.get("source")) for field in self._state_fields
        ]
        for field in self._action_fields:
            try:
                self.environment.actuator_id(str(field["actuator"]))
            except (NativeEnvironmentError, KeyError) as error:
                raise EvaluationSessionError(
                    "PROFILE_INVALID", f"Action actuator {field.get('actuator')!r} does not resolve."
                ) from error
        for camera in self._cameras:
            if not isinstance(camera, Mapping):
                raise EvaluationSessionError("PROFILE_INVALID", "Camera configuration must be an object.")
            self._camera_index(str(camera.get("camera", "")))
        self._lease_identity: bytes | None = None
        self._lease_last_seen: float | None = None
        self._episode_id: str | None = None
        self._step_id = 0
        self._task_check: PickPlaceSuccessCheck | None = None
        self._task_status: TaskStatus | None = None
        # Running tally for the Studio Simulate panel; counts each finished episode once.
        self._episode_index = 0
        self._episode_seed: int | None = None
        self._episode_counted = False
        self._episodes_finished = 0
        self._episodes_succeeded = 0
        task = self.profile.get("task")
        self._start_targets: dict[str, float] | None = None
        if task is not None:
            self._task_check = self._build_task_check(task)
            self._start_targets = self._start_pose_targets(task)
            self.profile["task"] = dict(task)

    def _start_pose_targets(self, task: Mapping[str, Any]) -> dict[str, float] | None:
        """Action targets (control units) that put the arm in the task's start pose, or None.

        ``startPose.jointPositions`` lists joint angles in degrees by joint name; a name matches an
        action field with the same name or ending in ``__<name>`` (a namespaced robot).
        """
        start = task.get("startPose")
        if start is None:
            return None
        positions = start.get("jointPositions") if isinstance(start, Mapping) else None
        if not isinstance(positions, Mapping) or not positions:
            raise EvaluationSessionError("PROFILE_INVALID", "task.startPose.jointPositions must list joints.")
        targets: dict[str, float] = {}
        for joint, degrees in positions.items():
            if isinstance(degrees, bool) or not isinstance(degrees, (int, float)) or not math.isfinite(degrees):
                raise EvaluationSessionError("PROFILE_INVALID", f"task.startPose joint {joint!r} must be finite degrees.")
            matches = [
                field for field in self._action_fields
                if str(field["name"]) == joint or str(field["name"]).endswith(f"__{joint}")
            ]
            if len(matches) != 1:
                raise EvaluationSessionError(
                    "PROFILE_INVALID", f"task.startPose joint {joint!r} does not match one action."
                )
            value = math.radians(float(degrees))
            control_range = matches[0].get("controlRange")
            if control_range is not None:
                value = min(max(value, float(control_range[0])), float(control_range[1]))
            targets[str(matches[0]["name"])] = value
        return targets

    def _settle_start_pose(self, observation: NativeObservation) -> NativeObservation:
        """Drive the arm to the start pose and wait until it is at rest there, like the scripted
        demonstrations do before they start recording. Not part of the scored episode."""
        if not self._start_targets:
            return observation
        from ..robots.bindings import resolve_action_bindings
        from ..robots.servo import ServoCompensation

        mujoco = self.environment._mujoco
        model = self.environment.model
        # Compliant servos sag below a plain command, so offset it until the joints are at the pose.
        servo = ServoCompensation(
            mujoco,
            model,
            [
                binding
                for binding in resolve_action_bindings(mujoco, model, self.profile)
                if binding.action_name in self._start_targets
            ],
        )
        names = list(self.environment.action_names)
        hold = {name: self.environment.action_position(name) for name in names if name not in self._start_targets}
        targets = {**hold, **self._start_targets}
        physics_steps = int(self.profile.get("physicsSteps", 1))
        previous: dict[str, float] | None = None
        for _ in range(START_POSE_MAX_COMMANDS):
            command = servo.command(targets, self.environment.data.qpos, physics_steps)
            values = self.environment.validate_action({name: command[name] for name in names})
            # Physics only: rendering (and backdrop compositing) every settle step is far too slow.
            if self._control:
                self._control.step(values, physics_steps, images=False)
            else:
                self.environment.step(values, physics_steps=physics_steps, observe=False)
            current = {name: self.environment.action_position(name) for name in self._start_targets}
            # A command pinned at its range limit cannot push the joint further.
            at_pose = all(
                abs(current[name] - target) <= START_POSE_TOLERANCE or servo.saturated.get(name, False)
                for name, target in self._start_targets.items()
            )
            still = previous is not None and all(abs(current[name] - previous[name]) <= START_POSE_REST for name in current)
            if at_pose and still:
                return self.environment.observe(images=True)
            previous = current
        raise EvaluationSessionError(
            "START_POSE_UNREACHED",
            f"The arm did not settle at the task start pose within {START_POSE_MAX_COMMANDS} commands.",
        )

    def _build_task_check(self, task: Any) -> PickPlaceSuccessCheck:
        if not isinstance(task, Mapping) or task.get("kind") != "pick-place":
            raise EvaluationSessionError("PROFILE_INVALID", "Evaluation task must be a pick-place object.")
        allowed = {
            "kind", "sourceBody", "containerBody", "interiorSite", "placementHalfExtents", "settleSeconds",
            "maxEpisodeSteps", "terminateOnSuccess", "offTableMargin", "startPose",
        }
        if set(task) - allowed:
            raise EvaluationSessionError("PROFILE_INVALID", "Pick-place task contains unsupported fields.")
        source = task.get("sourceBody")
        container = task.get("containerBody")
        if not isinstance(source, str) or not source.strip() or not isinstance(container, str) or not container.strip():
            raise EvaluationSessionError("PROFILE_INVALID", "Pick-place task requires sourceBody and containerBody names.")
        extents = task.get("placementHalfExtents", (0.02, 0.02))
        if not isinstance(extents, (list, tuple)) or len(extents) != 2 or any(
            not isinstance(value, (int, float)) or isinstance(value, bool) or not np.isfinite(value) or value <= 0
            for value in extents
        ):
            raise EvaluationSessionError("PROFILE_INVALID", "placementHalfExtents must contain two positive finite numbers.")
        for key in ("settleSeconds", "offTableMargin"):
            value = task.get(key)
            if value is not None and (
                not isinstance(value, (int, float)) or isinstance(value, bool) or not np.isfinite(value) or value <= 0
            ):
                raise EvaluationSessionError("PROFILE_INVALID", f"{key} must be a positive finite number.")
        max_steps = task.get("maxEpisodeSteps")
        if max_steps is not None and (not isinstance(max_steps, int) or isinstance(max_steps, bool) or max_steps < 1):
            raise EvaluationSessionError("PROFILE_INVALID", "maxEpisodeSteps must be a positive integer.")
        if "terminateOnSuccess" in task and not isinstance(task["terminateOnSuccess"], bool):
            raise EvaluationSessionError("PROFILE_INVALID", "terminateOnSuccess must be a boolean.")
        try:
            mujoco = self.environment._mujoco
            finger_geoms: list[str] = []
            from ..robots.bindings import find_geom_suffix

            for suffix in ("fixed_finger_pad", "moving_finger_pad"):
                name = find_geom_suffix(mujoco, self.environment.model, suffix)
                if name is not None:
                    finger_geoms.append(name)
            return PickPlaceSuccessCheck(
                mujoco, self.environment.model, self.environment.data, task, tuple(finger_geoms)
            )
        except Exception as error:
            raise EvaluationSessionError("PROFILE_INVALID", f"Pick-place task bodies do not resolve: {error}") from error

    @property
    def status(self) -> str:
        return self._status

    def describe(self) -> dict[str, Any]:
        input_convention = self.profile["inputConvention"]
        actions = []
        for field in self._action_fields:
            actuator = str(field["actuator"])
            try:
                index = self.environment.actuator_id(actuator)
            except NativeEnvironmentError as error:
                raise EvaluationSessionError(
                    "PROFILE_INVALID", f"Action actuator '{actuator}' does not resolve."
                ) from error
            actions.append(
                {
                    "name": field["name"],
                    "source": {"name": actuator, "index": index},
                    "dtype": "float32",
                    "shape": [1],
                    **({"unit": field["unit"]} if field.get("unit") else {}),
                    **({"inputRange": field["inputRange"]} if field.get("inputRange") else {}),
                    **({"controlRange": field["controlRange"]} if field.get("controlRange") else {}),
                }
            )
        state = []
        for index, field in enumerate(self._state_fields):
            source = self._resolved_state[index]
            state.append(
                {
                    "name": field["name"],
                    "source": source,
                    "dtype": "float32",
                    "shape": [1],
                    **({"unit": field["unit"]} if field.get("unit") else {}),
                    **({"scale": field["scale"]} if field.get("scale") is not None else {}),
                    **({"offset": field["offset"]} if field.get("offset") is not None else {}),
                }
            )
        cameras = [
            {
                "name": camera["camera"],
                "source": {"name": camera["camera"], "index": self._camera_index(camera["camera"])},
                "outputName": camera["outputName"],
                "width": camera["width"],
                "height": camera["height"],
                "channels": 3,
                "dtype": "uint8",
                "layout": "HWC",
                "colorSpace": "rgb",
                "rowOrientation": "top-to-bottom",
            }
            for camera in self._cameras
        ]
        return {
            "protocolVersion": 1,
            "backend": "native-worker",
            "inputConvention": input_convention,
            "capabilities": {
                "externalControl": True,
                "binaryAttachments": True,
                "authoredCameraRgb": bool(cameras),
                "seededRandomization": bool(self.profile.get("randomization")),
                "capturedStateBaseline": False,
                **({"taskStatus": True} if self._task_check is not None else {}),
            },
            "sceneId": self.scene_id,
            "sceneFingerprint": self.scene_fingerprint,
            "profileId": self.profile_id,
            "profileVersion": 1,
            "timestep": float(self.environment.model.opt.timestep),
            "actions": actions,
            "state": state,
            "cameras": cameras,
            "physicsSteps": int(self.profile.get("physicsSteps", 1)),
            "randomization": list(self.profile.get("randomization") or []),
            **({"task": dict(self.profile["task"])} if self._task_check is not None else {}),
            "reset": {
                "baselines": ["model-default"],
                "seededRandomization": bool(self.profile.get("randomization")),
            },
        }

    def _camera_index(self, camera: str) -> int:
        try:
            return self.environment.camera_id(camera)
        except NativeEnvironmentError as error:
            raise EvaluationSessionError(
                "PROFILE_INVALID", f"Camera '{camera}' does not resolve."
            ) from error

    def _resolve_state_source(self, source_value: Any) -> dict[str, Any]:
        if not isinstance(source_value, Mapping):
            raise EvaluationSessionError("PROFILE_INVALID", "State field source must be an object.")
        source = dict(source_value)
        kind = source.get("kind")
        try:
            if kind in {"qpos", "qvel"}:
                name = str(source["component"])
                index = self.environment.joint_id(name)
                return {"kind": kind, "name": name, "index": index}
            if kind == "actuator":
                name = str(source["actuator"])
                index = self.environment.actuator_id(name)
                return {"kind": kind, "name": name, "index": index, "value": source["value"]}
            if kind == "sensor":
                name = str(source["sensor"])
                index = self.environment.sensor_id(name)
                resolved = {"kind": kind, "name": name, "index": index}
                if source.get("component") is not None:
                    resolved["component"] = source["component"]
                return resolved
        except (NativeEnvironmentError, KeyError) as error:
            raise EvaluationSessionError(
                "PROFILE_INVALID", f"State source {kind!r} does not resolve: {error}"
            ) from error
        raise EvaluationSessionError("PROFILE_INVALID", f"State source kind {kind!r} is unsupported.")

    def acquire(self, identity: bytes) -> str:
        self.expire_stale_lease()
        if self._status == "invalidated":
            raise EvaluationSessionError("SESSION_INVALIDATED", "The evaluation session is invalidated.")
        if self._lease_identity is not None:
            raise EvaluationSessionError("ALREADY_ACQUIRED", "This evaluation session is already acquired.")
        lease_id = self._control.acquire(identity) if self._control else f"lease-{uuid.uuid4()}"
        self._lease_identity = identity
        self._lease_last_seen = time.monotonic()
        self._status = "acquired"
        return lease_id

    def release(self, identity: bytes) -> None:
        self._require_lease(identity)
        if self._control:
            self._control.release()
        self._episode_id = None
        self._step_id = 0
        self._lease_identity = None
        self._lease_last_seen = None
        self._status = "connected"

    def reset(
        self,
        identity: bytes,
        seed: int | None,
        *,
        request_id: int = 0,
    ) -> tuple[dict[str, Any], list[bytes]]:
        self._require_lease(identity)
        randomization = self.profile.get("randomization") or []
        self.environment.task = {"randomization": list(randomization)} if randomization else None
        observation = (
            self._control.reset(seed) if self._control else self.environment.reset(seed=seed)
        )
        observation = self._settle_start_pose(observation)
        self._episode_id = f"episode-{uuid.uuid4()}"
        self._step_id = 0
        self._status = "episode-active"
        if self._task_check is not None:
            self._task_status = self._task_check.reset(self.environment.model, self.environment.data)
        reset_info = self.environment.last_reset_info
        self._episode_index += 1
        self._episode_seed = None if reset_info.seed is None else int(reset_info.seed)
        self._episode_counted = False
        samples = [
            {"ruleIndex": index, "target": sample.get("target"), "values": list(sample.get("values", []))}
            for index, sample in enumerate(reset_info.samples)
        ]
        header, attachments = self._observation_bundle(
            observation,
            request_id=request_id,
        )
        return (
            {
                "episodeId": self._episode_id,
                "observation": header,
                "resetInfo": {"seed": reset_info.seed, "samples": samples},
                **({"task": self._task_status.to_dict()} if self._task_status is not None else {}),
            },
            attachments,
        )

    def step(
        self,
        identity: bytes,
        episode_id: str,
        action: Sequence[float],
        physics_steps: int | None,
        *,
        request_id: int = 0,
    ) -> tuple[dict[str, Any], list[bytes]]:
        self._require_lease(identity)
        if self._episode_id is None:
            raise EvaluationEpisodeError("Reset the evaluation session before stepping.")
        if episode_id != self._episode_id:
            raise EvaluationSessionError("EPISODE_INVALID", "Step episode does not match the active episode.")
        if self._task_status is not None and (self._task_status.terminated or self._task_status.truncated):
            raise EvaluationSessionError("EPISODE_TERMINATED", "This evaluation episode has already terminated.")
        if len(action) != len(self._action_fields):
            raise EvaluationSessionError(
                "ACTION_LENGTH_MISMATCH",
                f"Expected {len(self._action_fields)} action values but received {len(action)}.",
            )
        if physics_steps is not None and not (1 <= physics_steps <= EVALUATION_MAX_PHYSICS_STEPS):
            raise EvaluationSessionError(
                "PHYSICS_STEPS_INVALID",
                f"physicsSteps must be between 1 and {EVALUATION_MAX_PHYSICS_STEPS}.",
            )
        targets = {
            str(field["name"]): _remap_action_value(field, raw_value, self._action_range_policy)
            for field, raw_value in zip(self._action_fields, action, strict=True)
        }
        try:
            values = self.environment.validate_action(targets)
        except NativeActionError as error:
            raise EvaluationSessionError("ACTION_OUT_OF_RANGE", str(error)) from error
        applied_physics_steps = (
            int(self.profile.get("physicsSteps", 1)) if physics_steps is None else physics_steps
        )
        observation = (
            self._control.step(values, applied_physics_steps)
            if self._control
            else self.environment.step(values, physics_steps=applied_physics_steps)
        )
        self._step_id += 1
        if self._task_check is not None:
            self._task_status = self._task_check.update(self.environment.model, self.environment.data)
            if not self._episode_counted and (self._task_status.terminated or self._task_status.truncated):
                self._episode_counted = True
                self._episodes_finished += 1
                self._episodes_succeeded += int(self._task_status.success)
        header, attachments = self._observation_bundle(
            observation,
            physics_steps=applied_physics_steps,
            request_id=request_id,
        )
        return {
            "observation": header,
            **({"task": self._task_status.to_dict()} if self._task_status is not None else {}),
        }, attachments

    def render(self, cameras: Sequence[str] | None = None, *, request_id: int = 0) -> tuple[dict[str, Any], list[bytes]]:
        """Renders the current state without stepping. Needs no lease, so a viewer such as a
        virtual webcam can watch while another client drives the simulation."""
        if self._status == "invalidated":
            raise EvaluationSessionError("SESSION_INVALIDATED", "The evaluation session is invalidated.")
        outputs = {str(camera["outputName"]) for camera in self._cameras}
        selected = outputs if cameras is None else set(cameras)
        unknown = sorted(selected - outputs)
        if unknown:
            raise EvaluationSessionError("TARGET_NOT_FOUND", f"Unknown camera output {unknown[0]!r}.")
        observation = self.environment.observe(images=bool(selected), cameras=selected)
        header, attachments = self._observation_bundle(
            observation, physics_steps=0, request_id=request_id, cameras=selected
        )
        return {"observation": header}, attachments

    def episode_summary(self) -> dict[str, Any] | None:
        """Current episode and running score for the Studio stream; ``None`` before any reset."""
        if self._episode_index == 0:
            return None
        task = self._task_status
        return {
            "index": self._episode_index,
            "active": self._episode_id is not None,
            "step": self._step_id,
            "seed": self._episode_seed,
            "task": None
            if task is None
            else {
                "success": task.success,
                "terminated": task.terminated,
                "truncated": task.truncated,
                "reason": task.reason,
            },
            "finished": self._episodes_finished,
            "succeeded": self._episodes_succeeded,
        }

    def stop(self, identity: bytes) -> None:
        self._require_lease(identity)
        self._episode_id = None
        self._step_id = 0
        self._status = "acquired"

    def invalidate(self) -> None:
        if self._control:
            self._control.revoke()
        self._episode_id = None
        self._lease_identity = None
        self._lease_last_seen = None
        self._status = "invalidated"

    def expire_stale_lease(self, now: float | None = None) -> bool:
        if self._lease_identity is None or self._lease_last_seen is None:
            return False
        current = time.monotonic() if now is None else now
        if current - self._lease_last_seen < EVALUATION_LEASE_TIMEOUT_SECONDS:
            return False
        if self._control:
            self._control.revoke()
        self._episode_id = None
        self._step_id = 0
        self._lease_identity = None
        self._lease_last_seen = None
        self._status = "connected"
        return True

    def ping(self, identity: bytes) -> None:
        self._require_lease(identity)

    def _require_lease(self, identity: bytes) -> None:
        if self._status == "invalidated":
            raise EvaluationSessionError("SESSION_INVALIDATED", "The evaluation session is invalidated.")
        if self._lease_identity is None or self._lease_identity != identity:
            raise EvaluationLeaseError("Acquire the evaluation session before this command.")
        if self._control:
            self._control.ping()
        self._lease_last_seen = time.monotonic()

    def _observation_bundle(
        self,
        observation: Any,
        *,
        physics_steps: int | None = None,
        request_id: int = 0,
        cameras: Collection[str] | None = None,
    ) -> tuple[dict[str, Any], list[bytes]]:
        state = np.asarray(self.environment.state_values(self._state_fields), dtype=np.float64)
        state_bytes = state.astype(np.float32).tobytes()
        attachments = [state_bytes]
        descriptors: list[dict[str, Any]] = [
            {
                "name": "state",
                "kind": "state",
                "dtype": "float32",
                "shape": [len(self._state_fields)],
                "layout": "flat",
                "byteLength": len(state_bytes),
                "requestId": request_id,
                "episodeId": self._episode_id,
                "stepId": self._step_id,
            }
        ]
        for camera in self._cameras:
            output_name = str(camera["outputName"])
            if cameras is not None and output_name not in cameras:
                continue
            image = observation.images.get(output_name)
            if image is None:
                raise EvaluationSessionError(
                    "CAPTURE_FAILED", f"Camera '{output_name}' did not render a frame."
                )
            payload = np.ascontiguousarray(image, dtype=np.uint8).tobytes()
            attachments.append(payload)
            descriptors.append(
                {
                    "name": output_name,
                    "kind": "camera",
                    "dtype": "uint8",
                    "shape": list(image.shape),
                    "layout": "HWC",
                    "byteLength": len(payload),
                    "requestId": request_id,
                    "episodeId": self._episode_id,
                    "stepId": self._step_id,
                }
            )
        header = {
            "attachments": descriptors,
            "requestId": request_id,
            "episodeId": self._episode_id,
            "stepId": self._step_id,
            "simulationTime": observation.simulation_time,
            "sceneFingerprint": self.scene_fingerprint,
            "physicsSteps": int(self.profile.get("physicsSteps", 1))
            if physics_steps is None
            else physics_steps,
        }
        return header, attachments
