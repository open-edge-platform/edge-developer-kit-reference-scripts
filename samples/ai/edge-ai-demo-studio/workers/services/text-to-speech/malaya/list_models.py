#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether the Malaya text-to-speech model is already on disk,
without starting the worker.

Layout rule mirrored from ``workers/services/text-to-speech/malaya/main.py``
(``load_model``): there is only one model id ("malaya" -- the three
``AVAILABLE_VOICES`` speakers are a separate, per-request parameter, never
part of the download path), fetched to
``worker_common.models_dir("tts", "malaya", "malaysia-ai/malay-VITS-multispeaker")``
i.e. ``<repo>/models/tts/malaya/malaysia-ai/malay-VITS-multispeaker`` -- under
``models/tts``, matching the frontend's declared ``modelDirectories``
(``['models/tts']``, shared with kokoro/piper/oep-tts).

Older checkouts may still have the model at the legacy location this worker
used before it called ``models_dir()``:
``<repo>/models/huggingface/malaysia-ai/malay-VITS-multispeaker``. ``main.py``
migrates that into the new location the first time it starts
(``worker_common.migrate_legacy_models_dir``); this script has no such
side effect (it must not touch disk), so it checks both and reports
whichever one is actually complete, preferring the new location.

"Downloaded" mirrors ``load_model``'s own skip check exactly: both
``config.json`` and ``model.pth`` must exist directly under that directory.

Malaya's own NLP support code (normalizer rules, an emoji dictionary) makes
further downloads of its own, into a cache this worker never redirects --
those are shared library plumbing rather than "the model", identical
regardless of model id, and out of scope here.

``files`` is the model's folder at either location, whichever are on disk
(both, when a legacy copy was left beside a newer one, which
``migrate_legacy_models_dir`` then ignores): ``fetch_snapshot``'s mirror of
the repository -- ``config.json``, ``model.pth`` and the rest, plus the
hub's ``.cache/`` with any partial download -- and the FP32 IR
``ov_malaya.ensure_ir`` converts into ``openvino/malaya.xml``/``.bin``
there, the only precision this worker produces. Both folders hold this
model alone, and neither is a repository of the shared Hugging Face cache
(the legacy one is a plain folder in ``models/huggingface``, beside its
``hub/``). Left out: the normalizer's ``demoji.json``
(``main.py:load_normalizer``, in the instance's data directory -- this
worker's ``temp/`` for the primary instance), support data, not the model.

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

_AVAILABLE_MODEL = "malaysia-ai/malay-VITS-multispeaker"


def _paths_module():
    """Load ``worker_common/paths.py`` by path, skipping ``worker_common/__init__.py`` (fastapi).

    Walks up to the ``workers`` root first: in a worker's uv venv the editable install's import
    hook puts no real path on ``sys.path``. Falls back to scanning ``sys.path``.
    """
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


def _resolve(model_id: str, new_dir: Path, legacy_dir: Path) -> dict:
    if model_id.strip().lower() != "malaya":
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    files = paths.existing_paths(new_dir, legacy_dir)
    if (new_dir / "config.json").is_file() and (new_dir / "model.pth").is_file():
        return {"name": model_id, "downloaded": True, "path": str(new_dir), "files": files}
    if (legacy_dir / "config.json").is_file() and (legacy_dir / "model.pth").is_file():
        return {"name": model_id, "downloaded": True, "path": str(legacy_dir), "files": files}
    return {"name": model_id, "downloaded": False, "path": str(new_dir), "files": files}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    new_dir = paths.models_dir("tts", "malaya", _AVAILABLE_MODEL)
    # main.py's legacy_model_dir: under the repository, whatever HF_HOME says.
    legacy_dir = paths.project_root() / "models" / "huggingface" / _AVAILABLE_MODEL
    print(f"malaya model dir: {new_dir} (legacy: {legacy_dir})", file=sys.stderr)
    print(json.dumps([_resolve(m, new_dir, legacy_dir) for m in args.models]))


if __name__ == "__main__":
    main()
