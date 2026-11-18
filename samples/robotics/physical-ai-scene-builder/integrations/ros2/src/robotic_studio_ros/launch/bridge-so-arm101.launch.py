# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from pathlib import Path

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import Command, FindExecutable, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare

# URDF joint names of so_arm101_description and the matching Studio SO-101 MJCF joints, in command order.
JOINTS = (
    ("shoulder_pan_joint", "shoulder_pan"),
    ("shoulder_lift_joint", "shoulder_lift"),
    ("elbow_flex_joint", "elbow_flex"),
    ("wrist_flex_joint", "wrist_flex"),
    ("wrist_roll_joint", "wrist_roll"),
    ("gripper_joint", "gripper"),
)
FORWARDED = (
    "connection", "namespace", "publish_clock", "publish_images", "image_transport",
    "rviz", "use_sim_time", "command_timeout_s",
)


def generate_launch_description() -> LaunchDescription:
    launch_dir = Path(__file__).resolve().parent
    prefix = LaunchConfiguration("studio_joint_prefix")
    studio_names: list = []
    for index, (_, studio_name) in enumerate(JOINTS):
        studio_names += [prefix, studio_name + ("," if index < len(JOINTS) - 1 else "")]
    robot_description = Command([
        FindExecutable(name="xacro"), " ",
        PathJoinSubstitution([FindPackageShare("so_arm101_description"), "urdf", "so_arm101.urdf.xacro"]),
    ])
    return LaunchDescription([
        DeclareLaunchArgument("connection", default_value="http://localhost:3000"),
        DeclareLaunchArgument(
            "namespace", default_value="studio",
            description="Bridge namespace; the bundled RViz configuration expects 'studio'.",
        ),
        DeclareLaunchArgument("publish_clock", default_value="true"),
        DeclareLaunchArgument("publish_images", default_value="true"),
        DeclareLaunchArgument("image_transport", default_value="both", description="Image output: raw, compressed, or both."),
        DeclareLaunchArgument("rviz", default_value="true", description="Start RViz alongside the bridge."),
        DeclareLaunchArgument(
            "rviz_config", default_value=str(launch_dir.parent / "config" / "so_arm101.rviz"),
            description="RViz configuration file.",
        ),
        DeclareLaunchArgument(
            "use_sim_time", default_value="true",
            description="Use /clock for RViz and robot_state_publisher time.",
        ),
        DeclareLaunchArgument("command_timeout_s", default_value="1.0"),
        DeclareLaunchArgument(
            "studio_joint_prefix", default_value="",
            description="Prefix of the SO-101 joints in the Studio scene, for example 'robot_1__'.",
        ),
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(str(launch_dir / "bridge.launch.py")),
            launch_arguments={
                **{name: LaunchConfiguration(name) for name in FORWARDED},
                "rviz_config": LaunchConfiguration("rviz_config"),
                "ros_joint_names": ",".join(ros_name for ros_name, _ in JOINTS),
                "studio_joint_names": studio_names,
            }.items(),
        ),
        Node(
            package="robot_state_publisher",
            executable="robot_state_publisher",
            name="robot_state_publisher",
            namespace=LaunchConfiguration("namespace"),
            output="screen",
            parameters=[{
                "robot_description": ParameterValue(robot_description, value_type=str),
                "use_sim_time": ParameterValue(LaunchConfiguration("use_sim_time"), value_type=bool),
                # Paused simulation repeats joint-state stamps; publish TF for each message anyway.
                "ignore_timestamp": True,
            }],
            remappings=[("joint_states", "bridge/joint_states")],
        ),
    ])
