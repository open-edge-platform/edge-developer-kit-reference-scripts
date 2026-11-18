# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Feetech STS3215 servo bus emulation (protocol 0), with no I/O.

Implements the subset of the Feetech serial protocol that LeRobot's ``FeetechMotorsBus`` and the
``scservo_sdk`` use: PING (including broadcast), READ, WRITE, REG_WRITE/ACTION, SYNC_READ and
SYNC_WRITE. Multi-byte values are little-endian, as on STS-series servos.

Packets: ``FF FF id length instruction params... checksum`` where ``length = len(params) + 2``
and ``checksum = ~(id + length + instruction + sum(params)) & 0xFF``. Status packets carry an
error byte in place of the instruction.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

BROADCAST_ID = 0xFE
INST_PING = 0x01
INST_READ = 0x02
INST_WRITE = 0x03
INST_REG_WRITE = 0x04
INST_ACTION = 0x05
INST_SYNC_READ = 0x82
INST_SYNC_WRITE = 0x83

STS3215_MODEL_NUMBER = 777
RESOLUTION = 4096
CENTER = RESOLUTION // 2
FIRMWARE_VERSION = (3, 10)
SUPPLY_VOLTAGE_RAW = 120  # 12.0 V: an SO-101 follower on its external supply.
TEMPERATURE_C = 30

# Control table addresses (STS/SMS series, as used by LeRobot).
ADDR_FIRMWARE_MAJOR = 0
ADDR_FIRMWARE_MINOR = 1
ADDR_MODEL_NUMBER = 3
ADDR_ID = 5
ADDR_BAUD_RATE = 6
ADDR_RESPONSE_STATUS_LEVEL = 8
ADDR_MIN_POSITION_LIMIT = 9
ADDR_MAX_POSITION_LIMIT = 11
ADDR_MAX_TEMPERATURE = 13
ADDR_MAX_VOLTAGE = 14
ADDR_MIN_VOLTAGE = 15
ADDR_MAX_TORQUE = 16
ADDR_P_COEFFICIENT = 21
ADDR_D_COEFFICIENT = 22
ADDR_HOMING_OFFSET = 31
ADDR_OPERATING_MODE = 33
ADDR_TORQUE_ENABLE = 40
ADDR_ACCELERATION = 41
ADDR_GOAL_POSITION = 42
ADDR_TORQUE_LIMIT = 48
ADDR_LOCK = 55
ADDR_PRESENT_POSITION = 56
ADDR_PRESENT_VELOCITY = 58
ADDR_PRESENT_LOAD = 60
ADDR_PRESENT_VOLTAGE = 62
ADDR_PRESENT_TEMPERATURE = 63
ADDR_STATUS = 65
ADDR_MOVING = 66
ADDR_PRESENT_CURRENT = 69
ADDR_GOAL_POSITION_2 = 71
ADDR_MAXIMUM_ACCELERATION = 85
REGISTER_COUNT = 128

# Addresses the servo computes or that are fixed at the factory; writes to them are ignored.
READ_ONLY = frozenset(
    {ADDR_FIRMWARE_MAJOR, ADDR_FIRMWARE_MINOR, ADDR_MODEL_NUMBER, ADDR_MODEL_NUMBER + 1}
    | set(range(ADDR_PRESENT_POSITION, ADDR_GOAL_POSITION_2 + 2))
)

# Moving is reported while the joint is farther than this from its goal, in encoder ticks.
MOVING_THRESHOLD_TICKS = 8


def checksum(payload: Iterable[int]) -> int:
    return ~sum(payload) & 0xFF


def encode_sign_magnitude(value: int, sign_bit: int) -> int:
    magnitude = abs(int(value)) & ((1 << sign_bit) - 1)
    return magnitude | (1 << sign_bit) if value < 0 else magnitude


def decode_sign_magnitude(value: int, sign_bit: int) -> int:
    magnitude = value & ((1 << sign_bit) - 1)
    return -magnitude if value & (1 << sign_bit) else magnitude


def status_packet(servo_id: int, error: int = 0, params: Sequence[int] = ()) -> bytes:
    body = [servo_id, len(params) + 2, error, *params]
    return bytes([0xFF, 0xFF, *body, checksum(body)])


def instruction_packet(servo_id: int, instruction: int, params: Sequence[int] = ()) -> bytes:
    body = [servo_id, len(params) + 2, instruction, *params]
    return bytes([0xFF, 0xFF, *body, checksum(body)])


def radians_to_ticks(radians: float) -> int:
    """Absolute encoder ticks for a joint angle; the simulation's zero is the encoder center."""
    return round(CENTER + radians * RESOLUTION / (2 * math.pi)) % RESOLUTION


def ticks_to_radians(ticks: int) -> float:
    return (ticks - CENTER) * 2 * math.pi / RESOLUTION


