# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import time
import logging
from typing import Tuple

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)


class SO101:
    def __init__(self, port: str, gripper_threshold: float):
        try:
            from platforms.so101.sdk import SO101FollowerArm
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise ImportError("SO101 SDK is not installed") from exc
        self.arm = SO101FollowerArm(
            port=port,
            gripper_threshold=gripper_threshold
        )
        self._reset_home_position()

    def _reset_home_position(self):
        logger.info("Reset SO101 to home position.")
        self.arm.move_to_joint_position(self.arm.DEFAULT_LOCATION["home"])

    def get_home_position(self) -> Tuple[float, float, float]:
        raise NotImplementedError(
            "SO101 does not support Cartesian position retrieval.")

    def get_robot_position(self):
        raise NotImplementedError(
            "SO101 does not support Cartesian position retrieval.")

    def move_to_coordinate(self, x, y, z, wrist_roll=None):
        self.arm.move_relative(x, y, z, duration=1.0, position_weight=20.0,
                               orientation_weight=0.05, wrist_roll=wrist_roll)
        time.sleep(0.1)

    def move_to_joint_pose(self, location_name: str):
        self.arm.move_to_joint_position(
            self.arm.DEFAULT_LOCATION[location_name])
        time.sleep(0.1)

    def set_suction_state(self, state, pin_index):
        raise NotImplementedError(
            "SO101 does not support suction control.")

    def set_gripper_state(self, open: bool):
        if open:
            self.arm.open_gripper()
        else:
            self.arm.close_gripper()

    def calibrate_start(self, offset_x_mm: float, offset_y_mm: float, offset_z_mm: float):
        """Phase 1 of calibration: move to home, open gripper, then apply XY and Z offsets
        to reach the target pick position so the operator can visually verify alignment."""
        offset_x = offset_x_mm / 1000.0
        offset_y = offset_y_mm / 1000.0
        offset_z = offset_z_mm / 1000.0

        self.arm.move_to_joint_position(self.arm.DEFAULT_LOCATION["home"])
        self.arm.open_gripper()

        # Apply X/Y offset from home
        T_current = self.arm.get_current_ee_pose()
        current_pos = T_current[:3, 3]
        self.arm.move_relative(
            current_pos[0] + offset_x,
            current_pos[1] + offset_y,
            current_pos[2],
            duration=1.0,
            position_weight=20.0,
            orientation_weight=0.05,
        )

        # Apply Z offset to reach pick height
        T_current = self.arm.get_current_ee_pose()
        current_pos = T_current[:3, 3]
        self.arm.move_relative(
            current_pos[0],
            current_pos[1],
            offset_z,
            duration=1.0,
            position_weight=20.0,
            orientation_weight=0.05,
        )

    def calibrate_confirm(self):
        """Phase 2 of calibration: confirm pick position, cycle through container pose,
        and return to home. Does NOT disconnect the arm."""
        self.arm.close_gripper()
        self.arm.move_to_joint_position(self.arm.DEFAULT_LOCATION["home"])
        self.arm.move_to_joint_position(self.arm.DEFAULT_LOCATION["container"])
        self.arm.open_gripper()
        self.arm.close_gripper()
        self.arm.move_to_joint_position(self.arm.DEFAULT_LOCATION["home"])

    def disconnect(self):
        self.arm.disconnect()
