# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from setuptools import find_packages, setup
from glob import glob

package_name = 'unitree_a2_ros2'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/config', glob('config/*.yaml')),
        ('share/' + package_name + '/launch', glob('launch/*.py')),
        ('share/' + package_name + '/rviz', glob('rviz/*')),
        ('share/' + package_name + '/model/urdf', glob('model/urdf/*')),
        ('share/' + package_name + '/model/meshes', glob('model/meshes/*')),
        
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='you',
    maintainer_email='you@example.com',
    description='ROS 2 visualization bridge for Unitree A2 in RViz2.',
    license='MIT',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'joint_state_bridge = src.joint_state_bridge:main',
            'lowstate_bridge = src.joint_state_bridge:lowstate_main',
            'sportstate_odom_bridge = src.sportstate_odom_bridge:main',
        ],
    },
)
