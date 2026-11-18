---
name: replicate-scene
description: Build a Physical AI Scene Builder scene that matches one or more photos of a real robot workspace, for a given task such as "pick the red cube into the bowl", using the scene-builder MCP tools. Use when the user shares a photo of a desk, table, or cell and wants it recreated in simulation for data generation.
---

<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Replicate a scene from photos

Goal: a saved scene whose camera image looks like the user's photo, whose objects rest where the
photo shows them, and which `check_scene` passes, so Generate can record the task without changes.
Work in small steps and look after each one: `render_camera` shows exactly what recordings capture.

## Before you start

- The scene is open in **Build** with **MCP** enabled, and the browser tab stays visible (renders
  fail when it is hidden). Call `get_scene` first; every write needs its latest `revision` and a
  new `requestId` UUID. Read `get_scene` again after each write.
- You need the photo(s) in your own context and the task in one sentence. If the task does not say
  which object is picked and where it goes, ask. Name bodies after their role: the picked object as
  the task says (`red_cube`), the destination `container`. The editor prefixes added objects
  (`asset_red_cube`); use the names `get_scene` reports.
- Units are meters, kilograms, and MuJoCo Z-up world coordinates. Read the compiler angle unit in
  the MJCF before writing Euler angles.

## 1. Read the photo

Write down, before editing anything:

- **Camera**: height above the table, distance to the robot base, which way it looks, roughly how
  wide the view is (phone main camera about 55-65 degrees vertical, webcam about 45-55), and image
  aspect. Note any second camera (wrist, side) the task needs.
- **Table**: shape, height (desks are usually 0.72-0.76 m), top color or material, and its edges
  visible in the frame. A user's "1.0 x 0.7 m" does not say which side runs along which
  world axis; check it against an object of known size in the photo before building. If the scene already has a scanned room (an `rs_backdrop` body), the table
  comes from the scan instead (step 2).
- **Robot**: model, where its base sits on the table, and which way it faces.
- **Objects**: each one's kind, color, real size (estimate from things of known size: a sheet
  of A4 is 21 x 29.7 cm, a drinks can is 6.6 cm across), and position
  relative to the robot base: forward, left or right, in centimeters.
- **Light**: main direction (window, ceiling) and whether shadows are hard or soft.

Keep the task's pick object within reach: for the SO-101 that is about 33 cm from the shoulder at
table height for a comfortable top-down grasp and 40 cm at most. If the photo puts it farther,
tell the user rather than silently moving it.

## 2. Build the support

- **Plain scene**: `add_table` with full `dimensions` [width, depth, height] and the floor-level
  `position`. Its top is at Z = height.
- **Scanned room**: call `detect_table`. Take the first proposal (nearest the robot) unless the photo
  says otherwise, then `add_scan_table` with its `center`, `size`, `top`, and `yaw`. Scan surfaces
  do not collide by themselves; without this table objects fall through. A proposal can extend along
  a long bench; shrink `size` to the part the robot works on if that matters.

## 3. Add the robot

`list_robots` (search the model, for example `SO`), then `add_robot`. Read `get_scene` for the new
namespaced root body (`robot_N__root`) and set it on the table with `place_object` (`on` the
table with an `offset`, or `at` a world X, Y, and `yaw` for its heading): `add_robot` puts it at
the floor. With an identity orientation the SO-101 faces world +X, and in its default
pose the upper arm points up and the forearm forward. Check the heading with a free top view:
`render_camera` with `view` `{position: [x, y, top + 1.2], target: [x, y, top]}`.

## 4. Add the objects

**The destination.** A bowl, tray, or box the object is put into is an `add_container` operation
(in `apply_scene_operations`): give its `inner` width and depth, `wallHeight`, and color, then
`place_object` it on the table. It carries the placement target Generate checks. A flat target
(a coaster, a marked spot) is a thin fixed box primitive named `container`.

**Everything else**, preferring in order:

1. A primitive (`add_primitive` in `apply_scene_operations`) when the object is a box, ball,
   cylinder, or capsule. Use the photo's color for `rgba`. Sizes are half-extents (box) or radius
   and half-length (cylinder).
