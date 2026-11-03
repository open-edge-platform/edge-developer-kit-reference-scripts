#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report which face-recognition presets are already on disk, without
starting the worker.

Layout rule mirrored from ``workers/services/face-recognition/models/registry.py``
(``REGISTRY``, ``_ir()``), ``models/omz/model.py`` (``OMZFacePipeline.load``)
and ``models/yunet_sface/model.py`` (``YuNetSFacePipeline.load``), plus
``workers/common/downloader/model_downloader/http.py``'s ``fetch_omz_ir``
(mirrors an OpenVINO IR pair to ``<root>/<model>/<precision>/<model>.{xml,bin}``):

* ``omz-retail`` / ``omz-adas`` — three Open Model Zoo IR pairs under
  ``<models>/open-model-zoo/<name>/FP16/<name>.{xml,bin}``: a detector
  (``face-detection-retail-0004`` or ``face-detection-adas-0001``) plus the
  two models every OMZ preset shares (``landmarks-regression-retail-0009``,
  ``face-reidentification-retail-0095``). "Downloaded" requires all three
  pairs to be present.
* ``yunet-sface`` — two plain ONNX files, ``<models>/yunet/yunet.onnx`` and
  ``<models>/sface/sface.onnx`` (fetched with ``fetch_url``, no precision
  subfolder).

Both ``fetch_omz_ir`` and the direct ``fetch_url`` calls above go through
``fetch_url``'s own reuse rule -- ``target.is_file() and target.stat().st_size
> 0`` -- so a zero-byte file left behind by an interrupted download does not
count as present here either, the same way ``workers/services/wake-word-detection/list_models.py``
already checks its own single-file presets.

``<models>`` is ``models_dir("face-recognition")``
(``workers/services/face-recognition/config.py``), overridable with the same
``FACE_RECOGNITION_MODELS_DIR`` environment variable the worker itself reads.

``files`` is the preset's own model folders, whole, so ``fetch_url``'s
``<file>.part.<pid>`` partials beside a file go too:
``<models>/open-model-zoo/<detector>`` (every precision under it) for an OMZ
preset, ``<models>/yunet`` and ``<models>/sface`` for ``yunet-sface``. Left
out: ``landmarks-regression-retail-0009`` and
``face-reidentification-retail-0095``, which every OMZ preset loads.

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

# Shared by every Open Model Zoo preset (registry.py's _OMZ_COMMON).
_OMZ_LANDMARKS = "landmarks-regression-retail-0009"
_OMZ_REID = "face-reidentification-retail-0095"
_OMZ_PRECISION = "FP16"

# key -> the preset's own detector name (registry.py's REGISTRY).
_OMZ_DETECTORS = {
    "omz-retail": "face-detection-retail-0004",
    "omz-adas": "face-detection-adas-0001",
}


def _models_dir() -> Path:
    override = os.environ.get("FACE_RECOGNITION_MODELS_DIR")
    return Path(override) if override else models_dir("face-recognition")


def _present(path: Path) -> bool:
    """``fetch_url``'s own reuse rule: exists and non-empty."""
    return path.is_file() and path.stat().st_size > 0


def _omz_ir_ready(root: Path, name: str) -> tuple[bool, Path]:
    """``<root>/<name>/FP16/<name>.{xml,bin}`` -- see ``fetch_omz_ir``."""
    xml_path = root / name / _OMZ_PRECISION / f"{name}.xml"
    bin_path = xml_path.with_suffix(".bin")
    return _present(xml_path) and _present(bin_path), xml_path


def _resolve(model_id: str, base: Path) -> dict:
    if model_id in _OMZ_DETECTORS:
        root = base / "open-model-zoo"
        det_ok, det_path = _omz_ir_ready(root, _OMZ_DETECTORS[model_id])
        lm_ok, _ = _omz_ir_ready(root, _OMZ_LANDMARKS)
        reid_ok, _ = _omz_ir_ready(root, _OMZ_REID)
        return {
            "name": model_id,
            "downloaded": det_ok and lm_ok and reid_ok,
            "path": str(det_path),
            # The detector only: the other two are _OMZ_COMMON's.
            "files": paths.existing_paths(root / _OMZ_DETECTORS[model_id]),
        }
    if model_id == "yunet-sface":
        det_path = base / "yunet" / "yunet.onnx"
        rec_path = base / "sface" / "sface.onnx"
        return {
            "name": model_id,
            "downloaded": _present(det_path) and _present(rec_path),
            "path": str(det_path),
            "files": paths.existing_paths(det_path.parent, rec_path.parent),
        }
    return {"name": model_id, "downloaded": False, "path": None, "files": []}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    base = _models_dir()
    print(f"face-recognition models dir: {base}", file=sys.stderr)
    print(json.dumps([_resolve(m, base) for m in args.models]))


if __name__ == "__main__":
    main()
