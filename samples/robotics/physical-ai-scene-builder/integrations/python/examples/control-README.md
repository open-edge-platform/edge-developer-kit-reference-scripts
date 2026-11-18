<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Physical AI Scene Builder {{sceneName}} Control Examples

## Description

Control the native simulation in your running Physical AI Scene Builder session. Choose a
workflow:

| Workspace                  | Use it for                                                                                        | Environment                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [Python](python/README.md) | SO-101 scripted recording, keyboard control, or generic joint and actuator control                | Linux, `uv`, Python 3.12 or later                         |
| [ROS 2](ros2/README.md)    | ROS joint commands, joint states, camera previews, recording services, and the RViz control panel | Linux x86-64, Pixi, RoboStack Lyrical, Python 3.14, Zenoh |

Both workspaces control Studio's simulation, not a physical robot. Install only the environment
you need.

## Before You Start

1. Keep Physical AI Scene Builder open on this saved scene's **Generate** tab.
2. Turn on **Stream to client** before starting a controller.
3. Extract the full archive and keep its folders together. The ROS 2 workspace uses the sibling
   Python SDK.
4. If you change and save the scene, download the examples again. The active scene is fetched from
   the app when the SDK connects; the scene bundle is not included in this archive.
5. Only one Python controller or ROS bridge can hold the session at a time.

The root `connection.json` contains this session's endpoints and expected scene fingerprint.
Turning streaming off and back on does not require another download. Physical AI Scene Builder runs
one simulation at a time: streaming another scene, in Generate or Evaluate, stops this one. The
examples then refuse to connect and name the scene that is streaming; open this scene and turn on
Stream to client again.

## File Structure

```text
control-examples/
├── README.md                                  # This guide
├── connection.json                            # Session endpoints and scene fingerprint
├── python/
│   ├── README.md                              # Python usage and command options
│   ├── AGENTS.md                              # Guidance for adapting the examples
│   ├── pyproject.toml                         # Python dependencies and CLI entry points
│   ├── uv.lock                                # Locked Python dependency versions
│   ├── skills/so101-pick-and-place/SKILL.md   # SO-101 controller guidance
│   ├── so101/generate_dataset.py              # Check scenes and record across states
│   ├── so101/pick_and_place.py                # Record one pick-and-place attempt
│   ├── so101/keyboard.py                      # Control the robot with keyboard input
│   ├── teleoperation_joint_control.py         # Inspect joints and send control targets
│   └── robotic_studio/                        # Shared Python SDK
└── ros2/
    ├── README.md                              # ROS 2 setup and usage
    ├── pixi.toml / pixi.lock                  # ROS environment and locked dependencies
    ├── upstream-ros-deps.repos                 # Pinned upstream ROS dependencies
    ├── scripts/activate.sh                     # Activate an existing ROS installation
    └── src/
        ├── robotic_studio_interfaces/          # Bridge status, services, and ROS interfaces
        ├── robotic_studio_ros/                 # Bridge, camera, launch, config, and tests
        └── robotic_studio_rviz/                # RViz control panel plugin
```
