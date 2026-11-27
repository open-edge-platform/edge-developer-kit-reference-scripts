# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""SO-101 pick-and-place controller used by the bundled examples.

The controller is external to Physical AI Scene Builder: it plans with a local MuJoCo replica of the scene,
sends named actuator targets through :class:`robotic_studio.teleoperation.Teleoperation`, and waits
for each authoritative native snapshot before planning the next command.

Most callers need only three things:

* :class:`PickPlaceTask` names the object to pick and the body to place it in.
* :func:`record_episode` selects a scene state, runs one attempt, and saves the recording only
  when the object was lifted and left settled inside the container. The arm then returns to the
  pose the attempt started from, so every episode ends at rest where it began. Each attempt samples a
  :class:`PickPlaceVariation` from the recording's seed, so repeats of one state differ the way
  repeated human demonstrations do instead of replaying one identical trajectory.
* :func:`run_pick_and_place` runs one attempt without managing recording.

Controller tuning lives in :class:`PickPlaceTuning`; its defaults are maintained for the SO-101
sample scene. Every command is physics-only: MuJoCo actuators, gravity, and contact decide the
motion.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
from typing import TYPE_CHECKING, Any

import numpy as np

from ...frame_clock import FrameClock, capture_fps_from_profile, validate_capture_fps
from ...generation.ik import DampedLeastSquaresIK
from ...tasks.pick_place import (
    OBJECT_SETTLE_ANGULAR_SPEED,
    OBJECT_SETTLE_QUIET_SECONDS,
    OBJECT_SETTLE_SPEED,
    OPENING_CONTACT_ALLOWANCE,
    container_interior_half_extents,
    gripper_touches,
    source_footprint_extents,
)
from ..bindings import (
    ActionBinding,
    body_position,
    body_quaternion,
    clamp,
    find_geom_suffix,
    find_optional_site,
    model_id as _model_id,
    resolve_action_bindings,
    resolve_body,
    site_position,
)
from ..overlaps import find_initial_overlaps
from ..servo import ServoCompensation
from .adapter import SO101

if TYPE_CHECKING:
    from ..control import ControlTarget


DEFAULT_WRIST_ROLL_DEGREES = SO101.home_wrist_roll_degrees
# The folded rest pose (degrees) every recording starts and ends at, serial or batch, so episodes
# match the evaluation start pose and the real arm's rest.
REST_POSE_DEGREES: Mapping[str, float] = {
    "shoulder_pan": 0.0,
    "shoulder_lift": -100.0,
    "elbow_flex": 86.85,
    "wrist_flex": 70.92,
    "wrist_roll": -90.00,
    "gripper": 0.0,
}
# Gripper closing speed while waiting for bilateral contact, in actuator units per simulated second.
MAX_CONTACT_CLOSE_SPEED = 1.25
MAX_GRASP_PENETRATION = 0.001
GRASP_ORIENTATION_WEIGHT = 0.3
# SO-101 gripperframe axes: x points along the fingers and z along the jaw closing direction.
# The planner assumes these two indices; the remaining frame axis is column 1.
GRASP_APPROACH_AXIS = 0
GRASP_CLOSING_AXIS = 2
GRASP_ORIENTATION_AXES = (GRASP_CLOSING_AXIS,)
# A vertical approach is outside the SO-101 workspace above most tabletop objects, so the fingers
# tilt outward from the shoulder-pan axis. The smallest reachable tilt keeps the pads most upright.
GRASP_APPROACH_TILTS = tuple(math.radians(degrees) for degrees in (10.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0))
# Keep the fixed pad just outside the object face while descending so it cannot land on the top
# edge; the moving jaw then pushes the object this short distance onto the fixed pad.
GRASP_FACE_CLEARANCE = 0.002
HOME_POSE_TOLERANCE = 0.005
HOME_POSE_MAX_VELOCITY = 0.05
HOME_POSE_MAX_COMMANDS = 2000
GRASP_ORIENTATION_TOLERANCE = 0.02
GRASP_PLAN_ITERATIONS = 4
GRASP_ALIGNMENT_TOLERANCE = 0.0002
GRASP_DISTANCE_MAX = 0.1
GRASP_ORIENTATION_MAX_ITERATIONS = 300
GRASP_SWEEP_SAMPLES = 40
GRASP_RAISE_STEP = 0.001
GRASP_MAX_RAISE_STEPS = 15
# The moving pad must first meet the object at least this far below its top: a pad landing on the
# top edge (steep approach tilts) squeezes the object out of the jaws on lift.
GRASP_TOP_EDGE_MARGIN = 0.003
# Extra simulated time a phase may take to reach or settle at its target before failing.
PHASE_SETTLE_SECONDS = 2.4
SETTLE_POSITION_TOLERANCE = 0.002
GRASP_POSITION_TOLERANCE = 0.0005
GRASP_PLAN_POSITION_TOLERANCE = 0.0001
SETTLE_AXIS_TOLERANCE = math.radians(3.0)
SETTLE_MAX_JOINT_SPEED = 0.05
# Joint command speed the SO-101 servos track without saturating, in rad/s of simulated time.
MAX_JOINT_COMMAND_SPEED = 2.5
# Jaw-axis turn rate while reorienting, in rad/s. One command's turn must exceed the IK orientation
# tolerance (about 2.3 degrees) or IK accepts the current pose.
MAX_AXIS_COMMAND_SPEED = math.radians(500.0)
MIN_AXIS_COMMAND_STEP = math.radians(4.0)
# Streamed IK commands stop within a quarter of this much travel of their target, like the 8 ms
# command stream the tolerances were tuned on; faster frames would otherwise loosen the grasp pose.
IK_TOLERANCE_REFERENCE_SECONDS = 0.008
# After release, the object must come to rest before containment is judged.
OBJECT_SETTLE_SECONDS = 1.0
# Via points bend a transfer path; the arm passes near them without stopping.
VIA_POSITION_TOLERANCE = 0.005
# After placing, the arm returns to the joint pose it started the episode from. Each joint must
# end within this many radians of its start command and stop moving.
RETURN_POSITION_TOLERANCE = 0.03

FAILURE_REASONS = {
    "initial_overlap": "An object starts inside other geometry (see --check).",
    "home_pose": "The arm could not reach its home pose.",
    "unreachable": "The object or container is outside the arm's reachable workspace.",
    "grasp_blocked": "Nearby geometry blocks the open gripper from every grasp direction.",
    "ik_failed": "Inverse kinematics could not find joint targets for a waypoint.",
    "motion_timeout": "The arm did not reach a waypoint in time.",
    "grasp_failed": "The gripper did not close on the object from both sides.",
    "dropped": "The object slipped out of the gripper while lifting.",
    "placement_failed": "The object did not come to rest inside the container.",
    "return_failed": "The arm did not return to its start pose after placing the object.",
}


# A failed grasp is re-planned from another direction, up to this many attempts per episode.
MAX_GRASP_ATTEMPTS = 3
# Failures before the object is lifted that another grasp direction can avoid.
RETRYABLE_GRASP_FAILURES = frozenset({"motion_timeout", "grasp_failed", "dropped"})
# A lowering that stops with the carried object this close (horizontally) to the container's
# placement reference releases there; the placement check decides whether it landed inside.
RELEASE_ABOVE_CONTAINER_LIMIT = 0.02


