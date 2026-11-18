// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

#pragma once

#include <string>

namespace robotic_studio_rviz
{

/// Bridge status relevant for enabling the panel controls.
struct PanelStatus
{
  bool connected = false;  // A status message arrived recently.
  bool busy = false;  // A service request of this panel is outstanding.
  bool terminal = false;
  std::string phase;  // disconnected, paused, running, faulted
  std::string recording;  // idle, recording, stopping, pending
  bool has_initial_states = false;
};

struct PanelControls
{
  bool pause = false;
  bool resume = false;
  bool reset = false;
  bool select_state = false;
  bool start_recording = false;
  bool stop_recording = false;
};

PanelControls enabled_controls(const PanelStatus & status);

}  // namespace robotic_studio_rviz
