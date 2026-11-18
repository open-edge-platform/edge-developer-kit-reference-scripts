# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Camera clipping distances in meters, applied the same way as the browser studio.

MuJoCo's ``<visual><map znear zfar>`` are fractions of the compiled scene extent, so one MJCF value
means a different distance whenever the scene grows (a splat room makes the extent ~14 m, turning
``znear="0.01"`` into a 14 cm near plane that cuts a wrist camera's gripper out of every image).
Studio scenes store meters in ``<custom><numeric name="rs_camera_clipping" data="near far"/>``;
every compiled model is rewritten from it on load so recorded images match the editor's camera
preview. Keep in sync with ``packages/mujoco/src/cameraClipping.ts``.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

CAMERA_CLIPPING_NUMERIC = "rs_camera_clipping"
DEFAULT_CAMERA_NEAR_M = 0.01
DEFAULT_CAMERA_FAR_M = 50.0


def normalize_camera_clipping(values: Sequence[float] | None) -> tuple[float, float]:
    """Valid ``(near, far)`` meters from authored values, falling back to the defaults."""
    values = list(values or [])
    near = float(values[0]) if len(values) > 0 else math.nan
    far = float(values[1]) if len(values) > 1 else math.nan
    if not (math.isfinite(near) and near > 0):
        near = DEFAULT_CAMERA_NEAR_M
    if not (math.isfinite(far) and far > near):
        far = max(DEFAULT_CAMERA_FAR_M, near * 2)
    return near, far


def apply_camera_clipping(mujoco: Any, model: Any) -> tuple[float, float]:
    """Sets the model's extent-relative map so cameras clip at the authored meters."""
    index = int(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_NUMERIC, CAMERA_CLIPPING_NUMERIC))
    authored = None
    if index >= 0:
        start = int(model.numeric_adr[index])
        authored = [float(value) for value in model.numeric_data[start : start + int(model.numeric_size[index])]]
    near, far = normalize_camera_clipping(authored)
    extent = float(model.stat.extent)
    if not (math.isfinite(extent) and extent > 0):
        extent = 1.0
    model.vis.map.znear = near / extent
    model.vis.map.zfar = far / extent
    return near, far
