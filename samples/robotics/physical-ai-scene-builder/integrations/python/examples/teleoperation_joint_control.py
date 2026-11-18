# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Inspect a teleoperation session and optionally command named joint targets.

Connect from the running Physical AI Scene Builder app without knowing native endpoints:

    uv run --project integrations/python --extra teleoperation \
        python integrations/python/examples/teleoperation_joint_control.py \
        --app-url http://localhost:3000

Downloaded control kits use the adjacent connection file automatically:

    uv run --locked --extra teleoperation \
        python teleoperation_joint_control.py --state-id state-000001 --joint robot_1__shoulder_pan=-0.2

Use ``--help`` for actuator targets, a scene-bundle override, and other options.
"""

from __future__ import annotations

import argparse
import math
from collections.abc import Sequence
from pathlib import Path

from robotic_studio.robots.cli import default_connection_file
from robotic_studio.teleoperation import StateSnapshot, Teleoperation


def _named_value(raw: str, label: str) -> tuple[str, float]:
    name, separator, value = raw.partition("=")
    if not separator or not name:
        raise argparse.ArgumentTypeError(f"{label} must use NAME=VALUE syntax.")
    try:
        parsed = float(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"{label} value must be numeric: {raw!r}.") from error
    if not math.isfinite(parsed):
        raise argparse.ArgumentTypeError(f"{label} value must be finite: {raw!r}.")
    return name, parsed


def _target_argument(label: str):
    return lambda raw: _named_value(raw, label)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inspect a Physical AI Scene Builder teleoperation session and optionally command targets."
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--app-url", help="Physical AI Scene Builder app URL, for example http://localhost:3000.")
    source.add_argument(
        "--connection-file",
        dest="connection_file",
        type=Path,
        help="Connection file (defaults to connection.json in this or the parent directory).",
    )
    parser.add_argument(
        "--scene-bundle",
        type=Path,
        help="Override the scene bundle, useful with a connection file or mapping.",
    )
    parser.add_argument(
        "--state-id",
        help="Initial state to select after listing states; defaults to state-000000 (Original scene).",
    )
    parser.add_argument(
        "--joint",
        action="append",
        default=[],
        metavar="NAME=VALUE",
        type=_target_argument("--joint"),
        help="Set one named controllable joint target; may be repeated.",
    )
    parser.add_argument(
        "--actuator",
        action="append",
        default=[],
        metavar="NAME=VALUE",
        type=_target_argument("--actuator"),
        help="Set one named actuator or action target; may be repeated.",
    )
    parser.add_argument("--physics-steps", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument("--client-id")
    return parser


def _mapping(values: Sequence[tuple[str, float]]) -> dict[str, float] | None:
    return dict(values) if values else None


def _print_initial_states(client: Teleoperation) -> None:
    print("Initial states:")
    if not client.initial_states:
        print("  (none reported)")
        return
    for state in client.initial_states:
        print(f"  {state.state_id}: {state.label} (index={state.index})")


def _print_bindings(client: Teleoperation) -> None:
    print("Joints:")
    for joint in client.joints.values():
        joint_range = "unbounded" if joint.range is None else f"[{joint.range[0]}, {joint.range[1]}]"
        actuators = ", ".join(joint.actuator_names) or "none"
        print(
            f"  {joint.name}: type={joint.joint_type} controllable={joint.controllable} "
            f"range={joint_range} actuators={actuators}"
        )

    print("Actuators:")
    for actuator in client.actuators.values():
        control_range = (
            "unbounded"
            if actuator.control_range is None
            else f"[{actuator.control_range[0]}, {actuator.control_range[1]}]"
        )
        print(
            f"  {actuator.name}: action={actuator.action_name or '-'} "
            f"joint={actuator.joint_name or '-'} controllable={actuator.controllable} "
            f"control_range={control_range}"
        )


def _print_state(client: Teleoperation, snapshot: StateSnapshot) -> None:
    print(
        f"State: id={snapshot.state_id} step={snapshot.step_id} "
        f"revision={snapshot.state_revision} simulation_time={snapshot.simulation_time:.6f}"
    )
    print(f"  qpos={snapshot.qpos.tolist()}")
    print(f"  qvel={snapshot.qvel.tolist()}")
    print(f"  ctrl={snapshot.ctrl.tolist()}")
    for name, joint in client.joints.items():
        print(
            f"  joint {name}: qpos={snapshot.qpos[joint.qpos_slice].tolist()} "
            f"qvel={snapshot.qvel[joint.qvel_slice].tolist()}"
        )


def main(argv: Sequence[str] | None = None) -> None:
    arguments = build_parser().parse_args(argv)
    if arguments.physics_steps < 1:
        raise SystemExit("--physics-steps must be positive.")
    if arguments.timeout <= 0 or not math.isfinite(arguments.timeout):
        raise SystemExit("--timeout must be positive and finite.")

    source: str | Path | None = arguments.app_url or arguments.connection_file
    if source is None:
        source = default_connection_file()
    if source is None:
        raise SystemExit(
            "Pass --connection-file PATH, place connection.json in this or the parent directory, "
            "or use --app-url."
        )
    with Teleoperation.connect(
        source,
        scene_bundle=arguments.scene_bundle,
        timeout_s=arguments.timeout,
        client_id=arguments.client_id,
    ) as client:
        print(f"Connected: session={client.session_id}")
        _print_initial_states(client)
        if not client.initial_states:
            raise SystemExit("The session did not report any selectable initial states.")

        original = next(
            (state for state in client.initial_states if state.state_id == "state-000000"),
            client.initial_states[0],
        )
        selected_state_id = arguments.state_id or original.state_id
        if not any(state.state_id == selected_state_id for state in client.initial_states):
            raise SystemExit(f"Initial state '{selected_state_id}' was not found.")
        snapshot = client.select_initial_state(selected_state_id)
        print(f"Selected initial state: {selected_state_id}")
        _print_bindings(client)
        _print_state(client, snapshot)

        joints = _mapping(arguments.joint)
        actuators = _mapping(arguments.actuator)
        if joints is None and actuators is None:
            return

        snapshot = client.step(
            joints=joints,
            actuators=actuators,
            physics_steps=arguments.physics_steps,
        )
        print("Applied targets:")
        if joints:
            print(f"  joints={joints}")
        if actuators:
            print(f"  actuators={actuators}")
        _print_state(client, snapshot)


if __name__ == "__main__":
    main()
