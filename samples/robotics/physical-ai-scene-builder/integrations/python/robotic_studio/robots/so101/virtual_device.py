# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""A virtual SO-101 follower: a Feetech servo bus whose joints are a simulated SO-101 arm.

Physical AI Studio (or any LeRobot ``SO101Follower``) opens a serial port and talks to six STS3215
servos emulated by :mod:`.feetech_bus`. This module couples the servos to a Physical AI Scene
Builder Simulate session through :class:`~robotic_studio.environment.StudioEnvironment`:

* Present_Position reports the simulated joint angle (encoder center = simulation zero).
* With torque enabled, Goal_Position (plus Homing_Offset) becomes the joint's position target.
* With torque disabled the arm holds still unless a hand-guide target moves it, standing in for
  moving a limp arm by hand during calibration.

The serial side runs in :mod:`.tty_relay`, launched where the client looks for the port (see
:mod:`robotic_studio.device_relay`), so it appears there as ``/dev/ttyACM<n>``. The relay
answers packets from its own copy of the servos, as fast as a USB adapter; this process keeps that
copy in step (encoder positions, host register writes) and mirrors the registers clients change.
Scene cameras are exposed separately by :mod:`robotic_studio.virtual_camera`.

Status is printed as JSON lines on stdout; JSON-line commands are read from stdin.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess  # nosec B404 
import sys
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from ...device_relay import add_target_arguments, relay_command_prefix
from . import feetech_bus, tty_relay
from .adapter import SO101_GRIPPER_RANGE_RAD, SO101_JOINT_RANGES_RAD
from .feetech_bus import (
    ADDR_GOAL_POSITION,
    ADDR_HOMING_OFFSET,
    ADDR_MAX_POSITION_LIMIT,
    ADDR_MIN_POSITION_LIMIT,
    RESOLUTION,
    FeetechBus,
    VirtualServo,
    encode_sign_magnitude,
    radians_to_ticks,
    ticks_to_radians,
)

SO101_SERVOS = (
    (1, "shoulder_pan"),
    (2, "shoulder_lift"),
    (3, "elbow_flex"),
    (4, "wrist_flex"),
    (5, "wrist_roll"),
    (6, "gripper"),
)
# Control-table bytes kept across restarts, like a real servo's EEPROM (ID, limits, homing, mode).
PERSISTED_REGISTERS = slice(0, 40)
RESETTABLE_ERRORS = frozenset({"EPISODE_TERMINATED", "EPISODE_INVALID"})
# LeRobot's half-turn homing puts the pose the arm was centered in at this Present_Position.
HALF_TURN = RESOLUTION // 2 - 1
DEFAULT_LIMITS_RAD = {**SO101_JOINT_RANGES_RAD, "gripper": SO101_GRIPPER_RANGE_RAD}


@dataclass(frozen=True)
class ServoCalibration:
    """What LeRobot's calibration stores in a servo: Homing_Offset and the position limits."""

    homing_offset: int
    range_min: int
    range_max: int

    @property
    def is_factory_default(self) -> bool:
        # Physical AI Studio's setup treats exactly these values as "not calibrated".
        return self.homing_offset == 0 and self.range_min == 0 and self.range_max == RESOLUTION - 1


# Homing offset of the default calibration: the simulation's zero pose reads as the half turn.
DEFAULT_HOMING_OFFSET = radians_to_ticks(0.0) - HALF_TURN
MAX_HOMING_OFFSET = 2047  # Homing_Offset is 11-bit sign-magnitude.


def simulation_calibration(low: float, high: float) -> ServoCalibration:
    """The calibration a perfect manual run yields: centered at simulation zero, swept limit to limit."""
    offset = DEFAULT_HOMING_OFFSET
    ticks = sorted(min(max(radians_to_ticks(value) - offset, 0), RESOLUTION - 1) for value in (low, high))
    return ServoCalibration(offset, ticks[0], ticks[1])


