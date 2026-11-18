// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

#pragma once

#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include <QString>
#include <rclcpp/rclcpp.hpp>
#include <robotic_studio_interfaces/msg/bridge_status.hpp>
#include <robotic_studio_interfaces/srv/select_initial_state.hpp>
#include <robotic_studio_interfaces/srv/start_recording.hpp>
#include <robotic_studio_interfaces/srv/stop_recording.hpp>
#include <rviz_common/panel.hpp>
#include <std_srvs/srv/set_bool.hpp>
#include <std_srvs/srv/trigger.hpp>

class QComboBox;
class QLabel;
class QLineEdit;
class QPushButton;
class QTimer;

namespace robotic_studio_rviz
{

/// RViz panel showing the Robotic Studio bridge status and calling its control services.
class StudioControlPanel : public rviz_common::Panel
{
  Q_OBJECT

public:
  explicit StudioControlPanel(QWidget * parent = nullptr);
  ~StudioControlPanel() override;

  void onInitialize() override;
  void load(const rviz_common::Config & config) override;
  void save(rviz_common::Config config) const override;

private Q_SLOTS:
  void applyNamespace();
  void refresh();

private:
  friend class StudioControlPanelTest;
  using BridgeStatus = robotic_studio_interfaces::msg::BridgeStatus;
  using Result = std::pair<bool, QString>;

  void connectRos();
  void showMessage(bool success, const QString & message);
  void cancelPendingRequest();
  void finishRequest(std::uint64_t generation, const Result & result);
  void pause(bool pause);
  void reset();
  void selectState();
  void startRecording();
  void stopRecording(bool save);
  template<typename ServiceT>
  void call(
    const typename rclcpp::Client<ServiceT>::SharedPtr & client,
    typename ServiceT::Request::SharedPtr request,
    std::function<Result(const typename ServiceT::Response &)> result);

  rclcpp::Node::SharedPtr node_;
  QString namespace_ = "/studio/bridge";

  rclcpp::Subscription<BridgeStatus>::SharedPtr status_subscription_;
  rclcpp::Client<std_srvs::srv::SetBool>::SharedPtr pause_client_;
  rclcpp::Client<std_srvs::srv::Trigger>::SharedPtr reset_client_;
  rclcpp::Client<robotic_studio_interfaces::srv::SelectInitialState>::SharedPtr select_client_;
  rclcpp::Client<robotic_studio_interfaces::srv::StartRecording>::SharedPtr start_client_;
  rclcpp::Client<robotic_studio_interfaces::srv::StopRecording>::SharedPtr stop_client_;

  // The status arrives on the RViz ROS thread and is consumed by the Qt timer.
  std::mutex status_mutex_;
  std::optional<BridgeStatus> status_;
  std::chrono::steady_clock::time_point status_received_;
  // Guards queued Qt calls from service callbacks against panel destruction.
  std::shared_ptr<std::mutex> alive_mutex_ = std::make_shared<std::mutex>();
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
  int busy_ = 0;
  std::uint64_t request_generation_ = 0;
  std::function<void()> cancel_request_;
  QString shown_status_message_;
  std::vector<std::string> shown_state_ids_;

  QLineEdit * namespace_edit_;
  QLabel * phase_label_;
  QLabel * time_label_;
  QLabel * state_label_;
  QLabel * recording_label_;
  QLabel * commands_label_;
  QLabel * message_label_;
  QPushButton * pause_button_;
  QPushButton * resume_button_;
  QPushButton * reset_button_;
  QComboBox * state_combo_;
  QPushButton * select_button_;
  QPushButton * record_button_;
  QPushButton * save_button_;
  QPushButton * discard_button_;
  QTimer * timer_;
  QTimer * request_timer_;
};

}  // namespace robotic_studio_rviz
