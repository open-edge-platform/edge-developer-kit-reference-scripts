# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

cmake_minimum_required(VERSION 3.10)
project(unitree_a2_control)

# Default to C99
if(NOT CMAKE_C_STANDARD)
  set(CMAKE_C_STANDARD 99)
endif()

# Default to C++17 or C++20 (your code uses cxx_std_20)
if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 20)
endif()

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

include_directories(include include/nlohmann)
link_directories(src)

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(unitree_go REQUIRED)
find_package(unitree_hg REQUIRED)
find_package(unitree_api REQUIRED)
find_package(rclcpp REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(rosbag2_cpp REQUIRED)
find_package(Eigen3 REQUIRED)

add_executable(read_motion_state src/read_motion_state.cpp)
target_compile_features(read_motion_state PRIVATE cxx_std_20)

add_executable(a2_sport_client src/a2_sport_client_node.cpp src/a2_sport_client.cpp)
target_compile_features(a2_sport_client PRIVATE cxx_std_20)

add_executable(a2_cmd_vel_node src/a2_cmd_vel_node.cpp src/a2_sport_client.cpp)
target_compile_features(a2_cmd_vel_node PRIVATE cxx_std_20)

# Define the shared target links using correct modern CMake targets
set(TARGET_DEPENDENCIES
  unitree_go::unitree_go
  unitree_hg::unitree_hg
  unitree_api::unitree_api
  rclcpp::rclcpp
  geometry_msgs::geometry_msgs
  std_msgs::std_msgs
  rosbag2_cpp::rosbag2_cpp
  Eigen3::Eigen
)

# Link dependencies to executables
target_link_libraries(read_motion_state PRIVATE ${TARGET_DEPENDENCIES})
target_link_libraries(a2_sport_client PRIVATE ${TARGET_DEPENDENCIES})
target_link_libraries(a2_cmd_vel_node PRIVATE ${TARGET_DEPENDENCIES})

install(TARGETS 
        read_motion_state
        a2_sport_client
        a2_cmd_vel_node
  DESTINATION lib/${PROJECT_NAME})

if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()

ament_package()