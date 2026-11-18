# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Evaluate a LeRobot-native Pi0.5 checkpoint in Physical AI Scene Builder.

Pi0.5 is language-conditioned, so --task is required: pass the same instruction
text used during training. Open the scene in Physical AI Scene Builder first, then run
this script. When prompted, click Start streaming in Evaluate > External
control.

Each run evaluates --episodes seeded episodes (seeds --seed-start, +1, ...), prints one line per
episode, then the success rate and the range its true value likely falls in (fewer episodes give
a wider range), and writes a JSON run record to --run-dir. Enter q + Enter or press Ctrl+C to
stop; the record is still written.

To evaluate without the browser, add --local --scene-bundle SCENE --profile PROFILE; with --local,
--num-envs N runs N simulated environments in parallel.

    uv run --extra lerobot python lerobot_evaluate_pi05.py \
        --checkpoint outputs/train/pi05/checkpoints/last/pretrained_model \
        --task "pick up cube and put it into container" --episodes 10
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--checkpoint",
        required=True,
        help="LeRobot pretrained_model checkpoint directory (config.json + model.safetensors).",
    )
    parser.add_argument(
        "--task",
        required=True,
        help="Task instruction used during training, e.g. 'pick up cube and put it into container'.",
    )
    parser.add_argument("--device", default="auto", help="Torch device, e.g. auto, cpu, cuda.")
    add_evaluation_arguments(parser)
    args = parser.parse_args()

    runner = LeRobotRunner(args.checkpoint, device=args.device)
    checkpoint = Path(args.checkpoint).resolve()
    task = args.task
    with evaluation_environment(args) as environment:
        run_policy_evaluation(
            runner,
            environment,
            args,
            policy={"framework": "lerobot", "checkpoint": str(checkpoint), "task": task},
            checkpoint_files=lerobot_checkpoint_files(checkpoint),
            checkpoint_root=checkpoint,
            task=task,
        )


if __name__ == "__main__":
    main()
