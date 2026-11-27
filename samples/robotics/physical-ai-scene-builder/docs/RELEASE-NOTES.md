<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Release Notes

## v0.1.1 (2026-11-05)

### Features

- AI-assisted scene authoring, including scene validation, object placement, and camera tools.
  `fit_camera` accepts edge lines and works from two visible corners, and warns about implausible
  lenses. New `pixel_to_world` and `resize_container` tools, round bowl containers, and
  `set_object_physics` object categories with typical size, mass, and friction, plus box or
  cylinder collision proxies for meshes.
- Scene check: confirms the destination container is present, reachable, and large enough, reports
  the free space beside each object (`grasp_blocked`), and warns when a scene has no lights.
- Image-to-3D asset creation and scanned-room table support. Scanned rooms get a **Clean** step
  (crop, faint, and floater removal) applied in the editor, camera preview, and recordings, and
  detected tables are listed in the Splat tab.
- USD import: the asset browser accepts `.usd`, `.usda`, `.usdc`, and `.usdz` files and converts
  them to a Y-up, metre-scaled GLB on the server (static visual geometry and base-colour materials
  only). `setup.sh` installs the converter, so it works offline afterwards.
- Camera preview shading, lights, and shadows match native MuJoCo* recordings.
- The Inspector warns when an object starts inside the robot or another object.
- Batch scene generation, demonstration recording, and episode review.
- Training bundles and seeded policy evaluation.
- Python* control examples and editor usability improvements.

### Improvements and Fixes

- Scripted SO-101 demonstrations retry a failed grasp from another direction, release over the
  container at the edge of reach, and report where the arm stopped on a timeout. In our benchmark,
  ±10 cm / ±45° start ranges succeed in 80 of 100 states.
- Batch recording starts from the SO-101 rest pose, and Generate spreads the object's start offset
  across consecutive seeds.
- Randomized objects rest on the surface below them instead of keeping their authored height.
- Evaluation stops before the first episode when the session has no success check
  (`--unscored` runs anyway).
- Starting a stream on another scene asks before ending a session that is in use.
- Dataset conversion is about 8x faster; interactive recordings encode video while recording.
- Scanned-room backdrops re-render only the parts of a still camera's view that changed.
- Installation: Python is pinned to 3.13 for uv (3.12 to 3.14 supported), only
  `opencv-python-headless` is installed, the EGL libraries are listed in the prerequisites, and
  `npm run build` works on a fresh clone.

### Limitations

- Scripted demonstrations support the SO-101 only.
- Only one live simulation runs at a time.
- Real-robot evaluation is not available.
- USD import converts static geometry only; PBR maps, animation, skinning, and lights are dropped.
