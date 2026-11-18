# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from pathlib import Path

from launch import LaunchContext, LaunchDescription
from launch.actions import DeclareLaunchArgument, OpaqueFunction, Shutdown
from launch.conditions import IfCondition
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue


def joint_names(context: LaunchContext, argument: str) -> list[str]:
    value = LaunchConfiguration(argument).perform(context).strip()
    if not value:
        return []
    names = [name.strip() for name in value.split(",")]
    if not all(names):
        raise ValueError(f"'{argument}' must be a comma-separated list of non-empty joint names.")
    return names


def launch_nodes(context: LaunchContext) -> list[Node]:
    parameters: dict[str, object] = {
        "connection": LaunchConfiguration("connection"),
        "publish_clock": ParameterValue(LaunchConfiguration("publish_clock"), value_type=bool),
        "publish_images": ParameterValue(LaunchConfiguration("publish_images"), value_type=bool),
        "image_transport": LaunchConfiguration("image_transport"),
        "command_timeout_s": ParameterValue(LaunchConfiguration("command_timeout_s"), value_type=float),
    }
    ros_names = joint_names(context, "ros_joint_names")
    studio_names = joint_names(context, "studio_joint_names")
    if ros_names or studio_names:
        # Empty arrays are omitted so the node keeps its typed STRING_ARRAY defaults.
        parameters.update(ros_joint_names=ros_names, studio_joint_names=studio_names)
    rviz_config = LaunchConfiguration("rviz_config").perform(context).strip()
    return [
        Node(
            package="robotic_studio_ros",
            executable="bridge",
            name="bridge",
            namespace=LaunchConfiguration("namespace"),
            output="screen",
            on_exit=Shutdown(reason="The Studio bridge exited."),
            parameters=[parameters],
        ),
        Node(
            package="rviz2",
            executable="rviz2",
            name="rviz2",
            namespace=LaunchConfiguration("namespace"),
            output="screen",
            arguments=["-d", rviz_config] if rviz_config else [],
            condition=IfCondition(LaunchConfiguration("rviz")),
            parameters=[{
                "use_sim_time": ParameterValue(LaunchConfiguration("use_sim_time"), value_type=bool),
            }],
        ),
    ]


def generate_launch_description() -> LaunchDescription:
    return LaunchDescription([
        DeclareLaunchArgument("connection", default_value="http://localhost:3000"),
        DeclareLaunchArgument("namespace", default_value="studio"),
        DeclareLaunchArgument("publish_clock", default_value="true"),
        DeclareLaunchArgument("publish_images", default_value="true"),
        DeclareLaunchArgument("image_transport", default_value="both", description="Image output: raw, compressed, or both."),
        DeclareLaunchArgument("rviz", default_value="true", description="Start RViz alongside the bridge."),
        DeclareLaunchArgument(
            "rviz_config", default_value=str(Path(__file__).resolve().parent.parent / "config" / "bridge.rviz"),
            description="RViz configuration file; empty starts RViz without one.",
        ),
        DeclareLaunchArgument(
            "use_sim_time", default_value="true",
            description="Use /clock for RViz time; requires the bridge or another simulation clock publisher.",
        ),
        DeclareLaunchArgument("command_timeout_s", default_value="1.0"),
        DeclareLaunchArgument(
            "ros_joint_names", default_value="",
            description="Optional comma-separated ROS joint names; requires studio_joint_names.",
        ),
        DeclareLaunchArgument(
            "studio_joint_names", default_value="",
            description="Optional comma-separated Studio joint names matching ros_joint_names.",
        ),
        OpaqueFunction(function=launch_nodes),
    ])
