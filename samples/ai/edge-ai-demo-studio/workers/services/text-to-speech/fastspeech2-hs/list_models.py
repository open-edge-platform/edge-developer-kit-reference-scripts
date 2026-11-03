#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether the Fastspeech2_HS Tamil models are already on disk,
without starting the worker.

Layout rule mirrored from ``main.py`` (``DOWNLOAD``): the one model id
("fastspeech2-hs") is both Tamil voices' acoustic models and vocoders plus
the phone dictionary, under
``<repo>/models/tts/fastspeech2-hs/smtiitm/Fastspeech2_HS``. The OpenVINO IR
the first start converts them to needs no network.

``files`` is that repository folder, whatever part of it is on disk. It
holds everything the worker fetches or makes for the model
(``FastSpeech2Service.initialize``): the ``fetch_snapshot`` files (with the
hub's ``.cache/`` bookkeeping, as a ``local_dir`` download), the female
vocoder ``fetch_url`` takes from GitHub instead (and its ``.part.<pid>``
while it downloads), and the one IR per voice ``ov_fastspeech2.ensure_ir``
writes to its ``openvino/`` folder (FP32 only, ``compress_to_fp16=False``).
Nothing goes to the Hugging Face cache, and nothing is shared: the
``models/tts/fastspeech2-hs`` root and its ``smtiitm`` folder stay.

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

MODEL_ID = "fastspeech2-hs"
REPO = "smtiitm/Fastspeech2_HS"
FILES = (
    "tamil/female/model/config.yaml",
    "tamil/female/model/model.pth",
    "tamil/male/model/config.yaml",
    "tamil/male/model/model.pth",
    "vocoder/female/aryan/hifigan/config.json",
    "vocoder/female/aryan/hifigan/generator",
    "vocoder/male/aryan/hifigan/config.json",
    "vocoder/male/aryan/hifigan/generator",
    "phone_dict/tamil",
    "ssn_parser_new/lists/tamil_map",
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
    if model_id.strip().lower() != MODEL_ID:
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

    model_dir = paths.models_dir("tts", MODEL_ID, REPO)
    print(f"{MODEL_ID} model dir: {model_dir}", file=sys.stderr)
    print(json.dumps([_resolve(m, model_dir) for m in args.models]))


if __name__ == "__main__":
    main()
