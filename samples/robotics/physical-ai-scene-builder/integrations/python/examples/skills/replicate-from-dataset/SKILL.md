---
name: replicate-from-dataset
description: Rebuild the workspace of a real robot recording (a LeRobot v3 dataset the user shared through the scene-builder MCP dialog) in Physical AI Scene Builder, matching its cameras, table, objects, and start pose, and score the result against the recorded frames. Use when the user wants to simulate, test, or generate data for the setup they recorded with their real robot.
---

<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Replicate a scene from a robot recording

Goal: a saved scene that looks like the recording's first frame from every recorded camera, with
the robot starting in the recorded pose and the objects where the real ones were, so a policy
trained on the real recording sees familiar images and Generate can record the same task.

The recording replaces the user's photos: its frames are photos whose cameras are the ones the
policy uses, and its joint states say exactly how the arm stood. Everything else works as in the
photo workflow (`skill://replicate-scene`); read it for the details this skill only names.

## Before you start

- The scene is open in **Build** with **MCP** enabled, and the browser tab stays visible. Call
  `get_scene` first; every write needs its latest `revision` and a new `requestId` UUID.
- Call `list_datasets`. If it is empty, ask the user to share the recording: **MCP > Share
  recording**, a zip of the LeRobot v3 dataset folder (one recording at a time). Older datasets
  (v2.1) must be converted with LeRobot's conversion script first.
- Note the `fps`, `robotType`, each camera's `key`, `name`, `width`, and `height`, the joint names
  in `state`, and the task of the episode you use. Use episode 0 unless the user names one.

## 1. Read the recording

- `get_dataset_frame` at `time` 0 with all cameras: this is the start layout to rebuild. Look at a
  frame near the middle of the episode as well (half its `durationSeconds`) to see which object is
  picked and where it goes; never place objects from a later frame, since the robot has moved them.
- `get_dataset_state` at `frame` 0 gives the start pose; its `stateRange` shows how far each joint
  moves during the episode.
- Write down, as in the photo workflow: table size and height, robot base position and heading,
  each object's kind, color, real size, and position relative to the robot base, and the light.
  Ask the user for sizes the frames cannot show (the table, the objects) when they matter.

## 2. Table and robot

Build the support (`add_table`, or `detect_table` and `add_scan_table` if the scene has a scanned
room) and add the robot the recording used (`list_robots`, `add_robot`, then `place_object` it on
the table). For an `so101_follower` recording, use the SO-101.

## 3. Start pose

Call `set_home_pose` with the `state` from `get_dataset_state` (names and values as they are) and
`unit` `so101-normalized`, the LeRobot SO-101 default. If it reports values outside a joint's
range, the recording probably used `use_degrees`: try `degrees`, and tell the user which unit you
used. The arm moves to the pose, so renders now show it as recorded.

## 4. Cameras

Give every recorded camera a scene camera with the same `name` (for example `front`, `wrist`) and
`resolution` [`width`, `height`] from `list_datasets`: a policy trained on the recording receives
cameras by these names.

- **World cameras**: read the pixels of the table-top corners (and the robot base) in the frame, and
  pass them with their world positions and the frame's `width` and `height` to `fit_camera`. Apply
  its `position`, `target`, and `fovy` with `add_camera`, or `aim_camera` for an existing camera,
  then set `resolution` with `set_attribute` in `apply_scene_operations`.
- **Wrist cameras**: `add_mounted_camera` on the gripper body, or keep the robot's own wrist camera
  if it has one; only its `fovy` and small offsets usually need tuning.

## 5. Objects

Place objects where frame 0 shows them: `pixel_to_world` with the fitted world camera, the frame
size, each object's footprint centre pixel, and `planeZ` (the table top), then `place_object` `at`
the returned X, Y. Add each object as in the photo workflow (`add_container` for the destination;
primitives, `list_assets` and `add_asset`, or image-to-3D: `get_dataset_frame` with `share` puts the
frames in `list_images` for `start_image_to_3d`), then `set_object_physics` with its real size and
mass.

## 6. Score against the recording and adjust

Call `compare_with_dataset` for each camera at `time` 0 (scene `camera`, recording
`datasetCamera`). Its image shows [real | render | overlay]: red edges are only in the recording,
cyan only in the render, white where both agree. Adjust in this order, one change per round:

1. **Framing** of world cameras: `aim_camera` (`position`, `target`, then `fovy`) until the table
   edges and robot base line up. Refit with `fit_camera` if they are far off.
2. **Layout**: move objects whose red and cyan outlines are apart (`place_object`).
3. **Appearance**: colors, then light; a `brightnessRatio` above 1 means the render is too bright
   (lower the lights' `diffuse`).

Watch `edgeF1`: it should rise as things line up. Stop after about five rounds per camera, or when
a round no longer raises it, and list what still differs. The recording's own scene (cables,
people, the room) is not expected to match; judge the table, robot, and task objects.

## 7. Check and save

`check_scene` and fix its errors as in the photo workflow, then `compare_with_dataset` once more for
every camera, `save_scene`, and `get_scene` to confirm it saved.

## Report

Tell the user, briefly: the robot, table, objects (sizes, masses), cameras and their final
`edgeF1` and `brightnessRatio`, the unit used for the start pose, what still differs, and the
`check_scene` result. Their next steps happen in the app: Evaluate the policy trained on the
recording with **Scene reset pose** as the start pose, or randomize and **Generate**.
