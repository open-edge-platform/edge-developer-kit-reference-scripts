# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

cmake_minimum_required(VERSION 3.20)
project(robotic_studio_rviz)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(pluginlib REQUIRED)
find_package(rclcpp REQUIRED)
find_package(robotic_studio_interfaces REQUIRED)
find_package(rviz_common REQUIRED)
find_package(std_srvs REQUIRED)
find_package(Qt6 REQUIRED COMPONENTS Widgets)

set(CMAKE_AUTOMOC ON)

add_library(panel_state STATIC src/panel_state.cpp)
target_include_directories(panel_state PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>)
set_target_properties(panel_state PROPERTIES POSITION_INDEPENDENT_CODE ON)

add_library(${PROJECT_NAME} SHARED
  src/studio_control_panel.cpp
  include/robotic_studio_rviz/studio_control_panel.hpp)
target_include_directories(${PROJECT_NAME} PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include/${PROJECT_NAME}>)
target_link_libraries(${PROJECT_NAME} PRIVATE
  panel_state
  pluginlib::pluginlib
  rclcpp::rclcpp
  rviz_common::rviz_common
  Qt6::Widgets
  ${robotic_studio_interfaces_TARGETS}
  ${std_srvs_TARGETS})

pluginlib_export_plugin_description_file(rviz_common plugin_description.xml)

install(TARGETS ${PROJECT_NAME}
  LIBRARY DESTINATION lib
  ARCHIVE DESTINATION lib
  RUNTIME DESTINATION bin)

if(BUILD_TESTING)
  set(PRIVATE_TEST_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../../internal/tests/ros2/robotic_studio_rviz")
  if(EXISTS "${PRIVATE_TEST_DIR}/test_panel_state.cpp" AND
      EXISTS "${PRIVATE_TEST_DIR}/test_plugin_load.cpp")
    find_package(ament_cmake_gtest REQUIRED)
    ament_add_gtest(test_panel_state "${PRIVATE_TEST_DIR}/test_panel_state.cpp")
    target_link_libraries(test_panel_state panel_state)
    ament_add_gtest(test_plugin_load "${PRIVATE_TEST_DIR}/test_plugin_load.cpp"
      ENV QT_QPA_PLATFORM=offscreen)
    target_link_libraries(test_plugin_load ${PROJECT_NAME} pluginlib::pluginlib
      rclcpp::rclcpp rviz_common::rviz_common Qt6::Widgets
      ${robotic_studio_interfaces_TARGETS} ${std_srvs_TARGETS})
  endif()
endif()

ament_package()
