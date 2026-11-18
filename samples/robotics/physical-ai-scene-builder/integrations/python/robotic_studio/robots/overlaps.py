# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Detect movable objects that start inside other geometry.

MuJoCo resolves an initial interpenetration by pushing the bodies apart on the first steps. A
free object authored a few centimetres inside a table or the robot is launched sideways and can
jam the arm, so controllers then fail with unrelated reasons (a waypoint is never reached).
Checking the restored state before an attempt reports the real cause instead.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# Resting contacts penetrate by well under a millimetre; authored overlaps are much deeper.
DEFAULT_OVERLAP_TOLERANCE = 0.005
# Boxes placed over a splat scan's tables in Scene Builder (Build > Splat > Table): worldbody
# geoms named scan_table, scan_table_2, ...
SCAN_TABLE_NAME = re.compile(r"scan_table(_\d+)?")


@dataclass(frozen=True)
class InitialOverlap:
    """A free-moving ``body`` whose geometry starts ``depth`` metres inside ``other``."""

    body: str
    other: str
    depth: float
    other_geom: str | None = None

    @property
    def scan_table(self) -> bool:
        return SCAN_TABLE_NAME.fullmatch(self.other) is not None

    def describe(self) -> str:
        target = f"the table ('{self.other}')" if self.scan_table else f"'{self.other}'"
        return f"'{self.body}' starts {self.depth * 1000:.0f} mm inside {target}."

    def hint(self) -> str:
        if self.scan_table:
            return (
                "In Scene Builder, open Build > Splat > Table and press Drop next to the object (or "
                "move it up onto the table), then save and generate the scene states again."
            )
        return "Move the object so it does not overlap, then save and generate the scene states again."


def _name(mujoco: Any, model: Any, kind: Any, index: int) -> str | None:
    return mujoco.mj_id2name(model, kind, index) or None


def find_initial_overlaps(
    mujoco: Any,
    model: Any,
    data: Any,
    *,
    tolerance: float = DEFAULT_OVERLAP_TOLERANCE,
) -> list[InitialOverlap]:
    """Return free bodies penetrating other geometry by more than ``tolerance`` in ``data``.

    Runs ``mj_forward`` (kinematics and collision only; the state is not advanced). Each pair of a
    free body and the body it overlaps is reported once with its deepest contact, deepest first.
    """
    mujoco.mj_forward(model, data)
    body_root = model.body_rootid
    free_joint = int(mujoco.mjtJoint.mjJNT_FREE)

    def free_root(body: int) -> int | None:
        root = int(body_root[body])
        joint = int(model.body_jntadr[root])
        if root > 0 and joint >= 0 and int(model.jnt_type[joint]) == free_joint:
            return root
        return None

    deepest: dict[tuple[str, str], tuple[float, str | None]] = {}
    for index in range(int(data.ncon)):
        contact = data.contact[index]
        depth = -float(contact.dist)
        if depth <= tolerance:
            continue
        geoms = (int(contact.geom1), int(contact.geom2))
        bodies = tuple(int(model.geom_bodyid[geom]) for geom in geoms)
        roots = tuple(free_root(body) for body in bodies)
        if roots[0] is not None and roots[0] == roots[1]:
            continue
        for side in (0, 1):
            root = roots[side]
            if root is None:
                continue
            other_geom, other_body = geoms[1 - side], bodies[1 - side]
            other_root = roots[1 - side]
            other = (
                _name(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, other_root)
                if other_root is not None
                else _name(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, other_body)
                if other_body > 0
                else _name(mujoco, model, mujoco.mjtObj.mjOBJ_GEOM, other_geom)
            ) or ("world" if other_body == 0 else f"body {other_body}")
            body = _name(mujoco, model, mujoco.mjtObj.mjOBJ_BODY, root) or f"body {root}"
            key = (body, other)
            if depth > deepest.get(key, (0.0, None))[0]:
                deepest[key] = (depth, _name(mujoco, model, mujoco.mjtObj.mjOBJ_GEOM, other_geom))
            # A pair of free bodies is one overlap; report it from the first side only.
            break
    return [
        InitialOverlap(body, other, depth, other_geom)
        for (body, other), (depth, other_geom) in sorted(deepest.items(), key=lambda item: -item[1][0])
    ]