def parse_calibration(value: Any) -> dict[str, ServoCalibration]:
    """Reads a LeRobot SO-101 calibration (``{joint: {id, drive_mode, homing_offset, range_min, range_max}}``).

    A ``{"calibration": {...}}`` wrapper is accepted too.
    """
    if isinstance(value, Mapping) and isinstance(value.get("calibration"), Mapping):
        value = value["calibration"]
    if not isinstance(value, Mapping):
        raise VirtualDeviceError("The calibration must be a JSON object with one entry per SO-101 joint.")
    result: dict[str, ServoCalibration] = {}
    for servo_id, joint in SO101_SERVOS:
        entry = value.get(joint)
        if not isinstance(entry, Mapping):
            raise VirtualDeviceError(f"The calibration has no entry for '{joint}'.")
        fields = {}
        for key in ("homing_offset", "range_min", "range_max"):
            number = entry.get(key)
            if isinstance(number, bool) or not isinstance(number, int):
                raise VirtualDeviceError(f"'{joint}.{key}' must be an integer.")
            fields[key] = number
        if "id" in entry and entry["id"] != servo_id:
            raise VirtualDeviceError(f"'{joint}.id' must be {servo_id}.")
        if entry.get("drive_mode", 0) != 0:
            raise VirtualDeviceError(f"'{joint}.drive_mode' must be 0; inverted servos are not supported.")
        if abs(fields["homing_offset"]) > MAX_HOMING_OFFSET:
            raise VirtualDeviceError(f"'{joint}.homing_offset' must be between -2047 and 2047.")
        if not 0 <= fields["range_min"] < fields["range_max"] <= RESOLUTION - 1:
            raise VirtualDeviceError(f"'{joint}' needs 0 <= range_min < range_max <= 4095.")
        result[joint] = ServoCalibration(**fields)
    return result


class VirtualDeviceError(RuntimeError):
    pass


def _suffix(name: str) -> str:
    return name.rsplit("__", 1)[-1]


def _prefix(name: str) -> str:
    return name[: -len(_suffix(name))]


@dataclass(frozen=True)
class JointBinding:
    joint: str
    state_index: int
    scale: float
    offset: float
    action_index: int
    input_range: tuple[float, float] | None
    control_range: tuple[float, float] | None

    def radians(self, state: Sequence[float]) -> float:
        scale = self.scale or 1.0
        return (float(state[self.state_index]) - self.offset) / scale

    def action_value(self, radians: float) -> float:
        value = radians
        if self.control_range is not None:
            low, high = self.control_range
            value = min(max(value, low), high)
            if self.input_range is not None and high != low:
                in_low, in_high = self.input_range
                value = in_low + (value - low) / (high - low) * (in_high - in_low)
        elif self.input_range is not None:
            value = min(max(value, self.input_range[0]), self.input_range[1])
        return value


