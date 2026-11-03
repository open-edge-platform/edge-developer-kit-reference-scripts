#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether the RIFE frame-generation model is already on disk,
without starting the worker.

Layout rule mirrored from
``workers/services/frame-generation/modules/frame_generator_ov.py``:
``DEFAULT_MODEL_PATH = models_dir("rife", "flownet.safetensors")`` and
``convert_rife_to_openvino``'s ``output_path`` default,
``os.path.join(os.path.dirname(model_path), "rife_ov", "rife.xml")`` -- both
resolved through ``worker_common.paths.models_dir``, i.e.
``<repo>/models/rife/...``, shared between every instance of this worker (and
what the app's "Clear model cache" knows as ``modelDirectories: ['models/rife']``
in ``frontend/src/services/frame-generation/data.ts``). This script loads
``models_dir`` the same way ``workers/services/face-recognition/list_models.py``
does -- by file path, walking up to the ``workers`` root -- rather than a
plain package import, so it needs none of the worker's own third-party
dependencies.

The worker's own startup sequence runs ``download_rife_model`` first --
skipping the fetch when ``flownet.safetensors`` already exists -- and only
then calls ``convert_rife_to_openvino``, which skips re-exporting once
``rife_ov/rife.xml`` exists. "Downloaded" here requires both steps' outputs
to be present: the raw ``flownet.safetensors`` checkpoint *and* the converted
OpenVINO IR the worker actually serves (``rife_ov/rife.xml`` + ``.bin`` --
checking the ``.bin`` sibling too is this script's own, stricter addition,
since ``convert_rife_to_openvino`` itself only checks the ``.xml``). The raw
checkpoint existing without the IR is reported as not yet downloaded, since
the worker would still need to run a torch-based conversion on first start.

``files`` is what those two steps leave under ``<repo>/models/rife`` -- the
worker's models root, which is not reported itself -- for the one preset:
``flownet.safetensors``, ``rife_ov/`` (the FP16 IR, the only precision
``_convert_rife`` writes), and a download that stopped part way:
``fetch_file`` (``model_downloader``) fetches ``TensorForger/RIFE-safetensors``
with ``hf_hub_download(local_dir=<repo>/models/rife)``, whose partial file
and metadata sit in ``.cache/huggingface/`` there and in no Hugging Face
cache, or, from ModelScope, ``flownet.safetensors.incomplete`` /
``.parallel_tmp`` / ``_<start>_<end>`` parts beside it; and the
``.flownet.safetensors.staging-*`` folder ``staged_model_file`` leaves when
the copy is cut short. Left out: the ``flownet.safetensors.lock`` and
``.cache/edge-ai-studio/download.lock`` locks, which exist only while held,
and the worker's legacy in-tree ``models/rife`` (``main.py``'s
``migrate_legacy_models_dir``), outside the folders the app deletes from --
a start only moves it into place when ``<repo>/models/rife`` is missing.

Usage: python3 list_models.py --models <id> [<id> ...]
Prints a JSON array to stdout: [{"name", "downloaded", "path", "files"}].
Diagnostics go to stderr; this always exits 0.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
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

_MODELS_ROOT = paths.models_dir("rife")
_RIFE_SAFETENSORS = _MODELS_ROOT / "flownet.safetensors"
_RIFE_OV_XML = _MODELS_ROOT / "rife_ov" / "rife.xml"

# ModelScope's partial download of flownet.safetensors (modelscope_hub's
# _download.py: single-stream ".incomplete", parallel "_<start>_<end>" parts
# merged through ".parallel_tmp"), and staged_model_file's staging folder.
_PARTIAL = re.compile(
    r"flownet\.safetensors(\.incomplete|\.parallel_tmp|_\d+_\d+)"
    r"|\.flownet\.safetensors\.staging-.+"
)


def _rife_files(root: Path) -> list[Path]:
    """Every file or folder of the preset directly under ``root``."""
    partials = (
        sorted(entry for entry in root.iterdir() if _PARTIAL.fullmatch(entry.name))
        if root.is_dir()
        else []
    )
    return [
        root / "flownet.safetensors",
        root / "rife_ov",
        root / ".cache" / "huggingface",
        *partials,
    ]


def _resolve(model_id: str) -> dict:
    if model_id.strip().lower() != "rife":
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    ready = (
        _RIFE_SAFETENSORS.is_file()
        and _RIFE_OV_XML.is_file()
        and _RIFE_OV_XML.with_suffix(".bin").is_file()
    )
    files = paths.existing_paths(*_rife_files(_MODELS_ROOT))
    return {"name": model_id, "downloaded": ready, "path": str(_RIFE_OV_XML), "files": files}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    print(f"frame-generation models dir: {_MODELS_ROOT}", file=sys.stderr)
    print(json.dumps([_resolve(m) for m in args.models]))


if __name__ == "__main__":
    main()
