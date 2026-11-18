// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

#include "robotic_studio_rviz/panel_state.hpp"

namespace robotic_studio_rviz
{

PanelControls enabled_controls(const PanelStatus & status)
{
  PanelControls controls;
  if (!status.connected || status.busy || status.terminal || status.phase == "disconnected") {
    return controls;
  }
  const bool idle = status.recording == "idle";
  controls.pause = status.phase == "running" || status.phase == "faulted";
  controls.resume = status.phase == "paused" || status.phase == "faulted";
  // The session refuses reset and state selection while a recording is active or pending.
  controls.reset = idle;
  controls.select_state = idle && status.has_initial_states;
  controls.start_recording = idle;
  controls.stop_recording = status.recording == "recording" || status.recording == "pending";
  return controls;
}

}  // namespace robotic_studio_rviz
