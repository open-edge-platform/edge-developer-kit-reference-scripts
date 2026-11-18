# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Perspective intrinsics shared by native rendering and ROS image forwarding."""

import math


def frustum_intrinsics(
    *, width: int, height: int, frustum_bottom: float, frustum_top: float,
    frustum_center: float, frustum_width: float, frustum_near: float,
) -> tuple[float, float, float, float]:
    """Return fx, fy, cx, cy for MuJoCo's mono frustum and a top-left image origin."""
    values = (frustum_bottom, frustum_top, frustum_center, frustum_width, frustum_near)
    if width < 1 or height < 1 or not all(math.isfinite(value) for value in values):
        raise ValueError("MuJoCo camera dimensions and frustum must be valid and finite.")
    vertical = frustum_top - frustum_bottom
    if frustum_near <= 0 or vertical <= 0 or frustum_width < 0:
        raise ValueError("MuJoCo camera frustum is degenerate.")
    half_width = frustum_width if frustum_width > 0 else 0.5 * vertical * width / height
    fx = width * frustum_near / (2.0 * half_width)
    fy = height * frustum_near / vertical
    cx = width * (half_width - frustum_center) / (2.0 * half_width)
    cy = height * frustum_top / vertical
    if not all(math.isfinite(value) for value in (fx, fy, cx, cy)) or fx <= 0 or fy <= 0:
        raise ValueError("MuJoCo camera intrinsics must be finite with positive focal lengths.")
    return fx, fy, cx, cy
