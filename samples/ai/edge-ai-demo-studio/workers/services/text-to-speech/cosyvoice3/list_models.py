#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether the CosyVoice 3 model is already on disk, without
starting the worker.

Layout rule mirrored from ``ov_cosyvoice.py`` (``model_dir``, ``voices_dir``,
``download``): the one model id ("cosyvoice3") lives under
``<repo>/models/tts/cosyvoice3/FunAudioLLM/Fun-CosyVoice3-0.5B-2512``, and its
voices under ``<repo>/models/tts/cosyvoice3/voices``. It counts as downloaded
once the files ``download`` fetches are there (the config, the LLM, flow and
vocoder checkpoints, the ONNX speech tokenizer, speaker encoder and flow
estimator and the Qwen2 tokenizer); the built-in voice comes with the worker's
vendored sources, and the OpenVINO export the first start makes needs no
network.

``files`` is the model folder, which holds this model alone (the repository
files, the hub's ``.cache/`` and the export in ``openvino/``), and the
built-in voice's copy in ``voices/``. Voices a user added to ``voices/``
are theirs and stay, as does the ``models/tts/cosyvoice3`` folder. Nothing
goes to the shared Hugging Face cache.

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

MODEL_ID = "cosyvoice3"
REPO = "FunAudioLLM/Fun-CosyVoice3-0.5B-2512"
FILES = (
    "cosyvoice3.yaml",
    "llm.pt",
    "flow.pt",
    "hift.pt",
    "campplus.onnx",
    "speech_tokenizer_v3.onnx",
    "flow.decoder.estimator.fp32.onnx",
    "CosyVoice-BlankEN/model.safetensors",
    "CosyVoice-BlankEN/vocab.json",
    "CosyVoice-BlankEN/merges.txt",
)
DEFAULT_VOICE = ("zh_female.wav", "zh_female.txt")


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


def _resolve(model_id: str, model_dir: Path, voices_dir: Path) -> dict:
    if model_id.strip().lower() != MODEL_ID:
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    ready = all((model_dir / f).is_file() for f in FILES)
    return {
        "name": model_id,
        "downloaded": ready,
        "path": str(model_dir),
        "files": paths.existing_paths(model_dir, *(voices_dir / f for f in DEFAULT_VOICE)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    model_dir = paths.models_dir("tts", MODEL_ID, REPO)
    voices_dir = paths.models_dir("tts", MODEL_ID, "voices")
    print(f"{MODEL_ID} model dir: {model_dir}", file=sys.stderr)
    print(json.dumps([_resolve(m, model_dir, voices_dir) for m in args.models]))


if __name__ == "__main__":
    main()