class SimulationBinding:
    """Maps the six SO-101 joints onto an external-control description's state and actions."""

    def __init__(self, description: Mapping[str, Any], robot: str | None = None) -> None:
        actions = list(description.get("actions", []))
        state = list(description.get("state", []))
        joints = {name for _, name in SO101_SERVOS}
        prefixes = sorted(
            {
                _prefix(str(field["name"]))
                for field in state
                if _suffix(str(field["name"])) in joints and field.get("source", {}).get("kind") == "qpos"
            }
        )
        if robot is not None:
            prefix = robot if robot == "" or robot.endswith("__") else f"{robot}__"
            if prefix not in prefixes:
                raise VirtualDeviceError(f"No SO-101 named '{robot}' in this scene.")
        elif len(prefixes) == 1:
            prefix = prefixes[0]
        elif not prefixes:
            raise VirtualDeviceError("This scene has no SO-101 arm joints to drive.")
        else:
            names = ", ".join(item.rstrip("_") or "(unnamed)" for item in prefixes)
            raise VirtualDeviceError(f"This scene has several SO-101 arms ({names}); choose one.")
        self.prefix = prefix
        self.action_count = len(actions)
        self.joints: dict[str, JointBinding] = {}
        for _, joint in SO101_SERVOS:
            name = prefix + joint
            state_index = next(
                (
                    index
                    for index, field in enumerate(state)
                    if field.get("name") == name and field.get("source", {}).get("kind") == "qpos"
                ),
                None,
            )
            action_index = next(
                (index for index, field in enumerate(actions) if field.get("source", {}).get("name") == name),
                None,
            )
            if state_index is None or action_index is None:
                raise VirtualDeviceError(f"The scene's SO-101 is missing a joint or actuator named '{name}'.")
            state_field, action_field = state[state_index], actions[action_index]

            def pair(value: Any) -> tuple[float, float] | None:
                return (float(value[0]), float(value[1])) if value else None

            self.joints[joint] = JointBinding(
                joint=joint,
                state_index=state_index,
                scale=float(state_field.get("scale", 1.0)),
                offset=float(state_field.get("offset", 0.0)),
                action_index=action_index,
                input_range=pair(action_field.get("inputRange")),
                control_range=pair(action_field.get("controlRange")),
            )
        self._fallback = [self._neutral(field) for field in actions]

    @staticmethod
    def _neutral(field: Mapping[str, Any]) -> float:
        value_range = field.get("inputRange") or field.get("controlRange")
        if not value_range:
            return 0.0
        return float(min(max(0.0, value_range[0]), value_range[1]))

    def joint_limits(self) -> dict[str, tuple[float, float]]:
        """Each joint's simulated range in radians (the actuator's control range)."""
        return {
            joint: binding.control_range or DEFAULT_LIMITS_RAD[joint] for joint, binding in self.joints.items()
        }

    def joint_radians(self, state: Sequence[float]) -> dict[str, float]:
        return {joint: binding.radians(state) for joint, binding in self.joints.items()}

    def action(self, targets: Mapping[str, float]) -> np.ndarray:
        values = list(self._fallback)
        for joint, binding in self.joints.items():
            values[binding.action_index] = binding.action_value(targets[joint])
        return np.asarray(values, dtype=np.float32)


