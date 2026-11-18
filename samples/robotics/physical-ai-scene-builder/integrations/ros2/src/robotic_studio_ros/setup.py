# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from glob import glob

from setuptools import setup

setup(
    name="robotic_studio_ros",
    version="0.1.0",
    packages=["robotic_studio_ros"],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/robotic_studio_ros"]),
        ("share/robotic_studio_ros", ["package.xml"]),
        ("share/robotic_studio_ros/launch", glob("launch/*.launch.py")),
        ("share/robotic_studio_ros/config", glob("config/*.rviz")),
    ],
    install_requires=["setuptools", "robotic-studio", "mujoco>=3.10.0", "Pillow>=10.0.0"],
    zip_safe=True,
    maintainer="Intel Robotics",
    maintainer_email="robotics@intel.com",
    description="Position-control bridge for Robotic Studio.",
    license="UNLICENSED",
    entry_points={"console_scripts": ["bridge = robotic_studio_ros.node:main"]},
)
