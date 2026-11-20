#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report which image-upscaling presets are already on disk, without starting the worker.

A preset is on disk once its checkpoint and an OpenVINO IR at any precision are there (the
instance's precision is not known here): ``<repo>/models/upscaling/<id>/<file>.pth`` and
``openvino-<precision>/model.xml`` (``model-<tile>.xml`` for a Swin model), as ``presets.py``
lays them out; a PyTorch preset (SeedVR2) once all its weight files are. Each preset owns its
whole folder, so ``files`` is that folder: the checkpoint, every precision's IR, the NPU compile
cache, and any ``.part`` download or staging folder a stopped start left there.

``presets.py`` and ``worker_common/paths.py`` are loaded by file path, so this needs none of the
worker's own dependencies.

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

HERE = Path(__file__).resolve().parent


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    # dataclasses resolves the module's annotations through sys.modules.
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _paths_module():
    """``worker_common/paths.py``, found by walking up to the ``workers`` root (no fastapi import)."""
    for parent in HERE.parents:
        if (parent / "scripts" / "worker-common.sh").is_file():
            return _load("worker_common_paths", parent / "common" / "worker_common" / "paths.py")
    raise ModuleNotFoundError("workers/common/worker_common/paths.py not found above this script")


paths = _paths_module()
presets = _load("image_upscaling_presets", HERE / "presets.py")
_MODELS_ROOT = paths.models_dir("upscaling")


def _resolve(model_id: str) -> dict:
    preset = presets.PRESETS.get(model_id)
    if preset is None:
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    folder = presets.preset_dir(_MODELS_ROOT, preset)
    if preset.torch_xpu:
        # PyTorch runs the downloads as they are: no IR.
        ready = all(path.is_file() for _, _, path in presets.weight_files(_MODELS_ROOT, preset))
        files = paths.existing_paths(folder)
        return {"name": model_id, "downloaded": ready, "path": str(folder), "files": files}
    irs = sorted(folder.glob("openvino-*/model*.xml")) if folder.is_dir() else []
    ready = presets.checkpoint_path(_MODELS_ROOT, preset).is_file() and any(
        xml.with_suffix(".bin").is_file() for xml in irs
    )
    return {
        "name": model_id,
        "downloaded": ready,
        "path": str(irs[0] if irs else folder),
        "files": paths.existing_paths(folder),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    print(f"image-upscaling models dir: {_MODELS_ROOT}", file=sys.stderr)
    print(json.dumps([_resolve(m) for m in args.models]))


if __name__ == "__main__":
    main()