class VirtualSO101:
    """Six virtual servos plus the targets they impose on the simulated arm (thread-safe)."""

    def __init__(self, state_file: Path | None = None) -> None:
        self.lock = threading.Lock()
        self.bus = FeetechBus(VirtualServo(servo_id) for servo_id, _ in SO101_SERVOS)
        self.names = {servo_id: name for servo_id, name in SO101_SERVOS}
        self.state_file = state_file
        self._guides: dict[str, float] = {}
        self._default_calibration: dict[str, ServoCalibration] = {}
        self._file_calibration: dict[str, ServoCalibration] | None = None
        # Encoder ticks between the simulation's raw angle and the emulated encoder, per joint. A
        # loaded calibration sets it so the file's centered pose (half turn) is the simulation's zero.
        self._mount = {name: 0 for name in self.names.values()}
        self._persisted = self._eeprom()
        # Forwards host register writes (index, address, data) to the serial-facing copy.
        self.on_write: Callable[[int, int, bytes], None] | None = None
        if state_file is not None and state_file.exists():
            self._load(state_file)

    def _eeprom(self) -> dict[str, Any]:
        return {
            **{
                self.names.get(index + 1, str(servo.servo_id)): list(servo.registers[PERSISTED_REGISTERS])
                for index, servo in enumerate(self.bus.servos)
            },
            "mount": dict(self._mount),
        }

    def _load(self, path: Path) -> None:
        try:
            saved = json.loads(path.read_text())
        except (OSError, ValueError):
            return
        for index, servo in enumerate(self.bus.servos):
            registers = saved.get(self.names[index + 1])
            if isinstance(registers, list) and len(registers) == PERSISTED_REGISTERS.stop:
                servo.registers[PERSISTED_REGISTERS] = bytes(int(value) & 0xFF for value in registers)
                servo.servo_id = servo.registers[5]
                # Torque starts off after a power cycle.
                servo.registers[40] = 0
        mount = saved.get("mount")
        if isinstance(mount, Mapping):
            for joint in self.names.values():
                if isinstance(mount.get(joint), int):
                    self._mount[joint] = mount[joint]
        self._persisted = self._eeprom()

    def save_if_changed(self) -> None:
        with self.lock:
            current = self._eeprom()
            if current == self._persisted or self.state_file is None:
                return
            self._persisted = current
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_file.with_suffix(".tmp")
        temporary.write_text(json.dumps(current))
        os.replace(temporary, self.state_file)

    def load_message(self) -> dict[str, Any]:
        """The relay's start state: every register file and encoder position."""
        with self.lock:
            return {
                "type": "load",
                "servos": [bytes(servo.registers).hex() for servo in self.bus.servos],
                "ticks": [servo.actual_ticks for servo in self.bus.servos],
            }

    def actual_ticks(self) -> list[int]:
        with self.lock:
            return [servo.actual_ticks for servo in self.bus.servos]

    def apply_report(self, report: Mapping[str, Any]) -> None:
        """Mirrors registers the relay reports changed (by clients, or after host writes)."""
        with self.lock:
            for index, registers in report.get("servos", {}).items():
                servo = self.bus.servos[int(index)]
                servo.registers[:] = bytes.fromhex(registers)
                servo.servo_id = servo.registers[feetech_bus.ADDR_ID]
            self.bus.packets_handled = int(report.get("packets", self.bus.packets_handled))

    def _host_write(self, servo: VirtualServo, address: int, data: bytes) -> None:
        servo.write(address, list(data))
        if self.on_write is not None:
            self.on_write(self.bus.servos.index(servo), address, data)

    @staticmethod
    def _calibration(servo: VirtualServo) -> ServoCalibration:
        return ServoCalibration(
            servo.homing_offset,
            int.from_bytes(servo.registers[ADDR_MIN_POSITION_LIMIT : ADDR_MIN_POSITION_LIMIT + 2], "little"),
            int.from_bytes(servo.registers[ADDR_MAX_POSITION_LIMIT : ADDR_MAX_POSITION_LIMIT + 2], "little"),
        )

    def _write_calibration(self, joint: str, servo: VirtualServo, calibration: ServoCalibration) -> None:
        """Loads a calibration as if the arm were that physical arm, keeping the simulated pose and goal."""
        mount = calibration.homing_offset - DEFAULT_HOMING_OFFSET
        shift = mount - self._mount[joint]
        self._mount[joint] = mount
        servo.actual_ticks = (servo.actual_ticks + shift) % RESOLUTION
        # Keep the goal's angle so a torqued joint does not jump.
        goal_ticks = (servo.goal_ticks + shift) % RESOLUTION
        offset = encode_sign_magnitude(calibration.homing_offset, 11)
        self._host_write(servo, ADDR_HOMING_OFFSET, offset.to_bytes(2, "little"))
        self._host_write(servo, ADDR_MIN_POSITION_LIMIT, calibration.range_min.to_bytes(2, "little"))
        self._host_write(servo, ADDR_MAX_POSITION_LIMIT, calibration.range_max.to_bytes(2, "little"))
        goal = encode_sign_magnitude((goal_ticks - calibration.homing_offset) % RESOLUTION, 15)
        self._host_write(servo, ADDR_GOAL_POSITION, goal.to_bytes(2, "little"))

    def _apply(self, calibration: Mapping[str, ServoCalibration]) -> None:
        for index, servo in enumerate(self.bus.servos):
            joint = self.names[index + 1]
            self._write_calibration(joint, servo, calibration[joint])

    def set_joint_limits(
        self,
        limits: Mapping[str, tuple[float, float]],
        file_calibration: Mapping[str, ServoCalibration] | None = None,
    ) -> None:
        """Records the simulated joint ranges and loads the starting calibration.

        A calibration file wins; otherwise a never-calibrated device gets the default (simulation)
        calibration, and calibration written over the serial port earlier is kept.
        """
        with self.lock:
            self._default_calibration = {
                joint: simulation_calibration(*limits[joint]) for joint in self.names.values()
            }
            if file_calibration is not None:
                self._file_calibration = dict(file_calibration)
                self._apply(self._file_calibration)
            elif all(self._calibration(servo).is_factory_default for servo in self.bus.servos):
                self._apply(self._default_calibration)

    def use_default_calibration(self) -> None:
        with self.lock:
            if not self._default_calibration:
                raise VirtualDeviceError("The simulated joint ranges are not known yet.")
            self._file_calibration = None
            self._apply(self._default_calibration)

    def use_file_calibration(self, calibration: Mapping[str, ServoCalibration]) -> None:
        with self.lock:
            self._file_calibration = dict(calibration)
            self._apply(self._file_calibration)

    def calibration_state(self) -> str:
        """``default`` or ``file`` when the servos hold that calibration, ``custom`` when a client
        wrote another one over the serial port, ``none`` for factory values."""
        with self.lock:
            current = {self.names[index + 1]: self._calibration(servo) for index, servo in enumerate(self.bus.servos)}
        if self._file_calibration is not None and current == self._file_calibration:
            return "file"
        if self._default_calibration and current == self._default_calibration:
            return "default"
        if all(value.is_factory_default for value in current.values()):
            return "none"
        return "custom"

    def sync(self, radians: Mapping[str, float]) -> None:
        with self.lock:
            self.bus.set_actual_ticks(
                [
                    radians_to_ticks(radians[self.names[index + 1]]) + self._mount[self.names[index + 1]]
                    for index in range(len(self.bus.servos))
                ]
            )

    def guide(self, targets: Mapping[str, float]) -> None:
        with self.lock:
            for joint, value in targets.items():
                if joint in self.names.values() and math.isfinite(float(value)):
                    self._guides[joint] = float(value)

    def targets(self, measured: Mapping[str, float]) -> dict[str, float]:
        """Position targets for the simulated joints, in radians."""
        result = {}
        with self.lock:
            for index, servo in enumerate(self.bus.servos):
                joint = self.names[index + 1]
                if servo.torque_enabled:
                    self._guides.pop(joint, None)
                    result[joint] = ticks_to_radians((servo.goal_ticks - self._mount[joint]) % RESOLUTION)
                else:
                    # Latch the pose when torque drops; following the measured angle would sag.
                    result[joint] = self._guides.setdefault(joint, measured[joint])
        return result

    def snapshot(self, measured: Mapping[str, float]) -> list[dict[str, Any]]:
        with self.lock:
            return [
                {
                    "id": servo.servo_id,
                    "name": self.names[index + 1],
                    "torque": servo.torque_enabled,
                    "position": servo.present_position,
                    "goal": servo.goal_position,
                    "homingOffset": servo.homing_offset,
                    "rangeMin": self._calibration(servo).range_min,
                    "rangeMax": self._calibration(servo).range_max,
                    "radians": round(measured.get(self.names[index + 1], 0.0), 5),
                }
                for index, servo in enumerate(self.bus.servos)
            ]