@dataclass
class VirtualServo:
    """Register file and motion state of one STS3215 servo."""

    servo_id: int
    registers: bytearray = field(default_factory=lambda: bytearray(REGISTER_COUNT))
    actual_ticks: int = CENTER

    def __post_init__(self) -> None:
        regs = self.registers
        regs[ADDR_FIRMWARE_MAJOR], regs[ADDR_FIRMWARE_MINOR] = FIRMWARE_VERSION
        self._write_word(ADDR_MODEL_NUMBER, STS3215_MODEL_NUMBER)
        regs[ADDR_ID] = self.servo_id
        regs[ADDR_BAUD_RATE] = 0  # 1 Mbps
        regs[ADDR_RESPONSE_STATUS_LEVEL] = 1
        self._write_word(ADDR_MIN_POSITION_LIMIT, 0)
        self._write_word(ADDR_MAX_POSITION_LIMIT, RESOLUTION - 1)
        regs[ADDR_MAX_TEMPERATURE] = 70
        regs[ADDR_MAX_VOLTAGE] = 140
        regs[ADDR_MIN_VOLTAGE] = 40
        self._write_word(ADDR_MAX_TORQUE, 1000)
        regs[ADDR_P_COEFFICIENT] = 32
        regs[ADDR_D_COEFFICIENT] = 32
        self._write_word(ADDR_TORQUE_LIMIT, 1000)
        regs[ADDR_MAXIMUM_ACCELERATION] = 254
        self._write_word(ADDR_GOAL_POSITION, self.present_position)

    def _word(self, address: int) -> int:
        return self.registers[address] | (self.registers[address + 1] << 8)

    def _write_word(self, address: int, value: int) -> None:
        self.registers[address] = value & 0xFF
        self.registers[address + 1] = (value >> 8) & 0xFF

    @property
    def homing_offset(self) -> int:
        return decode_sign_magnitude(self._word(ADDR_HOMING_OFFSET), 11)

    @property
    def torque_enabled(self) -> bool:
        return self.registers[ADDR_TORQUE_ENABLE] != 0

    @property
    def responds_to_writes(self) -> bool:
        return self.registers[ADDR_RESPONSE_STATUS_LEVEL] != 0

    @property
    def present_position(self) -> int:
        """Present_Position = Actual_Position - Homing_Offset, wrapped to one turn."""
        return (self.actual_ticks - self.homing_offset) % RESOLUTION

    @property
    def goal_position(self) -> int:
        goal = decode_sign_magnitude(self._word(ADDR_GOAL_POSITION), 15)
        low, high = self._word(ADDR_MIN_POSITION_LIMIT), self._word(ADDR_MAX_POSITION_LIMIT)
        return min(max(goal, low), high) if low < high else goal

    @property
    def goal_ticks(self) -> int:
        """Absolute encoder target for the current goal, honoring the homing offset."""
        return (self.goal_position + self.homing_offset) % RESOLUTION

    def read(self, address: int, length: int) -> bytes | None:
        if address < 0 or length < 1 or address + length > REGISTER_COUNT:
            return None
        snapshot = bytearray(self.registers)
        present = self.present_position

        def put(target: int, value: int) -> None:
            snapshot[target] = value & 0xFF
            snapshot[target + 1] = (value >> 8) & 0xFF

        put(ADDR_PRESENT_POSITION, encode_sign_magnitude(present, 15))
        put(ADDR_PRESENT_VELOCITY, 0)
        put(ADDR_PRESENT_LOAD, 0)
        snapshot[ADDR_PRESENT_VOLTAGE] = SUPPLY_VOLTAGE_RAW
        snapshot[ADDR_PRESENT_TEMPERATURE] = TEMPERATURE_C
        snapshot[ADDR_STATUS] = 0
        snapshot[ADDR_MOVING] = int(self.torque_enabled and self.distance_to_goal() > MOVING_THRESHOLD_TICKS)
        put(ADDR_PRESENT_CURRENT, 0)
        put(ADDR_GOAL_POSITION_2, self._word(ADDR_GOAL_POSITION))
        return bytes(snapshot[address : address + length])

    def write(self, address: int, data: Sequence[int]) -> bool:
        if address < 0 or address + len(data) > REGISTER_COUNT:
            return False
        was_enabled = self.torque_enabled
        for offset, value in enumerate(data):
            target = address + offset
            if target not in READ_ONLY:
                self.registers[target] = value & 0xFF
        if not was_enabled and self.torque_enabled:
            # Enabling torque holds the current position instead of jumping to a stale goal.
            self._write_word(ADDR_GOAL_POSITION, encode_sign_magnitude(self.present_position, 15))
        new_id = self.registers[ADDR_ID]
        if new_id != self.servo_id and 0 <= new_id < BROADCAST_ID:
            self.servo_id = new_id
        return True

    def distance_to_goal(self) -> int:
        delta = abs(self.goal_ticks - self.actual_ticks) % RESOLUTION
        return min(delta, RESOLUTION - delta)


