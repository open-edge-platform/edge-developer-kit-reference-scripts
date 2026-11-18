# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import re
from dataclasses import dataclass

import mujoco
import numpy as np
from builtin_interfaces.msg import Time
from sensor_msgs.msg import CameraInfo, CompressedImage, Image
from std_msgs.msg import Header

from robotic_studio.camera_projection import frustum_intrinsics
from robotic_studio.teleoperation import StateSnapshot

from .mapping import stamp_parts


@dataclass(frozen=True)
class Calibration:
    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float


@dataclass(frozen=True)
class CameraSample:
    snapshot: StateSnapshot
    calibration: Calibration | None
    error: str = ""


class CameraCalibration:
    """Worker-owned camera projection, caching only the latest size per camera."""

    def __init__(self, model: mujoco.MjModel, data: mujoco.MjData, names: dict[str, str]) -> None:
        self.model = model
        self.data = data
        self.names = names
        self.scene = mujoco.MjvScene(model, maxgeom=1)
        self.cache: dict[str, Calibration] = {}

    def for_image(self, output: str, width: int, height: int) -> Calibration:
        cached = self.cache.get(output)
        if cached is not None and (cached.width, cached.height) == (width, height):
            return cached
        name = self.names.get(output)
        if not isinstance(name, str) or not name:
            raise ValueError(f"No MuJoCo camera mapping for output '{output}'.")
        camera_id = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_CAMERA, name)
        if camera_id < 0:
            raise ValueError(f"MuJoCo camera '{name}' does not exist.")
        if self.model.cam_projection[camera_id] != mujoco.mjtProjection.mjPROJ_PERSPECTIVE:
            raise ValueError(f"MuJoCo camera '{name}' uses an unsupported non-perspective projection.")
        camera = mujoco.MjvCamera()
        camera.type = mujoco.mjtCamera.mjCAMERA_FIXED
        camera.fixedcamid = camera_id
        mujoco.mjv_updateCamera(self.model, self.data, camera, self.scene)
        # Native mono rendering averages the two eye-camera frusta.
        frustum = {
            field: 0.5 * (float(getattr(self.scene.camera[0], field)) + float(getattr(self.scene.camera[1], field)))
            for field in ("frustum_bottom", "frustum_top", "frustum_center", "frustum_width", "frustum_near")
        }
        calibration = Calibration(width, height, *frustum_intrinsics(width=width, height=height, **frustum))
        self.cache[output] = calibration
        return calibration


def camera_info_message(calibration: Calibration, image: Image | CameraInfo) -> CameraInfo:
    if (calibration.width, calibration.height) != (image.width, image.height):
        raise ValueError("Camera calibration dimensions do not match the image.")
    fx, fy, cx, cy = calibration.fx, calibration.fy, calibration.cx, calibration.cy
    message = CameraInfo(
        width=image.width, height=image.height, distortion_model="plumb_bob", d=[0.0] * 5,
        k=[fx, 0.0, cx, 0.0, fy, cy, 0.0, 0.0, 1.0],
        r=[1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        p=[fx, 0.0, cx, 0.0, 0.0, fy, cy, 0.0, 0.0, 0.0, 1.0, 0.0],
    )
    message.header = image.header
    return message


def camera_token(name: str) -> str:
    if not name:
        raise ValueError("Camera output names must be non-empty.")
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) and not name.startswith("encoded_"):
        return name
    return "encoded_" + name.encode("utf-8").hex()


def validate_image(snapshot: StateSnapshot, camera: str) -> None:
    pixels = snapshot.images[camera]
    if pixels.dtype != np.uint8 or pixels.ndim != 3 or pixels.shape[2] != 3:
        raise ValueError(f"Camera '{camera}' must contain an H x W x 3 uint8 RGB image.")
    if pixels.shape[0] < 1 or pixels.shape[1] < 1:
        raise ValueError(f"Camera '{camera}' has empty image dimensions.")
    stamp_parts(snapshot.simulation_time)


def image_dimensions(snapshot: StateSnapshot, camera: str) -> tuple[int, int]:
    dimensions = None
    if camera in snapshot.images:
        validate_image(snapshot, camera)
        height, width, _ = snapshot.images[camera].shape
        dimensions = (width, height)
    if camera in snapshot.compressed_images:
        compressed = snapshot.compressed_images[camera]
        if compressed.encoding != "jpeg" or not compressed.data or compressed.width < 1 or compressed.height < 1:
            raise ValueError(f"Camera '{camera}' has invalid compressed JPEG metadata.")
        if dimensions is not None and dimensions != (compressed.width, compressed.height):
            raise ValueError(f"Camera '{camera}' raw and compressed dimensions differ.")
        dimensions = (compressed.width, compressed.height)
    if dimensions is None:
        raise ValueError(f"Camera '{camera}' has no image representation.")
    stamp_parts(snapshot.simulation_time)
    return dimensions


def image_header(snapshot: StateSnapshot, frame_id: str) -> Header:
    seconds, nanoseconds = stamp_parts(snapshot.simulation_time)
    return Header(stamp=Time(sec=seconds, nanosec=nanoseconds), frame_id=frame_id)


def compressed_image_message(snapshot: StateSnapshot, camera: str, frame_id: str) -> CompressedImage:
    image_dimensions(snapshot, camera)
    if camera not in snapshot.compressed_images:
        raise ValueError(f"Camera '{camera}' has no original JPEG payload.")
    # The transport plugin's JPEG decoder yields BGR, then converts to original RGB.
    return CompressedImage(
        header=image_header(snapshot, frame_id), format="rgb8; jpeg compressed bgr8",
        data=snapshot.compressed_images[camera].data,
    )


def image_message(snapshot: StateSnapshot, camera: str, frame_id: str) -> Image:
    validate_image(snapshot, camera)
    pixels = snapshot.images[camera]
    height, width, _ = pixels.shape
    message = Image(
        height=height, width=width, encoding="rgb8", is_bigendian=0,
        step=width * 3, data=pixels.tobytes(order="C"),
    )
    message.header = image_header(snapshot, frame_id)
    return message
