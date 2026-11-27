# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Scripted SO-101 pick-and-place success over randomized object start poses (roadmap item 6).

Builds a throwaway collection from a scene bundle and profile, adds ``--states`` randomized
states (object x/y within ``--x-cm``/``--y-cm`` and yaw within ``--yaw-deg``, no robot joint
offsets), records them with the batch Generate runner exactly as Generate does, and prints the
success rate (overall, and over states with a feasible grasp) and failure reasons. A run record is appended to ``results/`` unless ``--no-save``.

    uv run --project integrations/python --extra teleoperation \\
      python integrations/python/benchmarks/bench_scripted.py \\
      --scene-bundle integrations/python/benchmarks/fixtures/so101.mujoco-scene \\
      --profile integrations/python/benchmarks/fixtures/so101-profile.json \\
      --states 100 --x-cm 10 --y-cm 10 --yaw-deg 45 --workers 8
"""

from __future__ import annotations

import argparse
import json
import random
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

RESULTS = Path(__file__).parent / "results"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--scene-bundle", type=Path, required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--body", default="asset_cube", help="Object to randomize and pick (default: asset_cube).")
    parser.add_argument("--states", type=int, default=100)
    parser.add_argument("--x-cm", type=float, default=10.0, help="Symmetric x range in cm (default: 10).")
    parser.add_argument("--y-cm", type=float, default=10.0, help="Symmetric y range in cm (default: 10).")
    parser.add_argument("--yaw-deg", type=float, default=45.0, help="Symmetric yaw range in degrees (default: 45).")
    parser.add_argument("--seed", type=int, default=0, help="Seed for the state seeds (default: 0).")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--keep", type=Path, help="Keep the collection here instead of a temporary directory.")
    parser.add_argument("--no-save", action="store_true", help="Do not append the result to results/.")
    return parser


def add_states(scene_bundle: Path, profile: dict[str, Any], collection_dir: Path, arguments: argparse.Namespace) -> None:
    from robotic_studio.runtime import load_scene
    from robotic_studio.teleoperation.collection import TeleoperationCollectionStore
    from robotic_studio.teleoperation.session import TeleoperationSession, build_teleoperation_environment

    collection_id = f"collection-{profile['sceneId']}-benchmark"
    store = TeleoperationCollectionStore(
        collection_dir,
        collection_id=collection_id,
        scene_id=str(profile["sceneId"]),
        scene_fingerprint=str(profile["sceneFingerprint"]),
    )
    environment = build_teleoperation_environment(load_scene(scene_bundle), {**profile, "captureRgb": False})
    try:
        session = TeleoperationSession(
            environment, profile, collection_dir, collection_id=collection_id, collection_store=store
        )
        zone = {
            "enabled": True,
            "body": arguments.body,
            "xCm": [-arguments.x_cm, arguments.x_cm],
            "yCm": [-arguments.y_cm, arguments.y_cm],
            "yawDegrees": [-arguments.yaw_deg, arguments.yaw_deg],
        }
        # Seeded for reproducible benchmark layouts, not security.
        seeds = random.Random(arguments.seed)  # nosec B311
        base = session.active_state_id
        for _ in range(arguments.states):
            session.select_state("node-admin", None, base, admin=True)
            session.append_randomized_state(
                "node-admin",
                None,
                seeds.randrange(2**32),
                source_randomization=zone,
                robot_randomization={"enabled": False},
                admin=True,
            )
    finally:
        environment.close()


LAYOUT_FAILURES = ("unreachable", "grasp_blocked")


def infeasible(report: dict[str, Any]) -> int:
    reasons = report.get("failuresByReason") or {}
    return sum(int(reasons.get(reason) or 0) for reason in LAYOUT_FAILURES)


def main(argv: list[str] | None = None) -> int:
    from robotic_studio.generation import batch
    from robotic_studio.runtime import load_profile

    arguments = build_parser().parse_args(argv)
    profile = load_profile(arguments.profile)
    with tempfile.TemporaryDirectory(prefix="robotic-studio-bench-scripted-") as temporary:
        collection_dir = arguments.keep or Path(temporary)
        collection_dir.mkdir(parents=True, exist_ok=True)
        add_states(arguments.scene_bundle, profile, collection_dir, arguments)
        collection = json.loads((collection_dir / "collection.json").read_text())
        states = [state["stateId"] for state in collection["states"] if state["index"] > 0]
        report_path = collection_dir / "report.json"
        batch.main(
            [
                "--scene-bundle",
                str(arguments.scene_bundle),
                "--profile",
                str(arguments.profile),
                "--collection-dir",
                str(collection_dir),
                "--states",
                *states,
                "--workers",
                str(arguments.workers),
                "--report",
                str(report_path),
            ]
        )
        report = json.loads(report_path.read_text())
    total = int(report.get("total") or 0)
    saved = int(report.get("saved") or 0)
    result = {
        "label": "auto",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sceneBundle": str(arguments.scene_bundle),
        "body": arguments.body,
        "states": arguments.states,
        "range": {"xCm": arguments.x_cm, "yCm": arguments.y_cm, "yawDegrees": arguments.yaw_deg},
        "seed": arguments.seed,
        "workers": arguments.workers,
        "total": total,
        "saved": saved,
        "successRate": saved / total if total else None,
        # States the planner rejects before moving (no reachable or unobstructed grasp) are a
        # property of the layout and range; the rest measure the controller itself.
        "feasibleSuccessRate": saved / feasible if (feasible := total - infeasible(report)) else None,
        "failuresByReason": report.get("failuresByReason") or {},
    }
    print(json.dumps(result, indent=2))
    if not arguments.no_save:
        RESULTS.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        (RESULTS / f"scripted-{stamp}.json").write_text(json.dumps(result, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
