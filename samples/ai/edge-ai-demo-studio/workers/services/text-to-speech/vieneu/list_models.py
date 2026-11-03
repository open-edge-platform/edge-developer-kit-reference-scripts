#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether the VieNeu-TTS v3 Turbo model is already on disk, without
starting the worker.

Layout rule mirrored from ``main.py`` (``VieNeuService.initialize``): the one
model id ("vieneu") is the int8 ONNX graphs under
``<repo>/models/tts/vieneu/pnnbao-ump/VieNeu-TTS-v3-Turbo/onnx_int8`` plus the
MOSS codec decoder under
``<repo>/models/tts/vieneu/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX``.
The preset voices ship with the vendored package, not the model.

``files`` is both of those repository folders, whatever part of them is on
disk: ``fetch_snapshot`` downloads into them with ``local_dir``, so the hub's
``.cache/`` bookkeeping and the download lock sit inside them too, and the
codec serves only this model, so nothing is left out as shared. Nothing goes
to the Hugging Face cache: the engine is handed local directories
(``OnnxV3LiteEngine.__init__``), and its hub fallback for a file outside
them (``_resolve_root_file``) passes the hub a local path, which it rejects.
The ``models/tts/vieneu`` root and its org folders stay.

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

MODEL_ID = "vieneu"
FILES = {
    "pnnbao-ump/VieNeu-TTS-v3-Turbo": (
        "onnx_int8/config.json",
        "onnx_int8/tokenizer.json",
        "onnx_int8/vieneu_prefill.onnx",
        "onnx_int8/vieneu_decode_step.onnx",
        "onnx_int8/vieneu_acoustic_cached.onnx",
        "onnx_int8/vieneu_backbone_shared.data",
        "onnx_int8/vieneu_v3_heads.npz",
    ),
    "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX": (
        "moss_audio_tokenizer_decode_full.onnx",
        "moss_audio_tokenizer_decode_shared.data",
    ),
}


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


def _resolve(model_id: str, root: Path) -> dict:
    if model_id.strip().lower() != MODEL_ID:
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    ready = all((root / repo / f).is_file() for repo, files in FILES.items() for f in files)
    return {
        "name": model_id,
        "downloaded": ready,
        "path": str(root / "pnnbao-ump/VieNeu-TTS-v3-Turbo"),
        "files": paths.existing_paths(*(root / repo for repo in FILES)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    root = paths.models_dir("tts", MODEL_ID)
    print(f"{MODEL_ID} model dir: {root}", file=sys.stderr)
    print(json.dumps([_resolve(m, root) for m in args.models]))


if __name__ == "__main__":
    main()
