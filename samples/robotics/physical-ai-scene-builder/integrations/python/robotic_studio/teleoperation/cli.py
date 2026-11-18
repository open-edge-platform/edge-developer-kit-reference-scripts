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
from typing import Any

from ..frame_clock import capture_fps_from_profile
from ..generation.batch import CollectionLock, cleanup_stale_staging
from ..generation.dataset import JSONNPZStagingWriter
from ..runtime import load_profile, load_scene
from .server import TeleoperationServer
from .session import TeleoperationSession, build_teleoperation_environment


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


async def _run(arguments: argparse.Namespace) -> None:
    profile = load_profile(arguments.profile)
    collection_dir = Path(arguments.collection_dir)
    # This worker is the collection's sole owner (collection.json and batch commits). The server
    # reuses this lock for batch jobs instead of locking the same file a second time.
    collection_lock = CollectionLock(collection_dir).acquire()
    try:
        cleanup_stale_staging(collection_dir / "dataset")
        scene = load_scene(arguments.scene_bundle)
        try:
            await _serve(arguments, profile, collection_dir, scene, collection_lock)
        finally:
            scene.bundle.close()
    finally:
        collection_lock.release()


async def _serve(
    arguments: argparse.Namespace,
    profile: dict[str, Any],
    collection_dir: Path,
    scene: Any,
    collection_lock: CollectionLock,
) -> None:
    environment = build_teleoperation_environment(scene, profile)
    try:
        # Cameras are stored as one AV1 video per episode at the capture rate.
        writer = JSONNPZStagingWriter(
            collection_dir / "dataset",
            successful_only=True,
            video_fps=capture_fps_from_profile(profile),
        )
        session = TeleoperationSession(
            environment,
            profile,
            collection_dir,
            session_id=arguments.session_id,
            collection_id=arguments.collection_id,
            writer=writer,
        )
        server = TeleoperationServer(
            session,
            host=arguments.host,
            control_port=arguments.control_port,
            publisher_port=arguments.publisher_port,
            stream_port=arguments.stream_port,
            collection_lock=collection_lock,
        )
        parent_closed = threading.Event()
        parent_task: asyncio.Task[None] | None = None
        if not arguments.no_parent_watch:
            parent_thread = threading.Thread(
                target=_watch_parent,
                args=(parent_closed, arguments.parent_pid),
                name="teleoperation-parent-watch",
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
            session.interrupt_recording()
            writer.finalize(
                {
                    "version": 1,
                    "kind": "teleoperation",
                    "sessionId": session.session_id,
                    "collectionId": session.collection_id,
                    "sceneId": session.collection.scene_id,
                    "sceneFingerprint": session.collection.scene_fingerprint,
                    "profile": profile,
                    "collection": session.collection.to_dict(),
                    "droppedStreamMessages": server.dropped_messages,
                }
            )
    finally:
        environment.close()


async def _stop_when_parent_closes(parent_closed: threading.Event, server: TeleoperationServer) -> None:
    while not parent_closed.is_set():
        await asyncio.sleep(0.1)
    server.stop()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a native Physical AI Scene Builder teleoperation session.")
    parser.add_argument("--scene-bundle", required=True, type=Path)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--collection-dir", required=True, type=Path)
    parser.add_argument("--session-id")
    parser.add_argument("--collection-id")
    parser.add_argument("--parent-pid", type=int)
    parser.add_argument("--no-parent-watch", action="store_true")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--control-port", default=8080, type=int)
    parser.add_argument("--publisher-port", default=8081, type=int)
    parser.add_argument("--stream-port", default=8082, type=int)
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
