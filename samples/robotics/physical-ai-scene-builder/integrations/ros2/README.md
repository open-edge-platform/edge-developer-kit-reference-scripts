<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Physical AI Scene Builder ROS 2 bridge

The bridge connects ROS 2 position control and RGB camera previews to an existing
native **Generate** session.
Studio owns physics; the bridge uses the public Python SDK and never steps its local
MuJoCo replica. No ROS dependencies are added to the web application or base SDK.

## Setup with Pixi

In a **Download control examples** archive, run all commands below from `ros2/`
(including in each additional terminal). In a repository checkout, use
`physical-ai-scene-builder/integrations/ros2/` instead. Keep the sibling `python/` folder in place:
the Pixi manifest and lockfile install its SDK via `../python`.

Setup requires Linux x86-64, [Pixi](https://pixi.sh), internet access, and a graphical
desktop for RViz (or use `rviz:=false`). No system ROS installation is needed. The
archive ships source, not environments or build outputs. Setup imports the upstream
sources at the revision pinned in `upstream-ros-deps.repos`.

```sh
pixi install --locked
pixi run install-deps
pixi run build
```

The public source archive contains the bridge and RViz plugin sources. Internal test procedures
are maintained separately from this public setup guide.

The locked environment uses RoboStack Lyrical, Python 3.14, and Zenoh. The bridge
installs the sibling Python SDK editable, with MuJoCo but without the heavyweight
training/recording extras; the Studio native worker retains its own environment.

On headless Linux, the tests select EGL rendering unless a backend was explicitly configured.
RViz plugin tests use Qt's offscreen platform.

### Launching the bridge

In one terminal, start the Zenoh router (unless one is already running):

```sh
pixi run zenoh-router
```

Start Studio normally, open a saved scene in **Generate**, and turn on **Stream
to client**. Stop any other Python controller: the bridge needs the exclusive
native controller lease. Then, in another terminal:

```sh
# Downloaded archive: use the shared connection file, resolved to an absolute path.
pixi run bridge connection:="$(realpath ../connection.json)"
# Repository checkout: discover the active session at http://localhost:3000.
# pixi run bridge
```

This also starts RViz with `use_sim_time=true`, consuming the simulator's `/clock`.
To run only the bridge (for example, without a graphical desktop):

```sh
pixi run bridge connection:="$(realpath ../connection.json)" rviz:=false
```

RViz opens the bundled `bridge.rviz` configuration with the world camera and the
[Robot Studio control](#robot-studio-control-panel) panel. Use
`rviz_config:=/absolute/path/config.rviz` to open a different saved configuration,
or `rviz_config:=` to start RViz without one.

RViz follows the bridge namespace. Its simulation time stops while simulation
stepping is paused. If `publish_clock:=false`, another simulator must supply
`/clock`, or set `use_sim_time:=false` to use wall time in RViz instead.
The `use_sim_time` launch argument applies only to RViz; bridge SDK polling and
watchdogs continue using their existing steady/monotonic clocks.
When the bridge exits, the launch file shuts down RViz started by that launch;
separately started RViz instances are unaffected.

The default app URL is `http://localhost:3000`. Override it or use an absolute path
to a downloaded `connection.json`:

```sh
pixi run bridge \
  connection:=http://localhost:3000 namespace:=studio publish_clock:=true \
  command_timeout_s:=1.0
```

All terminals participating in the ROS graph must use the same Pixi environment,
middleware, and domain configuration. Use `pixi shell` for interactive `ros2`
commands. Studio's worker endpoints remain loopback-only.
Only one simulation should publish `/clock`; set `publish_clock:=false` for others.

## Command a joint

The node starts **paused**. Commands use `std_msgs/msg/Float64MultiArray`: one
position per controllable joint, in configured mapping order (native scalar-joint
order when no mapping is configured), omitting read-only joints. The diagnostics
field `command_joint_names` lists that exact order. Publish fresh positions
continuously before resuming, within joint and position-actuator limits.

```sh
pixi run ros2 topic echo \
  /studio/bridge/joint_states

# Keep this publisher running in a separate terminal:
pixi run ros2 topic pub --rate 10 \
  /studio/bridge/joint_commands std_msgs/msg/Float64MultiArray \
  "{data: [0.0]}"

pixi run ros2 service call \
  /studio/bridge/pause std_srvs/srv/SetBool "{data: false}"
```

The example vector `[0.0]` is for a single controllable joint; replace it with
one position per controllable joint in your scene. Each command must contain the
full vector in radians/metres, with an empty `layout.dim` and zero
`layout.data_offset` (the message defaults). Empty, short, long, non-finite, and
out-of-range vectors are rejected. The array contains no names or scheduling
metadata. Native SDK validation remains the final gate.

While running, the bridge continues stepping at the profile's `captureFps` even
between messages, retaining the last target. Physics substeps come from the shared
`FrameClock`. A latest-value slot replaces unsent setpoints rather than accumulating
motion. Slow simulation reduces real-time factor; it does not create catch-up bursts.

After `command_timeout_s` without a valid command, stepping faults and stops.
Publish fresh commands and explicitly resume. This is simulation behavior, not
a hardware emergency stop.

```sh
# Pause, then reset the active immutable initial state:
pixi run ros2 service call \
  /studio/bridge/pause std_srvs/srv/SetBool "{data: true}"
pixi run ros2 service call \
  /studio/bridge/reset std_srvs/srv/Trigger "{}"
```

Pause/reset clear old commands, and reset leaves stepping paused. The native reset
currently restores joint state and resets the step counter while preserving
simulation time and state revision. The bridge publishes actual native time,
including backward jumps if a future backend or state change produces one.

## Robot Studio control panel

The `robotic_studio_rviz` package provides the RViz panel **Robot Studio control**.
Both bundled RViz configurations open it; in other configurations add it through
**Panels → Add New Panel → robotic_studio_rviz → Robot Studio control**.

Both configurations place the Tools toolbar across the top. Below it, the left
column stacks Robot Studio control, Time, and the world-camera preview; the middle
contains the 3D view; and the right column stacks Views above Displays. The saved
window size is 1600 × 1000, and the docks can be resized for smaller screens.

The panel shows the bridge phase (running, paused, faulted or disconnected), the
simulation time, step and real-time factor, the active initial state, the recording
state with the last saved episode, and whether fresh joint commands are arriving.
Its buttons call the bridge services:

| Button                  | Service                                   |
| ----------------------- | ----------------------------------------- |
| Pause / Resume          | `pause` (`std_srvs/srv/SetBool`)          |
| Reset                   | `reset` (`std_srvs/srv/Trigger`)          |
| Select (initial state)  | `select_initial_state`                    |
| Record                  | `recording/start`                         |
| Stop & Save / & Discard | `recording/stop` (`save: true` / `false`) |

Buttons are enabled only when the action is valid for the current status and
disabled while a call is outstanding; service failures appear in red under the
buttons. Resume keeps the bridge safety check: publish `joint_commands` first.
The panel's **Bridge** field selects the bridge node namespace (default
`/studio/bridge`) and is saved in the RViz configuration. The status shows "bridge
not responding" if no status arrives for two seconds.

The same controls are available from the command line:

```sh
pixi run ros2 topic echo /studio/bridge/status
pixi run ros2 service call /studio/bridge/select_initial_state \
  robotic_studio_interfaces/srv/SelectInitialState "{state_id: initial}"
pixi run ros2 service call /studio/bridge/recording/start \
  robotic_studio_interfaces/srv/StartRecording "{}"
pixi run ros2 service call /studio/bridge/recording/stop \
  robotic_studio_interfaces/srv/StopRecording "{save: true}"
```

Recording uses Studio's native recorder and dataset format; only stepped frames are
captured, so resume after starting a recording. Stopping with `save: true` pauses
stepping before saving; saving may take up to two minutes and returns the episode ID.
If saving fails, the recording stays _pending_ and can be saved or discarded again.
Reset and initial-state selection are refused while a recording is active or
pending, and both leave stepping paused.

## Camera images and calibration

RGB forwarding is enabled by default (`publish_images:=true`). In Studio's Generate
profile, enable RGB capture and configure the cameras to stream. The bridge requests
the simulator's existing JPEG previews and publishes their decoded pixels as
`sensor_msgs/msg/Image`, encoding `rgb8`, on:

```text
/studio/bridge/cameras/<outputName>/image_raw
/studio/bridge/cameras/<outputName>/image_raw/compressed
/studio/bridge/cameras/<outputName>/camera_info
```

For example, a camera with output name `world` appears at
`/studio/bridge/cameras/world/image_raw`. Topics are created when the first preview
arrives, including while simulation stepping is paused. Inspect available topics
and stream metadata with:

```sh
pixi run ros2 topic list
pixi run ros2 topic echo /studio/bridge/cameras/world/image_raw --field header
```

Names that are not valid ROS topic tokens, or start with reserved `encoded_`, are
encoded as `encoded_` plus the camera output name's UTF-8 bytes in hexadecimal.
Simple names such as `world` and `wrist` remain unchanged.

### Raw and compressed transport

The default `image_transport:=both` publishes raw `sensor_msgs/msg/Image` (`rgb8`)
and `sensor_msgs/msg/CompressedImage` on the conventional `image_raw/compressed`
topic. The latter passes through Studio's **original JPEG bytes** without
re-encoding or additional quality loss. Select the output at startup:

```sh
pixi run bridge image_transport:=compressed
pixi run bridge image_transport:=raw
# Both is the default; the SO-ARM101 launch accepts the same argument.
pixi run bridge image_transport:=both
```

In compressed-only mode, the SDK inspects JPEG headers but **does not decode
pixels or allocate RGB arrays**. Raw and both modes retain full pixel decoding.
JPEG header validation checks format, size bounds, and descriptor dimensions,
but cannot guarantee the compressed pixel stream is intact without decoding;
corruption after a valid header may be detected only by a consuming decoder.

Use an `image_transport` subscriber with the `compressed` transport and base topic
`/studio/bridge/cameras/world/image_raw`, or subscribe directly to `CompressedImage`
on its `/compressed` subtopic. The environment includes the compressed transport
plugin. The bundled RViz configs retain raw transport; choose **compressed** in the
Image display's transport setting for compressed-only mode. A raw-only consumer
can instead use the installed republisher (run from `physical-ai-scene-builder/integrations/ros2`):

```sh
pixi run ros2 run image_transport republish --ros-args \
  -p in_transport:=compressed -p out_transport:=raw \
  -r in:=/studio/bridge/cameras/world/image_raw \
  -r out:=/studio/world_decoded \
  -p qos_overrides./studio/bridge/cameras/world/image_raw/compressed.subscription.reliability:=best_effort
```

CameraInfo remains on the sibling `camera_info` topic in every output mode and
is published once per supported sample, not once per transport.
`publish_images:=false` disables all three outputs. Both mode publishes both
representations regardless of subscriber count and increases ROS traffic compared
with raw-only; compressed-only reduces traffic and skips local pixel decoding.
Studio's JPEG quality is 85; ROS encoder-quality settings do not affect pass-through.

Each image retains its originating simulator timestamp, dimensions, RGB row order,
and optical frame ID, for example `studio/bridge/cameras/world_optical_frame`.
Frame IDs include the bridge's actual namespace/name. Pixels use optical conventions
(right/down/forward). For each supported perspective-camera image, the bridge
publishes `sensor_msgs/msg/CameraInfo` with the **same timestamp, optical frame ID,
width, and height**, using the same best-effort sensor QoS.

Calibration is derived from the connected client's compiled MuJoCo camera and its
effective mono rendering frustum, including explicit focal lengths and
principal-point offsets as well as ordinary `fovy` cameras. The profile maps each
`outputName` to its MuJoCo `camera` name. Actual image dimensions are used, not an
assumed MJCF `resolution`; calibration is recomputed when dimensions change.
This is synthetic model calibration, not an empirical calibration.
`K` contains the intrinsics, `R` is identity, `P` is monocular with zero translation,
and `D` has five zero coefficients (`plumb_bob`), since these native perspective
images have no lens distortion. No binning or cropped ROI is declared.

Orthographic cameras and invalid calibration produce a warning and a
`camera_info_errors` diagnostic; RGB forwarding continues without CameraInfo for
the affected camera. `published_camera_info` counts published calibration messages.
Camera definitions are taken from the connected local model; arbitrary server-side
camera-parameter mutations are not synchronized by the SDK. Reconnect after such
changes. `publish_images:=false` disables both image and CameraInfo forwarding.

**Camera TF is not published.** CameraInfo alone does not place the camera in the
robot/world TF tree; use an image viewer directly, or provide the correct optical
transform before using a spatial RViz Camera display. SO-ARM101 robot-link TF does
not provide these camera frames.

Previews are JPEG-lossy, throttled by the profile's `streamHz`, and may be dropped
when consumers lag. The SDK retains at most two image-bearing snapshots and the
bridge keeps only the latest pending sample per configured camera. State-only
snapshots do not erase queued previews, and old images are never stamped with newer
state times. Reset/state changes clear queued images; terminal faults stop image
forwarding. This is live monitoring, not frame-complete training data.

Diagnostics include `camera_status`, `image_transport`, `published_images`
(raw messages), `published_compressed_images`, `dropped_image_snapshots`
(SDK queue replacements, not ZeroMQ transport loss), and `replaced_images` (bridge
pending-frame replacements). If no images arrive, check `camera_status` and the
Generate RGB/camera settings. To disable rendering requests and forwarding:

```sh
pixi run bridge publish_images:=false
```

## SO-ARM101 robot model

`bridge-so-arm101.launch.py` includes `bridge.launch.py` and adds
`robot_state_publisher` with the upstream `so_arm101_description` URDF (see
[External](#external-imported-via-upstream-ros-depsrepos); run
`pixi run install-deps` before `pixi run build`). It maps the URDF joints to the
Studio SO-101 joints and opens RViz with a bundled SO-ARM101 configuration:

```sh
pixi run ros2 launch robotic_studio_ros bridge-so-arm101.launch.py
# Scenes that prefix imported robots, for example the seeded SO-101 scene:
pixi run ros2 launch robotic_studio_ros bridge-so-arm101.launch.py studio_joint_prefix:=robot_1__
```

For a downloaded archive, append `connection:="$(realpath ../connection.json)"`
to either command. Use the prefix matching your scene's actual joint names.

| ROS (URDF) joint      | Studio joint            |
| --------------------- | ----------------------- |
| `shoulder_pan_joint`  | `<prefix>shoulder_pan`  |
| `shoulder_lift_joint` | `<prefix>shoulder_lift` |
| `elbow_flex_joint`    | `<prefix>elbow_flex`    |
| `wrist_flex_joint`    | `<prefix>wrist_flex`    |
| `wrist_roll_joint`    | `<prefix>wrist_roll`    |
| `gripper_joint`       | `<prefix>gripper`       |

The table order is also the `joint_commands` vector order. The launch accepts the
generic bridge arguments plus `studio_joint_prefix` (default empty). The internal
`ros_joint_names`/`studio_joint_names` arguments shown by `--show-args` are set by
this launch file. `robot_state_publisher` runs in the bridge namespace, subscribes
to `bridge/joint_states`, publishes `/studio/robot_description`, and broadcasts the
robot link TF on `/tf` stamped with simulation time (`use_sim_time` applies to it
and RViz). It runs with `ignore_timestamp=true`, so TF keeps being published at the
stream rate while simulation stepping is paused and the joint-state stamps are
frozen. The RViz fixed frame is `base_link`; the bundled configuration hardcodes
the `/studio` namespace and shows the `world` camera when present.

Limitations:

- The robot pose in the Studio world is not published; TF starts at the URDF
  `world`/`base_link` frames.
- The upstream URDF and Studio's `so101_new_calib.xml` agree through the wrist
  (within 0.05°), but the joint zeros differ slightly: the URDF `gripper_link` is
  rotated about 2.7° about the wrist-roll axis (URDF ≈ Studio − 0.047 rad) and the
  jaw about 10.3° (URDF ≈ Studio + 0.18 rad). No offsets are applied, so RViz
  shows these visual differences.
- Joint limits differ: the URDF gripper range is `0..1.70` rad versus Studio's
  `-0.17..1.75` rad, and wrist roll/flex and elbow ranges are narrower in the
  URDF. Commands are validated against the Studio limits only.

## Interfaces and configuration

| Interface                                              | Type                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `/studio/bridge/joint_commands`                        | `std_msgs/msg/Float64MultiArray` (full controllable-joint position vector) |
| `/studio/bridge/joint_states`                          | `sensor_msgs/msg/JointState` (position/velocity, no fabricated effort)     |
| `/studio/bridge/pause`                                 | `std_srvs/srv/SetBool` (`true` pauses, `false` resumes)                    |
| `/studio/bridge/reset`                                 | `std_srvs/srv/Trigger`                                                     |
| `/studio/bridge/select_initial_state`                  | `robotic_studio_interfaces/srv/SelectInitialState`                         |
| `/studio/bridge/recording/start`                       | `robotic_studio_interfaces/srv/StartRecording`                             |
| `/studio/bridge/recording/stop`                        | `robotic_studio_interfaces/srv/StopRecording` (`save` or discard)          |
| `/studio/bridge/status`                                | `robotic_studio_interfaces/msg/BridgeStatus` (latched session status)      |
| `/studio/bridge/diagnostics`                           | `diagnostic_msgs/msg/DiagnosticArray`                                      |
| `/studio/bridge/cameras/<camera>/image_raw`            | `sensor_msgs/msg/Image` (`rgb8` previews)                                  |
| `/studio/bridge/cameras/<camera>/image_raw/compressed` | `sensor_msgs/msg/CompressedImage` (original JPEG preview)                  |
| `/studio/bridge/cameras/<camera>/camera_info`          | `sensor_msgs/msg/CameraInfo` (model-derived perspective calibration)       |
| `/clock`                                               | `rosgraph_msgs/msg/Clock` (optional)                                       |

Joint states, images, and clock use shallow best-effort QoS; commands and services are
reliable. Status is reliable and transient-local (depth 1); it is republished on
change and at least every second (every 0.2 s while running). Consumers should set `use_sim_time=true`. The bridge uses steady wall
time for scheduling and watchdogs, so a paused simulated clock cannot deadlock it.

Parameters are read at startup and read-only:

| Parameter            | Default                 | Meaning                                            |
| -------------------- | ----------------------- | -------------------------------------------------- |
| `connection`         | `http://localhost:3000` | App URL or absolute connection-file path           |
| `timeout_s`          | `5.0`                   | SDK request/connection timeout                     |
| `command_timeout_s`  | `1.0`                   | Maximum wall-time age of a position command        |
| `state_timeout_s`    | `5.0`                   | Maximum age without a newer native stream sequence |
| `publish_clock`      | `true`                  | Publish the global simulation clock                |
| `publish_images`     | `true`                  | Request and forward simulator RGB camera previews  |
| `image_transport`    | `both`                  | Image output: `raw`, `compressed`, or `both`       |
| `ros_joint_names`    | unset                   | Optional ROS-side joint-name array                 |
| `studio_joint_names` | unset                   | Matching Studio joint-name array                   |

Without a mapping, all named hinge/slide joints are published under their native
names. Only unambiguous profile-declared position actuators accept commands.
Command arrays follow this mapping order after filtering out read-only joints;
`joint_states` continues to include all mapped joints.
To remap/subset joints, provide both name arrays as comma-separated launch
arguments, through a ROS parameter file, or as direct node arguments:

```sh
pixi run bridge ros_joint_names:=shoulder studio_joint_names:=YOUR_SCENE_JOINT
```

```sh
pixi run ros2 run robotic_studio_ros bridge \
  --ros-args -p 'ros_joint_names:=[shoulder]' \
  -p 'studio_joint_names:=[YOUR_SCENE_JOINT]'
```

Diagnostics report session identity, state revision, step counter, phase, received/
replaced/rejected command counts, command joint order, real-time factor, and faults. Receipt on the
command topic is not an acknowledgement of applied motion. Invalid commands are
logged and diagnosed; failed services return an explicit message. Transport/lease
failures and unknown command outcomes require restarting the bridge; motion is
never retried or replayed automatically. A missing Generate stream at startup or
an unrecoverable connection/stream failure is logged and the bridge executable
exits with code 1. Recoverable faults such as a joint-command watchdog timeout
leave the bridge alive for fresh commands and explicit resume.
Ctrl+C closes the SDK on its owning thread
and releases its lease without terminating the Studio worker.

## Validation and limits

The tests include a private loopback Zenoh router, real ROS publishers/subscribers
and services, and a native MuJoCo worker with a synthetic position-controlled
joint. They validate motion, limit rejection, watchdog recovery, reset, initial-state
selection, recording start/stop/save, status and clock/state publication, worker
failure, and actual rendered RGB forwarding. The panel gtests cover button
enablement and plugin export/construction. Camera tests also
cover pixel bytes, timestamps, noncontiguous arrays, namespaced IDs, bounded
replacement, multiple cameras, and disabled/unavailable streams. Calibration tests
compare projection against rendered targets for FOV-based and explicit-intrinsics
cameras at different resolutions. Native ROS tests verify paired CameraInfo headers
and unsupported-camera diagnostics without losing RGB.
Tests close their own router and worker; they do
not require a running app, use fixed worker ports, or touch Studio data.

Model-derived TF (beyond the SO-ARM101 `robot_state_publisher` launch), camera TF,
orthographic CameraInfo, recording metadata and batch recording, trajectory actions, headless control, hardware,
and `ros2_control` are not implemented in this MVP. The initial-state list is read
when the bridge connects. A recording stopped from the browser is not reported as
pending by the bridge. A browser/SO-101 user journey and the panel with a live
Studio session still need manual validation. The repository's
`internal/docs/ros2-integration.md` describes the architecture and follow-up work; it is not
part of the downloaded control bundle.

## Connection troubleshooting and controller handoff

- **No active stream:** open the saved scene's Generate tab and turn on **Stream to client**.
  The bridge controls that native session; it does not start a standalone simulator.
- **Scene fingerprint mismatch or stale endpoints:** save the scene and download a fresh archive.
  Do not manually edit the shared connection file.
- **Controller lease busy:** stop the other Python controller or ROS bridge. Pausing the bridge
  keeps its lease; Ctrl+C releases it without stopping Studio's worker. Keep streaming active
  and then start the other controller.
- **No motion:** the bridge starts paused. Publish a fresh full joint vector in the documented
  order and explicitly resume; a stale-command fault also needs fresh commands and resume.
- **No ROS messages:** check that the Zenoh router is running and that all terminals use the same
  Pixi workspace, middleware, and ROS domain.

### External (imported via `upstream-ros-deps.repos`)

| Source                                                        | Description                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [ros2_so_arm](https://github.com/ros-physical-ai/ros2_so_arm) | URDF descriptions, MoveIt config, Gazebo support, and utilities for the SO-ARM robots |
