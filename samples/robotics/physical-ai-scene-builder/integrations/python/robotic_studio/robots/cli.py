# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Shared command-line plumbing for the bundled robot examples.

Examples keep a small, user-facing option set: how to connect, which scene objects to use, and
``--verbose`` for troubleshooting. Transport details and controller tuning stay out of ``--help``.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any, TextIO

from ..teleoperation import Teleoperation, TeleoperationError
from ..teleoperation.client import _http_json

ONE_SIMULATION_NOTE = (
    "Physical AI Scene Builder runs one simulation at a time: turning on Stream to client (Generate) "
    "or streaming in Evaluate for another scene stops the previous one."
)


def add_connection_arguments(parser: argparse.ArgumentParser) -> None:
    """Add ``--connection-file`` / ``--app-url`` plus hidden compatibility options."""
    group = parser.add_argument_group("connection")
    group.add_argument(
        "--connection-file",
        dest="connection_file",
        type=Path,
        help="Connection file (defaults to connection.json in this or the parent directory).",
    )
    group.add_argument(
        "--app-url",
        help="Physical AI Scene Builder URL, for example http://localhost:3000. Finds the active session.",
    )
    # Advanced options: supported, but not shown in --help.
    parser.add_argument("--scene-bundle", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--control-endpoint", help=argparse.SUPPRESS)
    parser.add_argument("--publisher-endpoint", help=argparse.SUPPRESS)
    parser.add_argument("--timeout", type=float, default=5.0, help=argparse.SUPPRESS)
    parser.add_argument("--client-id", help=argparse.SUPPRESS)


def default_connection_file() -> Path | None:
    for candidate in (Path("connection.json"), Path("../connection.json")):
        if candidate.is_file():
            return candidate
    return None


def add_verbose_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Print controller details (targets, phases) for troubleshooting.",
    )


def resolve_connection_source(
    arguments: argparse.Namespace,
    default_scene_bundle: Path,
) -> tuple[str | Path | Mapping[str, Any], Path | None]:
    """Resolve app discovery, a downloaded connection file, or explicit endpoint flags."""
    endpoint_values = (arguments.control_endpoint, arguments.publisher_endpoint)
    if arguments.app_url:
        if arguments.connection_file or any(value is not None for value in endpoint_values):
            raise SystemExit("Use either --app-url or --connection-file, not both.")
        return arguments.app_url, arguments.scene_bundle
    if arguments.connection_file:
        if any(value is not None for value in endpoint_values):
            raise SystemExit("Use --connection-file by itself, without endpoint flags.")
        return arguments.connection_file, arguments.scene_bundle
    connection_file = default_connection_file()
    if connection_file is not None:
        return connection_file, arguments.scene_bundle
    if any(value is None for value in endpoint_values):
        raise SystemExit(
            "Tell the example how to reach Physical AI Scene Builder: place connection.json in the "
            "current or parent directory, pass --connection-file PATH, or use --app-url "
            "http://localhost:3000."
        )
    scene_bundle = arguments.scene_bundle or default_scene_bundle
    if not scene_bundle.is_file():
        raise SystemExit(
            f"Scene bundle not found at '{scene_bundle}'. Use --connection-file or --app-url instead."
        )
    return {
        "endpoints": {
            "control": arguments.control_endpoint,
            "publisher": arguments.publisher_endpoint,
        },
    }, scene_bundle


def _read_json(path: Path) -> Mapping[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, Mapping) else None


def choose_live_session(
    bundle: Mapping[str, Any] | None,
    live: Mapping[str, Any] | None,
    app_url: str | None,
) -> str | None:
    """Check the app's streaming session against the downloaded bundle's scene.

    Returns an app URL to connect through when the bundle's session was replaced by a new session
    of the same scene, ``None`` to connect as requested, and exits when the app is streaming a
    different scene (connecting would record into, or evaluate on, the wrong scene).
    """
    if not bundle:
        return None
    scene_id = bundle.get("sceneId")
    if live is None:
        if app_url is None and bundle.get("baseUrl"):
            raise SystemExit(
                f"Scene {scene_id} is not streaming. Open it in Physical AI Scene Builder and turn on "
                f"Stream to client, then run this again. {ONE_SIMULATION_NOTE}"
            )
        return None
    live_scene = live.get("sceneId")
    if scene_id is not None and live_scene is not None and str(scene_id) != str(live_scene):
        raise SystemExit(
            f"These examples were downloaded for scene {scene_id}, but the app is streaming scene "
            f"{live_scene}. Open scene {scene_id}, turn on Stream to client, then run this again. "
            f"{ONE_SIMULATION_NOTE}"
        )
    if app_url is None and bundle.get("sessionId") != live.get("sessionId"):
        return str(bundle.get("baseUrl") or "") or None
    return None


def connect(arguments: argparse.Namespace, *, default_scene_bundle: Path) -> Teleoperation:
    if arguments.timeout <= 0:
        raise SystemExit("--timeout must be positive.")
    source, scene_bundle = resolve_connection_source(arguments, default_scene_bundle)
    bundle_file = source if isinstance(source, Path) else default_connection_file()
    bundle = _read_json(bundle_file) if bundle_file is not None else None
    base_url = arguments.app_url or (bundle or {}).get("baseUrl")
    if bundle and base_url:
        try:
            live = _http_json(f"{str(base_url).rstrip('/')}/api/teleoperation/sessions", arguments.timeout)
        except TeleoperationError:
            live = None
        if live is not None and live.get("status") not in {"starting", "ready", "active"}:
            live = None
        replacement = choose_live_session(bundle, live, arguments.app_url)
        if replacement is not None:
            print(
                f"Scene {bundle.get('sceneId')} restarted streaming; connecting to its current session.",
                file=sys.stderr,
            )
            source = replacement
    try:
        return Teleoperation.connect(
            source,
            scene_bundle=scene_bundle,
            timeout_s=arguments.timeout,
            client_id=arguments.client_id,
        )
    except TeleoperationError as error:
        raise SystemExit(f"Could not connect to Physical AI Scene Builder: {error}") from error


def require_mujoco() -> Any:
    try:
        import mujoco
    except ModuleNotFoundError as error:
        raise SystemExit(
            "This example needs MuJoCo. Run it with `uv run --locked --extra teleoperation ...` "
            "from the extracted control examples."
        ) from error
    return mujoco


class Reporter:
    """User-facing output with optional troubleshooting detail."""

    def __init__(self, *, verbose: bool = False, stream: TextIO | None = None) -> None:
        self.verbose = verbose
        self.stream = stream or sys.stdout

    def info(self, message: str) -> None:
        print(message, file=self.stream, flush=True)

    def debug(self, message: str) -> None:
        if self.verbose:
            print(f"  · {message}", file=self.stream, flush=True)
