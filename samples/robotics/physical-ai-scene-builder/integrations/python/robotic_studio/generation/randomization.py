# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from math import cos, hypot, sin
from typing import Any

from .model_randomization import is_model_rule, sample_model_rule


def derive_seed(*parts: int) -> int:
    """Return a stable 32-bit seed for a tuple of integers (e.g. a state seed and a recording)."""
    digest = hashlib.sha256(":".join(str(int(part)) for part in parts).encode("ascii")).digest()
    return int.from_bytes(digest[:4], "little")


class XorShift32:
    def __init__(self, seed: int) -> None:
        state = seed & 0xFFFFFFFF
        self._state = state or 0x6D2B79F5

    def next(self) -> float:
        state = self._state
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= state >> 17
        state ^= (state << 5) & 0xFFFFFFFF
        self._state = state & 0xFFFFFFFF
        return self._state / 0x1_0000_0000

    def range(self, value: list[float]) -> float:
        return value[0] + self.next() * (value[1] - value[0])


def _axis_quaternion(axis: str, angle: float) -> list[float]:
    half_angle = angle / 2
    sine = sin(half_angle)
    cosine = cos(half_angle)
    if axis == "x":
        return [cosine, sine, 0.0, 0.0]
    if axis == "y":
        return [cosine, 0.0, sine, 0.0]
    return [cosine, 0.0, 0.0, sine]


def _multiply_quaternion(left: list[float], right: list[float]) -> list[float]:
    left_w, left_x, left_y, left_z = left
    right_w, right_x, right_y, right_z = right
    return [
        left_w * right_w - left_x * right_x - left_y * right_y - left_z * right_z,
        left_w * right_x + left_x * right_w + left_y * right_z - left_z * right_y,
        left_w * right_y - left_x * right_z + left_y * right_w + left_z * right_x,
        left_w * right_z + left_x * right_y - left_y * right_x + left_z * right_w,
    ]


def _quaternion_from_euler(angles: list[float], order: str) -> list[float]:
    values = dict(zip(("x", "y", "z"), angles, strict=True))
    quaternion = [1.0, 0.0, 0.0, 0.0]
    for axis in order:
        quaternion = _multiply_quaternion(quaternion, _axis_quaternion(axis, values[axis]))
    length = hypot(*quaternion)
    return [value / length for value in quaternion]


def sample_task_randomization(task: Mapping[str, Any], seed: int) -> list[dict[str, Any]]:
    """Sample every rule in ``task["randomization"]`` from one seeded stream, in rule order.

    The seed is hashed first: XorShift32 seeded with a small integer (Evaluate's episode seeds
    0, 1, 2, ...) emits near-zero values for its first draws, which would pin every episode to the
    low end of each range.
    """
    return sample_rules(task["randomization"], XorShift32(derive_seed(seed)))


def sample_rules(rules: Sequence[Mapping[str, Any]], random: XorShift32) -> list[dict[str, Any]]:
    """Sample rules in order from an existing stream (Generate continues after its pose draws)."""
    samples: list[dict[str, Any]] = []
    for rule in rules:
        kind = rule["kind"]
        if is_model_rule(rule):
            samples.append(sample_model_rule(rule, random))
        elif kind == "select-source-object":
            candidates = rule["candidates"]
            selected_index = min(int(random.next() * len(candidates)), len(candidates) - 1)
            samples.append(
                {
                    "target": "source-object",
                    "values": [float(selected_index)],
                    "selected": candidates[selected_index],
                }
            )
        elif kind == "free-body-position":
            samples.append(
                {
                    "target": rule["body"],
                    "values": [random.range(rule["range"][axis]) for axis in ("x", "y", "z")],
                }
            )
        elif kind == "free-body-orientation-euler":
            angles = [random.range(rule["range"][axis]) for axis in ("x", "y", "z")]
            samples.append(
                {
                    "target": rule["body"],
                    "values": _quaternion_from_euler(angles, rule["order"]),
                }
            )
        elif kind == "free-body-orientation-quaternion":
            values = [random.range(rule["range"][component]) for component in ("w", "x", "y", "z")]
            length = hypot(*values)
            if length == 0:
                raise ValueError(f"Quaternion randomization for '{rule['body']}' sampled zero length.")
            samples.append({"target": rule["body"], "values": [value / length for value in values]})
        elif kind in {"joint-position", "joint-velocity"}:
            samples.append({"target": rule["joint"], "values": [random.range(rule["range"])]})
        else:
            raise ValueError(f"Unsupported randomization rule '{kind}'.")
    return samples
