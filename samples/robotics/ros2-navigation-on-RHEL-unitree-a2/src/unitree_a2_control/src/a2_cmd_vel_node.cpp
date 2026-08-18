// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

#include <chrono>
#include <mutex>

#include <geometry_msgs/msg/twist_stamped.hpp>
#include <rclcpp/rclcpp.hpp>

#include "unitree_api/msg/request.hpp"
#include "a2_sport_client.h"

using namespace std::chrono_literals;

class A2CmdVelNode : public rclcpp::Node
{
public:
  A2CmdVelNode() : Node("a2_cmd_vel_node"), sport_client_(this)
  {
    cmd_vel_sub_ = this->create_subscription<geometry_msgs::msg::TwistStamped>(
        "/cmd_vel", 10,
        std::bind(&A2CmdVelNode::cmdVelCallback, this, std::placeholders::_1));

    control_timer_ = this->create_wall_timer(
        20ms, std::bind(&A2CmdVelNode::controlLoop, this));

    RCLCPP_INFO(this->get_logger(), "Listening on /cmd_vel (TwistStamped) and forwarding to SportClient::Move(vx, vy, vyaw)");
  }

private:
  void cmdVelCallback(const geometry_msgs::msg::TwistStamped::SharedPtr msg)
  {
    std::lock_guard<std::mutex> lock(twist_mutex_);
    latest_twist_ = msg->twist;
    has_twist_ = true;
    last_cmd_time_ = msg->header.stamp.sec == 0 && msg->header.stamp.nanosec == 0
                         ? this->now()
                         : rclcpp::Time(msg->header.stamp);
  }

  void controlLoop()
  {
    constexpr double kCmdTimeoutSec = 0.5;
    geometry_msgs::msg::Twist twist;

    {
      std::lock_guard<std::mutex> lock(twist_mutex_);
      if (!has_twist_)
      {
        return;
      }
      twist = latest_twist_;
    }

    const bool timed_out = (this->now() - last_cmd_time_).seconds() > kCmdTimeoutSec;
    const float vx = timed_out ? 0.0f : static_cast<float>(twist.linear.x);
    const float vy = timed_out ? 0.0f : static_cast<float>(twist.linear.y);
    const float vyaw = timed_out ? 0.0f : static_cast<float>(twist.angular.z);

    unitree_api::msg::Request req;
    sport_client_.Move(req, vx, vy, vyaw);
  }

  SportClient sport_client_;
  rclcpp::Subscription<geometry_msgs::msg::TwistStamped>::SharedPtr cmd_vel_sub_;
  rclcpp::TimerBase::SharedPtr control_timer_;

  std::mutex twist_mutex_;
  geometry_msgs::msg::Twist latest_twist_;
  rclcpp::Time last_cmd_time_{0, 0, RCL_ROS_TIME};
  bool has_twist_{false};
};

int main(int argc, char **argv)
{
  rclcpp::init(argc, argv);
  auto node = std::make_shared<A2CmdVelNode>();
  rclcpp::spin(node);
  rclcpp::shutdown();
  return 0;
}