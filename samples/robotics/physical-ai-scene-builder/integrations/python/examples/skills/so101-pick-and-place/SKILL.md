---
name: so101-pick-and-place
description: Adapt and validate SO-101 pick-and-place data generation for a user's Physical AI Scene Builder scene. Use when the user changed the scene (object, container, positions, cameras), when generate_dataset.py attempts fail, or when asked to produce training data for a custom SO-101 setup.
---

<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# SO-101 pick-and-place for a custom scene

Goal: physics-only demonstrations that are saved only when the object ends up at rest inside the
container. Work from evidence: check, try, read failure reasons, then change the smallest thing.

## Prerequisites (confirm with the user)

- Physical AI Scene Builder is open on the scene's **Generate** tab with streaming active.
- This folder was downloaded for the current scene revision (re-download after saving changes).
- Commands run from the archive's `python/` folder with
  `uv run --locked --extra teleoperation python ...`; the shared connection file one level up is
  detected automatically. Stop the controller before stopping streaming; restart streaming before
  reconnecting with this download.
- Any ROS bridge or other Python controller has been stopped so this controller can acquire the lease.

## Workflow

1. **Identify the bodies.** Ask for, or read from the scene tree, the object to pick and the
   container. Names may omit a namespace prefix (`asset_cube` matches `scene__asset_cube`). The
   object defaults to the one randomized in Generate; the container defaults to `container`.

2. **Check the scene.**

   ```sh
   uv run --locked --extra teleoperation python so101/generate_dataset.py --check
   ```

   Fix every `ERROR` in the scene (in Physical AI Scene Builder), not in code:

   | Message                         | Fix                                                  |
   | ------------------------------- | ---------------------------------------------------- |
   | not a recognized SO-101 arm     | Insert the SO-101 from the robot library.            |
   | no free joint                   | Make the object movable in Build.                    |
   | does not record camera images   | Add a camera, save, reopen Generate.                 |
   | state ... problem / unreachable | Delete that state or reduce the randomization range. |

3. **Try one attempt** and read the outcome:

   ```sh
   uv run --locked --extra teleoperation python so101/pick_and_place.py --verbose
   ```

4. **Run the batch with a report**:

   ```sh
   uv run --locked --extra teleoperation python so101/generate_dataset.py --report report.json
   ```

   Aim for most states to succeed. Group failures by `reason` in `report.json` before acting.

## Interpreting failure reasons

| Reason             | Likely cause                                                      | First response                                       |
| ------------------ | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `initial_overlap`  | An object starts inside a table, the splat backdrop, or the robot | Follow the printed hint; see `--check`               |
| `unreachable`      | Object or container too far, or rotated beyond reach              | Move closer; narrow X/Y range; avoid yaw             |
| `grasp_failed`     | Object too large/small for the jaws, or odd collision shape       | Use a 2–4 cm box-like object with collision enabled  |
| `dropped`          | Low friction, heavy object, weak grip                             | Increase object friction or reduce mass in the scene |
| `motion_timeout`   | Waypoint at the edge of the workspace                             | Move object/container toward the arm                 |
| `placement_failed` | Container too small or far; object bounced out                    | Larger container, closer to the arm                  |
| `ik_failed`        | Waypoint outside the arm's reach                                  | Same as `unreachable`                                |
| `home_pose`        | Wrist blocked by an obstacle                                      | Clear space around the gripper                       |
| `return_failed`    | Arm blocked on its way back to the start pose                     | Clear space between the container and the arm        |

Scene edits are preferred over controller changes. Only if a failure clearly maps to a setting,
override `PickPlaceTuning` in a small script (for example taller objects need a larger
`approach_height`), and verify with steps 3–4:

```python
from robotic_studio.robots.so101 import PickPlaceTask, PickPlaceTuning, record_episode

outcome = record_episode(client, mujoco, PickPlaceTask(source_body="red_block"),
                         PickPlaceTuning(approach_height=0.10))
```

## Do not

- Do not bypass actuator-driven physics or the controller's quality checks to make attempts
  "succeed"; doing so hides real failures and can produce unusable training data.
- Do not bypass `record_episode`'s quality gates or save failed attempts.
- Do not copy the controller into a new script; import it from `robotic_studio.robots.so101`.
- Do not claim the data is good because some attempts passed. Report the saved/failed counts and
  the failure reasons to the user.

## Known limits

The controller is regression-tested on the SO-101 sample scene with the object within ±2 cm of its
authored position and no rotation. Larger offsets and rotations of 30° or more fail often. Each
attempt varies its motion from its own seed, so repeating a state with `--episodes-per-state`
records distinct demonstrations; keep that variation on (`--no-variation` records one fixed motion
and is only for debugging). More generated states still add the most variety.
