# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import platform
import socket
import subprocess  # nosec B404
import time
from pathlib import Path
from typing import Any

import numpy as np

from robotic_studio.generation import NativeEnvironment
from robotic_studio.runtime import load_scene


def json_file(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}.")
    return value


def environment(scene_path: Path, profile_path: Path | None) -> tuple[Any, NativeEnvironment, dict[str, Any]]:
    """Load a scene bundle and build the environment the Evaluate worker would; returns the bundle too."""
    profile = json_file(profile_path) if profile_path is not None else {}
    cameras = profile.get("cameras", [])
    if not isinstance(cameras, list):
        raise ValueError("profile.cameras must be an array.")
    action = profile.get("action", [])
    if not isinstance(action, list):
        raise ValueError("profile.action must be an array.")
    scene = load_scene(scene_path)
    try:
        native = NativeEnvironment(
            scene,
            task={"randomization": profile.get("randomization", [])},
            action_fields=action,
            physics_steps=profile.get("physicsSteps", 1),
            cameras=cameras,
            render_rgb=bool(cameras),
        )
    except Exception:
        scene.bundle.close()
        raise
    return scene.bundle, native, profile


def action_targets(environment: NativeEnvironment) -> dict[str, float]:
    return {
        name: (target.control_range[0] + target.control_range[1]) / 2
        if target.control_range is not None
        else 0.0
        for name, target in environment.action_targets.items()
    }


def machine_info() -> dict[str, Any]:
    import mujoco

    renderer = None
    try:
        renderer = subprocess.run(
            ["eglinfo", "-B"],
            capture_output=True,
            check=False,
            text=True,
            timeout=3,
        ).stdout.strip()[:2_000]
    except (OSError, subprocess.TimeoutExpired):
        pass
    return {
        "host": socket.gethostname(),
        "platform": platform.platform(),
        "processor": platform.processor(),
        "python": sys.version.split()[0],
        "mujoco": mujoco.__version__,
        "eglInfo": renderer,
    }


def append_result(kind: str, result: dict[str, Any]) -> None:
    output = Path(__file__).parent / "results" / f"{socket.gethostname()}.jsonl"
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"benchmark": kind, **result}, sort_keys=True) + "\n")


def elapsed(start: float) -> float:
    return time.perf_counter() - start


def observation_bytes(observation: Any) -> int:
    size = sum(np.asarray(value).nbytes for value in (observation.state, observation.qpos, observation.qvel))
    size += sum(np.asarray(image).nbytes for image in observation.images.values())
    return int(size)
