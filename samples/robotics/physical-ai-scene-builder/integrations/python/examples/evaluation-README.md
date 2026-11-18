<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Physical AI Scene Builder Evaluation

## Description

The evaluation examples run on your machine, next to your trained checkpoint. They connect to the
native simulation in Physical AI Scene Builder; your checkpoint and its dependencies stay on your
machine. There is one script for each framework and model type:

| Checkpoint type      | Pi0.5 script                  | ACT script                   |
| -------------------- | ----------------------------- | ---------------------------- |
| Physical AI OpenVINO | `physicalai_evaluate_pi05.py` | `physicalai_evaluate_act.py` |
| LeRobot-native       | `lerobot_evaluate_pi05.py`    | `lerobot_evaluate_act.py`    |

## Before You Start

1. Open the scene in Physical AI Scene Builder and go to **Simulate > External control**.
2. Turn on **Stream to external app**. This starts the native worker that runs the scene physics.
   Keep streaming on while evaluating; the script connects to this worker.
3. Extract the full evaluation archive next to your checkpoint and keep its files together. Run
   commands from the extracted archive root. The project requires Python 3.12 and `uv`.
4. For a server on another LAN machine, use its app address with `--studio-url`. The SDK relays
   commands and camera observations through the app port, so no native worker ports need to be
   opened. The app has no user authentication; use only a trusted LAN.

## Convert a Physical AI Checkpoint

Physical AI training (`physicalai_train_act.sh` / `physicalai_train_pi05.sh` in the training
download) writes Lightning checkpoints (`.ckpt`), not OpenVINO packages. Install the `openvino`
extra, then convert a checkpoint:

```sh
uv run --locked python physicalai_convert_to_openvino.py --checkpoint /path/to/experiments/lightning_logs/version_0/checkpoints/last.ckpt
```

The script detects ACT or Pi0.5, writes the package to
`version_0/openvino/<checkpoint name>/` (for `last.ckpt`, the name of the epoch it points to), and
prints the evaluation command to run next. `--checkpoint` also accepts a `version_N` directory or
the training folder itself, which selects the newest run's `last.ckpt`.

| Option               | Meaning                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `--output DIR`       | Write the package somewhere else.                                         |
| `--policy act\|pi05` | Name the policy instead of detecting it.                                  |
| `--int8`             | INT8 weights: smaller, faster on CPU. Compare its success rate with FP16. |
| `--overwrite`        | Replace an existing package at the output path.                           |

Conversion runs on the CPU. ACT takes seconds. Pi0.5 takes about 10 minutes and around 50 GB of
RAM, writes a package of about 6 GB, and downloads the PaliGemma tokenizer
(`google/paligemma-3b-pt-224`) from Hugging Face on first use. That model is gated: accept its
license on Hugging Face and run `hf auth login` first.

A checkpoint from a training download made before Physical AI 0.2 can fail with a message that its
weights do not match. Export it in that download's own environment instead:
`uv run --locked physicalai export --policy physicalai.policies.ACT --ckpt_path <ckpt> --backend openvino --output_dir <dir>`
(`physicalai.policies.Pi05` for Pi0.5).

## Quick Start

From the extracted archive root, install the extra for your checkpoint format. Install only the
extra you need:

```sh
uv sync --locked --extra openvino
```

For a LeRobot-native checkpoint, use this instead:

```sh
uv sync --locked --extra lerobot
```

Then run the script matching your checkpoint. Pi0.5 requires `--task`; ACT does not:

```sh
# Physical AI OpenVINO Pi0.5
uv run --locked python physicalai_evaluate_pi05.py --package /path/to/pi05_openvino --task "pick up the cube" --episodes 10

# Physical AI OpenVINO ACT
uv run --locked python physicalai_evaluate_act.py --package /path/to/act_openvino --episodes 10

# LeRobot Pi0.5
uv run --locked python lerobot_evaluate_pi05.py --checkpoint /path/to/pretrained_model --task "pick up the cube" --episodes 10

# LeRobot ACT
uv run --locked python lerobot_evaluate_act.py --checkpoint /path/to/pretrained_model --episodes 10
```

ACT predicts 100 actions (about 3 seconds) at a time. Both ACT scripts use the first
10, then looks at the cameras again and predicts a fresh chunk, so the arm can correct a grasp that
starts slightly off. `--temporal-ensemble 0.01` re-plans at every step and blends the overlapping
predictions (slower); `--action-steps 100` runs each whole chunk without looking.

Add `--help` to an example for its options. The `robotic-studio-physicalai-openvino-eval` and
`robotic-studio-lerobot-eval` commands provide the same evaluations with additional options.

## File Structure

```text
evaluation-example/
├── README.md                         # Setup and evaluation guide
├── pyproject.toml                    # Project dependencies and CLI entry points
├── uv.lock                           # Locked dependency versions
├── physicalai_evaluate_pi05.py       # Evaluate a Physical AI Pi0.5 OpenVINO package
├── physicalai_evaluate_act.py        # Evaluate a Physical AI ACT OpenVINO package
├── physicalai_convert_to_openvino.py # Convert a Physical AI training checkpoint
├── lerobot_evaluate_pi05.py          # Evaluate a LeRobot Pi0.5 checkpoint
├── lerobot_evaluate_act.py           # Evaluate a LeRobot ACT checkpoint
└── robotic_studio/                   # Python SDK and evaluation helpers
```
