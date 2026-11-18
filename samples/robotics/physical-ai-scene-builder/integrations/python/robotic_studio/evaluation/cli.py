# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import sys
import threading
from pathlib import Path

from ..runtime import evaluation_environment, load_profile, load_scene
from .server import EvaluationServer
from .session import EvaluationSession


def _watch_parent(stop: threading.Event, parent_pid: int | None) -> None:
    if parent_pid is not None:
        while not stop.wait(0.5):
            try:
                os.kill(parent_pid, 0)
            except ProcessLookupError:
                stop.set()
                return
            except PermissionError:
                continue
        return
    while not stop.is_set():
        value = sys.stdin.read(1)
        if value == "":
            stop.set()
            return


async def _stop_when_parent_closes(parent_closed: threading.Event, server: EvaluationServer) -> None:
    while not parent_closed.is_set():
        await asyncio.sleep(0.1)
    server.stop()


async def _run(arguments: argparse.Namespace) -> None:
    profile = load_profile(arguments.profile)
    scene = load_scene(arguments.scene_bundle)
    bundle = scene.bundle
    try:
        environment = evaluation_environment(scene, profile)
        session: EvaluationSession | None = None
        try:
            session = EvaluationSession(
                environment,
                profile,
                session_id=arguments.session_id or "session",
                scene_id=str(profile.get("sceneId", "")),
                scene_fingerprint=str(profile.get("sceneFingerprint", "")),
                profile_id=str(profile.get("profileId", "runtime-policy")),
            )
            server = EvaluationServer(
                session,
                host=arguments.host,
                control_port=arguments.control_port,
                stream_port=arguments.stream_port,
            )
            parent_closed = threading.Event()
            parent_task: asyncio.Task[None] | None = None
            if not arguments.no_parent_watch:
                parent_thread = threading.Thread(
                    target=_watch_parent,
                    args=(parent_closed, arguments.parent_pid),
                    name="evaluation-parent-watch",
                    daemon=True,
                )
                parent_thread.start()
                parent_task = asyncio.create_task(_stop_when_parent_closes(parent_closed, server))
            loop = asyncio.get_running_loop()
            for signum in (signal.SIGINT, signal.SIGTERM):
                loop.add_signal_handler(signum, server.stop)
            try:
                await server.run()
            finally:
                if parent_task is not None:
                    parent_task.cancel()
                    await asyncio.gather(parent_task, return_exceptions=True)
        finally:
            if session is not None:
                session.invalidate()
            environment.close()
    finally:
        bundle.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a native Physical AI Scene Builder evaluation worker.")
    parser.add_argument("--scene-bundle", required=True, type=Path)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--session-id")
    parser.add_argument("--parent-pid", type=int)
    parser.add_argument("--no-parent-watch", action="store_true")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--control-port", default=8090, type=int)
    parser.add_argument("--stream-port", default=8091, type=int)
    return parser


def main() -> None:
    arguments = build_parser().parse_args()
    try:
        asyncio.run(_run(arguments))
    except KeyboardInterrupt:
        return
    except Exception as error:  # noqa: BLE001 - CLI reports a concise startup/runtime failure.
        print(json.dumps({"event": "error", "error": f"{type(error).__name__}: {error}"}), file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
