# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Benchmark native Generate throughput in-process, across worker processes, or over ZeroMQ.

Modes:

- ``in-process`` steps a ``NativeEnvironment`` directly. ``--workers N`` runs ``N`` spawn processes,
  each with its own ``--episodes``, and reports the aggregate recorded frames per second.
- ``zeromq`` starts a ``TeleoperationServer`` in this process, opens a viewport stream client (Studio
  requires one before a controller connects), and records each episode through ``Teleoperation``
  ``start_recording``/``step``/``stop_recording`` so the transport overhead is measured.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import multiprocessing
import tempfile
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from _common import action_targets, append_result, elapsed, environment, machine_info


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark native Generate reset/step/render throughput.")
    parser.add_argument("--scene-bundle", required=True, type=Path)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--mode", choices=("in-process", "zeromq"), default="in-process")
    parser.add_argument("--episodes", type=int, default=2, help="Episodes per worker process.")
    parser.add_argument("--frames", type=int, default=219)
    parser.add_argument("--cameras", choices=("profile", "none"), default="profile")
    parser.add_argument("--resolution", help="Override every configured camera resolution as WIDTHxHEIGHT.")
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="In-process worker processes (spawn); each runs --episodes. ZeroMQ mode supports 1.",
    )
    parser.add_argument("--writer", action="store_true", help="Include writing recorded RGB frames as AV1.")
    parser.add_argument("--profile-cpu", action="store_true", help="Print cProfile cumulative-time summary.")
    parser.add_argument("--no-save", action="store_true", help="Print the result without appending it to results/.")
    return parser