class FeetechBus:
    """A half-duplex bus of virtual servos fed with raw serial bytes."""

    def __init__(self, servos: Iterable[VirtualServo]) -> None:
        self.servos = list(servos)
        self._buffer = bytearray()
        self._registered: dict[int, tuple[int, bytes]] = {}
        self.packets_handled = 0

    def servo(self, servo_id: int) -> VirtualServo | None:
        return next((servo for servo in self.servos if servo.servo_id == servo_id), None)

    def set_actual_ticks(self, ticks: Sequence[int]) -> None:
        """Moves each servo's encoder to the arm's position.

        A limp servo's goal follows the arm, so a client reading Goal_Position sees where the arm
        is and enabling torque later holds the pose.
        """
        for servo, value in zip(self.servos, ticks, strict=True):
            servo.actual_ticks = int(value) % RESOLUTION
            if not servo.torque_enabled:
                goal = encode_sign_magnitude(servo.present_position, 15)
                servo.write(ADDR_GOAL_POSITION, list(goal.to_bytes(2, "little")))

    def feed(self, data: bytes) -> bytes:
        """Consume serial bytes from the host and return the bytes the servos send back."""
        self._buffer.extend(data)
        response = bytearray()
        while True:
            start = self._buffer.find(b"\xff\xff")
            if start < 0:
                # Keep a trailing 0xFF; it may begin the next header.
                del self._buffer[: max(0, len(self._buffer) - 1)]
                return bytes(response)
            del self._buffer[:start]
            # Tolerate extra 0xFF padding before the id.
            while len(self._buffer) > 2 and self._buffer[2] == 0xFF:
                del self._buffer[0]
            if len(self._buffer) < 4:
                return bytes(response)
            length = self._buffer[3]
            total = length + 4
            if length < 2:
                del self._buffer[:2]
                continue
            if len(self._buffer) < total:
                return bytes(response)
            packet = bytes(self._buffer[:total])
            del self._buffer[:total]
            if checksum(packet[2:-1]) != packet[-1]:
                continue
            self.packets_handled += 1
            response.extend(self._handle(packet[2], packet[4], packet[5:-1]))

    def _handle(self, servo_id: int, instruction: int, params: bytes) -> bytes:
        if instruction == INST_SYNC_WRITE:
            return self._sync_write(params)
        if instruction == INST_SYNC_READ:
            return self._sync_read(params)
        if servo_id == BROADCAST_ID:
            if instruction == INST_PING:
                return b"".join(status_packet(servo.servo_id) for servo in sorted(self.servos, key=lambda s: s.servo_id))
            if instruction == INST_WRITE and len(params) >= 1:
                for servo in self.servos:
                    servo.write(params[0], params[1:])
            elif instruction == INST_ACTION:
                self._action()
            return b""
        servo = self.servo(servo_id)
        if servo is None:
            return b""
        if instruction == INST_PING:
            return status_packet(servo.servo_id)
        if instruction == INST_READ and len(params) == 2:
            data = servo.read(params[0], params[1])
            return status_packet(servo.servo_id, 0 if data is not None else 0x08, data or ())
        if instruction == INST_WRITE and len(params) >= 1:
            ok = servo.write(params[0], params[1:])
            return status_packet(servo.servo_id, 0 if ok else 0x08) if servo.responds_to_writes else b""
        if instruction == INST_REG_WRITE and len(params) >= 1:
            self._registered[servo.servo_id] = (params[0], bytes(params[1:]))
            return status_packet(servo.servo_id) if servo.responds_to_writes else b""
        if instruction == INST_ACTION:
            self._action()
            return b""
        return status_packet(servo.servo_id, 0x08)

    def _action(self) -> None:
        for servo_id, (address, data) in self._registered.items():
            servo = self.servo(servo_id)
            if servo is not None:
                servo.write(address, data)
        self._registered.clear()

    def _sync_read(self, params: bytes) -> bytes:
        if len(params) < 2:
            return b""
        address, length = params[0], params[1]
        response = bytearray()
        for servo_id in params[2:]:
            servo = self.servo(servo_id)
            if servo is None:
                continue
            data = servo.read(address, length)
            if data is not None:
                response.extend(status_packet(servo.servo_id, 0, data))
        return bytes(response)

    def _sync_write(self, params: bytes) -> bytes:
        if len(params) < 2:
            return b""
        address, length = params[0], params[1]
        stride = length + 1
        for start in range(2, len(params) - length, stride):
            servo = self.servo(params[start])
            if servo is not None:
                servo.write(address, params[start + 1 : start + stride])
        return b""
