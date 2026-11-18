# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Control a SO-101 end effector with keyboard input.

The Generate page must already have a saved scene, an active teleoperation session, and a running
viewport stream. The public ``robotic_studio.teleoperation.Teleoperation`` client discovers the
session, compiles the local scene mirror, sends complete named actuator targets, and synchronizes
the local IK model from every authoritative snapshot.

Controls use world axes:

    w / s       +X / -X
    a / d       +Y / -Y
    r / f       +Z / -Z
    space       toggle the gripper open / closed
    ?           print the controls
    q / Escape  quit

Before running, open a saved SO-101 scene in **Generate** and click **Start streaming**. Then,
from the extracted control examples, in an interactive terminal (Linux or macOS):

    uv run --locked --extra teleoperation python so101/keyboard.py --connection-file connection.json

Recording starts with the first movement and is saved when you quit. Every command is one dataset
frame at the session's capture rate (30 FPS by default). Motion is physics-only by default, so
recordings are eligible for training.
"""

from __future__ import annotations

import argparse
import math
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, TextIO

import numpy as np

try:
    import termios
    import tty
except ModuleNotFoundError:  # pragma: no cover - exercised on non-POSIX hosts.
    termios = None  # type: ignore[assignment]
    tty = None  # type: ignore[assignment]

from robotic_studio.frame_clock import FrameClock, capture_fps_from_profile
from robotic_studio.generation.ik import DampedLeastSquaresIK
from robotic_studio.robots.bindings import ActionBinding, clamp, resolve_action_bindings
from robotic_studio.robots.cli import (
    Reporter,
    add_connection_arguments,
    add_verbose_argument,
    connect,
    require_mujoco,
)
from robotic_studio.robots.so101 import SO101

# In physics-only mode, keep stepping after each key until the arm stops, up to this long.
SETTLE_MAX_SECONDS = 0.5
SETTLE_MAX_JOINT_SPEED = 0.05


MOVEMENT_DELTAS: dict[str, tuple[float, float, float]] = {
    "w": (1.0, 0.0, 0.0),
    "s": (-1.0, 0.0, 0.0),
    "a": (0.0, 1.0, 0.0),
    "d": (0.0, -1.0, 0.0),
    "r": (0.0, 0.0, 1.0),
    "f": (0.0, 0.0, -1.0),
}
HELP_KEY = "?"
QUIT_KEYS = {"q", "\x1b", "\x03", "esc", "escape"}


def movement_delta(key: str, step_size: float) -> np.ndarray | None:
    """Return the world-space translation for one key, or None for a non-movement key."""
    direction = MOVEMENT_DELTAS.get(key.lower())
    if direction is None:
        return None
    return np.asarray(direction, dtype=np.float64) * step_size


def print_controls() -> None:
    print(
        "Controls: W/S = +X/-X, A/D = +Y/-Y, R/F = +Z/-Z, "
        "Space = toggle gripper, ? = help, Q/Escape = quit."
    )


class TerminalInput:
    """Read single characters while restoring the caller's terminal mode on exit."""

    def __init__(self, stream: TextIO | None = None, *, configure: bool = True) -> None:
        self.stream = stream or sys.stdin
        self.configure = configure
        self._fd: int | None = None
        self._original_attributes: list[Any] | None = None

    def __enter__(self) -> "TerminalInput":
        if not self.configure:
            return self
        if termios is None or tty is None:
            raise RuntimeError("Keyboard teleoperation requires a POSIX terminal with termios support.")
        if not self.stream.isatty():
            raise RuntimeError("Keyboard teleoperation requires an interactive terminal (TTY).")
        try:
            self._fd = self.stream.fileno()
            self._original_attributes = termios.tcgetattr(self._fd)
            tty.setcbreak(self._fd)
        except Exception:
            if self._fd is not None and self._original_attributes is not None:
                termios.tcsetattr(self._fd, termios.TCSADRAIN, self._original_attributes)
            self._fd = None
            self._original_attributes = None
            raise
        return self

    def __exit__(self, _exception_type: Any, _exception: Any, _traceback: Any) -> None:
        if self.configure and self._fd is not None and self._original_attributes is not None:
            restore_error: BaseException | None = None
            try:
                flush = getattr(termios, "tcflush", None)
                if flush is not None:
                    flush(self._fd, termios.TCIFLUSH)
            except BaseException as error:  # noqa: BLE001 - preserve the original controller error.
                restore_error = error
            try:
                termios.tcsetattr(self._fd, termios.TCSADRAIN, self._original_attributes)
            except BaseException as error:  # noqa: BLE001 - preserve the original controller error.
                restore_error = restore_error or error
            finally:
                self._fd = None
                self._original_attributes = None
            if restore_error is not None and _exception_type is None:
                raise restore_error

    def read_key(self) -> str:
        return self.stream.read(1)


