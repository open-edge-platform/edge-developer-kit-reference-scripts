# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.substitutions import FindPackageShare
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory

def generate_launch_description() -> LaunchDescription:
    slam_config = get_package_share_directory('unitree_a2_nav')+'/config/slam_toolbox.yaml'
    nav2_config = get_package_share_directory('unitree_a2_nav')+'/config/nav2_a2.yaml'

    declare_rviz_config_file = DeclareLaunchArgument(
        'rviz_config_file',
        default_value=PathJoinSubstitution(
            [FindPackageShare('unitree_a2_nav'), 'rviz', 'slam_nav2.rviz']
        ),
        description='RViz configuration file.',
    )

    rviz_config_file = LaunchConfiguration('rviz_config_file')

    robot_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            PathJoinSubstitution([FindPackageShare('unitree_a2_ros2'), 'launch', 'robot.launch.py'])
        )
    )

    slam_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            PathJoinSubstitution([FindPackageShare('slam_toolbox'), 'launch', 'online_async_launch.py'])
        ),
        launch_arguments={
            'use_sim_time': 'false',
            'autostart': 'true',
            'use_lifecycle_manager': 'false',
            'slam_params_file': slam_config,
        }.items(),
    )

    nav2_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            PathJoinSubstitution([FindPackageShare('nav2_bringup'), 'launch', 'navigation_launch.py'])
        ),
        launch_arguments={
            'use_sim_time': 'false',
            'autostart': 'true',
            'params_file': nav2_config,
            'use_composition': 'False',
        }.items(),
    )

    realsense2_camera_launch = IncludeLaunchDescription(
            PythonLaunchDescriptionSource(
                PathJoinSubstitution([FindPackageShare('realsense2_camera'), 'launch', 'rs_launch.py'])
            ),
            launch_arguments={
                'camera_namespace': '/',
                'camera_name': 'camera',
                'align_depth.enable': 'true',
                'rgb_camera.color_profile': '640,360,30',
                'pointcloud.enable': 'false',
            }.items(),
    )

    realsense2_camera_tf = Node(
        package='tf2_ros',
        executable='static_transform_publisher',
        name='camera_static_tf_publisher',
        arguments=['0.0', '0.0', '0.0', '0.0', '0.0', '0.0', 'base_link', 'camera_link']
    )

    fast_mapping_node = Node(
            package='fast_mapping',
            executable='fast_mapping_node',
            output='screen',
            name='fast_mapping'
    )

    parameters=[{
          'frame_id':'base_link',
          'use_sim_time':False,
          'subscribe_depth':False,
          'subscribe_rgb':False,
          'subscribe_scan':True,
          'topic_queue_size': 100,
          'approx_sync':True,
          'use_action_for_goal':True,
          'Reg/Strategy':'1',
          'Reg/Force3DoF':'true',
          'RGBD/NeighborLinkRefining':'True',
          'Grid/RangeMin':'0.2', # ignore laser scan points on the robot itself
          'Optimizer/GravitySigma':'0' # Disable imu constraints (we are already in 2D)
    }]

    remappings = [
        # ('odom_info', '/odom'),
        ('rgb/image', '/camera/color/image_raw'),
        ('rgb/camera_info', '/camera/color/camera_info'),
        ('depth/image', '/camera/aligned_depth_to_color/image_raw')
    ]

    rtabmap_odom_node = Node(
        package='rtabmap_odom', executable='rgbd_odometry', output='screen',
        parameters=parameters,
        remappings=remappings
    )
    
    rtabmap_slam_node = Node(
        package='rtabmap_slam', executable='rtabmap', output='screen',
        parameters=parameters,
        remappings=remappings,
        arguments=['-d']
    )

    rviz2_node = Node(
        package='rviz2',
        executable='rviz2',
        output='screen',
        arguments=['-d', rviz_config_file],
    )

    return LaunchDescription([
        declare_rviz_config_file,
        robot_launch,
        slam_launch,
        nav2_launch,
        realsense2_camera_launch,
        realsense2_camera_tf,
        
        # rtabmap_odom_node,
        # rtabmap_slam_node,

        # fast_mapping_node,
        rviz2_node
    ])