def _resolution(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    width, separator, height = value.lower().partition("x")
    if not separator or not width.isdigit() or not height.isdigit():
        raise ValueError("--resolution must have the form WIDTHxHEIGHT.")
    return int(width), int(height)


def _in_process(options: Mapping[str, Any]) -> dict[str, Any]:
    """Run ``options['episodes']`` episodes in this process and return timing totals."""
    bundle, native, profile = environment(Path(options["scene_bundle"]), options["profile"])
    try:
        if options["cameras"] == "none":
            native._render_rgb = False
        resolution = options["resolution"]
        if resolution is not None:
            native._camera_specs = tuple(
                type(camera)(camera.camera, camera.output_name, resolution[0], resolution[1])
                for camera in native._camera_specs
            )
        action = action_targets(native)
        reset_seconds = step_seconds = render_seconds = 0.0
        rendered_frames = total_frames = 0
        for episode in range(options["episodes"]):
            started = time.perf_counter()
            native.reset(seed=options["seed_offset"] + episode, images=False)
            reset_seconds += elapsed(started)
            for _ in range(options["frames"]):
                started = time.perf_counter()
                native.step(action, observe="state")
                step_seconds += elapsed(started)
                if native._render_rgb:
                    started = time.perf_counter()
                    native.observe(images=True)
                    render_seconds += elapsed(started)
                    rendered_frames += 1
                total_frames += 1
        writer_seconds = 0.0
        if options["writer"] and native._render_rgb:
            writer_seconds = _measure_writer(native, profile, action, options["frames"])
        return {
            "cameras": len(native._camera_specs) if native._render_rgb else 0,
            "frames": total_frames,
            "resetSeconds": reset_seconds,
            "stepSeconds": step_seconds,
            "renderSeconds": render_seconds,
            "writerSeconds": writer_seconds,
            "renderedFrames": rendered_frames,
        }
    finally:
        native.close()
        bundle.close()


def _measure_writer(native: Any, profile: Mapping[str, Any], action: Mapping[str, float], frames: int) -> float:
    from robotic_studio.generation.dataset import (
        CollectedEpisode,
        EpisodeFrame,
        EpisodeSummary,
        JSONNPZStagingWriter,
    )

    native.reset(seed=0, images=False)
    recorded = []
    for index in range(frames):
        observation = native.observe(images=True)
        recorded.append(
            EpisodeFrame.from_values(
                index,
                observation.simulation_time,
                observation.state,
                [action[name] for name in action],
                str(profile.get("name", "benchmark")),
                images=observation.images,
            )
        )
        native.step(action, observe="state")
    with tempfile.TemporaryDirectory(prefix="robotic-studio-bench-") as output:
        writer = JSONNPZStagingWriter(
            Path(output) / "dataset",
            successful_only=False,
            video_fps=int(profile.get("captureFps", 30)),
        )
        started = time.perf_counter()
        writer.write_episode(CollectedEpisode(EpisodeSummary(0, 0, "recorded", 1, len(recorded)), tuple(recorded)))
        return elapsed(started)


def _base_result(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "machine": machine_info(),
        "mode": args.mode,
        "sceneBundle": str(args.scene_bundle),
        "profile": str(args.profile),
        "episodes": args.episodes,
        "framesPerEpisode": args.frames,
        "workers": args.workers,
        "writer": bool(args.writer),
    }


def _run_in_process(args: argparse.Namespace) -> dict[str, Any]:
    options = {
        "scene_bundle": str(args.scene_bundle),
        "profile": args.profile,
        "episodes": args.episodes,
        "frames": args.frames,
        "cameras": args.cameras,
        "resolution": _resolution(args.resolution),
        "writer": bool(args.writer),
    }
    started = time.perf_counter()
    if args.workers == 1:
        runs = [_in_process({**options, "seed_offset": 0})]
    else:
        context = multiprocessing.get_context("spawn")
        with context.Pool(args.workers) as pool:
            runs = pool.map(
                _in_process,
                [{**options, "seed_offset": worker * args.episodes} for worker in range(args.workers)],
            )
    wall_seconds = elapsed(started)
    total_frames = sum(run["frames"] for run in runs)
    simulated = [run["resetSeconds"] + run["stepSeconds"] + run["renderSeconds"] for run in runs]
    return {
        **_base_result(args),
        "cameras": runs[0]["cameras"],
        "resetSeconds": sum(run["resetSeconds"] for run in runs),
        "stepSeconds": sum(run["stepSeconds"] for run in runs),
        "renderSeconds": sum(run["renderSeconds"] for run in runs),
        "writerSeconds": sum(run["writerSeconds"] for run in runs),
        "renderedFrames": sum(run["renderedFrames"] for run in runs),
        "wallSeconds": wall_seconds,
        # Per process: frames over its own simulation time; aggregate: all frames over wall time
        # (includes process start-up and scene compilation for --workers > 1).
        "recordedFramesPerSecond": runs[0]["frames"] / max(simulated[0], 1e-9),
        "aggregateFramesPerSecond": total_frames / max(wall_seconds, 1e-9),
        "perWorkerFramesPerSecond": [run["frames"] / max(seconds, 1e-9) for run, seconds in zip(runs, simulated)],
    }


class _StreamClient:
    """Stand-in for the Studio viewport: holds a WebSocket stream open and drains previews."""

    def __init__(self, endpoint: str) -> None:
        from websockets.sync.client import connect

        self._connection = connect(endpoint, max_size=16 * 1024 * 1024)
        self.messages = 0
        self._thread = threading.Thread(target=self._drain, name="bench-stream-client", daemon=True)
        self._thread.start()

    def _drain(self) -> None:
        from websockets.exceptions import ConnectionClosed

        try:
            while True:
                self._connection.recv()
                self.messages += 1
        except (ConnectionClosed, OSError, RuntimeError):
            return

    def close(self) -> None:
        self._connection.close()
        self._thread.join(timeout=3)


def _wait_for(condition: Any, timeout_s: float, message: str) -> None:
    deadline = time.monotonic() + timeout_s
    while not condition():
        if time.monotonic() > deadline:
            raise RuntimeError(message)
        time.sleep(0.01)


def _run_zeromq(args: argparse.Namespace) -> dict[str, Any]:
    from robotic_studio.generation import NativeEnvironment
    from robotic_studio.runtime import load_profile, load_scene
    from robotic_studio.teleoperation.client import Teleoperation
    from robotic_studio.teleoperation.server import TeleoperationServer
    from robotic_studio.teleoperation.session import TeleoperationSession

    if args.workers != 1:
        raise ValueError("--mode zeromq measures one worker; use --mode in-process for --workers > 1.")
    profile = load_profile(args.profile)
    if args.cameras == "none":
        profile = {**profile, "cameras": [], "captureRgb": False}
    resolution = _resolution(args.resolution)
    if resolution is not None:
        profile["cameras"] = [
            {**camera, "width": resolution[0], "height": resolution[1]} for camera in profile.get("cameras", [])
        ]
    physics_steps = int(profile.get("physicsSteps", 1))
    scene = load_scene(args.scene_bundle)
    with tempfile.TemporaryDirectory(prefix="robotic-studio-bench-zmq-") as temporary:
        root = Path(temporary)
        render_rgb = bool(profile.get("captureRgb", False)) and bool(profile.get("cameras"))
        loop_ready = threading.Event()
        state: dict[str, Any] = {}

        async def serve() -> None:
            # Renderers are bound to the thread that creates them, so the environment, session, and
            # server all live on the worker thread, as they do in the worker process.
            native = NativeEnvironment(
                scene,
                action_fields=profile["action"],
                physics_steps=physics_steps,
                cameras=profile.get("cameras", []),
                render_rgb=render_rgb,
            )
            try:
                session = TeleoperationSession(native, profile, root / "collection")
                server = TeleoperationServer(session)
                state.update(loop=asyncio.get_running_loop(), native=native, session=session, server=server)
                loop_ready.set()
                await server.run()
            finally:
                native.close()

        def run_server() -> None:
            try:
                asyncio.run(serve())
            except BaseException as error:  # noqa: BLE001 - reported to the benchmark thread.
                state["error"] = error
                loop_ready.set()

        thread = threading.Thread(target=run_server, name="bench-teleoperation-server", daemon=True)
        thread.start()
        stream: _StreamClient | None = None
        try:
            if not loop_ready.wait(timeout=30) or "error" in state:
                raise RuntimeError("The ZeroMQ benchmark worker did not start.") from state.get("error")
            native, session, server = state["native"], state["session"], state["server"]
            _wait_for(lambda: "stream" in server.endpoints, 10, "The ZeroMQ benchmark worker did not open its ports.")
            stream = _StreamClient(server.endpoints["stream"])
            _wait_for(lambda: len(server._websockets) > 0, 10, "The benchmark stream client did not connect.")
            connection_file = root / "connection.json"
            connection_file.write_text(
                json.dumps(
                    {
                        "sessionId": session.session_id,
                        "sceneFingerprint": session.collection.scene_fingerprint,
                        "endpoints": {
                            "control": server.endpoints["control"],
                            "publisher": server.endpoints["publisher"],
                        },
                        "sceneBundle": str(Path(args.scene_bundle).resolve()),
                    }
                ),
                encoding="utf-8",
            )
            step_seconds = record_seconds = 0.0
            frames = 0
            with Teleoperation.connect(connection_file, timeout_s=30.0) as client:
                targets = {
                    name: (target.control_range[0] + target.control_range[1]) / 2 if target.control_range else 0.0
                    for name, target in native.action_targets.items()
                }
                started = time.perf_counter()
                for _episode in range(args.episodes):
                    client.start_recording()
                    step_started = time.perf_counter()
                    for _frame in range(args.frames):
                        client.step(actuators=targets, physics_steps=physics_steps)
                        frames += 1
                    step_seconds += elapsed(step_started)
                    stop_started = time.perf_counter()
                    if args.writer:
                        client.stop_recording(save=True)
                    else:
                        client.stop_recording(save=False)
                        client.discard_recording()
                    record_seconds += elapsed(stop_started)
                elapsed_seconds = elapsed(started)
            return {
                **_base_result(args),
                "cameras": len(profile.get("cameras", [])) if render_rgb else 0,
                "elapsedSeconds": elapsed_seconds,
                "stepSeconds": step_seconds,
                "stopRecordingSeconds": record_seconds,
                "frames": frames,
                "streamMessages": stream.messages,
                "recordedFramesPerSecond": frames / max(step_seconds, 1e-9),
                "aggregateFramesPerSecond": frames / max(elapsed_seconds, 1e-9),
            }
        finally:
            if stream is not None:
                stream.close()
            if "server" in state:
                state["loop"].call_soon_threadsafe(state["server"].stop)
            thread.join(timeout=10)
            scene.bundle.close()


def _run(args: argparse.Namespace) -> dict[str, Any]:
    if args.episodes < 1 or args.frames < 1 or args.workers < 1:
        raise ValueError("episodes, frames, and workers must be positive.")
    if args.mode == "zeromq":
        if args.profile is None:
            raise ValueError("--profile is required for ZeroMQ benchmark mode.")
        result = _run_zeromq(args)
    else:
        result = _run_in_process(args)
    if not args.no_save:
        append_result("generate", result)
    return result


def main() -> None:
    args = build_parser().parse_args()
    if args.profile_cpu:
        import cProfile
        import pstats

        profiler = cProfile.Profile()
        profiler.enable()
        result = _run(args)
        profiler.disable()
        pstats.Stats(profiler).sort_stats("cumulative").print_stats(30)
    else:
        result = _run(args)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
