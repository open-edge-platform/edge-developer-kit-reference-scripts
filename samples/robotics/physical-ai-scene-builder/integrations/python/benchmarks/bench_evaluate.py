# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import argparse
import json
import tempfile
import time
from pathlib import Path
from typing import Any

import numpy as np

from _common import (
    action_targets,
    append_result,
    elapsed,
    environment,
    json_file,
    machine_info,
    observation_bytes,
)
from robotic_studio.evaluation_loop import PolicyRunnerMixin


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Benchmark native Evaluate reset/step/render throughput.")
    parser.add_argument("--scene-bundle", required=True, type=Path)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--episodes", type=int, default=2)
    parser.add_argument("--frames", type=int, default=219)
    parser.add_argument("--cameras", choices=("profile", "none"), default="profile")
    parser.add_argument("--policy", choices=("zero", "random"), default="zero")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--num-envs", type=int, default=1)
    parser.add_argument("--policy-batching", choices=("batched", "per-env"), default="batched")
    parser.add_argument(
        "--vector",
        action="store_true",
        help="Use the vectorized Evaluate path (evaluate_vector) even with --num-envs 1.",
    )
    parser.add_argument("--egl-devices", nargs="*", type=int, help="EGL device indices for vector workers.")
    return parser


def _run(args: argparse.Namespace) -> dict[str, Any]:
    if args.episodes < 1 or args.frames < 1 or args.workers < 1 or args.num_envs < 1:
        raise ValueError("episodes, frames, workers, and num-envs must be positive.")
    if args.num_envs > 1 or args.vector:
        return _run_vectorized(args)
    setup_started = time.perf_counter()
    bundle, native, profile = environment(args.scene_bundle, args.profile)
    setup_seconds = elapsed(setup_started)
    try:
        if args.cameras == "none":
            native._render_rgb = False
        action = action_targets(native)
        rng = np.random.default_rng(args.seed)
        reset_seconds = physics_seconds = render_seconds = serialization_seconds = 0.0
        observed_bytes = steps = 0
        loop_started = time.perf_counter()
        for episode in range(args.episodes):
            started = time.perf_counter()
            observation = native.reset(seed=args.seed + episode, images=False)
            reset_seconds += elapsed(started)
            for _ in range(args.frames):
                targets = action
                if args.policy == "random":
                    targets = {}
                    for name, target in native.action_targets.items():
                        if target.control_range is not None:
                            targets[name] = float(rng.uniform(*target.control_range))
                        else:
                            targets[name] = float(rng.normal())
                started = time.perf_counter()
                native.step(targets, observe="state")
                physics_seconds += elapsed(started)
                if native._render_rgb:
                    started = time.perf_counter()
                    observation = native.observe(images=True)
                    render_seconds += elapsed(started)
                else:
                    observation = native.observe(images=False)
                started = time.perf_counter()
                observed_bytes += observation_bytes(observation)
                serialization_seconds += elapsed(started)
                steps += 1
        loop_seconds = elapsed(loop_started)
        result: dict[str, Any] = {
            "machine": machine_info(),
            "sceneBundle": str(args.scene_bundle),
            "profile": str(args.profile),
            "episodes": args.episodes,
            "framesPerEpisode": args.frames,
            "workers": args.workers,
            "policy": args.policy,
            "cameras": len(native._camera_specs) if native._render_rgb else 0,
            "resetSeconds": reset_seconds,
            "physicsSeconds": physics_seconds,
            "renderSeconds": render_seconds,
            "serializationSeconds": serialization_seconds,
            "observationBytes": observed_bytes,
            **_throughput(steps, setup_seconds, loop_seconds),
        }
        append_result("evaluate", result)
        return result
    finally:
        native.close()
        bundle.close()


def main() -> None:
    args = build_parser().parse_args()
    print(_run(args))


def _throughput(env_steps: int, setup_seconds: float, loop_seconds: float) -> dict[str, Any]:
    """Shared metric definitions: executed env steps over episode-loop wall time (setup excluded)."""
    return {
        "envSteps": env_steps,
        "setupSeconds": setup_seconds,
        "loopSeconds": loop_seconds,
        "envStepsPerSecond": env_steps / max(loop_seconds, 1e-9),
    }


class _ScriptedRunner(PolicyRunnerMixin):
    """Zero (control-range midpoint) or uniformly random actions, matching the sequential branch."""

    policy_type = "scripted"
    device = "cpu"

    def __init__(self, policy: str, seed: int) -> None:
        self._policy = policy
        self._bit_generator = np.random.PCG64(seed)
        self._ranges: list[tuple[float, float] | None] = []

    def validate_description(self, description: Any) -> None:
        self._description = description
        self._ranges = [
            (float(field["controlRange"][0]), float(field["controlRange"][1])) if field.get("controlRange") else None
            for field in description.get("actions", [])
        ]

    def reset_policy(self, task: str | None = None) -> None:
        return None

    def _actions(self, rows: int) -> np.ndarray:
        actions = np.zeros((rows, len(self._ranges)), dtype=np.float32)
        rng = np.random.Generator(self._bit_generator)
        for column, bounds in enumerate(self._ranges):
            if self._policy == "random":
                actions[:, column] = rng.uniform(*bounds, size=rows) if bounds is not None else rng.normal(size=rows)
            elif bounds is not None:
                actions[:, column] = (bounds[0] + bounds[1]) / 2
        return actions

    def select_action(self, observation: Any) -> np.ndarray:
        return self._actions(1)[0]

    def infer_action_batch(self, states: np.ndarray, images: Any, task: str | None = None) -> np.ndarray:
        return self._actions(len(states))


def _run_vectorized(args: argparse.Namespace) -> dict[str, Any]:
    from robotic_studio.vector_environment import SubprocessVectorEnvironment

    with tempfile.TemporaryDirectory(prefix="bench-evaluate-") as scratch:
        profile_path = Path(args.profile)
        profile = json_file(profile_path)
        if args.cameras == "none":
            profile = {**profile, "cameras": []}
            profile_path = Path(scratch) / "profile.json"
            profile_path.write_text(json.dumps(profile), encoding="utf-8")
        setup_started = time.perf_counter()
        vector = SubprocessVectorEnvironment(
            str(args.scene_bundle), str(profile_path), num_envs=args.num_envs, egl_devices=args.egl_devices
        )
        setup_seconds = elapsed(setup_started)
        try:
            runner = _ScriptedRunner(args.policy, args.seed)
            loop_started = time.perf_counter()
            # Run every frame like the sequential branch; only task termination ends a row early.
            results = runner.evaluate_vector(
                vector,
                episodes=args.episodes,
                start_seed=args.seed,
                max_steps=args.frames,
                policy_batching=args.policy_batching,
                terminate_on_success=False,
            )
            loop_seconds = elapsed(loop_started)
        finally:
            vector.close()
    outcomes: dict[str, int] = {}
    for episode in results:
        outcomes[episode.outcome] = outcomes.get(episode.outcome, 0) + 1
    result: dict[str, Any] = {
        "machine": machine_info(),
        "sceneBundle": str(args.scene_bundle),
        "profile": str(args.profile),
        "episodes": args.episodes,
        "framesPerEpisode": args.frames,
        "numEnvs": args.num_envs,
        "policy": args.policy,
        "policyBatching": args.policy_batching,
        "eglDevices": args.egl_devices,
        "cameras": len(profile.get("cameras") or []),
        "completed": len(results),
        "outcomes": outcomes,
        **_throughput(sum(episode.steps for episode in results), setup_seconds, loop_seconds),
    }
    append_result("evaluate-vector", result)
    return result


if __name__ == "__main__":
    main()