class PickPlaceError(RuntimeError):
    """A pick-and-place attempt failed for a known ``reason`` (see ``FAILURE_REASONS``)."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class PickPlaceTask:
    """Which scene bodies the task uses. Body names may omit a robot/asset namespace prefix."""

    source_body: str = "asset_cube"
    container_body: str = "container"
    # Maximum X/Y offset between the settled object center and the container center, in metres.
    placement_half_extents: tuple[float, float] = (0.02, 0.02)

    @classmethod
    def for_session(
        cls,
        client: ControlTarget,
        *,
        source_body: str | None = None,
        container_body: str | None = None,
    ) -> PickPlaceTask:
        """Use explicit names, else the object randomized in Generate, else the sample defaults."""
        if source_body is None:
            states = [
                state for state in getattr(client, "initial_states", ())
                if getattr(state, "randomization", None)
            ]
            current = getattr(client, "current_state", None)
            selected = next(
                (state for state in states if current is not None and state.state_id == current.state_id),
                states[-1] if states else None,
            )
            sample = selected.randomization if selected is not None else None
            if isinstance(sample, Mapping) and isinstance(sample.get("target"), str):
                source_body = sample["target"]
        if source_body is None:
            profile = getattr(client, "profile", None)
            randomization = profile.get("sourceRandomization") if isinstance(profile, Mapping) else None
            if isinstance(randomization, Mapping) and isinstance(randomization.get("body"), str):
                source_body = randomization["body"]
        defaults = cls()
        return cls(
            source_body=source_body or defaults.source_body,
            container_body=container_body or defaults.container_body,
        )


@dataclass(frozen=True)
class PickPlaceTuning:
    """Controller settings maintained for the SO-101 sample scene.

    Distances are metres, speeds are per simulated second, and gripper values are native actuator
    units. One command is one dataset frame: ``fps`` (default: the session profile's ``captureFps``,
    30) sets the command rate, and a :class:`~robotic_studio.frame_clock.FrameClock` picks the
    physics steps per command. Change these only after a scene check or failed attempts point to a
    specific cause.
    """

    end_effector_site: str = SO101.end_effector_site
    arm_joints: tuple[str, ...] | None = None
    gripper_action: str | None = None
    gripper_open: float = 1.2
    gripper_closed: float | None = None  # Defaults to the gripper actuator's lower limit.
    gripper_release: float = 1.0
    gripper_speed: float = 25.0
    approach_height: float = 0.08
    lift_height: float = 0.10
    lower_height: float = 0.04
    grasp_height: float = 0.0
    fps: int | None = None
    phase_seconds: float = 0.64
    release_seconds: float = 0.32
    travel_speed: float = 0.375
    descend_speed: float = 0.125
    lift_speed: float = 0.25
    ik_max_joint_delta: float = 0.10
    home_wrist_roll_degrees: float = SO101.home_wrist_roll_degrees
    # Joint positions in degrees keyed by SO-101 joint name (arm joints and "gripper"). When set, every attempt settles here before recording and
    # returns here at the end; ``home_wrist_roll_degrees`` is then unused.
    home_pose: Mapping[str, float] | None = None
    home_physics_steps: int = 1
    # After placing, drive the arm and gripper back to the episode's start pose so recorded
    # episodes end where they began. A policy trained on them then has a familiar rest pose to
    # return to, instead of stalling above the container in a pose it never saw at the start.
    return_to_start: bool = True
    # Joint-space speed of the return move, in rad/s of simulated time (fastest joint).
    return_joint_speed: float = 1.0

    def validate(self) -> None:
        if self.fps is not None:
            validate_capture_fps(self.fps, "fps")
        value = self.home_physics_steps
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            raise ValueError("home_physics_steps must be a positive integer.")
        for name in (
            "phase_seconds",
            "release_seconds",
            "travel_speed",
            "descend_speed",
            "lift_speed",
            "ik_max_joint_delta",
            "gripper_speed",
            "return_joint_speed",
        ):
            value = getattr(self, name)
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be positive.")
        if not math.isfinite(self.home_wrist_roll_degrees):
            raise ValueError("home_wrist_roll_degrees must be finite.")
        if self.home_pose is not None:
            known = (*SO101.arm_joint_suffixes, SO101.gripper_action)
            if not self.home_pose:
                raise ValueError("home_pose must list at least one joint.")
            for name, degrees in self.home_pose.items():
                if name not in known:
                    raise ValueError(f"home_pose joint '{name}' is not one of: {', '.join(known)}.")
                if not isinstance(degrees, (int, float)) or not math.isfinite(degrees):
                    raise ValueError(f"home_pose['{name}'] must be a finite number of degrees.")


@dataclass(frozen=True)
class PickPlaceVariation:
    """Per-attempt changes to speed, timing, heights, and path shape.

    Deterministic physics and a deterministic controller would otherwise record the same
    trajectory every time a state is repeated. :meth:`sample` draws these from a seed (the
    recording's ``attemptSeed``), so every attempt is reproducible yet different. Distances are
    metres; the defaults change nothing.
    """

    seed: int = 0
    speed_scale: float = 1.0
    gripper_speed_scale: float = 1.0
    phase_scale: float = 1.0
    approach_height_offset: float = 0.0
    lift_height_offset: float = 0.0
    approach_via_offset: tuple[float, float, float] = (0.0, 0.0, 0.0)
    transfer_via_offset: tuple[float, float, float] = (0.0, 0.0, 0.0)
    grasp_dwell_seconds: float = 0.0

    @classmethod
    def sample(cls, seed: int) -> PickPlaceVariation:
        rng = np.random.default_rng(int(seed) & 0xFFFFFFFF)
        speed_scale = float(rng.uniform(0.8, 1.2))
        gripper_speed_scale = float(rng.uniform(0.8, 1.2))
        phase_scale = float(rng.uniform(0.8, 1.25))
        approach_height_offset = float(rng.uniform(-0.01, 0.015))
        lift_height_offset = float(rng.uniform(-0.005, 0.02))
        # Lateral x/y within ±2 cm, then a lift of up to 2 cm.
        approach_via = rng.uniform((-0.02, -0.02, 0.0), (0.02, 0.02, 0.02))
        transfer_via = rng.uniform((-0.02, -0.02, 0.0), (0.02, 0.02, 0.02))
        return cls(
            seed=int(seed),
            speed_scale=speed_scale,
            gripper_speed_scale=gripper_speed_scale,
            phase_scale=phase_scale,
            approach_height_offset=approach_height_offset,
            lift_height_offset=lift_height_offset,
            approach_via_offset=(float(approach_via[0]), float(approach_via[1]), float(approach_via[2])),
            transfer_via_offset=(float(transfer_via[0]), float(transfer_via[1]), float(transfer_via[2])),
            grasp_dwell_seconds=float(rng.uniform(0.0, 0.2)),
        )

    def apply(self, tuning: PickPlaceTuning) -> PickPlaceTuning:
        return replace(
            tuning,
            travel_speed=tuning.travel_speed * self.speed_scale,
            descend_speed=tuning.descend_speed * self.speed_scale,
            lift_speed=tuning.lift_speed * self.speed_scale,
            return_joint_speed=tuning.return_joint_speed * self.speed_scale,
            gripper_speed=tuning.gripper_speed * self.gripper_speed_scale,
            phase_seconds=tuning.phase_seconds * self.phase_scale,
            release_seconds=tuning.release_seconds * self.phase_scale,
            approach_height=tuning.approach_height + self.approach_height_offset,
            lift_height=tuning.lift_height + self.lift_height_offset,
        )

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["approach_via_offset"] = list(self.approach_via_offset)
        value["transfer_via_offset"] = list(self.transfer_via_offset)
        return {_camel(key): item for key, item in value.items()}


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


@dataclass(frozen=True)
class EpisodeOutcome:
    """Result of one recorded attempt."""

    state_id: str
    saved: bool
    reason: str | None = None
    message: str | None = None
    episode_id: str | None = None
    frame_count: int = 0
    control_mode: str | None = None
    attempt_seed: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "stateId": self.state_id,
            "saved": self.saved,
            "reason": self.reason,
            "message": self.message,
            "episodeId": self.episode_id,
            "frameCount": self.frame_count,
            "controlMode": self.control_mode,
            "attemptSeed": self.attempt_seed,
        }


Logger = Callable[[str], None]


def _ignore(_message: str) -> None:
    return


def _settle_joints(
    client: ControlTarget,
    targets: Mapping[str, float],
    *,
    physics_steps: int,
    tolerance: float,
    max_commands: int,
    servo: ServoCompensation | None = None,
    actions: Mapping[str, str] | None = None,
) -> Any | None:
    """Command joint ``targets`` until every joint is at rest there; ``None`` if they never settle.

    With ``servo`` and ``actions`` (joint name to action name) the commands are offset so compliant
    servos reach the targets. A joint whose command is pinned at its range limit cannot be pushed
    further, so it counts as arrived once it stops.
    """
    joints = {name: client.joints[name] for name in targets}
    compensate = servo is not None and actions is not None
    qpos = None
    for _ in range(max_commands):
        command = dict(targets)
        if compensate:
            offset = servo.command({actions[name]: value for name, value in targets.items()}, qpos, physics_steps)
            command = {name: offset[actions[name]] for name in targets}
        snapshot = client.step(joints=command, physics_steps=physics_steps)
        qpos = np.asarray(snapshot.qpos)
        qvel = np.asarray(snapshot.qvel)
        if all(
            (
                abs(float(qpos[joint.qpos_slice][0]) - targets[name]) <= tolerance
                or (compensate and servo.saturated.get(actions[name], False))
            )
            and abs(float(qvel[joint.qvel_slice][0])) <= HOME_POSE_MAX_VELOCITY
            for name, joint in joints.items()
        ):
            return snapshot
    return None


def set_default_home_pose(
    client: ControlTarget,
    *,
    wrist_roll_degrees: float = DEFAULT_WRIST_ROLL_DEGREES,
    physics_steps: int = 1,
    tolerance: float = HOME_POSE_TOLERANCE,
    max_commands: int = HOME_POSE_MAX_COMMANDS,
    mujoco: Any = None,
) -> Any:
    """Set the default SO-101 wrist-roll home pose before moving the cube.

    The actuator drives the joint through physics, so commands repeat until the joint settles at
    the target. The grasp orientation is latched from this pose, so an unsettled wrist would grasp
    with the wrong roll. Pass ``mujoco`` to offset the command for compliant servos.
    """
    if not np.isfinite(wrist_roll_degrees):
        raise ValueError("wrist_roll_degrees must be finite.")
    if not isinstance(physics_steps, int) or isinstance(physics_steps, bool) or physics_steps < 1:
        raise ValueError("physics_steps must be a positive integer.")

    wrist_roll, wrist_roll_position = SO101.home_joint_target(client, wrist_roll_degrees)
    servo = actions = None
    if mujoco is not None:
        bindings = [
            binding
            for binding in resolve_action_bindings(mujoco, client.local.model, client.profile)
            if binding.joint_name == wrist_roll
        ]
        if bindings:
            servo = ServoCompensation(mujoco, client.local.model, bindings)
            actions = {wrist_roll: bindings[0].action_name}
    snapshot = _settle_joints(
        client,
        {wrist_roll: wrist_roll_position},
        physics_steps=physics_steps,
        tolerance=tolerance,
        max_commands=max_commands,
        servo=servo,
        actions=actions,
    )
    if snapshot is not None:
        return snapshot
    raise PickPlaceError(
        "home_pose",
        f"The wrist did not settle at its home pose ({math.degrees(wrist_roll_position):.0f} degrees) "
        f"within {max_commands} commands.",
    )


def home_pose_targets(
    bindings: Sequence[ActionBinding], home_pose: Mapping[str, float]
) -> list[tuple[ActionBinding, float]]:
    """Map a home pose in degrees to action bindings and native targets clamped to their range."""
    by_name: dict[str, ActionBinding] = dict(
        zip(SO101.arm_joint_suffixes, SO101.resolve_arm_bindings(bindings), strict=True)
    )
    by_name[SO101.gripper_action] = SO101.resolve_gripper_binding(bindings)
    return [
        (by_name[name], clamp(math.radians(float(degrees)), by_name[name].control_range))
        for name, degrees in home_pose.items()
    ]


def move_to_home_pose(
    client: ControlTarget,
    mujoco: Any,
    home_pose: Mapping[str, float],
    *,
    physics_steps: int = 1,
    tolerance: float = HOME_POSE_TOLERANCE,
    max_commands: int = HOME_POSE_MAX_COMMANDS,
) -> Any:
    """Drive the listed SO-101 joints to ``home_pose`` (degrees) and wait until all are at rest there.

    Joints not listed keep their current targets. Commands are offset so compliant servos reach
    the pose. Returns the snapshot in which the pose settled.
    """
    bindings = resolve_action_bindings(mujoco, client.local.model, client.profile)
    pose = home_pose_targets(bindings, home_pose)
    targets: dict[str, float] = {}
    actions: dict[str, str] = {}
    for binding, value in pose:
        if binding.joint_name is None:
            raise RuntimeError(f"Home pose action '{binding.action_name}' does not drive a joint.")
        targets[binding.joint_name] = value
        actions[binding.joint_name] = binding.action_name
    snapshot = _settle_joints(
        client,
        targets,
        physics_steps=physics_steps,
        tolerance=tolerance,
        max_commands=max_commands,
        servo=ServoCompensation(mujoco, client.local.model, [binding for binding, _ in pose]),
        actions=actions,
    )
    if snapshot is not None:
        return snapshot
    raise PickPlaceError(
        "home_pose",
        f"The arm did not settle at its home pose within {max_commands} commands.",
    )


def closed_pad_offset(
    mujoco: Any,
    model: Any,
    data: Any,
    site_name: str,
    gripper: ActionBinding,
    gripper_closed: float,
    fixed_pad: str | None,
    moving_pad: str | None,
) -> np.ndarray:
    if fixed_pad is None or moving_pad is None:
        return np.zeros(3, dtype=np.float64)
    signature = mujoco.mjtState.mjSTATE_FULLPHYSICS
    state = np.empty(mujoco.mj_stateSize(model, signature), dtype=np.float64)
    mujoco.mj_getState(model, data, state, signature)
    try:
        np.asarray(data.ctrl)[gripper.actuator_id] = gripper_closed
        if gripper.qpos_address is not None:
            np.asarray(data.qpos)[gripper.qpos_address] = gripper_closed
        mujoco.mj_forward(model, data)
        fixed_id = _model_id(mujoco, model, mujoco.mjtObj.mjOBJ_GEOM, fixed_pad, "geom")
        moving_id = _model_id(mujoco, model, mujoco.mjtObj.mjOBJ_GEOM, moving_pad, "geom")
        site_id = _model_id(mujoco, model, mujoco.mjtObj.mjOBJ_SITE, site_name, "site")
        midpoint = (
            np.asarray(data.geom_xpos[fixed_id], dtype=np.float64)
            + np.asarray(data.geom_xpos[moving_id], dtype=np.float64)
        ) / 2.0
        return midpoint - np.asarray(data.site_xpos[site_id], dtype=np.float64)
    finally:
        mujoco.mj_setState(model, data, state, signature)
        mujoco.mj_forward(model, data)


class PickPlaceController:
    """Waypoint controller that moves ``task.source_body`` into ``task.container_body``.

    ``client`` is a connected :class:`~robotic_studio.teleoperation.Teleoperation` (or an object with
    the same ``profile``, ``local``, and ``step`` surface). Build the controller after the local
    replica is synchronized with the state the attempt starts from.
    """

    log: Logger = staticmethod(_ignore)

    def __init__(
        self,
        client: ControlTarget,
        mujoco: Any,
        task: PickPlaceTask = PickPlaceTask(),
        tuning: PickPlaceTuning = PickPlaceTuning(),
        *,
        log: Logger | None = None,
    ) -> None:
        tuning.validate()
        profile = client.profile
        if not isinstance(profile, Mapping):
            raise RuntimeError("The teleoperation session did not provide a profile.")
        model = client.local.model
        data = client.local.data
        bindings = resolve_action_bindings(mujoco, model, profile)
        self.client = client
        self.mujoco = mujoco
        self.model = model
        self.data = data
        self.log = log or _ignore
        self.source_body = resolve_body(mujoco, model, task.source_body, "source body")
        self.container_body = resolve_body(mujoco, model, task.container_body, "container body")
        self.end_effector_site = SO101.resolve_end_effector_site(
            mujoco, model, override=tuning.end_effector_site
        )
        self.arm_bindings = SO101.resolve_arm_bindings(bindings, tuning.arm_joints)
        # ``targets`` are planned joint angles; the servo offsets turn them into commands.
        self.servo = ServoCompensation(mujoco, model, self.arm_bindings)
        self.measured_qpos = np.asarray(data.qpos, dtype=np.float64).copy()
        self.gripper = SO101.resolve_gripper_binding(bindings, tuning.gripper_action)
        self.gripper_open = tuning.gripper_open
        self.gripper_closed = (
            tuning.gripper_closed
            if tuning.gripper_closed is not None
            else self.gripper.control_range[0]
            if self.gripper.control_range is not None
            else 0.0
        )
        self.gripper_release = tuning.gripper_release
        fps = tuning.fps if tuning.fps is not None else capture_fps_from_profile(profile)
        # One command per dataset frame; speeds become per-command steps at that rate.
        self.clock = FrameClock(fps, float(model.opt.timestep))
        self.command_period = self.clock.period
        self.tuning = tuning
        self.variation = PickPlaceVariation()
        self._configure_motion(tuning)
        self.lower_height = tuning.lower_height
        self.grasp_height = tuning.grasp_height
        placement_extents = np.asarray(task.placement_half_extents, dtype=np.float64)
        if placement_extents.shape != (2,) or not np.all(np.isfinite(placement_extents)) or np.any(placement_extents <= 0):
            raise ValueError("placement_half_extents must contain two positive finite values.")
        self.placement_half_extents = placement_extents
        self.ik = DampedLeastSquaresIK(
            model,
            data,
            [binding.joint_name for binding in self.arm_bindings if binding.joint_name is not None],
            self.end_effector_site,
            max_joint_delta=tuning.ik_max_joint_delta,
            orientation_tolerance=GRASP_ORIENTATION_TOLERANCE,
        )
        self.targets = self._current_targets(bindings)
        if tuning.home_pose is not None:
            for binding, value in home_pose_targets(bindings, tuning.home_pose):
                self.targets[binding.action_name] = value
        # The pose the episode starts from; the arm returns here after placing the object.
        self.start_targets = dict(self.targets)
        self.return_to_start = tuning.return_to_start
        self.source_site = find_optional_site(mujoco, model, f"{self.source_body}__generation_center")
        self.container_site = find_optional_site(mujoco, model, f"{self.container_body}__generation_interior")
        self.fixed_pad = find_geom_suffix(mujoco, model, "fixed_finger_pad")
        self.moving_pad = find_geom_suffix(mujoco, model, "moving_finger_pad")
        self.current_gripper_target = (
            float(np.asarray(data.qpos)[self.gripper.qpos_address])
            if self.gripper.qpos_address is not None
            else float(np.asarray(data.ctrl)[self.gripper.actuator_id])
        )
        self.grasp_gripper_target = self.gripper_closed
        self.grasp_orientation = self._site_rotation()
        # The (face normal, tilt) of the planned grasp, so a retry can try another direction.
        self.grasp_direction: tuple[np.ndarray, float] | None = None
        # Set by grasp planning when the last direction was rejected only for a top-edge grasp.
        self.edge_grasp = False
        # Arm joints a streamed move is committed to after switching IK branches (see _action_for).
        self.joint_goal: np.ndarray | None = None
        self.orientation_seeds: list[tuple[np.ndarray, np.ndarray]] = []
        self.hold_orientation = True
        self.source_initial_position = body_position(mujoco, model, data, self.source_body)

    def _configure_motion(self, tuning: PickPlaceTuning) -> None:
        fps = self.clock.fps
        self.gripper_step = tuning.gripper_speed * self.command_period
        self.approach_height = tuning.approach_height
        self.lift_height = tuning.lift_height
        self.phase_steps = max(1, round(tuning.phase_seconds * fps))
        self.release_steps = max(1, round(tuning.release_seconds * fps))
        self.travel_step = tuning.travel_speed * self.command_period
        self.descend_step = tuning.descend_speed * self.command_period
        self.lift_step = tuning.lift_speed * self.command_period
        self.return_joint_step = min(tuning.return_joint_speed, MAX_JOINT_COMMAND_SPEED) * self.command_period

    def apply_variation(self, variation: PickPlaceVariation) -> None:
        """Vary this attempt's speeds, timing, heights, and path; call before :meth:`run`."""
        self.variation = variation
        self._configure_motion(variation.apply(self.tuning))

    def _via_phase(self, label: str, start: np.ndarray, end: np.ndarray, offset: Sequence[float]) -> None:
        """Bend the path from ``start`` to ``end`` through a point offset from its midpoint."""
        if not any(offset):
            return
        via = (np.asarray(start, dtype=np.float64) + np.asarray(end, dtype=np.float64)) / 2.0
        via = via + np.asarray(offset, dtype=np.float64)
        self._phase(
            label,
            via,
            self.current_gripper_target,
            self.travel_step,
            0,
            reach_target=True,
            position_tolerance=VIA_POSITION_TOLERANCE,
        )

    def _dwell(self, seconds: float) -> None:
        for _ in range(round(seconds * self.clock.fps)):
            self._send(self.targets)

    def _send(self, targets: Mapping[str, float]) -> Any:
        """Send one complete action map, then synchronize the local replica to its snapshot."""
        physics_steps = self.clock.next_physics_steps()
        snapshot = self.client.step(
            actuators=self.servo.command(targets, self.measured_qpos, physics_steps),
            physics_steps=physics_steps,
        )
        self.client.local.synchronize(snapshot)
        self.measured_qpos = np.asarray(self.data.qpos, dtype=np.float64).copy()
        return snapshot

    def _current_targets(self, bindings: Sequence[ActionBinding]) -> dict[str, float]:
        values: dict[str, float] = {}
        for binding in bindings:
            if binding.qpos_address is not None:
                values[binding.action_name] = float(np.asarray(self.data.qpos)[binding.qpos_address])
            else:
                values[binding.action_name] = float(np.asarray(self.data.ctrl)[binding.actuator_id])
        return values

    def _reference_position(self, body_name: str, site_name: str | None) -> np.ndarray:
        reference = site_position(self.mujoco, self.model, self.data, site_name)
        return reference if reference is not None else body_position(
            self.mujoco,
            self.model,
            self.data,
            body_name,
        )

    def _site_target(
        self,
        reference: np.ndarray,
        z_offset: float,
        gripper_value: float | None = None,
    ) -> np.ndarray:
        calibration_gripper = self.gripper_closed if gripper_value is None else gripper_value
        offset = closed_pad_offset(
            self.mujoco,
            self.model,
            self.data,
            self.end_effector_site,
            self.gripper,
            calibration_gripper,
            self.fixed_pad,
            self.moving_pad,
        )
        target = reference - offset
        target[2] += z_offset + self.grasp_height
        return target

    def _incremental_target(self, target_position: np.ndarray, cartesian_step: float) -> np.ndarray:
        site_id = _model_id(
            self.mujoco,
            self.model,
            self.mujoco.mjtObj.mjOBJ_SITE,
            self.end_effector_site,
            "site",
        )
        current_position = np.asarray(self.data.site_xpos[site_id], dtype=np.float64)
        delta = target_position - current_position
        distance = float(np.linalg.norm(delta))
        if distance <= cartesian_step:
            return target_position.copy()
        return current_position + delta * (cartesian_step / distance)

    def _action_for(
        self,
        target_position: np.ndarray | Callable[[], np.ndarray],
        gripper_value: float,
        cartesian_step: float,
        *,
        gripper_step: float | None = None,
        rate_limit: bool = True,
    ) -> dict[str, float]:
        # Seed IK and Cartesian stepping from the previous command, not the measured arm state.
        # Re-solving from a lagging or vibrating measurement lands at a slightly different
        # solution each command; the stiff position servos amplify that jitter into a limit cycle.
        for binding in self.arm_bindings:
            if binding.qpos_address is not None:
                np.asarray(self.data.qpos)[binding.qpos_address] = self.targets[binding.action_name]
        self.mujoco.mj_forward(self.model, self.data)
        if rate_limit and self.joint_goal is not None:
            return self._step_joints(self.joint_goal, gripper_value, gripper_step)
        incremental_target = self._incremental_target(target_position, cartesian_step)
        solve_options = {
            "target_orientation": (
                self._incremental_orientation() if rate_limit else self.grasp_orientation
            ),
            "orientation_weight": GRASP_ORIENTATION_WEIGHT,
            "orientation_axes": GRASP_ORIENTATION_AXES,
            # Planning probes measure contact geometry at the solved pose, so they need the
            # solved pose to match the target far more closely than a streamed command does.
            "position_tolerance": (
                min(0.0015, cartesian_step * 0.25 * self._ik_tolerance_scale())
                if rate_limit
                else GRASP_PLAN_POSITION_TOLERANCE
            ),
            "preserve_state": False,
        }
        # Enforce the jaw axis whenever it is reachable. An intermediate turn of the axis can be
        # unreachable even when the final one is not, so try the final axis next; the joint rate
        # limit below still smooths the motion. Fall back to position-only IK last so an
        # infeasible orientation near the workspace edge does not abort the episode.
        result = None
        if self.hold_orientation:
            orientations = [solve_options["target_orientation"]]
            if rate_limit:
                orientations.append(self.grasp_orientation)
            for orientation in orientations:
                solve_options["target_orientation"] = orientation
                result = self.ik.solve(
                    incremental_target,
                    require_orientation=True,
                    max_iterations=GRASP_ORIENTATION_MAX_ITERATIONS,
                    **solve_options,
                )
                if result.success:
                    break
            if rate_limit and not result.success:
                reseeded = self._reseeded_orientation_solve(incremental_target, solve_options)
                if reseeded is not None:
                    # The planned joints are on another IK branch (often the wrist rolled the
                    # other way). Re-solving from the commanded joints next tick would fall back
                    # to the old branch and oscillate, so move in joint space until there.
                    self.joint_goal = np.asarray(reseeded.joint_positions, dtype=np.float64).copy()
                    return self._step_joints(self.joint_goal, gripper_value, gripper_step)
        if result is None or not result.success:
            result = self.ik.solve(
                incremental_target,
                position_tolerance=solve_options["position_tolerance"],
                max_iterations=GRASP_ORIENTATION_MAX_ITERATIONS,
                preserve_state=False,
            )
        if not result.success and rate_limit:
            # A streamed step re-solves every control tick, so a step that lands within the settle
            # tolerance is close enough; near the workspace edge the tight step tolerance could
            # miss by a tenth of a millimetre and end the episode.
            result = self.ik.solve(
                incremental_target,
                position_tolerance=max(solve_options["position_tolerance"], SETTLE_POSITION_TOLERANCE),
                max_iterations=GRASP_ORIENTATION_MAX_ITERATIONS,
                preserve_state=False,
            )
        if not result.success:
            raise PickPlaceError("ik_failed", result.message or "The DLS IK solver did not converge.")
        return self._step_joints(
            np.asarray(result.joint_positions, dtype=np.float64), gripper_value, gripper_step, rate_limit=rate_limit
        )

    def _step_joints(
        self,
        joints: np.ndarray,
        gripper_value: float,
        gripper_step: float | None,
        *,
        rate_limit: bool = True,
    ) -> dict[str, float]:
        """Command one rate-limited step toward ``joints`` and the gripper toward its value."""
        previous = np.array([self.targets[binding.action_name] for binding in self.arm_bindings])
        delta = np.asarray(joints, dtype=np.float64)[: len(previous)] - previous
        largest = float(np.max(np.abs(delta))) if delta.size else 0.0
        max_step = MAX_JOINT_COMMAND_SPEED * self.command_period
        if rate_limit and largest > max_step:
            # Scale the whole joint step so torque-limited servos can follow it; saturated servos
            # chatter and let the arm sag. Uniform scaling keeps the step's Cartesian direction.
            delta *= max_step / largest
        elif rate_limit:
            self.joint_goal = None  # This step arrives.
        for binding, value in zip(self.arm_bindings, previous + delta, strict=True):
            self.targets[binding.action_name] = clamp(float(value), binding.control_range)
        effective_gripper_step = self.gripper_step if gripper_step is None else gripper_step
        self.current_gripper_target += float(
            np.clip(
                gripper_value - self.current_gripper_target,
                -effective_gripper_step,
                effective_gripper_step,
            )
        )
        self.targets[self.gripper.action_name] = clamp(
            self.current_gripper_target,
            self.gripper.control_range,
        )
        return dict(self.targets)

    def _reseeded_orientation_solve(
        self,
        target: np.ndarray,
        solve_options: Mapping[str, Any],
    ) -> Any | None:
        """At a planned waypoint, retry the grasp orientation from that waypoint's planned joints."""
        seeds = [
            joints
            for waypoint, joints in getattr(self, "orientation_seeds", ())
            if float(np.linalg.norm(np.asarray(target) - waypoint)) <= GRASP_POSITION_TOLERANCE
        ]
        if not seeds:
            return None
        joints = [binding for binding in self.arm_bindings if binding.qpos_address is not None]
        for binding, value in zip(joints, seeds[0], strict=False):
            np.asarray(self.data.qpos)[binding.qpos_address] = value
        self.mujoco.mj_forward(self.model, self.data)
        result = self.ik.solve(
            target,
            require_orientation=True,
            max_iterations=GRASP_ORIENTATION_MAX_ITERATIONS,
            **{**solve_options, "target_orientation": self.grasp_orientation},
        )
        return result if result.success else None

    def _ik_tolerance_scale(self) -> float:
        return min(1.0, IK_TOLERANCE_REFERENCE_SECONDS / self.command_period)

    def _incremental_orientation(self) -> np.ndarray:
        """Turn the commanded jaw axis toward the grasp axis by at most one step per command."""
        rotation = self._site_rotation()
        current = rotation[:, GRASP_CLOSING_AXIS]
        target = self.grasp_orientation[:, GRASP_CLOSING_AXIS]
        angle = math.acos(float(np.clip(current @ target, -1.0, 1.0)))
        axis_step = max(MIN_AXIS_COMMAND_STEP, MAX_AXIS_COMMAND_SPEED * self.command_period)
        if angle <= axis_step:
            return self.grasp_orientation
        axis = np.cross(current, target)
        if float(np.linalg.norm(axis)) < 1e-9:
            return self.grasp_orientation
        axis /= np.linalg.norm(axis)
        # Rodrigues rotation of the current commanded frame about ``axis`` by one step.
        skew = np.array([[0.0, -axis[2], axis[1]], [axis[2], 0.0, -axis[0]], [-axis[1], axis[0], 0.0]])
        turn = (
            np.eye(3)
            + math.sin(axis_step) * skew
            + (1.0 - math.cos(axis_step)) * (skew @ skew)
        )
        return turn @ rotation

    def _pad_midpoint(self) -> np.ndarray:
        if self.fixed_pad is None or self.moving_pad is None:
            site_id = _model_id(
                self.mujoco,
                self.model,
                self.mujoco.mjtObj.mjOBJ_SITE,
                self.end_effector_site,
                "site",
            )
            return np.asarray(self.data.site_xpos[site_id], dtype=np.float64).copy()
        fixed_id = _model_id(
            self.mujoco,
            self.model,
            self.mujoco.mjtObj.mjOBJ_GEOM,
            self.fixed_pad,
            "geom",
        )
        moving_id = _model_id(
            self.mujoco,
            self.model,
            self.mujoco.mjtObj.mjOBJ_GEOM,
            self.moving_pad,
            "geom",
        )
        return (
            np.asarray(self.data.geom_xpos[fixed_id], dtype=np.float64)
            + np.asarray(self.data.geom_xpos[moving_id], dtype=np.float64)
        ) / 2.0

    def _site_rotation(self) -> np.ndarray:
        site_id = _model_id(
            self.mujoco,
            self.model,
            self.mujoco.mjtObj.mjOBJ_SITE,
            self.end_effector_site,
            "site",
        )
        return np.asarray(self.data.site_xmat[site_id], dtype=np.float64).reshape(3, 3).copy()

    def _source_geom_ids(self) -> set[int]:
        source_body_id = _model_id(
            self.mujoco,
            self.model,
            self.mujoco.mjtObj.mjOBJ_BODY,
            self.source_body,
            "body",
        )
        source_geoms: set[int] = set()
        for geom_id in range(int(self.model.ngeom)):
            body_id = int(self.model.geom_bodyid[geom_id])
            while body_id > 0 and body_id != source_body_id:
                body_id = int(self.model.body_parentid[body_id])
            if body_id == source_body_id:
                source_geoms.add(geom_id)
        return source_geoms

    @contextmanager
    def _local_probe(self) -> Iterator[None]:
        """Restore the local replica, targets, and gripper command after a planning probe."""
        signature = self.mujoco.mjtState.mjSTATE_FULLPHYSICS
        state = np.empty(self.mujoco.mj_stateSize(self.model, signature), dtype=np.float64)
        self.mujoco.mj_getState(self.model, self.data, state, signature)
        targets = dict(self.targets)
        current_gripper_target = self.current_gripper_target
        try:
            yield
        finally:
            self.mujoco.mj_setState(self.model, self.data, state, signature)
            self.mujoco.mj_forward(self.model, self.data)
            self.targets = targets
            self.current_gripper_target = current_gripper_target

    def _face_closing_axes(self) -> list[np.ndarray]:
        """Return the object's horizontal face normals, nearest the current jaw axis first."""
        current_closing = self._site_rotation()[:, GRASP_CLOSING_AXIS]
        source_id = _model_id(self.mujoco, self.model, self.mujoco.mjtObj.mjOBJ_BODY, self.source_body, "body")
        source_axes = np.asarray(self.data.xmat[source_id], dtype=np.float64).reshape(3, 3)
        candidates = []
        for column in (0, 1):
            horizontal = source_axes[:, column].copy()
            horizontal[2] = 0.0
            length = float(np.linalg.norm(horizontal))
            if length > 1e-6:
                candidates.extend((horizontal / length, -horizontal / length))
        return sorted(candidates, key=lambda candidate: -float(candidate @ current_closing))

    def _grasp_orientation(self, face_normal: np.ndarray, tilt: float) -> np.ndarray:
        """Return a grasp orientation whose jaw closing axis squares the pads to ``face_normal``.

        SO-101's wrist-roll axis stays in the shoulder-pan plane, so the fingers can only lean
        radially. They lean outward by ``tilt`` to stay inside the arm's reach, and the closing
        axis is the face normal made perpendicular to that finger direction.
        """
        pan_joint = self.arm_bindings[0].joint_id
        radial = np.zeros(2, dtype=np.float64)
        if pan_joint is not None:
            radial = body_position(self.mujoco, self.model, self.data, self.source_body)[:2] - np.asarray(
                self.data.xanchor[pan_joint], dtype=np.float64
            )[:2]
            radial_length = float(np.linalg.norm(radial))
            radial = radial / radial_length if radial_length > 1e-6 else np.zeros(2)
        fingers = np.array([radial[0] * math.sin(tilt), radial[1] * math.sin(tilt), -math.cos(tilt)])
        closing = face_normal - float(face_normal @ fingers) * fingers
        closing /= np.linalg.norm(closing)
        orientation = np.empty((3, 3), dtype=np.float64)
        orientation[:, GRASP_APPROACH_AXIS] = fingers
        orientation[:, GRASP_CLOSING_AXIS] = closing
        orientation[:, 1] = np.cross(closing, fingers)
        return orientation

    def _plan_grasp(self, source_reference: np.ndarray) -> np.ndarray:
        """Choose the most upright reachable grasp orientation and return its grasp target."""
        return next(self._grasp_plans(source_reference))

    def _grasp_plans(
        self, source_reference: np.ndarray, tried: Sequence[tuple[np.ndarray, float]] = ()
    ) -> Iterator[np.ndarray]:
        """Yield reachable grasp targets, most preferred first, skipping ``tried`` directions.

        Faces nearest the current jaw axis are tried first. The orientation must be reachable at
        the grasp, approach, and lift heights so the wrist does not reorient beside the object.
        Each yield sets :attr:`grasp_orientation`, :attr:`orientation_seeds`, and
        :attr:`grasp_direction`. Raises when no direction is left.
        """
        heights = (0.0, self.approach_height, self.lift_height)
        blocked = False
        directions = [(face, tilt) for face in self._face_closing_axes() for tilt in GRASP_APPROACH_TILTS]
        # Directions whose moving pad only meets the object at its top edge come last.
        edge_directions: list[tuple[np.ndarray, float]] = []
        for allow_edge, candidates in ((False, directions), (True, edge_directions)):
            for face_normal, tilt in candidates:
                if any(
                    abs(tilt - tried_tilt) < 1e-9 and float(face_normal @ tried_normal) > 0.99
                    for tried_normal, tried_tilt in tried
                ):
                    continue
                self.grasp_orientation = self._grasp_orientation(face_normal, tilt)
                self.edge_grasp = False
                grasp_target = self._plan_grasp_target(source_reference, allow_edge=allow_edge)
                if grasp_target is None:
                    if self.edge_grasp:
                        edge_directions.append((face_normal, tilt))
                    else:
                        # The open jaws would land on nearby geometry (a pad, a container wall);
                        # another face pair or tilt puts them on different sides of the object.
                        blocked = True
                    continue
                solutions = []
                for height in heights:
                    waypoint = grasp_target + [0.0, 0.0, height]
                    solution = self._orientation_solution(waypoint)
                    if solution is None:
                        break
                    solutions.append((waypoint, solution))
                else:
                    # Streamed IK follows whichever branch the start pose leads to; these planned
                    # joints re-seed it at a waypoint when that branch cannot hold the orientation.
                    self.orientation_seeds = solutions
                    self.grasp_direction = (face_normal, tilt)
                    yield grasp_target
                    # The caller came back for another direction; the planning state it set
                    # (orientation, seeds) is replaced by the next yield.
        if blocked:
            raise PickPlaceError(
                "grasp_blocked",
                "Every grasp direction puts the open gripper onto nearby geometry; move the object "
                "away from neighboring objects and container walls, or reduce the randomization range.",
            )
        raise PickPlaceError(
            "unreachable",
            "No reachable grasp squares the jaws to the object; move the object closer to the arm "
            "or reduce the randomization range.",
        )

    def _orientation_solution(self, target: np.ndarray) -> np.ndarray | None:
        """Return arm joints that reach ``target`` at the grasp orientation, or None."""
        with self._local_probe():
            result = self.ik.solve(
                target,
                target_orientation=self.grasp_orientation,
                orientation_weight=GRASP_ORIENTATION_WEIGHT,
                require_orientation=True,
                orientation_axes=GRASP_ORIENTATION_AXES,
                position_tolerance=SETTLE_POSITION_TOLERANCE,
                max_iterations=GRASP_ORIENTATION_MAX_ITERATIONS,
                preserve_state=False,
            )
        return np.asarray(result.joint_positions, dtype=np.float64).copy() if result.success else None

    def _plan_grasp_target(self, source_reference: np.ndarray, *, allow_edge: bool = True) -> np.ndarray | None:
        """Plan the end-effector grasp target at the grasp orientation, not the current one.

        The closed-pad offset from the site depends on orientation, so the centered target is
        re-evaluated at the IK grasp pose before the fixed pad is aligned to the object face.
        None when the open jaws cannot clear the environment at this orientation, or, unless
        ``allow_edge``, when the moving pad would close on the object's top edge (sets
        :attr:`edge_grasp`).
        """
        with self._local_probe():
            target = self._site_target(source_reference, 0.0, self.gripper_closed)
            for _ in range(GRASP_PLAN_ITERATIONS):
                self._action_for(target, self.gripper_open, 1.0, rate_limit=False)
                target = self._site_target(source_reference, 0.0, self.gripper_closed)
            # Aligning shifts the target along the closing axis, which has a vertical component at
            # a tilted grasp, and raising changes the IK pose slightly; alternate until the aligned
            # target also clears the support, or the fixed pad lands on it and stalls the descent.
            for _ in range(GRASP_PLAN_ITERATIONS):
                aligned = self._collision_aligned_grasp_target(target)
                target = self._jaw_clear_grasp_target(aligned, allow_edge=allow_edge)
                if target is None:
                    return None
                if float(np.linalg.norm(target - aligned)) <= GRASP_PLAN_POSITION_TOLERANCE:
                    return target
            # Not converged: keep a target that clears the support and is within a millimetre of
            # alignment; a larger miss would put the fixed pad into, or well off, the object.
            if float(np.linalg.norm(self._collision_aligned_grasp_target(target) - target)) <= 0.001:
                return target
            return None

    def _jaw_clear_grasp_target(self, target: np.ndarray, *, allow_edge: bool = True) -> np.ndarray | None:
        """Raise the grasp target until the closing jaws clear the object's support surface.

        The moving jaw closes on an arc that dips below the fixed pad, so a grasp centered on a
        short object can drive the moving pad into the table before it reaches the object. Call
        inside ``_local_probe``: it moves the local replica to each candidate pose. None when no
        height within ``GRASP_MAX_RAISE_STEPS`` clears: descending anyway would drive the jaws into
        that geometry and stall the arm.
        """
        raised = target.copy()
        for _ in range(GRASP_MAX_RAISE_STEPS):
            probe_targets = self._action_for(raised, self.gripper_open, 1.0, rate_limit=False)
            for binding in self.arm_bindings:
                if binding.qpos_address is not None:
                    np.asarray(self.data.qpos)[binding.qpos_address] = probe_targets[binding.action_name]
            sweep = self._jaw_sweep_collides()
            if not sweep:
                return raised
            if sweep == "edge":
                if allow_edge:
                    return raised
                # Raising only moves the pad further up the object.
                self.edge_grasp = True
                return None
            raised = raised + [0.0, 0.0, GRASP_RAISE_STEP]
        return None

    def _jaw_sweep_collides(self) -> str | None:
        """Report how closing from open until the object is touched goes wrong, or None.

        ``"support"`` when a pad hits the environment (raising the grasp may clear it), ``"edge"``
        when the moving pad first meets the object within :data:`GRASP_TOP_EDGE_MARGIN` of its top.
        """
        if self.gripper.qpos_address is None or self.moving_pad is None or self.fixed_pad is None:
            return None
        moving_id = _model_id(self.mujoco, self.model, self.mujoco.mjtObj.mjOBJ_GEOM, self.moving_pad, "geom")
        pads = {
            moving_id,
            _model_id(self.mujoco, self.model, self.mujoco.mjtObj.mjOBJ_GEOM, self.fixed_pad, "geom"),
        }
        source_geoms = self._source_geom_ids()
        robot_root = int(self.model.body_rootid[int(self.model.geom_bodyid[next(iter(pads))])])
        for value in np.linspace(self.gripper_open, self.gripper_closed, GRASP_SWEEP_SAMPLES):
            np.asarray(self.data.qpos)[self.gripper.qpos_address] = value
            self.mujoco.mj_forward(self.model, self.data)
            touched_source = False
            lowest_touch = math.inf
            for contact_index in range(int(self.data.ncon)):
                contact = self.data.contact[contact_index]
                first, second = int(contact.geom1), int(contact.geom2)
                if first not in pads and second not in pads:
                    continue
                pad = first if first in pads else second
                other = second if pad == first else first
                if other in source_geoms:
                    if pad == moving_id:
                        touched_source = True
                        lowest_touch = min(lowest_touch, float(contact.pos[2]))
                elif (
                    int(self.model.body_rootid[int(self.model.geom_bodyid[other])]) != robot_root
                    and float(contact.dist) < 0.0
                ):
                    return "support"
            if touched_source:
                return "edge" if lowest_touch > self._source_top() - GRASP_TOP_EDGE_MARGIN else None
        return None

    def _source_top(self) -> float:
        """World height of the top of the object's collision geometry at the current pose."""
        top = -math.inf
        for geom_id in self._source_geom_ids():
            rotation = np.asarray(self.data.geom_xmat[geom_id]).reshape(3, 3)
            center = np.asarray(self.data.geom_xpos[geom_id]) + rotation @ np.asarray(self.model.geom_aabb[geom_id][:3])
            half = np.asarray(self.model.geom_aabb[geom_id][3:])
            top = max(top, float(center[2] + np.abs(rotation[2]) @ half))
        return top

    def _collision_aligned_grasp_target(self, centered_target: np.ndarray) -> np.ndarray:
        """Shift a centered target along the jaw axis so the fixed pad sits at the object face.

        SO-101 closes one moving jaw against a fixed finger, so the fixed pad, not the pad
        midpoint, must meet the object. The signed pad-to-object distance is measured at the IK
        pose for each candidate target, which stays accurate at any grasp orientation.
        """
        if self.fixed_pad is None:
            return centered_target
        clearance = GRASP_FACE_CLEARANCE
        target = centered_target.copy()
        with self._local_probe():
            for _ in range(GRASP_PLAN_ITERATIONS):
                probe_targets = self._action_for(target, self.gripper_open, 1.0, rate_limit=False)
                for binding in (*self.arm_bindings, self.gripper):
                    if binding.qpos_address is not None:
                        np.asarray(self.data.qpos)[binding.qpos_address] = probe_targets[binding.action_name]
                self.mujoco.mj_forward(self.model, self.data)
                distance = self._fixed_pad_distance()
                if distance is None:
                    break
                error = clearance - distance
                if abs(error) <= GRASP_ALIGNMENT_TOLERANCE:
                    break
                # The object lies along +closing axis from the fixed pad.
                target = target - self._site_rotation()[:, GRASP_CLOSING_AXIS] * error
        return target

    def _fixed_pad_distance(self) -> float | None:
        """Return the signed distance from the fixed pad to the object, negative when overlapping."""
        if self.fixed_pad is None:
            return None
        fixed_id = _model_id(self.mujoco, self.model, self.mujoco.mjtObj.mjOBJ_GEOM, self.fixed_pad, "geom")
        distances = [
            float(self.mujoco.mj_geomDistance(self.model, self.data, fixed_id, geom_id, GRASP_DISTANCE_MAX, None))
            for geom_id in self._source_geom_ids()
            if int(self.model.geom_contype[geom_id]) or int(self.model.geom_conaffinity[geom_id])
        ]
        return min(distances) if distances else None

    def _wait_for_object_to_settle(self) -> bool:
        """Hold the final command until the released object stays quiet for a short interval."""
        dt = self.command_period
        quiet_duration = 0.0
        body_id = _model_id(
            self.mujoco,
            self.model,
            self.mujoco.mjtObj.mjOBJ_BODY,
            self.source_body,
            "body",
        )
        for _ in range(math.ceil(OBJECT_SETTLE_SECONDS / dt)):
            self._send(self.targets)
            # MuJoCo cvel stores angular then linear velocity in the body's local frame.
            velocity = np.asarray(self.data.cvel[body_id], dtype=np.float64)
            linear_speed = float(np.linalg.norm(velocity[3:]))
            angular_speed = float(np.linalg.norm(velocity[:3]))
            if linear_speed <= OBJECT_SETTLE_SPEED and angular_speed <= OBJECT_SETTLE_ANGULAR_SPEED:
                quiet_duration += dt
            else:
                quiet_duration = 0.0
            if quiet_duration >= OBJECT_SETTLE_QUIET_SECONDS:
                return True
        return False

    def _gripper_touches_object(self) -> bool:
        return gripper_touches(
            self.mujoco,
            self.model,
            self.data,
            self.source_body,
            tuple(name for name in (self.fixed_pad, self.moving_pad) if name is not None),
        )

    def _source_footprint_extents(self, container_rotation: np.ndarray) -> np.ndarray:
        """Return conservative source-object half-extents in the container's local frame."""
        return source_footprint_extents(
            self.mujoco, self.model, self.data, self.source_body, container_rotation
        )

    def _container_interior_half_extents(
        self,
        container_position: np.ndarray,
        container_rotation: np.ndarray,
    ) -> np.ndarray | None:
        """Infer a rectangular opening from box walls attached to the container body."""
        return container_interior_half_extents(
            self.mujoco,
            self.model,
            self.data,
            self.container_body,
            container_rotation,
            self.container_site,
        )

    def _assert_placed(self) -> None:
        """Require the released object to be at rest, free of the gripper, and inside the container."""
        settled = self._wait_for_object_to_settle()
        source_position = body_position(self.mujoco, self.model, self.data, self.source_body)
        container_position = body_position(self.mujoco, self.model, self.data, self.container_body)
        container_id = _model_id(
            self.mujoco,
            self.model,
            self.mujoco.mjtObj.mjOBJ_BODY,
            self.container_body,
            "body",
        )
        container_rotation = np.asarray(self.data.xmat[container_id], dtype=np.float64).reshape(3, 3)
        container_local_offset = container_rotation.T @ (source_position - container_position)
        center_offset = np.abs(container_local_offset[:2])
        footprint = self._source_footprint_extents(container_rotation)
        interior_half_extents = self._container_interior_half_extents(container_position, container_rotation)
        outside_center_tolerance = np.any(center_offset > self.placement_half_extents)
        outside_opening = interior_half_extents is not None and np.any(
            center_offset + footprint[:2] > interior_half_extents + OPENING_CONTACT_ALLOWANCE
        )
        if outside_center_tolerance or outside_opening or container_local_offset[2] <= 0.0:
            raise PickPlaceError(
                "placement_failed",
                "The object was released outside the allowed placement area. "
                f"cube={np.round(source_position, 4).tolist()} "
                f"container={np.round(container_position, 4).tolist()} "
                f"allowedHalfExtents={self.placement_half_extents.tolist()} "
                f"objectFootprint={np.round(footprint[:2], 4).tolist()} "
                "containerInterior="
                f"{None if interior_half_extents is None else np.round(interior_half_extents, 4).tolist()}",
            )
        if not settled:
            raise PickPlaceError("placement_failed", "The object was still moving after release.")
        if self._gripper_touches_object():
            raise PickPlaceError("placement_failed", "The gripper was still touching the object after release.")

    def _assert_lifted(self) -> None:
        source_position = body_position(
            self.mujoco,
            self.model,
            self.data,
            self.source_body,
        )
        lift = float(source_position[2] - self.source_initial_position[2])
        required_lift = max(0.001, abs(float(self.lift_height)) * 0.5)
        if lift < required_lift:
            raise PickPlaceError(
                "dropped",
                "The cube did not remain grasped during lift. "
                f"lifted={lift:.4f}m required={required_lift:.4f}m; "
                "check gripper preload, pad contact, and collision friction.",
            )

    def _phase(
        self,
        label: str,
        target_position: np.ndarray,
        gripper_value: float,
        cartesian_step: float,
        steps: int | None = None,
        *,
        stop_on_bilateral_contact: bool = False,
        settle: bool = False,
        reach_target: bool = False,
        position_tolerance: float = SETTLE_POSITION_TOLERANCE,
    ) -> None:
        until_contact_or_closed = stop_on_bilateral_contact and steps is None
        count = 0 if until_contact_or_closed else self.phase_steps if steps is None else steps
        count_label = "until contact or closed" if until_contact_or_closed else str(count)

        def current_target() -> np.ndarray:
            return target_position() if callable(target_position) else target_position

        def arrived() -> bool:
            """Report whether the phase may end: at the target when settling or reaching."""
            if settle and not self._pose_settled(current_target(), position_tolerance):
                return False
            if reach_target and (
                float(np.linalg.norm(self._commanded_end_effector_position() - current_target()))
                > position_tolerance
            ):
                return False
            return True

        self.log(f"{label}: target={np.round(current_target(), 4).tolist()} steps={count_label}")
        self.joint_goal = None
        iteration = 0
        closed_commands = 0
        # Fixed step counts are a minimum; settling and reaching may run this much longer.
        extra_commands = math.ceil(PHASE_SETTLE_SECONDS / self.command_period)
        while until_contact_or_closed or iteration < count or (
            iteration < count + extra_commands and not arrived()
        ):
            targets = self._action_for(
                current_target(),
                gripper_value,
                cartesian_step,
                gripper_step=(
                    min(self.gripper_step, MAX_CONTACT_CLOSE_SPEED * self.command_period)
                    if stop_on_bilateral_contact
                    else None
                ),
            )
            self._send(targets)
            if stop_on_bilateral_contact and self._has_bilateral_pad_contact():
                return
            if until_contact_or_closed and np.isclose(
                self.current_gripper_target,
                gripper_value,
                rtol=0.0,
                atol=1e-9,
            ):
                # The jaw lags its command, most with few physics steps per command; keep
                # holding the closed command until the jaw stops or meets the object.
                closed_commands += 1
                if closed_commands >= extra_commands or self._gripper_stopped():
                    return
            iteration += 1
        if not until_contact_or_closed and not arrived():
            raise PickPlaceError(
                "motion_timeout",
                f"The arm did not reach the '{label}' pose within "
                f"{PHASE_SETTLE_SECONDS:g} extra simulated seconds; the target may be unreachable "
                f"({self._pose_error_summary(current_target())}).",
            )

    def _pose_error_summary(self, target_position: np.ndarray) -> str:
        """Where the arm stopped relative to the phase target, for timeout messages."""
        actual = float(np.linalg.norm(self._end_effector_position() - target_position))
        commanded = float(np.linalg.norm(self._commanded_end_effector_position() - target_position))
        rotation = self._site_rotation()
        axis_error = max(
            math.degrees(
                math.acos(float(np.clip(rotation[:, axis] @ self.grasp_orientation[:, axis], -1.0, 1.0)))
            )
            for axis in GRASP_ORIENTATION_AXES
        )
        qvel = np.asarray(self.data.qvel)
        speed = max(
            (
                abs(float(qvel[int(self.model.jnt_dofadr[binding.joint_id])]))
                for binding in self.arm_bindings
                if binding.joint_id is not None
            ),
            default=0.0,
        )
        contacts = sorted(self._arm_contacts())
        return (
            f"position error {actual * 1000:.1f} mm (commanded {commanded * 1000:.1f} mm), "
            f"jaw axis {axis_error:.1f} deg, joint speed {speed:.3f} rad/s"
            + (f", touching {', '.join(contacts)}" if contacts else "")
        )

    def _arm_contacts(self) -> set[str]:
        """Names of non-robot bodies the arm touches (the object, the table, the container)."""
        robot_root = None
        if self.fixed_pad is not None:
            pad = _model_id(self.mujoco, self.model, self.mujoco.mjtObj.mjOBJ_GEOM, self.fixed_pad, "geom")
            robot_root = int(self.model.body_rootid[int(self.model.geom_bodyid[pad])])
        names: set[str] = set()
        for index in range(int(self.data.ncon)):
            contact = self.data.contact[index]
            roots = [int(self.model.body_rootid[int(self.model.geom_bodyid[int(g)])]) for g in (contact.geom1, contact.geom2)]
            if robot_root is None or robot_root not in roots:
                continue
            other = roots[1] if roots[0] == robot_root else roots[0]
            if other == robot_root:
                continue
            geom = int(contact.geom2) if roots[0] == robot_root else int(contact.geom1)
            robot_geom = int(contact.geom1) if roots[0] == robot_root else int(contact.geom2)
            robot_part = self.model.geom(robot_geom).name or self.model.body(int(self.model.geom_bodyid[robot_geom])).name
            names.add(f"{self.model.body(other).name or self.model.geom(geom).name or 'world'} ({robot_part}, {float(contact.dist) * 1000:.1f} mm)")
        return names

    def _gripper_stopped(self) -> bool:
        if self.gripper.joint_id is None:
            return True
        speed = abs(float(np.asarray(self.data.qvel)[int(self.model.jnt_dofadr[self.gripper.joint_id])]))
        return speed <= SETTLE_MAX_JOINT_SPEED

    def _pose_settled(
        self,
        target_position: np.ndarray,
        position_tolerance: float = SETTLE_POSITION_TOLERANCE,
    ) -> bool:
        """Report whether the end effector is at the target pose and the arm has stopped."""
        if float(np.linalg.norm(self._end_effector_position() - target_position)) > position_tolerance:
            return False
        rotation = self._site_rotation()
        for axis in GRASP_ORIENTATION_AXES:
            alignment = float(np.clip(rotation[:, axis] @ self.grasp_orientation[:, axis], -1.0, 1.0))
            if math.acos(alignment) > SETTLE_AXIS_TOLERANCE:
                return False
        qvel = np.asarray(self.data.qvel)
        for binding in self.arm_bindings:
            if binding.joint_id is not None:
                speed = abs(float(qvel[int(self.model.jnt_dofadr[binding.joint_id])]))
                if speed > SETTLE_MAX_JOINT_SPEED:
                    return False
        return True

    def _has_bilateral_pad_contact(self) -> bool:
        if self.fixed_pad is None or self.moving_pad is None:
            return False
        source_geoms = self._source_geom_ids()
        fixed_id = _model_id(self.mujoco, self.model, self.mujoco.mjtObj.mjOBJ_GEOM, self.fixed_pad, "geom")
        moving_id = _model_id(self.mujoco, self.model, self.mujoco.mjtObj.mjOBJ_GEOM, self.moving_pad, "geom")
        contacted: set[int] = set()
        for contact_index in range(int(self.data.ncon)):
            contact = self.data.contact[contact_index]
            if float(contact.dist) < -MAX_GRASP_PENETRATION:
                continue
            first, second = int(contact.geom1), int(contact.geom2)
            if first in source_geoms and second in {fixed_id, moving_id}:
                contacted.add(second)
            if second in source_geoms and first in {fixed_id, moving_id}:
                contacted.add(first)
        return contacted == {fixed_id, moving_id}

    def run(self) -> None:
        """Run one attempt; raise :class:`PickPlaceError` when a quality gate fails."""
        source_reference = self._reference_position(self.source_body, self.source_site).copy()
        container_reference = self._reference_position(self.container_body, self.container_site).copy()
        self._grasp_with_retries(source_reference)
        # The jaw axis only matters while the pads meet the object. Holding a world-fixed jaw
        # axis while the shoulder pans toward the container folds the elbow into its limit.
        self.hold_orientation = False
        self._via_phase(
            "transfer via point",
            self._commanded_end_effector_position(),
            self._carried_object_target(container_reference, self.lift_height),
            self.variation.transfer_via_offset,
        )
        self._phase(
            "move above container",
            lambda: self._carried_object_target(container_reference, self.lift_height),
            self.grasp_gripper_target,
            self.travel_step,
            reach_target=True,
        )
        try:
            self._phase(
                "lower into container",
                lambda: self._carried_object_target(container_reference, self.lower_height),
                self.grasp_gripper_target,
                self.descend_step,
                reach_target=True,
            )
        except PickPlaceError as error:
            carried = body_position(self.mujoco, self.model, self.data, self.source_body)
            beside = float(np.linalg.norm(carried[:2] - container_reference[:2]))
            if error.reason != "motion_timeout" or beside > RELEASE_ABOVE_CONTAINER_LIMIT:
                raise
            # Over the container but short of the lowering height (edge of reach): release
            # from here; the placement check below still requires the object to land inside.
            self.log(f"lower into container: stopped {beside * 1000:.0f} mm off centre; releasing")
        release_target = self._commanded_end_effector_position()
        self._phase(
            "release cube",
            release_target,
            self.gripper_release,
            self.descend_step,
            self.release_steps,
        )
        self._phase(
            "retreat",
            release_target + [0.0, 0.0, self.lift_height - self.lower_height],
            self.gripper_open,
            self.travel_step,
        )
        if self.return_to_start:
            self._return_to_start()
        self._assert_placed()

    def _grasp_with_retries(self, source_reference: np.ndarray) -> np.ndarray:
        """Approach, descend, close on, and lift the object; return the grasp target that held.

        A grasp whose approach or descent stalls (the arm cannot reach the pose, often a jaw
        resting on the object's edge), that closes without both pads on the object, or whose lift
        leaves the object behind is retried from another direction, up to
        :data:`MAX_GRASP_ATTEMPTS` attempts: the gripper opens, rises, and the grasp is re-planned
        from the object's current pose.
        """
        tried: list[tuple[np.ndarray, float]] = []
        plans = self._grasp_plans(source_reference)
        last_failure: PickPlaceError | None = None
        while True:
            # Plan the aligned grasp before approaching so the descent is vertical: approaching
            # above the centered target and then shifting sideways drags the fixed pad across the
            # top edge.
            try:
                grasp_target = next(plans)
            except PickPlaceError:
                # No other direction is left: report why the last grasp failed.
                if last_failure is not None:
                    raise last_failure from None
                raise
            assert self.grasp_direction is not None
            tried.append(self.grasp_direction)
            try:
                self._attempt_grasp(grasp_target)
                return grasp_target
            except PickPlaceError as error:
                if error.reason not in RETRYABLE_GRASP_FAILURES or len(tried) >= MAX_GRASP_ATTEMPTS:
                    raise
                last_failure = error
            # From a stalled descent, rise by the approach height; after a failed lift, stay at
            # most that high above the grasp.
            back_off = self._commanded_end_effector_position()
            back_off[2] = min(back_off[2] + self.approach_height, grasp_target[2] + self.lift_height)
            self._phase("back off for another grasp", back_off, self.gripper_open, self.travel_step)
            source_reference = self._reference_position(self.source_body, self.source_site).copy()
            plans = self._grasp_plans(source_reference, tried)

    def _attempt_grasp(self, grasp_target: np.ndarray) -> None:
        # Settle above the object so the wrist finishes reorienting before the pads descend.
        approach_target = grasp_target + [0.0, 0.0, self.approach_height]
        self._via_phase(
            "approach via point",
            self._commanded_end_effector_position(),
            approach_target,
            self.variation.approach_via_offset,
        )
        self._phase(
            "open and approach cube",
            approach_target,
            self.gripper_open,
            self.travel_step,
            settle=True,
        )
        # The fixed pad is planned to sit within a clearance of a millimeter or two from the face,
        # so the grasp pose needs sub-millimeter accuracy before the jaw closes.
        self._phase(
            "descend to cube",
            grasp_target,
            self.gripper_open,
            self.descend_step,
            settle=True,
            position_tolerance=GRASP_POSITION_TOLERANCE,
        )
        self._dwell(self.variation.grasp_dwell_seconds)
        self._phase(
            "close gripper",
            grasp_target,
            self.gripper_closed,
            self.descend_step,
            stop_on_bilateral_contact=True,
        )
        if not self._has_bilateral_pad_contact():
            raise PickPlaceError(
                "grasp_failed",
                "The gripper did not establish bilateral contact with the source cube. "
                "Check the object size and collision geometry.",
            )
        self.grasp_gripper_target = self.current_gripper_target
        self._phase(
            "lift cube",
            grasp_target + [0.0, 0.0, self.lift_height],
            self.grasp_gripper_target,
            self.lift_step,
            reach_target=True,
        )
        self._assert_lifted()

    def _return_to_start(self) -> None:
        """Drive the arm and gripper back to the episode's start pose, then wait for the arm to stop.

        The move is a straight line in joint space: the start pose is a known collision-free
        configuration, and the retreat has already lifted the gripper clear of the container.
        """
        names = [binding.action_name for binding in self.arm_bindings]
        start = np.array([self.start_targets[name] for name in names], dtype=np.float64)
        gripper_start = clamp(self.start_targets[self.gripper.action_name], self.gripper.control_range)
        self.log(f"return to start: joints={np.round(start, 4).tolist()} gripper={gripper_start:.4f}")
        extra_commands = math.ceil(PHASE_SETTLE_SECONDS / self.command_period)
        settle_commands = 0
        while True:
            current = np.array([self.targets[name] for name in names], dtype=np.float64)
            delta = start - current
            largest = float(np.max(np.abs(delta))) if delta.size else 0.0
            if largest > self.return_joint_step:
                # Scale uniformly so every joint arrives together.
                delta *= self.return_joint_step / largest
            for binding, value in zip(self.arm_bindings, current + delta, strict=True):
                self.targets[binding.action_name] = clamp(float(value), binding.control_range)
            self.current_gripper_target += float(
                np.clip(gripper_start - self.current_gripper_target, -self.gripper_step, self.gripper_step)
            )
            self.targets[self.gripper.action_name] = clamp(self.current_gripper_target, self.gripper.control_range)
            self._send(self.targets)
            commanded = largest <= self.return_joint_step and math.isclose(
                self.current_gripper_target, gripper_start, rel_tol=0.0, abs_tol=1e-9
            )
            if not commanded:
                continue
            if self._at_start_pose():
                return
            settle_commands += 1
            if settle_commands >= extra_commands:
                raise PickPlaceError(
                    "return_failed",
                    f"The arm did not settle at its start pose within {PHASE_SETTLE_SECONDS:g} extra "
                    "simulated seconds after placing the object.",
                )

    def _at_start_pose(self) -> bool:
        """Report whether every arm joint and the gripper are at rest near their start commands."""
        qpos = np.asarray(self.data.qpos)
        qvel = np.asarray(self.data.qvel)
        for binding in (*self.arm_bindings, self.gripper):
            if binding.qpos_address is None or binding.joint_id is None:
                continue
            target = clamp(self.start_targets[binding.action_name], binding.control_range)
            if abs(float(qpos[binding.qpos_address]) - target) > RETURN_POSITION_TOLERANCE:
                return False
            if abs(float(qvel[int(self.model.jnt_dofadr[binding.joint_id])])) > SETTLE_MAX_JOINT_SPEED:
                return False
        return True

    def _end_effector_position(self) -> np.ndarray:
        site_id = _model_id(
            self.mujoco,
            self.model,
            self.mujoco.mjtObj.mjOBJ_SITE,
            self.end_effector_site,
            "site",
        )
        return np.asarray(self.data.site_xpos[site_id], dtype=np.float64).copy()

    def _commanded_end_effector_position(self) -> np.ndarray:
        """Return the end-effector position the current joint commands would reach."""
        with self._local_probe():
            for binding in self.arm_bindings:
                if binding.qpos_address is not None:
                    np.asarray(self.data.qpos)[binding.qpos_address] = self.targets[binding.action_name]
            self.mujoco.mj_forward(self.model, self.data)
            return self._end_effector_position()

    def _carried_object_target(self, reference: np.ndarray, z_offset: float) -> np.ndarray:
        """Return the end-effector target that places the held object's center over ``reference``.

        SO-101 closes one moving jaw against a fixed finger, so the held object sits against the
        fixed pad rather than at the pad midpoint. Using the measured object-to-end-effector
        offset, which is fixed while the object is held, keeps placement centered regardless of
        where the object settled between the jaws. Feeding back the lagging object position
        itself would wind up and overshoot.
        """
        carried = body_position(self.mujoco, self.model, self.data, self.source_body)
        target = reference - (carried - self._end_effector_position())
        target[2] += z_offset + self.grasp_height
        return target


def prepare_controller(
    client: ControlTarget,
    mujoco: Any,
    task: PickPlaceTask = PickPlaceTask(),
    tuning: PickPlaceTuning = PickPlaceTuning(),
    *,
    log: Logger | None = None,
) -> PickPlaceController:
    """Settle at the home pose, synchronize the local replica, and build a controller."""
    tuning.validate()
    if tuning.home_pose is not None:
        home_snapshot = move_to_home_pose(
            client,
            mujoco,
            tuning.home_pose,
            physics_steps=tuning.home_physics_steps,
        )
    else:
        home_snapshot = set_default_home_pose(
            client,
            wrist_roll_degrees=tuning.home_wrist_roll_degrees,
            physics_steps=tuning.home_physics_steps,
            mujoco=mujoco,
        )
    # step() does not refresh the local replica, and the controller latches its initial targets and
    # grasp orientation from it, so synchronize before building the controller.
    client.local.synchronize(home_snapshot)
    return PickPlaceController(client, mujoco, task, tuning, log=log)


def run_pick_and_place(
    client: ControlTarget,
    mujoco: Any,
    task: PickPlaceTask = PickPlaceTask(),
    tuning: PickPlaceTuning = PickPlaceTuning(),
    *,
    log: Logger | None = None,
) -> None:
    """Run one attempt from the current state without starting or stopping a recording."""
    prepare_controller(client, mujoco, task, tuning, log=log).run()


def record_episode(
    client: ControlTarget,
    mujoco: Any,
    task: PickPlaceTask = PickPlaceTask(),
    tuning: PickPlaceTuning = PickPlaceTuning(),
    *,
    state_id: str | None = None,
    vary: bool = True,
    log: Logger | None = None,
) -> EpisodeOutcome:
    """Record one attempt and save it only when every quality gate passes.

    The selected state is restored first, so repeated calls start from the same scene. With
    ``vary`` (the default) the attempt samples a :class:`PickPlaceVariation` from the recording's
    seed and saves it with the episode, so repeated calls record different demonstrations. A
    failed attempt is discarded and returned as an unsaved :class:`EpisodeOutcome` with its reason.
    Transport and programming errors are raised.
    """
    if state_id is not None:
        client.select_initial_state(state_id)
    else:
        client.local.synchronize(client.current_state)
    active_state = state_id or str(getattr(client.current_state, "state_id", "current"))
    overlaps = find_initial_overlaps(mujoco, client.local.model, client.local.data)
    if overlaps:
        return EpisodeOutcome(
            active_state,
            saved=False,
            reason="initial_overlap",
            message=" ".join([*(overlap.describe() for overlap in overlaps), overlaps[0].hint()]),
        )
    recording = False
    attempt_seed: int | None = None
    try:
        controller = prepare_controller(client, mujoco, task, tuning, log=log)
        client.start_recording()
        recording = True
        attempt = getattr(client, "recording_attempt", None)
        metadata: dict[str, Any] | None = None
        if vary and attempt is not None:
            attempt_seed = int(attempt.seed)
            variation = PickPlaceVariation.sample(attempt_seed)
            controller.apply_variation(variation)
            metadata = {"controller": "so101-pick-place", "variation": variation.to_dict()}
        controller.run()
        episode = (
            client.stop_recording(save=True, metadata=metadata)
            if metadata is not None
            else client.stop_recording(save=True)
        )
        recording = False
    except PickPlaceError as error:
        if recording and not client.command_outcome_unknown:
            client.discard_recording()
        return EpisodeOutcome(
            active_state, saved=False, reason=error.reason, message=str(error), attempt_seed=attempt_seed
        )
    except BaseException:
        if recording and not client.command_outcome_unknown:
            try:
                client.discard_recording()
            except Exception as cleanup_error:  # noqa: BLE001 - preserve the original failure.
                (log or _ignore)(f"Could not discard the failed recording: {cleanup_error}")
        raise
    if episode is None:
        return EpisodeOutcome(active_state, saved=False, reason="empty", message="The recording had no frames.")
    return EpisodeOutcome(
        active_state,
        saved=True,
        episode_id=str(episode.get("episodeId")),
        frame_count=int(episode.get("frameCount") or 0),
        control_mode=episode.get("controlMode"),
        attempt_seed=attempt_seed,
    )