# Runs tty_relay with feetech_bus as its sibling module, from source passed on the command line, so
# the container needs only a Python interpreter and no copy of this package.
_RELAY_BOOTSTRAP = """
import sys, types
package = types.ModuleType("virtual_so101")
package.__path__ = []
sys.modules["virtual_so101"] = package
for name, source in (("feetech_bus", sys.argv[1]), ("tty_relay", sys.argv[2])):
    module = types.ModuleType("virtual_so101." + name)
    module.__package__ = "virtual_so101"
    sys.modules[module.__name__] = module
    exec(compile(source, name + ".py", "exec"), module.__dict__)
sys.exit(sys.modules["virtual_so101.tty_relay"].main(sys.argv[3:]))
"""


class SerialRelay:
    """Runs :mod:`.tty_relay` (locally or via a command prefix) and keeps its servos in step."""

    def __init__(
        self,
        device: VirtualSO101,
        command_prefix: Sequence[str],
        python: str,
        relay_args: Sequence[str] = (),
        on_event: Callable[[dict[str, Any]], None] = lambda _event: None,
    ) -> None:
        self.device = device
        self.on_event = on_event
        sources = [Path(module.__file__).read_text() for module in (feetech_bus, tty_relay)]
        self.process = subprocess.Popen(
            [*command_prefix, python, "-u", "-c", _RELAY_BOOTSTRAP, *sources, *relay_args],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        self._send_lock = threading.Lock()
        self.device_path: str | None = None
        self.ready = threading.Event()
        self.failed: str | None = None
        self._send(device.load_message())
        device.on_write = self.send_write
        threading.Thread(target=self._mirror, daemon=True).start()
        threading.Thread(target=self._watch, daemon=True).start()

    def _send(self, message: Mapping[str, Any]) -> None:
        assert self.process.stdin is not None
        line = (json.dumps(message) + "\n").encode()
        with self._send_lock:
            try:
                self.process.stdin.write(line)
            except (BrokenPipeError, ValueError):
                # The relay is gone; the main loop notices through `alive`.
                pass

    def send_ticks(self, ticks: Sequence[int]) -> None:
        self._send({"type": "ticks", "values": [int(value) for value in ticks]})

    def send_write(self, index: int, address: int, data: bytes) -> None:
        self._send({"type": "write", "index": index, "address": address, "data": list(data)})

    def _mirror(self) -> None:
        assert self.process.stdout is not None
        for raw in self.process.stdout:
            try:
                report = json.loads(raw)
            except ValueError:
                continue
            if isinstance(report, dict) and report.get("type") == "registers":
                self.device.apply_report(report)

    def _watch(self) -> None:
        assert self.process.stderr is not None
        for raw in self.process.stderr:
            line = raw.decode(errors="replace").strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except ValueError:
                event = {"type": "log", "message": line}
            if event.get("type") == "ready":
                self.device_path = str(event.get("device"))
                self.ready.set()
            elif event.get("type") == "error":
                self.failed = str(event.get("message"))
            self.on_event(event)
        if not self.ready.is_set():
            self.failed = self.failed or f"The serial relay exited with code {self.process.wait()}."
            self.ready.set()

    def wait_ready(self, timeout_s: float) -> str:
        if not self.ready.wait(timeout_s):
            raise VirtualDeviceError("The serial relay did not report a device in time.")
        if self.failed or self.device_path is None:
            raise VirtualDeviceError(self.failed or "The serial relay did not report a device.")
        return self.device_path

    @property
    def alive(self) -> bool:
        return self.process.poll() is None

    def close(self, timeout_s: float = 3.0) -> None:
        self.device.on_write = None
        if self.process.stdin is not None:
            with self._send_lock:
                try:
                    self.process.stdin.close()
                except OSError:
                    pass
        try:
            self.process.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=timeout_s)
            except subprocess.TimeoutExpired:
                self.process.kill()


