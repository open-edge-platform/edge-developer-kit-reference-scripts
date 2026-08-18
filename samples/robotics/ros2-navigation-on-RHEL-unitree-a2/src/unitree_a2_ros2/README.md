# Unitree A2 -> RViz2 (ROS 2)

This package gives you a clean starting point to visualize Unitree A2 joint motion in RViz2.

It includes:
- The official Unitree A2 URDF in `urdf/unitree_a2_official.urdf`
- Official A2 meshes in `meshes/` (imported from `https://github.com/unitreerobotics/unitree_ros/tree/master/robots/a2_description`)
- A local visualization launch (`view_a2.launch.py`) using `joint_state_publisher_gui`
- A physical bridge launch (`mirror_physical_a2.launch.py`) that forwards hardware JointState into `/joint_states`
- A `joint_state_bridge` node with optional joint name remapping
- A `sportstate_odom_bridge` node that converts `rt/sportmodestate` to `/odom` and `odom -> base_link` TF
- A full-walk launch (`mirror_a2_full_walk.launch.py`) combining lowstate joints + sportstate odometry

## 1) Build

From your workspace root:

```bash
cd /home/user/Workspaces/Robotics/robot_ws
source /opt/ros/$ROS_DISTRO/setup.bash
colcon build --symlink-install
source install/setup.bash
```

## 2) Validate model with joint sliders (local testing)

```bash
ros2 launch unitree_a2_viz view_a2.launch.py
```

Use the joint sliders to interactively command joint positions and verify motion in RViz2.

## 3) Mirror physical Unitree A2 motion from rt/lowstate (real hardware)

The real A2 hardware publishes raw motor state on `rt/lowstate` (not standard ROS `JointState`).
Use the dedicated lowstate bridge:

```bash
ros2 launch unitree_a2_viz mirror_a2_lowstate.launch.py
```

This subscribes to `/rt/lowstate` (default), extracts the 12 leg joint motor states, and publishes them as `/joint_states` for RViz visualization.

If your lowstate topic is on a different name:

```bash
ros2 launch unitree_a2_viz mirror_a2_lowstate.launch.py lowstate_topic:=/your/custom/lowstate/topic
```

## 4) If you already have a JointState bridge (alternative)

If you have written your own `rt/lowstate` → `JointState` converter or use a third-party one, you can run:

```bash
ros2 launch unitree_a2_viz mirror_physical_a2.launch.py input_joint_topic:=/joint_states
```

This simpler launch assumes a `JointState` topic is already available.

## 5) Motor index -> joint name mapping (if needed)

The `lowstate_bridge` uses these default A2 leg joint names for motor indices 0-11:
- Motor 0: `FR_hip_joint`, Motor 1: `FR_thigh_joint`, Motor 2: `FR_calf_joint`
- Motor 3: `FL_hip_joint`, Motor 4: `FL_thigh_joint`, Motor 5: `FL_calf_joint`
- Motor 6: `RR_hip_joint`, Motor 7: `RR_thigh_joint`, Motor 8: `RR_calf_joint`
- Motor 9: `RL_hip_joint`, Motor 10: `RL_thigh_joint`, Motor 11: `RL_calf_joint`

If your SDK or URDF uses different joint naming, override via `motor_index_map` parameter (format: comma-separated `index:joint_name`):

```bash
ros2 launch unitree_a2_viz mirror_a2_lowstate.launch.py \
  motor_index_map:="0:leg_fr_hip,1:leg_fr_thigh,2:leg_fr_calf,..."
```

Or edit [config/joint_map_example.yaml](config/joint_map_example.yaml) and include it in the launch node parameters.

## 6) Full body motion parity (advanced)

Joint movement mirrors the physical robot through `/joint_states`. For full body pose tracking in RViz, also publish TF transforms:

- `odom -> base_link`: from your state estimator or IMU filter  
- All leg transforms (`base_link -> FR_hip -> ...`) are generated automatically by `robot_state_publisher`

Example: integrate your A2 estimator's IMU orientation and odometry into the TF tree so RViz tracks the complete body motion.

## 7) Full walking visualization (recommended for physical A2)

If Unitree only provides high-level state (sport mode) for odometry, use:

```bash
ros2 launch unitree_a2_viz mirror_a2_full_walk.launch.py
```

This launch does all of the following:
- `lowstate_bridge`: `rt/lowstate` -> `/joint_states`
- `sportstate_odom_bridge`: `rt/sportmodestate` -> `/odom` and `odom -> base_link`
- `robot_state_publisher`: full TF tree from URDF
- RViz with `Fixed Frame = odom` (`rviz/a2_walk.rviz`)

If your sport state topic is different or your SDK module name differs:

```bash
ros2 launch unitree_a2_viz mirror_a2_full_walk.launch.py \
  sportstate_topic:=/rt/lf/sportmodestate \
  sportstate_msg_module:=unitree_go.msg
```
