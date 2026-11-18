<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Physical AI Scene Builder

## Description

**{{sceneName}} client examples** control the native simulation in your running Physical AI Scene
Builder session. Use the SO-101 scripts to check a scene and record demonstrations, or use the
keyboard and joint-control examples to control a robot. These examples control the simulation, not
a physical robot. The SDK fetches the active scene from the app when it connects; the scene bundle
is not included in this download.

## Before You Start

1. Keep Physical AI Scene Builder open on this saved scene's **Generate** tab.
2. Turn on **Stream to client** before running a Python controller. Stop the controller before
   turning streaming off; turn it back on before using the same download again.
3. Extract the full archive and keep its folders together. Run Python commands from its `python/`
   directory. The first run creates the locked Python environment; ROS 2 is not required.
4. If you change and save the scene, download the examples again. Only one Python controller or
   ROS bridge can control the session at a time.

## Quick Start

From the extracted archive root, run these steps in order. First, check the connection and confirm
the scene is ready:

```sh
cd python

uv run --locked --extra teleoperation python so101/generate_dataset.py --check
```

When the check passes, run this command to start generating data. It records 5 pick-and-place
attempts per scene state by default (`--episodes-per-state N`), each with different motion; only
successful attempts are saved. First set the randomization in **Generate**, then generate the scene
states: set the count next to **Generate** and click it once. To train a policy, generate at least
100 scene states. With fewer start positions the policy learns those positions instead of the task,
and more episodes per state do not make up for it; the script warns when there are fewer.

```sh
uv run --locked --extra teleoperation python so101/generate_dataset.py
```

Other examples, run from `python/`:

| Command                                                                       | What it does                                               |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `uv run --locked --extra teleoperation python so101/pick_and_place.py`        | Record one pick-and-place attempt from the selected state. |
| `uv run --locked --extra teleoperation python so101/keyboard.py`              | Control the robot with the keyboard.                       |
| `uv run --locked --extra teleoperation python teleoperation_joint_control.py` | Inspect joints and send joint or actuator targets.         |

## File Structure

```text
control-examples/
├── README.md                 # Python and ROS quick start
├── connection.json           # Session endpoints and scene fingerprint
├── python/
│   ├── README.md             # This guide
│   ├── AGENTS.md             # Guidance for adapting the examples
│   ├── pyproject.toml        # Python project settings and dependencies
│   ├── uv.lock                # Exact dependency versions for repeatable setup
│   ├── so101/
│   │   ├── generate_dataset.py # Check the scene or record attempts across states
│   │   ├── pick_and_place.py   # Record one pick-and-place attempt
│   │   └── keyboard.py         # Control the robot from the keyboard
│   ├── teleoperation_joint_control.py # Inspect joints and send control targets
│   └── robotic_studio/       # Shared Python SDK
└── ros2/                     # Optional ROS 2 workspace
```
