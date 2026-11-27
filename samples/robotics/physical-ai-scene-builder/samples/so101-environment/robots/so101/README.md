<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# SO101 Robot - URDF and MuJoCo Description

This repository contains the URDF and MuJoCo (MJCF) files for the SO101 robot.

## Overview

- The robot model files were generated using the [onshape-to-robot](https://github.com/Rhoban/onshape-to-robot) plugin from a CAD model designed in Onshape.
- The generated URDFs were modified to allow meshes with relative paths instead of `package://...`.
- Base collision meshes were removed due to problematic collision behavior during simulation and planning.

## Calibration

`so101_new_calib.xml` (included by `scene.xml`) sets each joint's virtual zero to the **middle** of
its joint range. The upstream "old calibration" variant (zero at full horizontal extension) is not
vendored.

## Motor Parameters

Motor properties for the STS3215 motors used in the robot are adapted from the [Open Duck Mini project](https://github.com/apirrone/Open_Duck_Mini).

The arm position and velocity gains (`kp` 6 and `kv` 0.3; 13 and 1.6 for `shoulder_lift`) are
fitted to teleoperation recordings of a real follower arm. The simulated arm therefore sags under
its own weight and lags its command like the hardware.

## Gripper Note

LeRobot exposes the gripper as a normalized scalar, where:

* `0` = fully closed
* `100` = fully open

The MJCF keeps the native revolute gripper joint and actuator ranges. Physical AI Scene Builder's evaluation
profiles map the normalized scalar across that native range. The MuJoCo model uses
primitive fingertip pads instead of the visual CAD meshes for contact, with a gripper-specific gain
and force limit matching the protected hardware configuration. The pads are placed so the gripper
reads what the real arm reads while holding a 25 mm cube.

---

Feel free to open an issue or contribute improvements!
