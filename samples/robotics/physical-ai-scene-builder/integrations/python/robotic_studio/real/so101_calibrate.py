# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""``robotic-studio-so101-calibrate``: capture and check the SO-101 sim-to-real bridge.

All flows read the follower with torque disabled; the operator poses the arm by hand.

* ``check``   - pose the Studio home pose and compare per-joint readings (pass: all within 3 deg).
* ``capture`` - pose home, then the "ready" pose (every body joint moved about 45 deg in its
  positive Studio direction); writes zero offsets and joint signs.
* ``gripper`` - close then open the gripper fully; writes the gripper scale and offset.
"""

from __future__ import annotations

import argparse
import json
import math
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..robots.so101.calibration import CalibrationError, JointBridge, So101Bridge, file_sha256

CHECK_TOLERANCE_DEG = 3.0
# A joint must move at least this far between the home and ready poses to infer its sign.
MIN_SIGN_MOTION_DEG = 10.0
READY_POSE_MOTION_DEG = 45.0

PositionReader = Callable[[], Mapping[str, float]]
Prompt = Callable[[str], str]
Output = Callable[[str], None]


def _load_hardware() -> tuple[Any, Any]:
    try:
        from lerobot.robots.so_follower import SOFollower, SOFollowerRobotConfig
    except ModuleNotFoundError as error:
        raise CalibrationError(
            "SO-101 calibration requires the hardware extra: uv sync --extra hardware."
        ) from error
    return SOFollower, SOFollowerRobotConfig


def default_lerobot_calibration_path(robot_id: str) -> Path | None:
    """LeRobot's calibration file for an ``so_follower`` with this id, if LeRobot is installed."""
    try:
        from lerobot.utils.constants import HF_LEROBOT_CALIBRATION, ROBOTS
    except ModuleNotFoundError:
        return None
    return Path(HF_LEROBOT_CALIBRATION) / ROBOTS / "so_follower" / f"{robot_id}.json"


def _disable_torque(robot: Any) -> None:
    for name in ("disable_torque", "torque_off"):
        method = getattr(robot, name, None)
        if callable(method):
            method()
            return
    motors = getattr(robot, "bus", None) or getattr(robot, "motors_bus", None)
    method = getattr(motors, "disable_torque", None)
    if callable(method):
        method()
        return
    raise CalibrationError(
        "The connected LeRobot follower does not expose torque disable; refusing to read until torque is off."
    )


def read_follower_positions(port: str, robot_id: str) -> dict[str, float]:
    """Connect without re-calibrating, disable torque, read ``<joint>.pos`` degrees, disconnect."""
    SOFollower, SOFollowerRobotConfig = _load_hardware()
    robot = SOFollower(
        SOFollowerRobotConfig(
            port=port,
            id=robot_id,
            use_degrees=True,
            disable_torque_on_disconnect=True,
        )
    )
    connected = False
    try:
        robot.connect(calibrate=False)
        connected = True
        _disable_torque(robot)
        observation = robot.get_observation()
        return {
            name: float(observation[f"{name}.pos"])
            for name in (*So101Bridge.JOINTS, "gripper")
            if f"{name}.pos" in observation
        }
    finally:
        if connected:
            robot.disconnect()


def home_pose_rad() -> dict[str, float]:
    """Studio home pose in simulation radians: mid-range joints, wrist roll at the adapter home."""
    from ..robots.so101.adapter import SO101

    return {
        name: math.radians(SO101.home_wrist_roll_degrees) if name == "wrist_roll" else 0.0
        for name in So101Bridge.JOINTS
    }


def home_expected_deg(bridge: So101Bridge) -> dict[str, float]:
    """Real-arm readings (LeRobot degrees) expected at the Studio home pose through ``bridge``."""
    home = home_pose_rad()
    return {
        name: bridge.joints[name].sign * (home[name] + bridge.joints[name].zero_offset_rad) * 180.0 / math.pi
        for name in So101Bridge.JOINTS
    }


def check_bridge(bridge: So101Bridge, measured: Mapping[str, float], output: Output) -> bool:
    expected = home_expected_deg(bridge)
    passed = True
    for name in So101Bridge.JOINTS:
        residual = float(measured[name]) - expected[name]
        passed = passed and abs(residual) <= CHECK_TOLERANCE_DEG
        output(
            f"{name:16} expected={expected[name]:7.2f} deg measured={float(measured[name]):7.2f} deg "
            f"residual={residual:+6.2f} deg"
        )
    return passed


def capture_bridge(home: Mapping[str, float], ready: Mapping[str, float]) -> dict[str, JointBridge]:
    """Joint signs from the home -> ready motion, and zero offsets that make home residuals zero."""
    home_rad = home_pose_rad()
    joints: dict[str, JointBridge] = {}
    unmoved = []
    for name in So101Bridge.JOINTS:
        motion = float(ready[name]) - float(home[name])
        if abs(motion) < MIN_SIGN_MOTION_DEG:
            unmoved.append(f"{name} ({motion:+.1f} deg)")
            continue
        sign = 1 if motion > 0 else -1
        # Solve home_real = sign * (q_home + zero) * 180/pi for zero (1/sign == sign).
        joints[name] = JointBridge(sign=sign, zero_offset_rad=sign * math.radians(float(home[name])) - home_rad[name])
    if unmoved:
        raise CalibrationError(
            f"Move every joint at least {MIN_SIGN_MOTION_DEG:.0f} deg for the ready pose; too little motion: "
            + ", ".join(unmoved)
        )
    return joints


