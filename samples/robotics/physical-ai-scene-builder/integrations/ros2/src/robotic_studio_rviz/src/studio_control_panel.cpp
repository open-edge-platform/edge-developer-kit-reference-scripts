// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

#include "robotic_studio_rviz/studio_control_panel.hpp"

#include <algorithm>

#include <QComboBox>
#include <QFormLayout>
#include <QGridLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QMetaObject>
#include <QPushButton>
#include <QTimer>
#include <QVBoxLayout>
#include <pluginlib/class_list_macros.hpp>
#include <rviz_common/display_context.hpp>
#include <rviz_common/ros_integration/ros_node_abstraction_iface.hpp>

#include "robotic_studio_rviz/panel_state.hpp"

namespace robotic_studio_rviz
{

namespace
{
// The bridge republishes its status at least once per second.
constexpr auto kStatusTimeout = std::chrono::seconds(2);
// Recording saves can take up to 120 seconds in the SDK.
constexpr int kServiceTimeoutMs = 130000;

QString phase_style(const std::string & phase)
{
  const char * color = "#808080";
  if (phase == "running") {
    color = "#2e7d32";
  } else if (phase == "paused") {
    color = "#b26a00";
  } else if (phase == "faulted") {
    color = "#c62828";
  }
  return QString("QLabel { color: white; background-color: %1; border-radius: 3px; padding: 2px 8px; "
           "font-weight: bold; }").arg(color);
}
}  // namespace

StudioControlPanel::StudioControlPanel(QWidget * parent)
: rviz_common::Panel(parent)
{
  namespace_edit_ = new QLineEdit(namespace_);
  namespace_edit_->setToolTip("Namespace of the bridge node, for example /studio/bridge.");
  phase_label_ = new QLabel;
  time_label_ = new QLabel;
  state_label_ = new QLabel;
  recording_label_ = new QLabel;
  commands_label_ = new QLabel;
  message_label_ = new QLabel;
  message_label_->setWordWrap(true);
  message_label_->setTextInteractionFlags(Qt::TextSelectableByMouse);

  pause_button_ = new QPushButton("Pause");
  resume_button_ = new QPushButton("Resume");
  resume_button_->setToolTip("Requires joint commands received within command_timeout_s.");
  reset_button_ = new QPushButton("Reset");
  reset_button_->setToolTip("Reset to the active initial state; stepping stays paused.");
  state_combo_ = new QComboBox;
  state_combo_->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
  select_button_ = new QPushButton("Select");
  select_button_->setToolTip("Switch to the chosen initial state; stepping stays paused.");
  record_button_ = new QPushButton("Record");
  save_button_ = new QPushButton("Stop && Save");
  save_button_->setToolTip("Stop and save the recording; saving pauses simulation stepping.");
  discard_button_ = new QPushButton("Stop && Discard");

  auto * status_box = new QGroupBox("Status");
  auto * status_layout = new QFormLayout(status_box);
  status_layout->addRow("Phase", phase_label_);
  status_layout->addRow("Simulation", time_label_);
  status_layout->addRow("State", state_label_);
  status_layout->addRow("Recording", recording_label_);
  status_layout->addRow("Commands", commands_label_);

  auto * control_box = new QGroupBox("Simulation");
  auto * control_layout = new QGridLayout(control_box);
  control_layout->addWidget(pause_button_, 0, 0);
  control_layout->addWidget(resume_button_, 0, 1);
  control_layout->addWidget(reset_button_, 0, 2);
  control_layout->addWidget(state_combo_, 1, 0, 1, 2);
  control_layout->addWidget(select_button_, 1, 2);

  auto * record_box = new QGroupBox("Recording");
  auto * record_layout = new QHBoxLayout(record_box);
  record_layout->addWidget(record_button_);
  record_layout->addWidget(save_button_);
  record_layout->addWidget(discard_button_);

  auto * namespace_layout = new QHBoxLayout;
  namespace_layout->addWidget(new QLabel("Bridge"));
  namespace_layout->addWidget(namespace_edit_);

  auto * layout = new QVBoxLayout(this);
  layout->addLayout(namespace_layout);
  layout->addWidget(status_box);
  layout->addWidget(control_box);
  layout->addWidget(record_box);
  layout->addWidget(message_label_);
  layout->addStretch();

  connect(namespace_edit_, &QLineEdit::editingFinished, this, &StudioControlPanel::applyNamespace);
  connect(pause_button_, &QPushButton::clicked, this, [this]() {pause(true);});
  connect(resume_button_, &QPushButton::clicked, this, [this]() {pause(false);});
  connect(reset_button_, &QPushButton::clicked, this, &StudioControlPanel::reset);
  connect(select_button_, &QPushButton::clicked, this, &StudioControlPanel::selectState);
  connect(record_button_, &QPushButton::clicked, this, &StudioControlPanel::startRecording);
  connect(save_button_, &QPushButton::clicked, this, [this]() {stopRecording(true);});
  connect(discard_button_, &QPushButton::clicked, this, [this]() {stopRecording(false);});

  timer_ = new QTimer(this);
  connect(timer_, &QTimer::timeout, this, &StudioControlPanel::refresh);
  request_timer_ = new QTimer(this);
  request_timer_->setSingleShot(true);
  request_timer_->setInterval(kServiceTimeoutMs);
  connect(request_timer_, &QTimer::timeout, this, [this]() {
    cancelPendingRequest();
    showMessage(false, "Bridge service timed out. The operation may still finish; check status before retrying.");
    refresh();
  });
  refresh();
}

StudioControlPanel::~StudioControlPanel()
{
  {
    std::lock_guard<std::mutex> lock(*alive_mutex_);
    *alive_ = false;
  }
  cancelPendingRequest();
  status_subscription_.reset();
  pause_client_.reset();
  reset_client_.reset();
  select_client_.reset();
  start_client_.reset();
  stop_client_.reset();
}

void StudioControlPanel::onInitialize()
{
  node_ = getDisplayContext()->getRosNodeAbstraction().lock()->get_raw_node();
  connectRos();
  timer_->start(100);
}

void StudioControlPanel::load(const rviz_common::Config & config)
{
  rviz_common::Panel::load(config);
  QString value;
  if (config.mapGetString("Namespace", &value) && !value.isEmpty()) {
    namespace_ = value;
    namespace_edit_->setText(value);
    connectRos();
  }
}

void StudioControlPanel::save(rviz_common::Config config) const
{
  rviz_common::Panel::save(config);
  config.mapSetValue("Namespace", namespace_);
}

void StudioControlPanel::applyNamespace()
{
  auto value = namespace_edit_->text().trimmed();
  while (value.size() > 1 && value.endsWith('/')) {
    value.chop(1);
  }
  if (!value.startsWith('/')) {
    value.prepend('/');
  }
  namespace_edit_->setText(value);
  if (value == namespace_) {
    return;
  }
  namespace_ = value;
  connectRos();
  Q_EMIT configChanged();
}

void StudioControlPanel::connectRos()
{
  cancelPendingRequest();
  if (!node_) {
    return;
  }
  {
    std::lock_guard<std::mutex> lock(status_mutex_);
    status_.reset();
  }
  shown_state_ids_.clear();
  state_combo_->clear();
  const auto prefix = namespace_.toStdString();
  try {
    status_subscription_ = node_->create_subscription<BridgeStatus>(
      prefix + "/status", rclcpp::QoS(1).reliable().transient_local(),
      [this](const BridgeStatus & message) {
        std::lock_guard<std::mutex> lock(status_mutex_);
        status_ = message;
        status_received_ = std::chrono::steady_clock::now();
      });
    pause_client_ = node_->create_client<std_srvs::srv::SetBool>(prefix + "/pause");
    reset_client_ = node_->create_client<std_srvs::srv::Trigger>(prefix + "/reset");
    select_client_ = node_->create_client<robotic_studio_interfaces::srv::SelectInitialState>(
      prefix + "/select_initial_state");
    start_client_ = node_->create_client<robotic_studio_interfaces::srv::StartRecording>(
      prefix + "/recording/start");
    stop_client_ = node_->create_client<robotic_studio_interfaces::srv::StopRecording>(
      prefix + "/recording/stop");
    showMessage(true, QString("Waiting for %1/status.").arg(namespace_));
  } catch (const std::exception & error) {
    status_subscription_.reset();
    pause_client_.reset();
    reset_client_.reset();
    select_client_.reset();
    start_client_.reset();
    stop_client_.reset();
    showMessage(false, QString("Invalid bridge namespace: %1").arg(error.what()));
  }
}

void StudioControlPanel::refresh()
{
  std::optional<BridgeStatus> status;
  bool connected = false;
  {
    std::lock_guard<std::mutex> lock(status_mutex_);
    status = status_;
    connected = status_.has_value() &&
      std::chrono::steady_clock::now() - status_received_ < kStatusTimeout;
  }

  PanelStatus panel;
  panel.connected = connected;
  panel.busy = busy_ > 0;
  if (!connected) {
    phase_label_->setText(status ? "bridge not responding" : "bridge not connected");
    phase_label_->setStyleSheet(phase_style(""));
    time_label_->clear();
    state_label_->clear();
    recording_label_->clear();
    commands_label_->clear();
  } else {
    panel.phase = status->phase;
    panel.terminal = status->terminal;
    panel.recording = status->recording;
    panel.has_initial_states = !status->initial_state_ids.empty();

    phase_label_->setText(QString::fromStdString(status->phase) + (status->terminal ? " (restart bridge)" : ""));
    phase_label_->setStyleSheet(phase_style(status->phase));
    time_label_->setText(
      QString("%1 s, step %2, RTF %3")
      .arg(status->simulation_time, 0, 'f', 3)
      .arg(status->step_id)
      .arg(status->real_time_factor, 0, 'f', 2));

    if (status->initial_state_ids != shown_state_ids_) {
      shown_state_ids_ = status->initial_state_ids;
      state_combo_->clear();
      for (size_t index = 0; index < status->initial_state_ids.size(); ++index) {
        const auto & label = index < status->initial_state_labels.size() &&
          !status->initial_state_labels[index].empty() ?
          status->initial_state_labels[index] : status->initial_state_ids[index];
        state_combo_->addItem(
          QString::fromStdString(label), QString::fromStdString(status->initial_state_ids[index]));
      }
      state_combo_->setCurrentIndex(
        std::max(0, state_combo_->findData(QString::fromStdString(status->state_id))));
    }
    QString state = QString::fromStdString(status->state_id);
    const int current = state_combo_->findData(state);
    if (current >= 0) {
      state = state_combo_->itemText(current);
    }
    state_label_->setText(state);

    QString recording = QString::fromStdString(status->recording);
    if (status->recording == BridgeStatus::RECORDING_PENDING) {
      recording = "stopped, not saved";
    }
    if (!status->last_episode_id.empty()) {
      recording += QString(" (episode %1)").arg(QString::fromStdString(status->last_episode_id));
    }
    recording_label_->setText(recording);
    commands_label_->setText(
      status->command_fresh ? "receiving joint commands" :
      "no fresh joint command; publish joint_commands before resuming");

    const auto message = QString::fromStdString(status->message);
    if (message != shown_status_message_) {
      shown_status_message_ = message;
      if (!message.isEmpty()) {
        showMessage(status->phase != BridgeStatus::PHASE_FAULTED, message);
      }
    }
  }

  const auto controls = enabled_controls(panel);
  pause_button_->setEnabled(controls.pause);
  resume_button_->setEnabled(controls.resume);
  reset_button_->setEnabled(controls.reset);
  select_button_->setEnabled(controls.select_state && state_combo_->count() > 0);
  state_combo_->setEnabled(controls.select_state);
  record_button_->setEnabled(controls.start_recording);
  save_button_->setEnabled(controls.stop_recording);
  discard_button_->setEnabled(controls.stop_recording);
}

void StudioControlPanel::showMessage(bool success, const QString & message)
{
  message_label_->setStyleSheet(success ? "" : "QLabel { color: #c62828; }");
  message_label_->setText(message);
}

void StudioControlPanel::cancelPendingRequest()
{
  ++request_generation_;
  request_timer_->stop();
  if (cancel_request_) {
    cancel_request_();
    cancel_request_ = {};
  }
  busy_ = 0;
}

void StudioControlPanel::finishRequest(std::uint64_t generation, const Result & result)
{
  if (generation != request_generation_) {
    return;
  }
  cancelPendingRequest();
  showMessage(result.first, result.second);
  refresh();
}

template<typename ServiceT>
void StudioControlPanel::call(
  const typename rclcpp::Client<ServiceT>::SharedPtr & client,
  typename ServiceT::Request::SharedPtr request,
  std::function<Result(const typename ServiceT::Response &)> result)
{
  if (!client || !client->service_is_ready()) {
    showMessage(false, "The bridge service is not available.");
    return;
  }
  if (busy_) {
    showMessage(false, "Wait for the current bridge service request to finish.");
    return;
  }
  ++busy_;
  const auto generation = ++request_generation_;
  refresh();
  auto alive = alive_;
  auto alive_mutex = alive_mutex_;
  try {
    const auto pending = client->async_send_request(
      request,
      [this, alive, alive_mutex, result, generation](
        typename rclcpp::Client<ServiceT>::SharedFuture future) {
        Result response;
        try {
          response = result(*future.get());
        } catch (const std::exception & error) {
          response = {false, QString("Bridge service failed: %1").arg(error.what())};
        }
        std::lock_guard<std::mutex> lock(*alive_mutex);
        if (!*alive) {
          return;
        }
        QMetaObject::invokeMethod(
          this, [this, generation, response]() {finishRequest(generation, response);},
          Qt::QueuedConnection);
      });
    cancel_request_ = [client, id = pending.request_id]() {client->remove_pending_request(id);};
    request_timer_->start();
  } catch (const std::exception & error) {
    finishRequest(generation, {false, QString("Bridge service failed: %1").arg(error.what())});
  }
}

void StudioControlPanel::pause(bool pause)
{
  auto request = std::make_shared<std_srvs::srv::SetBool::Request>();
  request->data = pause;
  call<std_srvs::srv::SetBool>(
    pause_client_, request, [](const std_srvs::srv::SetBool::Response & response) {
      return Result{response.success, QString::fromStdString(response.message)};
    });
}

void StudioControlPanel::reset()
{
  call<std_srvs::srv::Trigger>(
    reset_client_, std::make_shared<std_srvs::srv::Trigger::Request>(),
    [](const std_srvs::srv::Trigger::Response & response) {
      return Result{response.success, QString::fromStdString(response.message)};
    });
}

void StudioControlPanel::selectState()
{
  using Service = robotic_studio_interfaces::srv::SelectInitialState;
  auto request = std::make_shared<Service::Request>();
  request->state_id = state_combo_->currentData().toString().toStdString();
  call<Service>(
    select_client_, request, [](const Service::Response & response) {
      return Result{response.success, QString::fromStdString(response.message)};
    });
}

void StudioControlPanel::startRecording()
{
  using Service = robotic_studio_interfaces::srv::StartRecording;
  call<Service>(
    start_client_, std::make_shared<Service::Request>(), [](const Service::Response & response) {
      return Result{response.success, QString::fromStdString(response.message)};
    });
}

void StudioControlPanel::stopRecording(bool save)
{
  using Service = robotic_studio_interfaces::srv::StopRecording;
  auto request = std::make_shared<Service::Request>();
  request->save = save;
  call<Service>(
    stop_client_, request, [](const Service::Response & response) {
      return Result{response.success, QString::fromStdString(response.message)};
    });
}

}  // namespace robotic_studio_rviz

PLUGINLIB_EXPORT_CLASS(robotic_studio_rviz::StudioControlPanel, rviz_common::Panel)