class KeyboardTeleoperator:
    def __init__(
        self,
        client: Any,
        mujoco: Any,
        model: Any,
        data: Any,
        bindings: Sequence[ActionBinding],
        *,
        end_effector_site: str,
        arm_joints: Sequence[str] | None,
        gripper_action: str | None,
        step_size: float = 0.005,
        fps: int | None = None,
        ik_max_joint_delta: float = 0.10,
        gripper_open: float | None = None,
        gripper_closed: float | None = None,
        recording_active: bool = False,
        enable_recording: bool = True,
    ) -> None:
        if not np.isfinite(step_size) or step_size <= 0:
            raise ValueError("step_size must be a positive finite number.")
        if not np.isfinite(ik_max_joint_delta) or ik_max_joint_delta <= 0:
            raise ValueError("ik_max_joint_delta must be a positive finite number.")

        self.client = client
        self.mujoco = mujoco
        self.model = model
        self.data = data
        self.end_effector_site = end_effector_site
        self.arm_bindings = SO101.resolve_arm_bindings(bindings, arm_joints)
        self.gripper = SO101.resolve_gripper_binding(bindings, gripper_action)
        self.step_size = float(step_size)
        # One command per dataset frame, on the session's capture-rate grid.
        self.clock = FrameClock(
            fps if fps is not None else capture_fps_from_profile(getattr(client, "profile", None)),
            float(model.opt.timestep),
        )
        self.enable_recording = enable_recording
        self.recording_owned = False
        self.ik = DampedLeastSquaresIK(
            model,
            data,
            [binding.joint_name for binding in self.arm_bindings if binding.joint_name is not None],
            end_effector_site,
            max_joint_delta=ik_max_joint_delta,
        )
        self.targets = self._current_targets(bindings)
        self.joint_targets = self._current_joint_targets(bindings)
        self.gripper_open_target, self.gripper_closed_target = self._gripper_targets(
            gripper_open,
            gripper_closed,
        )
        self.gripper_is_open = self._current_gripper_position() >= (
            self.gripper_open_target + self.gripper_closed_target
        ) / 2.0
        self.recording_active = recording_active

    def _current_targets(self, bindings: Sequence[ActionBinding]) -> dict[str, float]:
        values: dict[str, float] = {}
        for binding in bindings:
            values[binding.action_name] = float(np.asarray(self.data.ctrl)[binding.actuator_id])
        return values

    def _current_joint_targets(self, bindings: Sequence[ActionBinding]) -> dict[str, float]:
        return {
            binding.action_name: float(np.asarray(self.data.qpos)[binding.qpos_address])
            for binding in bindings
            if binding.qpos_address is not None
        }

    def _current_gripper_position(self) -> float:
        if self.gripper.qpos_address is not None:
            return float(np.asarray(self.data.qpos)[self.gripper.qpos_address])
        return float(np.asarray(self.data.ctrl)[self.gripper.actuator_id])

    def _gripper_targets(
        self,
        gripper_open: float | None,
        gripper_closed: float | None,
    ) -> tuple[float, float]:
        if self.gripper.control_range is None and (gripper_open is None or gripper_closed is None):
            raise ValueError(
                "The gripper actuator has no control range; pass both --gripper-open and "
                "--gripper-closed."
            )
        for value, label in ((gripper_open, "gripper_open"), (gripper_closed, "gripper_closed")):
            if value is not None and not np.isfinite(value):
                raise ValueError(f"{label} must be finite.")
        lower, upper = self.gripper.control_range or (0.0, 0.0)
        open_target = clamp(upper if gripper_open is None else gripper_open, self.gripper.control_range)
        closed_target = clamp(
            lower if gripper_closed is None else gripper_closed,
            self.gripper.control_range,
        )
        if open_target == closed_target:
            raise ValueError("The gripper open and closed targets must be different.")
        if open_target < closed_target:
            raise ValueError("The gripper open target must be greater than the closed target.")
        return open_target, closed_target

    def _ensure_recording(self) -> None:
        if self.recording_active or not self.enable_recording:
            return
        self.client.start_recording()
        self.recording_active = True
        self.recording_owned = True
        print("Recording started.")

    def _step_once(self) -> None:
        snapshot = self.client.step(
            actuators=dict(self.targets),
            physics_steps=self.clock.next_physics_steps(),
        )
        self.client.local.synchronize(snapshot)

    def _arm_moving(self) -> bool:
        qvel = np.asarray(self.data.qvel)
        dof_addresses = getattr(self.model, "jnt_dofadr", None)
        if dof_addresses is None:
            return False
        return any(
            abs(float(qvel[int(dof_addresses[binding.joint_id])])) > SETTLE_MAX_JOINT_SPEED
            for binding in (*self.arm_bindings, self.gripper)
            if binding.joint_id is not None
        )

    def _send(self) -> None:
        self._step_once()
        # Physics only advances on commands, so let the servos catch up to the new target.
        for _ in range(math.ceil(SETTLE_MAX_SECONDS * self.clock.fps)):
            if not self._arm_moving():
                break
            self._step_once()
        for binding in (*self.arm_bindings, self.gripper):
            if binding.qpos_address is not None:
                self.joint_targets[binding.action_name] = float(
                    np.asarray(self.data.qpos)[binding.qpos_address]
                )

    def _move(self, delta: np.ndarray) -> bool:
        site_id = int(self.model.site(self.end_effector_site).id)
        # Move relative to the commanded pose, not a measured pose that may still lag it.
        for binding in self.arm_bindings:
            if binding.qpos_address is not None:
                np.asarray(self.data.qpos)[binding.qpos_address] = self.targets[binding.action_name]
        self.mujoco.mj_forward(self.model, self.data)
        current_position = np.asarray(self.data.site_xpos[site_id], dtype=np.float64).copy()
        result = self.ik.solve(
            current_position + delta,
            position_tolerance=min(0.0015, self.step_size * 0.25),
            preserve_state=False,
        )
        if not result.success:
            print("That position is out of reach.")
            return False
        for binding, value in zip(self.arm_bindings, result.joint_positions, strict=True):
            target = clamp(float(value), binding.control_range)
            self.targets[binding.action_name] = target
            self.joint_targets[binding.action_name] = target
        self._ensure_recording()
        self._send()
        return True

    def _toggle_gripper(self) -> bool:
        next_is_open = not self.gripper_is_open
        target = clamp(
            self.gripper_open_target if next_is_open else self.gripper_closed_target,
            self.gripper.control_range,
        )
        self.targets[self.gripper.action_name] = target
        if self.gripper.qpos_address is not None:
            self.joint_targets[self.gripper.action_name] = target
        self._ensure_recording()
        self._send()
        self.gripper_is_open = next_is_open
        print("Gripper opened." if next_is_open else "Gripper closed.")
        return True

    def handle_key(self, key: str) -> str:
        """Handle one input character and return its category for the input loop."""
        if not key:
            return "quit"
        normalized = key.lower()
        if normalized in QUIT_KEYS or normalized.startswith("\x1b"):
            return "quit"
        if normalized == HELP_KEY:
            print_controls()
            return "help"
        if normalized == " ":
            self._toggle_gripper()
            return "gripper"
        delta = movement_delta(normalized, self.step_size)
        if delta is None:
            return "ignored"
        self._move(delta)
        return "movement"


