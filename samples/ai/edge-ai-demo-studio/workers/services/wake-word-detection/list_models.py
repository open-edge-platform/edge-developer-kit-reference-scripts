#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report which openWakeWord preset models are already on disk, without
starting the worker.

Layout rule mirrored from
``workers/services/wake-word-detection/utils/model_manager.py``:
``PREDEFINED_MODEL_URLS`` keys the six presets by their own file name, and
``ModelManager.resolve_model_path`` looks each one up directly under
``worker_common.models_dir("wake-word-detection")`` -- the model id *is* the
file name (no sanitizing, no precision subfolder). This mirrors that
directly: any id is checked at
``<models_dir>/wake-word-detection/<id>``, which naturally also handles the
six known presets (``hey_jarvis_v0.1.onnx``, ``alexa_v0.1.onnx``,
``hey_mycroft_v0.1.onnx``, ``hey_rhasspy_v0.1.onnx``, ``timer_v0.1.onnx``,
``weather_v0.1.onnx``) without hardcoding their names here.

"Downloaded" mirrors ``model_downloader.http.fetch_url``'s own "already have
it" rule: the file exists and is non-empty.

``files`` is that file plus any ``<id>.part.<pid>`` partial ``fetch_url``
left beside it. Left out: the models every preset runs on, which
``ModelManager.download_dependencies`` fetches into the same folder
(``DEPENDENCY_MODEL_URLS``: the ``melspectrogram`` and ``embedding_model``
feature extractors and the ``silero_vad`` VAD) -- named as an id, one of
them reports no ``files``.

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
models_dir = paths.models_dir

# model_manager.py's DEPENDENCY_MODEL_URLS, as the files they are saved to.
_SHARED_MODELS = ("embedding_model.onnx", "melspectrogram.onnx", "silero_vad.onnx")


def _files(path: Path) -> list[str]:
    """``path`` and the partial downloads beside it; none for the shared feature models."""
    if path.name in _SHARED_MODELS:
        return []
    prefix = f"{path.name}.part."
    partials: list[Path] = []
    try:
        if path.parent.is_dir():
            partials = sorted(e for e in path.parent.iterdir() if e.name.startswith(prefix))
    except OSError as error:
        print(f"Could not list {path.parent}: {error}", file=sys.stderr)
    return paths.existing_paths(path, *partials)


def _resolve(model_id: str, base: Path) -> dict:
    # Bare file names only: resolve_model_path() also takes absolute paths, but Runtime Settings
    # never lists one, so a path separator means "not one of our presets".
    if not model_id or "/" in model_id or "\\" in model_id or model_id in (".", ".."):
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    path = base / model_id
    ready = path.is_file() and path.stat().st_size > 0
    return {"name": model_id, "downloaded": ready, "path": str(path), "files": _files(path)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    base = models_dir("wake-word-detection")
    print(f"wake-word-detection models dir: {base}", file=sys.stderr)
    print(json.dumps([_resolve(m, base) for m in args.models]))


if __name__ == "__main__":
    main()