def gripper_mapping(closed: float, opened: float) -> tuple[float, float]:
    """Scale and offset so policy 0 maps to the closed reading and 100 to the open reading."""
    if math.isclose(opened, closed, abs_tol=1e-6):
        raise CalibrationError("Gripper calibration failed: closed and open readings are identical.")
    return (opened - closed) / 100.0, closed


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _write(path: Path, value: Mapping[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def run(
    args: argparse.Namespace,
    *,
    read_positions: PositionReader,
    prompt: Prompt = input,
    output: Output = print,
) -> int:
    """Run one calibration flow. Hardware access is injected so the flows can be tested."""
    bridge = (
        So101Bridge.load(args.bridge)
        if args.bridge.exists()
        else So101Bridge({name: JointBridge() for name in So101Bridge.JOINTS})
    )
    calibration_path: Path | None = args.calibration
    calibration_digest = (
        file_sha256(calibration_path) if calibration_path is not None and calibration_path.is_file() else None
    )
    if calibration_path is not None and calibration_digest is None:
        output(f"Warning: LeRobot calibration file {calibration_path} was not found; its hash is not recorded.")

    if args.command == "gripper":
        prompt("With torque disabled, close the gripper fully by hand, then press Enter.")
        closed = float(read_positions()["gripper"])
        prompt("Open the gripper fully by hand, then press Enter.")
        opened = float(read_positions()["gripper"])
        scale, offset = gripper_mapping(closed, opened)
        value = bridge.to_dict()
        value.update({"robotId": args.robot_id, "gripper": {"scale": scale, "offset": offset}, "measuredAt": _now()})
        if calibration_digest is not None:
            value["lerobotCalibrationSha256"] = calibration_digest
        _write(args.out, value)
        output(f"Wrote gripper calibration to {args.out}.")
        return 0

    if args.command == "check" and calibration_digest is not None and bridge.lerobot_calibration_sha256 not in (
        None,
        calibration_digest,
    ):
        output(
            "Warning: the LeRobot calibration changed since this bridge was captured "
            f"({bridge.lerobot_calibration_sha256} != {calibration_digest}). Re-run capture."
        )
    prompt("With torque disabled, pose the follower at the Studio home pose, then press Enter.")
    measured = read_positions()
    if args.command == "check":
        if check_bridge(bridge, measured, output):
            output(f"Calibration check passed (all residuals <= {CHECK_TOLERANCE_DEG:.0f} degrees).")
            return 0
        output(f"Calibration check failed: one or more joints exceed {CHECK_TOLERANCE_DEG:.0f} degrees.")
        return 1

    prompt(
        f"Now the ready pose: move every body joint about {READY_POSE_MOTION_DEG:.0f} degrees in its positive "
        "Studio direction (for example elbow and wrist bent), then press Enter."
    )
    ready = read_positions()
    joints = capture_bridge(measured, ready)
    captured = So101Bridge(
        joints,
        gripper_scale=bridge.gripper_scale,
        gripper_offset=bridge.gripper_offset,
        lerobot_calibration_sha256=calibration_digest or bridge.lerobot_calibration_sha256,
        document={**bridge.document, "robotId": args.robot_id, "measuredAt": _now()},
    )
    _write(args.out, captured.to_dict())
    output(f"Wrote bridge calibration to {args.out}.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="robotic-studio-so101-calibrate",
        description="Capture and check the SO-101 sim-to-real bridge (torque stays disabled).",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("check", "Compare the home pose with the bridge (pass: every joint within 3 degrees)."),
        ("capture", "Capture zero offsets and joint signs from the home and ready poses."),
        ("gripper", "Capture the gripper closed/open mapping."),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--port", required=True, help="Follower serial port, e.g. /dev/ttyACM0.")
        command.add_argument("--robot-id", required=True, help="LeRobot follower id used by lerobot-calibrate.")
        command.add_argument("--bridge", type=Path, default=Path("so101_bridge.json"))
        command.add_argument(
            "--calibration",
            type=Path,
            default=None,
            help="LeRobot calibration JSON (default: LeRobot's so_follower/<robot-id>.json).",
        )
        if name in {"capture", "gripper"}:
            command.add_argument("--out", type=Path, default=Path("so101_bridge.calibrated.json"))
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command in {"capture", "gripper"} and args.out.resolve() == args.bridge.resolve():
        parser.error("--out must differ from --bridge so calibration doesn't overwrite its input.")
    if args.calibration is None:
        args.calibration = default_lerobot_calibration_path(args.robot_id)
    try:
        code = run(args, read_positions=lambda: read_follower_positions(args.port, args.robot_id), prompt=input)
    except CalibrationError as error:
        raise SystemExit(str(error)) from error
    raise SystemExit(code)