def _emit(message: Mapping[str, Any]) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def _read_commands(device: VirtualSO101, stop: threading.Event) -> None:
    for line in sys.stdin:
        try:
            command = json.loads(line)
        except ValueError:
            continue
        if command.get("type") == "guide" and isinstance(command.get("joints"), Mapping):
            device.guide({str(key): float(value) for key, value in command["joints"].items()})
        elif command.get("type") == "calibrate":
            try:
                if command.get("mode") == "file":
                    device.use_file_calibration(parse_calibration(command.get("calibration")))
                else:
                    device.use_default_calibration()
            except VirtualDeviceError as error:
                _emit({"type": "log", "message": str(error)})
        elif command.get("type") == "stop":
            break
    stop.set()


def run(args: argparse.Namespace) -> int:
    from robotic_studio.environment import RemoteEvaluationError, StudioEnvironment

    stop = threading.Event()
    device = VirtualSO101(Path(args.state_file) if args.state_file else None)
    file_calibration = None
    if args.calibration_file:
        try:
            file_calibration = parse_calibration(json.loads(Path(args.calibration_file).read_text()))
        except (OSError, ValueError, VirtualDeviceError) as error:
            _emit({"type": "error", "message": f"The calibration file could not be loaded: {error}"})
            return 1
    environment = StudioEnvironment.connect(args.studio_url, timeout_s=args.timeout)
    relay: SerialRelay | None = None
    try:
        environment.wait_for_studio(timeout_s=args.timeout, acquire=True)
        description = environment.describe()
        binding = SimulationBinding(description, args.robot)
        device.set_joint_limits(binding.joint_limits(), file_calibration)
        observation, _ = environment.reset()
        measured = binding.joint_radians(observation.state)
        device.sync(measured)
        prefix = relay_command_prefix(args)
        relay_args = ["--link", args.link] if args.link else []
        if args.helper_image:
            # On this computer the port belongs to the app's user, who need not be in dialout.
            relay_args += ["--owner-uid", str(os.getuid())]
        relay = SerialRelay(device, prefix, args.relay_python, relay_args, on_event=_emit)
        device_path = relay.wait_ready(args.timeout)
        _emit(
            {
                "type": "ready",
                "device": device_path,
                "robot": binding.prefix.rstrip("_") or None,
            }
        )
        threading.Thread(target=_read_commands, args=(device, stop), daemon=True).start()

        period = 1.0 / args.rate
        timestep = float(description.get("timestep") or 0.002)
        physics_steps = max(1, min(1000, round(period / timestep)))
        next_tick = time.monotonic()
        next_status = 0.0
        while not stop.is_set():
            if not relay.alive:
                raise VirtualDeviceError("The serial relay stopped.")
            action = binding.action(device.targets(measured))
            try:
                observation = environment.step(action, physics_steps)
            except RemoteEvaluationError as error:
                if error.code not in RESETTABLE_ERRORS:
                    raise
                observation, _ = environment.reset()
            measured = binding.joint_radians(observation.state)
            device.sync(measured)
            relay.send_ticks(device.actual_ticks())
            now = time.monotonic()
            if now >= next_status:
                device.save_if_changed()
                _emit(
                    {
                        "type": "status",
                        "device": device_path,
                        "simulationTime": observation.simulation_time,
                        "packets": device.bus.packets_handled,
                        "calibration": device.calibration_state(),
                        "servos": device.snapshot(measured),
                    }
                )
                next_status = now + 0.25
            next_tick = max(next_tick + period, now)
            stop.wait(max(0.0, next_tick - time.monotonic()))
    except VirtualDeviceError as error:
        _emit({"type": "error", "message": str(error)})
        return 1
    except Exception as error:
        _emit({"type": "error", "message": f"{type(error).__name__}: {error}"})
        return 1
    finally:
        device.save_if_changed()
        if relay is not None:
            relay.close()
        environment.close()
        _emit({"type": "stopped"})
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="robotic-studio-virtual-so101",
        description="Expose the simulated SO-101 in a Simulate session as a Feetech serial device.",
    )
    parser.add_argument("--studio-url", default="http://127.0.0.1:3000")
    add_target_arguments(parser)
    parser.add_argument("--link", help="Exact device path to create (default: next free /dev/ttyACM<n>).")
    parser.add_argument("--robot", help="Scene robot name prefix when the scene has several SO-101 arms.")
    parser.add_argument("--state-file", help="Where to keep servo settings (calibration) across restarts.")
    parser.add_argument("--calibration-file", help="LeRobot SO-101 calibration JSON to load at start.")
    parser.add_argument("--rate", type=float, default=30.0, help="Simulation update rate in Hz.")
    parser.add_argument("--timeout", type=float, default=20.0)
    args = parser.parse_args(argv)
    if not 1.0 <= args.rate <= 200.0:
        parser.error("--rate must be between 1 and 200 Hz.")
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