def run_keyboard_loop(operator: KeyboardTeleoperator, terminal: TerminalInput) -> None:
    while True:
        if operator.handle_key(terminal.read_key()) == "quit":
            return


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Move the SO-101 gripper with the keyboard and record a demonstration.")
    add_connection_arguments(parser)
    parser.add_argument("--step-size", type=float, default=0.005, help="Distance per key press in metres (default: 0.005).")
    parser.add_argument("--no-record", action="store_true", help="Move the robot without recording an episode.")
    add_verbose_argument(parser)
    # Advanced options, not shown in --help.
    parser.add_argument("--end-effector-site", default=SO101.end_effector_site, help=argparse.SUPPRESS)
    parser.add_argument("--arm-joints", nargs="+", help=argparse.SUPPRESS)
    parser.add_argument("--gripper-action", help=argparse.SUPPRESS)
    parser.add_argument("--gripper-open", type=float, help=argparse.SUPPRESS)
    parser.add_argument("--gripper-closed", type=float, help=argparse.SUPPRESS)
    parser.add_argument("--fps", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--ik-max-joint-delta", type=float, default=0.10, help=argparse.SUPPRESS)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    arguments = build_parser().parse_args(argv)
    if arguments.step_size <= 0:
        raise SystemExit("--step-size must be positive.")
    if arguments.fps is not None and arguments.fps < 1:
        raise SystemExit("--fps must be positive.")
    if arguments.ik_max_joint_delta <= 0:
        raise SystemExit("--ik-max-joint-delta must be positive.")
    report = Reporter(verbose=arguments.verbose)
    mujoco = require_mujoco()
    client = connect(arguments, default_scene_bundle=Path(__file__).resolve().parent.parent / "scene.mujoco-scene")
    operator: KeyboardTeleoperator | None = None
    normal_exit = False
    try:
        profile = client.profile
        if not isinstance(profile, Mapping):
            raise RuntimeError("Teleoperation describe did not return a profile.")
        model = client.local.model
        data = client.local.data
        bindings = resolve_action_bindings(mujoco, model, profile)
        end_effector_site = SO101.resolve_end_effector_site(
            mujoco,
            model,
            override=arguments.end_effector_site,
        )

        initial_snapshot = client.current_state
        client.local.synchronize(initial_snapshot)
        report.info(f"Connected to Physical AI Scene Builder (scene state {initial_snapshot.state_id}).")
        report.debug(f"session={client.session_id} qpos={model.nq} qvel={model.nv} ctrl={model.nu}")
        operator = KeyboardTeleoperator(
            client,
            mujoco,
            model,
            data,
            bindings,
            end_effector_site=end_effector_site,
            arm_joints=arguments.arm_joints,
            gripper_action=arguments.gripper_action,
            step_size=arguments.step_size,
            fps=arguments.fps,
            ik_max_joint_delta=arguments.ik_max_joint_delta,
            gripper_open=arguments.gripper_open,
            gripper_closed=arguments.gripper_closed,
            recording_active=client.recording,
            enable_recording=not arguments.no_record,
        )
        print_controls()
        print("Keyboard teleoperation ready.")
        with TerminalInput() as terminal:
            run_keyboard_loop(operator, terminal)
        normal_exit = True
    finally:
        if operator is not None and operator.recording_owned and client.lease_id is not None:
            if not client.command_outcome_unknown:
                if normal_exit:
                    try:
                        episode = client.stop_recording()
                        operator.recording_active = False
                        operator.recording_owned = False
                        if episode is not None:
                            print(f"Saved episode with {episode.get('frameCount')} frames.")
                        else:
                            print("Recording stopped without frames; nothing was committed.")
                    except Exception as error:  # noqa: BLE001 - report cleanup failures.
                        print(f"Could not save the keyboard recording: {error}")
                        if not client.command_outcome_unknown:
                            try:
                                client.discard_recording()
                            except RuntimeError:
                                pass
                else:
                    try:
                        client.discard_recording()
                    except Exception as error:  # noqa: BLE001 - report cleanup failures.
                        print(f"Could not discard the interrupted recording: {error}")
        if client.lease_id is not None and not client.command_outcome_unknown:
            try:
                client.release()
            except Exception as error:  # noqa: BLE001 - report cleanup failures.
                print(f"Could not release the teleoperation lease: {error}")
        client.close()


if __name__ == "__main__":
    main()
