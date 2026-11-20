#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report which video-generation presets are on disk, without starting the worker.

Layout (``main._fetch_weights`` and ``wan/ov_export.py``), under ``<repo>/models/video-generation``:
``hf/<org>--<name>/`` mirrors each Hugging Face repository (``fetch_snapshot``'s ``local_dir``), and
``transformer/<org>--<name>/<precision>/``, ``text-encoder/umt5-xxl/<precision>/`` and
``vae/<family>/`` hold the OpenVINO exports. Wan2.2 A14B has two transformers, ``transformer`` and
``transformer_2``, in its repository and its export folder: it needs both.

A preset is ``downloaded`` when it can start without the network: its scheduler, tokenizer and VAE
config, its tiny decoder weights, and either its PyTorch weights (transformer and text encoder) or
an OpenVINO export of both at some precision. The app runs the 5B models with PyTorch (XPU) only
(``TORCH_PRESETS``): those need the PyTorch weights.

``files`` is what only that preset uses, so deleting it never breaks another: its transformer
weights and exports, and for VACE its repository mirror and the pose models. Shared and left out:
the UMT5 text encoder, each family's base repository (Wan2.1 T2V's is VACE's base too), tiny
decoder weights and ``vae/<family>`` exports. VACE also needs the DWPose models to be ``downloaded``.

The presets mirror ``wan/presets.py`` (stdlib only here: the app runs this outside the worker's
environment).

Usage: python3 list_models.py --models <id> [<id> ...]
Prints a JSON array to stdout: [{"name", "downloaded", "path", "files"}]. Always exits 0.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

WAN22 = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
A14B = "Wan-AI/Wan2.2-T2V-A14B-Diffusers"
# id -> (transformer repo, base repo, family)
PRESETS = {
    "Wan-AI/Wan2.1-T2V-1.3B-Diffusers": ("Wan-AI/Wan2.1-T2V-1.3B-Diffusers", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers", "wan2.1"),
    "Wan-AI/Wan2.1-VACE-1.3B-diffusers": ("Wan-AI/Wan2.1-VACE-1.3B-diffusers", "Wan-AI/Wan2.1-T2V-1.3B-Diffusers", "wan2.1"),
    A14B: (A14B, A14B, "wan2.1"),
    WAN22: (WAN22, WAN22, "wan2.2"),
    "FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers": ("FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers", WAN22, "wan2.2"),
}
TINY = {"wan2.1": "lighttaew2_1.safetensors", "wan2.2": "lighttaew2_2.safetensors"}
TINY_REPO = "lightx2v/Autoencoders"
POSE_REPO = "yzd-v/DWPose"
POSE_FILES = ("yolox_l.onnx", "dw-ll_ucoco_384.onnx")
VACE = "Wan-AI/Wan2.1-VACE-1.3B-diffusers"
#: Presets the app runs with PyTorch on XPU (frontend/src/services/video-generation/config.ts).
TORCH_PRESETS = {WAN22, "FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers"}
#: Presets with more than one transformer (``Preset.experts``).
EXPERTS = {A14B: ("transformer", "transformer_2")}


def _paths_module():
    """``worker_common/paths.py`` loaded by path (``worker_common/__init__.py`` needs fastapi)."""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "common" / "worker_common" / "paths.py"
        if (parent / "scripts" / "worker-common.sh").is_file() and candidate.is_file():
            spec = importlib.util.spec_from_file_location("worker_common_paths", candidate)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    raise ModuleNotFoundError("workers/common/worker_common/paths.py not found")


paths = _paths_module()


def _mirror(root: Path, repo: str) -> Path:
    return root / "hf" / repo.replace("/", "--")


def _has(folder: Path, pattern: str) -> bool:
    return folder.is_dir() and any(folder.glob(pattern))


def _resolve(model_id: str, root: Path) -> dict:
    if model_id not in PRESETS:
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    transformer_repo, base_repo, family = PRESETS[model_id]
    base = _mirror(root, base_repo)
    configs = all((base / p).is_file() for p in ("scheduler/scheduler_config.json", "tokenizer/tokenizer.json", "vae/config.json"))
    tiny = (_mirror(root, TINY_REPO) / TINY[family]).is_file()
    experts = EXPERTS.get(model_id, ("transformer",))
    torch_weights = all(_has(_mirror(root, transformer_repo) / e, "*.safetensors") for e in experts) and _has(
        _mirror(root, WAN22) / "text_encoder", "*.safetensors"
    )
    exports = root / "transformer" / transformer_repo.replace("/", "--")
    exported = any(
        all((exports / p / f"{e}.xml").is_file() for e in experts)
        and (root / "text-encoder" / "umt5-xxl" / p / "text_encoder.xml").is_file()
        for p in ("fp16", "int8", "int4")
    )
    if model_id == VACE:
        owned = [_mirror(root, transformer_repo), _mirror(root, POSE_REPO)]
        tiny = tiny and all((_mirror(root, POSE_REPO) / f).is_file() for f in POSE_FILES)
    elif model_id == A14B:
        # Its own base repository too (Wan2.1's VAE, tokenizer and scheduler, mirrored again).
        owned = [_mirror(root, transformer_repo)]
    else:
        owned = [_mirror(root, transformer_repo) / "transformer"]
    owned.append(exports)
    ready = torch_weights if model_id in TORCH_PRESETS else (torch_weights or exported)
    return {
        "name": model_id,
        "downloaded": configs and tiny and ready,
        "path": str(_mirror(root, transformer_repo)),
        "files": paths.existing_paths(*owned),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()
    root = paths.project_root() / "models" / "video-generation"
    print(f"video-generation models dir: {root}", file=sys.stderr)
    print(json.dumps([_resolve(m, root) for m in args.models]))


if __name__ == "__main__":
    main()
