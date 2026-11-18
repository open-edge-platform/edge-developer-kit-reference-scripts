# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Pick up an object and place it in a container with the SO-101, once.

Before running:

1. Open a saved SO-101 scene in Physical AI Scene Builder and switch to **Generate**.
2. In **Streaming mode**, click **Start streaming**.

From the extracted control examples:

    uv run --locked --extra teleoperation python so101/pick_and_place.py --connection-file connection.json

The attempt starts from the scene state selected in Generate and is recorded as one episode when
it succeeds. Use ``so101/generate_dataset.py`` to record many episodes.
"""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from robotic_studio.robots.cli import (
    Reporter,
    add_connection_arguments,
    add_verbose_argument,
    connect,
    require_mujoco,
)
from robotic_studio.robots.so101 import (
    FAILURE_REASONS,
    PickPlaceError,
    PickPlaceTask,
    PickPlaceTuning,
    check_reachability,
    check_scene,
    record_episode,
    sweep_reachability,
    run_pick_and_place,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Move an object into a container once with the SO-101 and record the attempt.",
    )
    add_connection_arguments(parser)
    parser.add_argument("--source-body", help="Object to pick (default: the object randomized in Generate).")
    parser.add_argument("--container-body", default="container", help="Body to place it in (default: container).")
    parser.add_argument("--no-record", action="store_true", help="Run the motion without recording an episode.")
    parser.add_argument("--check", action="store_true", help="Check the scene and exit without moving the robot.")
    parser.add_argument(
        "--no-return-to-start",
        action="store_true",
        help="End the episode above the container instead of returning the arm to its start pose.",
    )
    add_verbose_argument(parser)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    report = Reporter(verbose=arguments.verbose)
    tuning = PickPlaceTuning(return_to_start=not arguments.no_return_to_start)
    mujoco = require_mujoco()
    client = connect(arguments, default_scene_bundle=Path(__file__).resolve().parent.parent / "scene.mujoco-scene")
    try:
        task = PickPlaceTask.for_session(
            client, source_body=arguments.source_body, container_body=arguments.container_body
        )
        state_id = client.current_state.state_id
        report.info(f"Connected to Physical AI Scene Builder (scene state {state_id}).")
        issues = check_scene(client, mujoco, task, require_cameras=not arguments.no_record)
        if arguments.check:
            reachability = check_reachability(client, mujoco, task)
            if reachability is not None:
                issues.append(reachability)
            else:
                # Also plan grasps across the Generate randomization range (warnings only).
                issues.extend(sweep_reachability(client, mujoco, task))
        for issue in issues:
            report.info(str(issue))
        if any(issue.level == "error" for issue in issues):
            report.info("Fix the errors above and run again.")
            return 1
        if arguments.check:
            report.info("Scene check passed.")
            return 0
        report.info(f"Moving '{task.source_body}' into '{task.container_body}'...")
        if client.recording and not arguments.no_record:
            report.info(
                "A recording is already running. Use --no-record to run inside an existing recording; "
                "that recording is not subject to this script's save/discard quality gate."
            )
            return 1
        if arguments.no_record:
            try:
                run_pick_and_place(
                    client, mujoco, task, tuning, log=report.debug
                )
            except PickPlaceError as error:
                report.info(f"Failed: {FAILURE_REASONS.get(error.reason, error.reason)}")
                report.debug(str(error))
                return 1
            report.info("Done.")
            return 0

        outcome = record_episode(
            client, mujoco, task, tuning, log=report.debug
        )
        if not outcome.saved:
            report.info(f"Failed, nothing was saved: {FAILURE_REASONS.get(outcome.reason or '', outcome.reason)}")
            report.debug(outcome.message or "")
            return 1
        report.info(f"Saved episode with {outcome.frame_count} frames ({outcome.control_mode}).")
        report.info("Review it in Generate > Streaming mode.")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
