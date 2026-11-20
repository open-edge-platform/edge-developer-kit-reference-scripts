#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether MERaLiON-3-3B-ASR is already on disk for the MERaLiON
Speech to Text backend, without starting the worker.

Layout rule mirrored from ``ov_meralion.py`` (``model_dir``, ``download``):
the one model lives under ``<repo>/models/stt/meralion/MERaLiON/MERaLiON-3-3B-ASR``.
It counts as downloaded once the checkpoint files ``download`` fetches
(config, the two safetensors shards and their index, the tokenizer) are
there; the OpenVINO export the first start makes from them needs no network.

``files`` is that folder, which holds this model alone: the repository files
(plus the hub's ``.cache/`` with any partial download) and the exports
``ensure_export`` writes, one ``openvino-<precision>/`` per weight format
(``encoder.xml``, ``decoder.xml``, their ``.bin``, the NPU's compile
``cache/`` and the ``export.json`` marker). Nothing goes to the shared Hugging Face cache.
The ``models/stt/meralion`` folders above it stay.

Usage: python3 list_models.py --models <id> [<id> ...]
Prints a JSON array to stdout: [{"name", "downloaded", "path", "files"}].
Diagnostics go to stderr; this always exits 0.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

MODEL_ID = "MERaLiON/MERaLiON-3-3B-ASR"
FILES = (
    "config.json",
    "model.safetensors.index.json",
    "model-00001-of-00002.safetensors",
    "model-00002-of-00002.safetensors",
    "tokenizer.json",
)


def _paths_module():
    """Load ``worker_common/paths.py`` by path (no fastapi): from the ``workers`` root, else sys.path."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "scripts" / "worker-common.sh").is_file():
            candidate = parent / "common" / "worker_common" / "paths.py"
            if candidate.is_file():
                spec = importlib.util.spec_from_file_location("worker_common_paths", candidate)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                return module
            break
    for entry in sys.path:
        candidate = Path(entry) / "worker_common" / "paths.py"
        if candidate.is_file():
            spec = importlib.util.spec_from_file_location("worker_common_paths", candidate)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    raise ModuleNotFoundError(
        "worker_common not found on sys.path; run with PYTHONPATH=<repo>/workers/common"
    )


paths = _paths_module()


def _resolve(model_id: str, model_dir: Path) -> dict:
    if model_id.strip() != MODEL_ID:
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    ready = all((model_dir / f).is_file() for f in FILES)
    return {
        "name": model_id,
        "downloaded": ready,
        "path": str(model_dir),
        "files": paths.existing_paths(model_dir),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    model_dir = paths.models_dir("stt", "meralion", MODEL_ID)
    print(f"{MODEL_ID} model dir: {model_dir}", file=sys.stderr)
    print(json.dumps([_resolve(m, model_dir) for m in args.models]))


if __name__ == "__main__":
    main()
