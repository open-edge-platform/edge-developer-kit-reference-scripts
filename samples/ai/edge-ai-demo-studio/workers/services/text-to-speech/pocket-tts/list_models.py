#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether the Pocket TTS model is already on disk, without starting
the worker.

Layout rule mirrored from ``main.py`` (``IndonesianCheckpoint`` and
``KyutaiCheckpoint``): the one model id ("pocket-tts") speaks eight
languages, each a checkpoint of its own. The worker's start gates on
Indonesian, the default, under
``<repo>/models/tts/pocket-tts/anak10thn/pocket-tts-indonesian``; it counts
as downloaded once the worker's local config (written after the checkpoint,
tokenizer and voice prompts arrived) and those files are there. The OpenVINO
export the first start makes from them needs no network. Kyutai's seven
languages download on their first use, so they do not count.

``files`` is that folder and
``<repo>/models/tts/pocket-tts/kyutai/pocket-tts-without-voice-cloning``,
which hold this model alone. Into each, ``download`` fetches the repository
files at their paths in it (``fetch_snapshot``/``fetch_file`` with the folder
as their local dir, plus the hub's ``.cache/`` with any partial download):
for Indonesian the config, voice prompts, checkpoint and tokenizer; for
Kyutai's ``languages/<language>/`` the weights, tokenizer and voice states
(``embeddings/``). Beside each language's checkpoint are its local config and
the export ``ov_pocket.ensure_export`` writes to ``openvino/`` (the IRs,
``tables.npz``, the voice states and its ``export.json`` marker), the only
one this worker makes. Nothing goes to the shared Hugging Face cache: the
local configs point pocket-tts at the files in the folders. The
``models/tts/pocket-tts`` folders above them stay.

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

MODEL_ID = "pocket-tts"
REPO = "anak10thn/pocket-tts-indonesian"
# Where Kyutai's languages download to (pocket-tts' configs name this repository).
KYUTAI_REPO = "kyutai/pocket-tts-without-voice-cloning"
FILES = (
    "indonesian_6l.local.yaml",
    "6l/model.safetensors",
    "tokenizer.model",
    "voices/common_voice_id_20954552.mp3",
    "voices/common_voice_id_20954811.mp3",
    "voices/common_voice_id_19961910.mp3",
    "voices/common_voice_id_22918082.mp3",
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


def _resolve(model_id: str, model_dir: Path, kyutai_dir: Path) -> dict:
    if model_id.strip().lower() != MODEL_ID:
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    ready = all((model_dir / f).is_file() for f in FILES)
    return {
        "name": model_id,
        "downloaded": ready,
        "path": str(model_dir),
        "files": paths.existing_paths(model_dir, kyutai_dir),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    model_dir = paths.models_dir("tts", MODEL_ID, REPO)
    kyutai_dir = paths.models_dir("tts", MODEL_ID, KYUTAI_REPO)
    print(f"{MODEL_ID} model dir: {model_dir}", file=sys.stderr)
    print(json.dumps([_resolve(m, model_dir, kyutai_dir) for m in args.models]))


if __name__ == "__main__":
    main()
