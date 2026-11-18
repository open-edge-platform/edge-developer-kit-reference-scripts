<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# AGENTS.md — Physical AI Scene Builder control examples

Guidance for AI coding assistants working in a downloaded Physical AI Scene Builder control-examples folder
(or `integrations/python/examples` in the Physical AI Scene Builder repository).

## What is here

| Path                                | Purpose                                                         |
| ----------------------------------- | --------------------------------------------------------------- |
| `so101/generate_dataset.py`         | Batch pick-and-place recording over every scene state.          |
| `so101/pick_and_place.py`           | One recorded pick-and-place attempt.                            |
| `so101/keyboard.py`                 | Keyboard teleoperation of the SO-101 gripper.                   |
| `teleoperation_joint_control.py`    | Generic joint/actuator control for any robot.                   |
| `robotic_studio/robots/so101/`      | SO-101 controller, scene checks, and adapter (the real logic).  |
| `robotic_studio/robots/bindings.py` | Robot-agnostic profile/model binding helpers.                   |
| `robotic_studio/robots/control.py`  | `ControlTarget`, the interface controllers are written against. |
| `robotic_studio/teleoperation/`     | Public `Teleoperation` client. Do not reimplement its protocol. |
| `../connection.json`                | Session endpoints and the expected scene fingerprint.           |

The example scripts are thin command-line wrappers. Put task logic in the library modules, not in
the scripts.

In a downloaded archive, run Python commands from `python/`; the SDK detects
`../connection.json` automatically and fetches the active scene from the app. The sibling `ros2/`
workspace is optional and uses the same SDK and connection file; Python control does not require
ROS or Pixi.

## Ground rules

- Physical AI Scene Builder's native process is the authoritative simulation. Change the robot only through
  `Teleoperation.step(...)`; `client.local` is a replica for IK and planning.
- Keep training data **physics-only**. Do not bypass the actuators or physics in custom controllers.
- Never save an attempt that failed a quality gate. `record_episode` already discards failures;
  keep that behavior when writing new loops.
- Prefer configuration over code: `PickPlaceTask` (body names) first, `PickPlaceTuning` only when a
  failure reason points to a specific setting.
- Do not edit `uv.lock` or `connection.json`. Run scripts with `uv run --locked --extra teleoperation`.

## Adapting to a user's scene

Follow `skills/so101-pick-and-place/SKILL.md`. In short: inspect the scene, run
`so101/generate_dataset.py --check`, try a few single attempts, then run the batch with `--report`
and read the failure reasons before changing any code.

## Parallel recording

`so101/generate_dataset.py --workers N` hands the attempts to Physical AI Scene Builder, which records them in
N parallel processes with its built-in SO-101 controller and default settings. Edits to
`robotic_studio/robots/so101/` or tuning options in this folder do not affect `--workers` runs, so
debug and tune without `--workers`, and use it only for the unmodified controller. It cannot be
combined with `--check`, `--no-variation`, `--no-return-to-start`, or
`--home-pose`, and it does not use the home pose; Ctrl+C
cancels and keeps finished episodes.

## Writing controllers

Type controller code against `robotic_studio.robots.control.ControlTarget` (the methods the SO-101
controller uses: `step`, `current_state`, `select_initial_state`, the recording calls, `local`, and
so on) instead of the `Teleoperation` class. Physical AI Scene Builder also drives controllers in-process
through `robotic_studio.teleoperation.local.LocalTeleoperation`, which implements the same
interface, so code that only uses `ControlTarget` works in both places.

## Evaluation examples

These are not in the control-examples download. The policy evaluation scripts
(`*_evaluate_*.py`, from `GET /api/evaluation/example`) accept `--local` to simulate in their own
process and `--local --num-envs N` with `--policy-batching batched|per-env` to evaluate seeds in
parallel; keep them thin wrappers over the `robotic_studio` evaluator CLIs. The same download has
`physicalai_convert_to_openvino.py`, a thin wrapper over `robotic_studio.physicalai_export` that
turns a Physical AI training checkpoint (`.ckpt`) into the OpenVINO package those evaluators load.

## Other robots

The SO-101 controller assumes the SO-101 arm, its `gripperframe` site, and its finger pads. For a
different robot, start from `teleoperation_joint_control.py` and `robotic_studio/robots/bindings.py`,
and add a new `robotic_studio/robots/<robot>/` package that mirrors the SO-101 layout (adapter,
controller, checks). Do not add robot-specific branches to the SO-101 package.
