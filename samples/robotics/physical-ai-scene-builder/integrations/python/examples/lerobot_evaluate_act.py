# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Evaluate a LeRobot-native ACT checkpoint in Physical AI Scene Builder.

ACT is not language-conditioned, so no --task is needed. Open the scene in
Physical AI Scene Builder first, then run this script. When prompted, click Start streaming
in Evaluate > External control.

Each run evaluates --episodes seeded episodes (seeds --seed-start, +1, ...), prints one line per
episode, then the success rate and the range its true value likely falls in (fewer episodes give
a wider range), and writes a JSON run record to --run-dir. Enter q + Enter or press Ctrl+C to
stop; the record is still written.

To evaluate without the browser, add --local --scene-bundle SCENE --profile PROFILE; with --local,
--num-envs N runs N simulated environments in parallel.

ACT predicts 100 actions at a time; by default the script re-plans from the cameras after the first
10 (--action-steps). --temporal-ensemble 0.01 re-plans at every step instead (slower).

    uv run --extra lerobot python lerobot_evaluate_act.py \
        --checkpoint outputs/train/act/checkpoints/last/pretrained_model \
        --episodes 10
"""

from __future__ import annotations

import argparse
from pathlib import Path

from robotic_studio.evaluation_report import (
    add_evaluation_arguments,
    evaluation_environment,
    lerobot_checkpoint_files,
    run_policy_evaluation,
)
from robotic_studio.lerobot_policy import LeRobotRunner
from robotic_studio.physicalai_openvino import add_action_execution_arguments

# ACT predicts 100 actions (3.3 s) at a time. Re-planning from the cameras every 10 lets it correct a
# slightly-off grasp; running whole chunks blind roughly halved the success rate in our tests.
ACT_ACTION_STEPS = 10


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--checkpoint",
        required=True,
        help="LeRobot pretrained_model checkpoint directory (config.json + model.safetensors).",
    )
    parser.add_argument("--device", default="auto", help="Torch device, e.g. auto, cpu, cuda.")
    add_action_execution_arguments(parser, default_action_steps=ACT_ACTION_STEPS)
    add_evaluation_arguments(parser)
    args = parser.parse_args()
    if args.temporal_ensemble is not None:
        args.action_steps = None  # the two are alternatives; drop the default

    runner = LeRobotRunner(
        args.checkpoint,
        device=args.device,
        action_steps=args.action_steps,
        temporal_ensemble=args.temporal_ensemble,
    )
    checkpoint = Path(args.checkpoint).resolve()
    task = None
    with evaluation_environment(args) as environment:
        run_policy_evaluation(
            runner,
            environment,
            args,
            policy={
                "framework": "lerobot",
                "checkpoint": str(checkpoint),
                "task": task,
                **runner.describe_action_execution(),
            },
            checkpoint_files=lerobot_checkpoint_files(checkpoint),
            checkpoint_root=checkpoint,
            task=task,
        )


if __name__ == "__main__":
    main()
