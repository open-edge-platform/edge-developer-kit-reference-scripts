#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether the pyannote speaker-diarization model is already on
disk, without starting the worker.

Layout rule mirrored from ``workers/services/diarization/modules/models.py``:
``get_model_directory`` uses ``<repo>/models/diarization`` and
``download_pipeline`` mirrors the model into
``<that>/<model_id with "/" -> os.sep>`` via ``fetch_snapshot`` (a flat
mirror of the hub repository -- see ``model_downloader.oep.plugins``'s
``HuggingFaceDownloader``, which passes the exact ``local_dir`` through to
``huggingface_hub.snapshot_download`` rather than the ``models--org--name``
hub-cache layout). The only model id this service lists is
``pyannote/speaker-diarization-community-1``, so this only ever resolves
that one directory.

The worker itself has no first-party readiness check of its own
(``download_pipeline`` unconditionally calls the idempotent
``fetch_snapshot`` every start, and ``fetch_snapshot`` mirrors the *whole*
hub repository, not just the files ``config.yaml`` happens to reference), so
"downloaded" here checks for the repo's own weight files directly, rather
than just ``config.yaml`` on its own: besides ``config.yaml`` (read by
``pyannote.audio.Pipeline.from_pretrained`` to resolve every sub-model the
pipeline bundles), this repository is a pyannote 4.x "community" pipeline
that bundles its sub-models inside the snapshot itself
(``segmentation/pytorch_model.bin``, ``embedding/pytorch_model.bin``), plus
the PLDA-based clusterer's own weights (``plda/plda.npz``,
``plda/xvec_transform.npz``) that ``pyannote/speaker-diarization-community-1``
ships alongside them. All five files are required for "downloaded" to be
true.

``files`` is that mirror (finished or not: ``huggingface_hub`` and
ModelScope keep a partial download inside it) plus the repository's folder
in the hub cache -- ``paths.hf_repo_dir`` in the cache every worker shares,
and ``<repo>/models/diarization/hub``, where the hub put it while this
folder was ``HF_HOME`` and which ``get_model_directory``'s
``use_shared_hf_cache`` moves into the shared cache on the next start. The
pipeline bundles its sub-models (above), so no other repository is this
model's. Left out: the hub's shared ``xet`` chunk cache, and
``models/diarization`` and its ``pyannote`` folder themselves.

Usage: python3 list_models.py --models <id> [<id> ...]
Prints a JSON array to stdout: [{"name", "downloaded", "path", "files"}].
Diagnostics go to stderr; this always exits 0.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

_MODEL_ID = "pyannote/speaker-diarization-community-1"

# Every file the pipeline needs to load (see the module docstring).
_REQUIRED_FILES = (
    "config.yaml",
    os.path.join("segmentation", "pytorch_model.bin"),
    os.path.join("embedding", "pytorch_model.bin"),
    os.path.join("plda", "plda.npz"),
    os.path.join("plda", "xvec_transform.npz"),
)


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


def _resolve(model_id: str, cache_dir: Path) -> dict:
    if model_id != _MODEL_ID:
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    local_dir = cache_dir / model_id.replace("/", os.sep)
    ready = all((local_dir / f).is_file() for f in _REQUIRED_FILES)
    repo = paths.hf_repo_dir(model_id)
    return {
        "name": model_id,
        "downloaded": ready,
        "path": str(local_dir),
        "files": paths.existing_paths(local_dir, repo, cache_dir / "hub" / repo.name),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    cache_dir = paths.project_root() / "models" / "diarization"
    print(f"diarization models dir: {cache_dir}", file=sys.stderr)
    print(json.dumps([_resolve(m, cache_dir) for m in args.models]))


if __name__ == "__main__":
    main()
