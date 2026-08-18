# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, TimerAction, ExecuteProcess, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.conditions import IfCondition
from launch.substitutions import Command, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare
from ament_index_python.packages import get_package_share_directory

def generate_launch_description() -> LaunchDescription:
    pkg_share = FindPackageShare('unitree_a2_ros2')
    urdf_file = PathJoinSubstitution([pkg_share, 'model', 'urdf', 'unitree_a2.urdf'])
    robot_description = Command(['cat ', urdf_file])

    hesailidar_config = get_package_share_directory('unitree_a2_ros2')+'/config/hesai_lidar.yaml'
    ydlidar_config = get_package_share_directory('ydlidar_ros2_driver')+'/params/TG.yaml'
    velodyne_config = get_package_share_directory('unitree_a2_ros2')+'/config/velodyne_vlp16.yaml'
    
    
    lowstate_topic = LaunchConfiguration('lowstate_topic')
    sportstate_topic = LaunchConfiguration('sportstate_topic')
    sportstate_module = LaunchConfiguration('sportstate_msg_module')
    motor_index_map = LaunchConfiguration('motor_index_map')
    use_lidar = LaunchConfiguration('use_lidar')

    declare_use_sim_time = DeclareLaunchArgument('use_sim_time', default_value='false')
    declare_pointcloud_topic = DeclareLaunchArgument('pointcloud_topic', default_value='/lidar_points')
    declare_scan_topic = DeclareLaunchArgument('scan_topic', default_value='/scan')

    declare_lowstate_topic = DeclareLaunchArgument(
        'lowstate_topic',
        default_value='/lowstate',
        description='Unitree low-level state topic for joint states.',
    )

    declare_sportstate_topic = DeclareLaunchArgument(
        'sportstate_topic',
        default_value='/sportmodestate',
        description='Unitree high-level sport state topic with odometry/pose.',
    )

    declare_sportstate_module = DeclareLaunchArgument(
        'sportstate_msg_module',
        default_value='unitree_go.msg',
        description='Python module for SportModeState message.',
    )

    declare_motor_index_map = DeclareLaunchArgument(
        'motor_index_map',
        default_value='',
        description='Optional motor index -> joint name mapping as comma-separated idx:name pairs.',
    )

    rsp = Node(
        package='robot_state_publisher',
        executable='robot_state_publisher',
        output='screen',
        parameters=[{'robot_description': robot_description}],
    )

    lowstate_bridge = Node(
        package='unitree_a2_ros2',
        executable='joint_state_bridge',
        output='screen',
        parameters=[
            {
                'input_mode': 'lowstate',
                'input_lowstate_topic': lowstate_topic,
                'output_joint_topic': '/joint_states',
                'lowstate_msg_type': 'unitree_hg.msg',
                'motor_index_map': motor_index_map,
                'use_tau_est': True,
            }
        ],
    )

    a2_cmd_vel = Node(
        package='unitree_a2_control',
        executable='a2_cmd_vel_node',
        output='screen',
    )

    odom_bridge = Node(
        package='unitree_a2_ros2',
        executable='sportstate_odom_bridge',
        output='screen',
        parameters=[
            {
                'input_sportstate_topic': sportstate_topic,
                'sportstate_msg_module': sportstate_module,
                'output_odom_topic': '/odom',
                'output_imu_topic': '/imu/data',
                'odom_frame': 'odom',
                'base_frame': 'base_link',
                'imu_frame': 'imu_link',
                'publish_tf': True,
                'publish_odom': True,
                'publish_imu': True,
            }
        ],
    )

    hesai_lidar_node = Node(
        package='hesai_ros_driver',
        namespace='hesai_ros_driver',  
        executable='hesai_ros_driver_node', 
        parameters=[{'config_path': hesailidar_config}]
    )

    hesai_static_tf = Node(
        package='tf2_ros',
        executable='static_transform_publisher',
        name='hesai_static_tf_publisher',
        arguments=['0.33767', '0.0', '0.08134', '1.5707963267948966', '0.0', '1.5707963267948966', 'base_link', 'hesai_lidar']
    )

    ydlidar_node = Node(
        package='ydlidar_ros2_driver',
        executable='ydlidar_ros2_driver_node',
        name='ydlidar_ros2_driver_node',
        output='screen',
        emulate_tty=True,
        parameters=[ydlidar_config]
    )

    velodyne_tf = Node(
        package='tf2_ros',
        executable='static_transform_publisher',
        name='base_link_to_velodyne_tf',
        output='screen',
        arguments=[
            '--x', '0.03', '--y', '0.0', '--z', '0.20',
            '--roll', '0', '--pitch', '0', '--yaw', '0',
            '--frame-id', 'base_link', '--child-frame-id', 'velodyne',
        ],
    )
    velodyne_driver = Node(
        package='velodyne_driver',
        executable='velodyne_driver_node',
        output='screen',
        parameters=[
            velodyne_config
        ],
    )
    velodyne_transform = Node(
        package='velodyne_pointcloud',
        executable='velodyne_transform_node',
        output='screen',
        parameters=[
            PathJoinSubstitution([FindPackageShare('velodyne_pointcloud'), 'config',
                                  'VLP16-velodyne_transform_node-params.yaml']),
            {'calibration': PathJoinSubstitution([FindPackageShare('velodyne_pointcloud'),
                                                  'params', 'VLP16db.yaml'])},
        ],
    )
    velodyne_laserscan = Node(
        package='velodyne_laserscan',
        executable='velodyne_laserscan_node',
        output='screen',
        parameters=[PathJoinSubstitution([pkg_share, 'config', 'velodyne_laserscan.yaml'])],
    )


    imu_static_tf = Node(
        package='tf2_ros',
        executable='static_transform_publisher',
        name='imu_static_tf_publisher',
        output='screen',
        arguments=[
            '--x', '0.0', '--y', '0.0', '--z', '0.0',
            '--roll', '0.0', '--pitch', '0.0', '--yaw', '0.0',
            '--frame-id', 'base_link', '--child-frame-id', 'imu_link',
        ],
    )

    realsense2_camera_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            PathJoinSubstitution([FindPackageShare('realsense2_camera'), 'launch', 'rs_launch.py'])
        ),
        launch_arguments={
            'camera_namespace': '/',
            'camera_name': 'camera',
            'align_depth.enable': 'true',
            # 640x360 is NOT a supported RGB profile on this D435I at all (confirmed
            # via `rs-enumerate-devices`: only 1920x1080, 1280x720, 640x480, 424x240
            # are offered) -- the node rejected it and crashed on startup before the
            # color stream (and therefore web_video_server's feed) ever came up.
            # 640x480x30 keeps the same width/fps, just a supported height.
            'rgb_camera.color_profile': '848,480,30',
            'pointcloud.enable': 'true',
            # 'clip_distance': '1.0',       # discard depth beyond 50cm at driver level
            # 'config_file': realsense_config,
        }.items(),
    )

    realsense2_camera_tf = Node(
        package='tf2_ros',
        executable='static_transform_publisher',
        name='camera_static_tf_publisher',
        # args: x y z yaw pitch roll parent child. The RealSense is physically
        # level, so pitch remains 0.0. Verify the point cloud in RViz before
        # changing this transform to model a different physical installation.
        arguments=['0.38', '0.0', '0.14', '0.0', '0.0', '0.0', 'base_link', 'camera_link']
    )

    return LaunchDescription([
        declare_use_sim_time,
        declare_pointcloud_topic,
        declare_scan_topic,

        declare_lowstate_topic,
        declare_sportstate_topic,
        declare_sportstate_module,
        declare_motor_index_map,

        rsp,
        lowstate_bridge,
        a2_cmd_vel,
        odom_bridge,
        imu_static_tf,

        velodyne_driver, 
        velodyne_transform, 
        velodyne_laserscan,
        velodyne_tf, 

        # realsense2_camera_launch,
        # realsense2_camera_tf,

        # ydlidar_node,
        
        # hesai_lidar,
        # hesai_static_tf
    ])
