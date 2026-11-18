# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Convert a Physical AI training checkpoint (.ckpt) into an OpenVINO policy package.

Physical AI training writes Lightning checkpoints to
experiments/lightning_logs/version_N/checkpoints/. The physicalai_evaluate_*.py scripts load an
OpenVINO package instead; this script writes one. ACT and Pi0.5 checkpoints are both supported
and told apart automatically.

    uv run --locked --extra openvino python physicalai_convert_to_openvino.py \
        --checkpoint /path/to/experiments/lightning_logs/version_0/checkpoints/last.ckpt

--checkpoint also accepts a version_N/ directory or the training folder (newest run's
last.ckpt). The package is written to version_N/openvino/<checkpoint name>/ unless --output is
given, and the script prints the evaluation command to run next. Pi0.5 export downloads the
PaliGemma tokenizer from Hugging Face on first use and needs plenty of memory.
"""

from __future__ import annotations

from robotic_studio.physicalai_export import main

if __name__ == "__main__":
    main()
