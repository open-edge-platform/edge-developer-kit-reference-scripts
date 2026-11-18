# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Record SO-101 pick-and-place episodes for every scene state in Generate.

Before running:

1. Open a saved SO-101 scene with a camera in Physical AI Scene Builder and switch to **Generate**.
2. In **Scene randomization**, click **Generate scene** to add randomized object positions.
3. In **Streaming mode**, click **Start streaming**.

From the extracted control examples:

    uv run --locked --extra teleoperation python so101/generate_dataset.py --connection-file connection.json

Each attempt restores its scene state, moves the arm to the home pose (``--home-pose``) and waits
until it is at rest there, and only then starts recording. It moves the object into the container
using physics only, returns the arm to the home pose, and is saved only when the object ends up at
rest inside the container. Failed attempts are discarded and listed in the summary. New episodes are
appended to the existing collection. Starting and ending every episode at the home pose lets a
trained policy settle back to rest after placing, and restart cleanly when the object is put back.

Every attempt varies its speed, timing, heights, and path from its own recording seed, so repeated
attempts of one state (``--episodes-per-state``, like LeRobot's "10 episodes per location") and
re-runs over the same states record different demonstrations instead of identical copies.

With ``--workers N`` the attempts run in parallel inside Physical AI Scene Builder's Generate worker instead
of being driven frame by frame from this script; the script prints progress, Ctrl-C cancels the
batch (episodes already resolved are kept), and ``--report`` writes the final batch status.
"""

from __future__ import annotations

import argparse
import json
import time
from collections import defaultdict
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from robotic_studio.robots.cli import (
    Reporter,
    add_connection_arguments,
    add_verbose_argument,
    connect,
    require_mujoco,
)
from robotic_studio.robots.so101 import (
    FAILURE_REASONS,
    EpisodeOutcome,
    PickPlaceTask,
    PickPlaceTuning,
    check_reachability,
    check_scene,
    record_episode,
)

# With fewer distinct start positions a trained policy tends to memorize them instead of learning
# the task. The Generate panel shows the same number.
RECOMMENDED_TRAINING_STATES = 100

# Joint angles in degrees.
DEFAULT_HOME_POSE = {
    "shoulder_pan": 0.0,
    "shoulder_lift": -100.0,
    "elbow_flex": 86.85,
    "wrist_flex": 70.92,
    "wrist_roll": -90.00,
    "gripper": 0.0,
}


def parse_home_pose(text: str) -> dict[str, float]:
    """Parse ``joint=degrees,...``; joints not listed keep their ``DEFAULT_HOME_POSE`` value."""
    pose = dict(DEFAULT_HOME_POSE)
    for item in text.split(","):
        name, separator, value = item.partition("=")
        name = name.strip()
        if not separator or name not in DEFAULT_HOME_POSE:
            raise argparse.ArgumentTypeError(
                f"expected joint=degrees with a joint from: {', '.join(DEFAULT_HOME_POSE)}"
            )
        try:
            pose[name] = float(value)
        except ValueError as error:
            raise argparse.ArgumentTypeError(f"'{value.strip()}' is not a number of degrees") from error
    return pose


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Record SO-101 pick-and-place episodes for the scene states in Generate.",
    )
    add_connection_arguments(parser)
    parser.add_argument(
        "--state",
        action="append",
        dest="states",
        metavar="STATE_ID",
        help="Scene state to use, for example state-000001. Repeat for several. Default: all states.",
    )
    parser.add_argument(
        "--episodes-per-state",
        dest="episodes_per_state",
        type=int,
        default=5,
        help="Attempts per scene state (default: 5). Each attempt varies its motion.",
    )
    parser.add_argument("--source-body", help="Object to pick (default: the object randomized in Generate).")
    parser.add_argument("--container-body", default="container", help="Body to place it in (default: container).")
    parser.add_argument("--report", type=Path, help="Write a JSON report of every attempt to this file.")
    parser.add_argument(
        "--home-pose",
        type=parse_home_pose,
        metavar="JOINT=DEG,...",
        help="Pose every episode starts and ends at, in degrees as shown in Build > Simulation > Runtime "
        "pose, e.g. wrist_roll=-90,gripper=10. Unlisted joints keep the default: "
        + ", ".join(f"{name}={value:g}" for name, value in DEFAULT_HOME_POSE.items())
        + ".",
    )
    parser.add_argument(
        "--workers",
        type=int,
        help="Run deterministic batch generation inside the native worker (requires --app-url or connection file).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check the scene and every selected state without recording.",
    )
    parser.add_argument("--fail-fast", action="store_true", help="Stop at the first failed attempt.")
    parser.add_argument(
        "--no-variation",
        action="store_true",
        help="Replay the same motion for a state (debugging aid). Allows only one attempt per state.",
    )
    parser.add_argument(
        "--no-return-to-start",
        action="store_true",
        help="End each episode above the container instead of returning the arm to its start pose.",
    )
    add_verbose_argument(parser)
    return parser


def few_states_warning(state_count: int) -> str | None:
    """Warn when a dataset would have too few distinct start positions to train a policy on."""
    if state_count >= RECOMMENDED_TRAINING_STATES:
        return None
    return (
        f"Warning: only {state_count} scene state(s). To train a policy (ACT, Pi0.5), generate at "
        f"least {RECOMMENDED_TRAINING_STATES} in Generate (set the count next to Generate): with fewer "
        "start positions it learns those positions instead of the task. More episodes per state do "
        "not replace more states."
    )


def select_states(states: Sequence[Any], requested: Sequence[str] | None) -> tuple[Any, ...]:
    """Return the requested states in command-line order, or every state by default."""
    available = tuple(states)
    if not requested:
        return available
    by_id = {state.state_id: state for state in available}
    missing = [state_id for state_id in requested if state_id not in by_id]
    if missing:
        known = ", ".join(by_id) or "none"
        raise SystemExit(f"Unknown scene state(s): {', '.join(missing)}. Available: {known}.")
    return tuple(by_id[state_id] for state_id in requested)


def summarize(outcomes: Sequence[EpisodeOutcome]) -> list[str]:
    saved = [outcome for outcome in outcomes if outcome.saved]
    failed = [outcome for outcome in outcomes if not outcome.saved]
    lines = [f"Summary: {len(saved)} saved, {len(failed)} failed, {len(outcomes)} attempted."]
    by_reason: dict[str, list[str]] = defaultdict(list)
    for outcome in failed:
        by_reason[outcome.reason or "unknown"].append(outcome.state_id)
    for reason, state_ids in sorted(by_reason.items(), key=lambda item: -len(item[1])):
        description = FAILURE_REASONS.get(reason, reason)
        lines.append(f"  {len(state_ids)} x {description} ({', '.join(sorted(set(state_ids)))})")
    if failed:
        lines.append("  Run with --check to find unreachable states, or --verbose for controller details.")
    return lines


def write_report(path: Path, outcomes: Sequence[EpisodeOutcome]) -> None:
    payload = {
        "version": 1,
        "controlMode": "physics-only",
        "attempted": len(outcomes),
        "saved": sum(outcome.saved for outcome in outcomes),
        "attempts": [outcome.to_dict() for outcome in outcomes],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def run_checks(client: Any, mujoco: Any, task: PickPlaceTask, states: Sequence[Any], report: Reporter) -> int:
    unreachable = 0
    for index, state in enumerate(states, start=1):
        client.select_initial_state(state.state_id)
        issue = check_reachability(client, mujoco, task)
        status = "ok" if issue is None else f"problem: {issue.message}"
        report.info(f"[{index}/{len(states)}] {state.state_id}: {status}")
        unreachable += issue is not None
    if unreachable:
        report.info(
            f"{unreachable} state(s) cannot be grasped. Delete them in Generate or reduce the "
            "randomization range, then generate new states."
        )
        return 1
    report.info("Scene check passed.")
    return 0


def record_states(
    client: Any,
    mujoco: Any,
    task: PickPlaceTask,
    states: Sequence[Any],
    *,
    episodes_per_state: int,
    fail_fast: bool,
    report: Reporter,
    vary: bool = True,
    tuning: PickPlaceTuning = PickPlaceTuning(),
) -> list[EpisodeOutcome]:
    """Record ``episodes_per_state`` attempts for each state and print one line per attempt."""
    outcomes: list[EpisodeOutcome] = []
    attempts = len(states) * episodes_per_state
    for state in states:
        for _ in range(episodes_per_state):
            outcome = record_episode(
                client,
                mujoco,
                task,
                tuning=tuning,
                state_id=state.state_id,
                vary=vary,
                log=report.debug,
            )
            outcomes.append(outcome)
            prefix = f"[{len(outcomes)}/{attempts}] {state.state_id}:"
            if outcome.saved:
                report.info(f"{prefix} saved ({outcome.frame_count} frames)")
                continue
            report.info(f"{prefix} failed - {FAILURE_REASONS.get(outcome.reason or '', outcome.reason)}")
            report.debug(outcome.message or "")
            if fail_fast:
                return outcomes
    return outcomes


def run_batch(client: Any, arguments: argparse.Namespace, report: Reporter) -> int:
    """Run the attempts in the native worker's process pool and print its progress.

    Ctrl-C cancels the batch; episodes resolved before the cancel stay in the collection.
    """
    states = select_states(client.initial_states, arguments.states)
    if not states:
        report.info("No scene states found. Open Generate and click Generate scene first.")
        return 1
    status = dict(
        client.start_batch(
            state_ids=[state.state_id for state in states],
            episodes_per_state=arguments.episodes_per_state,
            workers=arguments.workers,
            controller="so101-pick-place",
        )
    )
    report.info(
        f"Batch {status.get('jobId', 'unknown')}: {status.get('total', 0)} attempt(s) with "
        f"{status.get('workerCount', arguments.workers)} worker(s). Press Ctrl-C to cancel."
    )
    cancelled = False
    while status.get("status") == "running":
        try:
            time.sleep(1.0)
            status = dict(client.batch_status())
        except KeyboardInterrupt:
            if cancelled:
                raise
            cancelled = True
            report.info("Cancelling the batch; resolved episodes are kept...")
            try:
                status = dict(client.cancel_batch())
            except Exception:  # noqa: BLE001 - Ctrl-C may have interrupted a status request.
                status = dict(client.cancel_batch())
            continue
        report.info(
            f"Batch progress: {status.get('resolved', 0)}/{status.get('total', 0)} resolved, "
            f"{status.get('committed', status.get('saved', 0))} saved, {status.get('failed', 0)} failed, "
            f"{float(status.get('framesPerSecond') or 0.0):.0f} frames/s"
        )
    failures = status.get("failuresByReason") or {}
    for reason, count in sorted(failures.items(), key=lambda item: -item[1]):
        report.info(f"  {count} x {FAILURE_REASONS.get(reason, reason)}")
    if status.get("error"):
        report.info(f"Batch error: {status['error']}")
    report.info(f"Batch {status.get('status', 'unknown')}.")
    if arguments.report:
        payload = {"version": 1, "controlMode": "physics-only", "batch": status}
        arguments.report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        report.info(f"Report written to {arguments.report}.")
    return 0 if status.get("status") == "completed" else 1


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    if arguments.episodes_per_state < 1:
        raise SystemExit("--episodes-per-state must be at least 1.")
    if arguments.no_variation and arguments.episodes_per_state > 1:
        raise SystemExit(
            "--no-variation records identical copies of each state; use one episode per state or "
            "keep variation on."
        )
    report = Reporter(verbose=arguments.verbose)
    if arguments.workers is not None:
        if arguments.workers < 1:
            raise SystemExit("--workers must be at least 1.")
        if (
            arguments.check
            or arguments.no_variation
            or arguments.no_return_to_start
            or arguments.home_pose is not None
        ):
            raise SystemExit(
                "--workers cannot be combined with --check, --no-variation, "
                "--no-return-to-start, or --home-pose."
            )
        client = connect(arguments, default_scene_bundle=Path(__file__).resolve().parent.parent / "scene.mujoco-scene")
        try:
            return run_batch(client, arguments, report)
        finally:
            client.close()
    mujoco = require_mujoco()
    client = connect(arguments, default_scene_bundle=Path(__file__).resolve().parent.parent / "scene.mujoco-scene")
    try:
        task = PickPlaceTask.for_session(
            client, source_body=arguments.source_body, container_body=arguments.container_body
        )
        states = select_states(client.initial_states, arguments.states)
        if not states:
            report.info("No scene states found. Open Generate and click Generate scene first.")
            return 1

        issues = check_scene(client, mujoco, task)
        for issue in issues:
            report.info(str(issue))
        if any(issue.level == "error" for issue in issues):
            report.info("Fix the errors above and run again.")
            return 1
        if arguments.check:
            return run_checks(client, mujoco, task, states, report)

        warning = few_states_warning(len(states))
        if warning:
            report.info(warning)
        attempts = len(states) * arguments.episodes_per_state
        report.info(
            f"Recording {attempts} attempt(s): {len(states)} scene state(s) x "
            f"{arguments.episodes_per_state}, moving '{task.source_body}' into '{task.container_body}'."
        )
        outcomes = record_states(
            client,
            mujoco,
            task,
            states,
            episodes_per_state=arguments.episodes_per_state,
            fail_fast=arguments.fail_fast,
            report=report,
            vary=not arguments.no_variation,
            tuning=PickPlaceTuning(
                return_to_start=not arguments.no_return_to_start,
                home_pose=arguments.home_pose or DEFAULT_HOME_POSE,
            ),
        )
        for line in summarize(outcomes):
            report.info(line)
        if arguments.report:
            write_report(arguments.report, outcomes)
            report.info(f"Report written to {arguments.report}.")
        if any(outcome.saved for outcome in outcomes):
            report.info("Review episodes in Generate > Streaming mode, then download the raw dataset.")
        return 0 if outcomes and all(outcome.saved for outcome in outcomes) else 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
