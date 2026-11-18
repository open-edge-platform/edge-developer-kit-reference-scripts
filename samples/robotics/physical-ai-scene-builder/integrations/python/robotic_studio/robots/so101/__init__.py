# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""SO-101 arm support: robot bindings, the pick-and-place controller, and scene checks.

Typical use from a script connected to a running Generate session::

    from robotic_studio.robots.so101 import PickPlaceTask, record_episode

    outcome = record_episode(client, mujoco, PickPlaceTask(source_body="asset_cube"))
"""

from .adapter import SO101, SO101Adapter
from .controller import (
    FAILURE_REASONS,
    EpisodeOutcome,
    PickPlaceController,
    PickPlaceError,
    PickPlaceTask,
    PickPlaceTuning,
    PickPlaceVariation,
    move_to_home_pose,
    prepare_controller,
    record_episode,
    run_pick_and_place,
    set_default_home_pose,
)
from .preflight import SceneIssue, check_reachability, check_scene, sweep_reachability

__all__ = [
    "FAILURE_REASONS",
    "SO101",
    "EpisodeOutcome",
    "PickPlaceController",
    "PickPlaceError",
    "PickPlaceTask",
    "PickPlaceTuning",
    "PickPlaceVariation",
    "SO101Adapter",
    "SceneIssue",
    "check_reachability",
    "sweep_reachability",
    "check_scene",
    "move_to_home_pose",
    "prepare_controller",
    "record_episode",
    "run_pick_and_place",
    "set_default_home_pose",
]
