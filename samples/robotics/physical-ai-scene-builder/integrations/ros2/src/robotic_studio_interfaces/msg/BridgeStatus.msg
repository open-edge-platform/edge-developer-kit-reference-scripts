# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Latched status of the Robotic Studio bridge; the header stamp is the simulation time.

string PHASE_DISCONNECTED=disconnected
string PHASE_PAUSED=paused
string PHASE_RUNNING=running
string PHASE_FAULTED=faulted

string RECORDING_IDLE=idle
string RECORDING_ACTIVE=recording
string RECORDING_STOPPING=stopping
# Stopped by the bridge but not yet saved or discarded.
string RECORDING_PENDING=pending

std_msgs/Header header
string phase
# Current error, otherwise the result of the last service operation.
string message
# The bridge must be restarted; no further operation can succeed.
bool terminal

string session_id
string state_id
uint64 step_id
uint64 state_revision
float64 simulation_time
float64 real_time_factor

string recording
string last_episode_id

# Initial states of the session, in Studio order.
string[] initial_state_ids
string[] initial_state_labels

# Order of the joint_commands vector.
string[] command_joint_names
# True if a joint command younger than command_timeout_s is available, so resume can succeed.
bool command_fresh