2. A library object: `list_assets` with a `search`, then `add_asset`.
3. A new object from a photo crop: the user shares the image (or you upload it with the MCP token
   when `start_image_to_3d` is exposed), then `list_images`, `start_image_to_3d`, poll
   `get_image_to_3d_job` until it succeeds, and `add_asset` with its `libraryAssetId`. Generation
   takes minutes and needs the user to start the image-to-3D service.

For every object, then:

- `set_object_physics` with `largestDimension` (its real size), `mass` (a 4 cm wooden cube about
  0.04 kg, an empty mug about 0.3 kg, a plastic bowl about 0.1 kg), and `friction` if it is
  slippery or rubbery. Generated objects come in at an arbitrary size; always set this.
- `place_object` with `at` (world X, Y), `on` (a table or container), or `beside` (another object)
  instead of computing heights yourself. `yaw` sets its heading. It refuses spots with nothing
  below or with something in the way; move the spot rather than forcing it.

## 5. Cameras and lights

- Match the photo's camera with `add_camera` (world `position`, `target`, `fovy`) and set its
  `resolution` with `set_attribute` (for example `[640, 480]`, or the photo's aspect at a size the
  policy uses). A wrist camera uses `add_mounted_camera` on the gripper body; read its live
  `worldMatrix` from `get_scene` first.
- Add one light per strong light source with `add_light`; point it with `direction`. The headlight
  already lights the scene from the camera, so one or two lights are usually enough.
- Renders tend to come out brighter than photos. Compare the table top's brightness in the render
  and the photo; when the render is brighter, lower each light's `diffuse` with `set_attribute`
  (for example `[0.5, 0.5, 0.5]`) before adding or removing lights. Prefer `directional` lights:
  `render_camera` shows point and spot lights brighter than recordings capture them.

## 6. Compare with the photo and adjust

Call `render_camera` with the scene camera's name and compare it with the photo, in this order:

1. **Framing**: table edges, robot base, and frame borders in the same places. Fix the camera
   `position`, `target`, then `fovy`, one at a time.
2. **Layout**: each object's position relative to the robot base and the table edge, then size.
3. **Appearance**: colors, then lighting direction and brightness.

Framing converges much faster from a fitted camera than by eye. Read the pixel positions of the
table top's 4 corners in the photo (and of other known points, such as the robot base, if visible),
pass them with their world positions to `fit_camera`, and apply its `position`, `target`, and
`fovy` with `aim_camera`. Keep the corners in the same order in both lists. A good fit has a
`reprojectionError` of a few pixels; tens of pixels mean a swapped corner or a wrong table size. If
it returns a `warning` (a view almost straight down), pass the camera's `fovy` and fit again; a
large `rollDegrees` means the photo is tilted, which a level camera cannot match exactly.
Back-project object pixels onto the table plane with the fitted camera to place objects.
`aim_camera` moves or re-aims any world camera by name and keeps its name and resolution. Change
one thing per round and render again. Stop after about five rounds, or when another round changes
nothing visible, and list what still differs. Do not claim a match you cannot see.

## 7. Check and save

Call `check_scene` and fix every error, using its `fix` text:

| Code                              | Usual fix                                                             |
| --------------------------------- | --------------------------------------------------------------------- |
| `overlap`                         | `place_object` the object again, or move it apart                     |
| `falls`, `settles`                | Add or extend the table under it; `place_object` it on that           |
| `unreachable`, `near_reach_limit` | Move the object closer to the robot (ask if the photo says otherwise) |
| `not_visible`                     | Aim the camera at the object or widen its `fovy`                      |
| `no_camera`, `camera_resolution`  | Add a named camera with a `resolution`                                |

Warnings may stay if the photo requires them; say which. When `ok` is true, `render_camera` once
more, then `save_scene`, and `get_scene` to confirm it saved.

## Report

Tell the user, briefly: what was built (robot, table, objects with sizes and masses, cameras), the
final render, what still differs from the photo, and the `check_scene` result. Next steps for them
happen in the app: randomization and **Generate**.
