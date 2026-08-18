// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

#include <iostream>
#include <string>
#include <chrono>
#include <thread>
#include <mutex>
#include <sstream>
#include <vector>
#include <rclcpp/rclcpp.hpp>
#include "unitree_api/msg/request.hpp"
#include "unitree_api/msg/response.hpp"
#include "a2_sport_client.h"

using namespace std::chrono_literals;

struct TestOption
{
    std::string name;
    int id;
};

const std::vector<TestOption> option_list = {
    {"damp", 0},
    {"balance_stand", 1},
    {"stop_move", 2},
    {"stand_down", 3},
    {"recovery_stand", 4},
    {"move", 5},
    {"switch_gait", 6},
    {"speed_level", 7},
    {"hand_stand", 8},
    {"auto_recovery_set", 9},
    {"free_walk", 10},
    {"classic_walk", 11},
    {"fast_walk", 12},
    {"euler", 13},
};

int ConvertToInt(const std::string &str)
{
    try
    {
        return std::stoi(str);
    }
    catch (const std::invalid_argument &)
    {
        return -1;
    }
    catch (const std::out_of_range &)
    {
        return -1;
    }
}

std::vector<float> ParseParameters(const std::string &param_str)
{
    std::vector<float> params;
    std::istringstream iss(param_str);
    float value;
    while (iss >> value)
    {
        params.push_back(value);
    }
    return params;
}

class UserInterface
{
public:
    UserInterface() = default;

    void terminalHandle()
    {
        std::string input;
        std::getline(std::cin, input);

        if (input == "list")
        {
            for (const auto &option : option_list)
            {
                std::cout << option.name << ", id: " << option.id << std::endl;
            }
            return;
        }

        for (const auto &option : option_list)
        {
            if (input == option.name || ConvertToInt(input) == option.id)
            {
                test_option_->id = option.id;
                test_option_->name = option.name;
                std::cout << "Test: " << test_option_->name << ", test_id: " << test_option_->id << std::endl;
            }
        }
    }

    TestOption *test_option_{nullptr};
};

class A2SportClientNode : public rclcpp::Node
{
public:
    A2SportClientNode() : Node("a2_sport_client_node"), sport_client_(this)
    {
        // Create subscriber to receive command execution responses
        response_subscriber_ = this->create_subscription<unitree_api::msg::Response>(
            "sport_response", 10,
            std::bind(&A2SportClientNode::responseCallback, this, std::placeholders::_1));

        // Subscribe to incoming commands
        command_subscription_ = this->create_subscription<unitree_api::msg::Request>(
            "sport_command", 10,
            std::bind(&A2SportClientNode::commandCallback, this, std::placeholders::_1));

        t1_ = std::thread([this] {
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            run();
        });
    }

    void responseCallback(const unitree_api::msg::Response::SharedPtr msg)
    {
        // Handle response from command execution
        RCLCPP_INFO(this->get_logger(), "Command response received");
    }

    void commandCallback(const unitree_api::msg::Request::SharedPtr msg)
    {
        // Store the received command for processing
        {
            std::lock_guard<std::mutex> lock(command_mutex_);
            current_command_ = msg;
            has_new_command_ = true;
        }
    }

    void run()
    {
        std::cout << "Listening for commands on /sport_command topic..." << std::endl;

        while (1)
        {
            auto time_start_trick = std::chrono::high_resolution_clock::now();
            static const constexpr auto dt = std::chrono::microseconds(20000); // 50Hz

            // Check if we have a new command from the publisher
            {
                std::lock_guard<std::mutex> lock(command_mutex_);
                if (has_new_command_ && current_command_)
                {
                    // Extract command ID from the first parameter value
                    int command_id = 0;
                    if (!current_command_->parameter.empty())
                    {
                        auto params = ParseParameters(current_command_->parameter);
                        if (!params.empty())
                        {
                            command_id = static_cast<int>(params[0]);
                        }
                    }
                    
                    // Execute the command
                    executeCommand(command_id, current_command_);
                    
                    std::cout << "Executed command: " << command_id << std::endl;
                    has_new_command_ = false;
                }
            }

            std::this_thread::sleep_until(time_start_trick + dt);
        }
    }

    void executeCommand(int command_id, const unitree_api::msg::Request::SharedPtr cmd)
    {
        switch (command_id)
        {
        case 0:
            sport_client_.Damp(*cmd);
            break;
        case 1:
            sport_client_.BalanceStand(*cmd);
            break;
        case 2:
            sport_client_.StopMove(*cmd);
            break;
        case 3:
            sport_client_.StandDown(*cmd);
            break;
        case 4:
            sport_client_.RecoveryStand(*cmd);
            break;
        case 5:
        {
            // Parse parameters from the request
            float vx = 0.0f, vy = 0.0f, yaw = 0.5f;
            if (!cmd->parameter.empty())
            {
                auto params = ParseParameters(cmd->parameter);
                if (params.size() >= 4)
                {
                    // params[0] is command_id, params[1:4] are vx, vy, yaw
                    vx = params[1];
                    vy = params[2];
                    yaw = params[3];
                }
            }
            sport_client_.Move(*cmd, vx, vy, yaw);
            break;
        }
        case 6:
            sport_client_.SwitchGait(*cmd, 0);
            break;
        case 7:
            sport_client_.SpeedLevel(*cmd, 1);
            break;
        case 8:
            sport_client_.HandStand(*cmd, true);
            break;
        case 9:
            sport_client_.AutoRecoverySet(*cmd, true);
            break;
        case 10:
            sport_client_.FreeWalk(*cmd);
            break;
        case 11:
            sport_client_.ClassicWalk(*cmd, true);
            break;
        case 12:
            sport_client_.FastWalk(*cmd, true);
            break;
        case 13:
            sport_client_.Euler(*cmd, 0, 0, 0.6);
            break;
        }
    }

private:
    SportClient sport_client_;
    std::thread t1_;
    
    // Pub-sub components
    rclcpp::Subscription<unitree_api::msg::Response>::SharedPtr response_subscriber_;
    rclcpp::Subscription<unitree_api::msg::Request>::SharedPtr command_subscription_;
    
    // Command storage
    std::mutex command_mutex_;
    unitree_api::msg::Request::SharedPtr current_command_;
    bool has_new_command_{false};
};

int main(int argc, char **argv)
{
    rclcpp::init(argc, argv);
    auto node = std::make_shared<A2SportClientNode>();
    rclcpp::executors::MultiThreadedExecutor executor;
    executor.add_node(node);
    executor.spin();
    rclcpp::shutdown();
    return 0;
}