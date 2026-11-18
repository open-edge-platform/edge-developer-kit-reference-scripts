# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Any

from ..camera_clipping import apply_camera_clipping
from .scene_bundle import SceneBundle


class NativeMuJoCoUnavailable(RuntimeError):
    pass


def configure_headless_rendering() -> None:
    if (
        sys.platform.startswith("linux")
        and not os.environ.get("MUJOCO_GL")
        and not os.environ.get("DISPLAY")
        and not os.environ.get("WAYLAND_DISPLAY")
    ):
        os.environ["MUJOCO_GL"] = "egl"


@dataclass
class NativeScene:
    bundle: SceneBundle
    model: Any
    data: Any

    @classmethod
    def compile(cls, bundle: SceneBundle) -> NativeScene:
        configure_headless_rendering()
        try:
            import mujoco
        except ModuleNotFoundError as error:
            raise NativeMuJoCoUnavailable(
                "Native MuJoCo requires the optional 'teleoperation' dependencies."
            ) from error
        try:
            model = mujoco.MjModel.from_xml_path(str(bundle.scene_path))
            apply_camera_clipping(mujoco, model)
            data = mujoco.MjData(model)
            mujoco.mj_forward(model, data)
        except Exception as error:
            raise RuntimeError(f"Native MuJoCo could not compile '{bundle.scene_path}'.") from error
        return cls(bundle=bundle, model=model, data=data)

    def forward(self) -> None:
        import mujoco

        mujoco.mj_forward(self.model, self.data)
