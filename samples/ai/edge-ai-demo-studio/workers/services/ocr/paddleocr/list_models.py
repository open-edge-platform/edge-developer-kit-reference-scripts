#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report which PaddleOCR presets are already on disk, without starting the
worker.

Layout rule mirrored from ``workers/services/ocr/paddleocr/config.py`` and
``models/registry.py`` (``REGISTRY``), plus the two model families'
loaders:

* ``ppocrv5`` / ``ppocrv5-server`` (``models/ppocr/model.py``,
  ``PPOCRModel.__init__``/``_ensure_model_file``/``_ensure_text_file``) --
  ``<models>/ppocr/<key>/<basename of det_url|rec_url|dict_url>``, i.e. the
  detector ``.onnx``, the recogniser ``.onnx`` and the dictionary ``.txt``,
  all downloaded verbatim by URL basename into a per-preset cache dir.
* ``ppocrv3`` (same file, the ``.tar`` branch of ``_ensure_model_file``) --
  the detector/recogniser archives (``ch_PP-OCRv3_det_infer.tar``,
  ``ch_PP-OCRv3_rec_infer.tar``) are always fetched first, through the same
  ``fetch_url`` skip check as the ``.onnx`` presets above (so a missing
  archive is re-downloaded even once it has already been extracted), *then*
  extracted into ``<models>/ppocr/ppocrv3/<archive-name-without-.tar>/`` --
  the worker itself only cares that the extracted directory holds an
  inference graph (``inference.pdmodel``, any ``*.pdmodel``,
  ``inference.json`` or any ``*.json``). "Downloaded" here requires both:
  the archive still present next to the extracted directory, and the
  extracted directory's own graph file.
* ``paddleocr-vl`` / ``paddleocr-vl-1.5`` (``models/paddleocr_vl/model.py``,
  ``PaddleOCRVLModel._ir_ready``) -- a converted OpenVINO IR under
  ``<models>/paddleocr_vl/<model_id with "/" -> "__">/``: ``vision.xml``,
  ``llm_embd.xml``, ``config.json``, an ``llm_stateful*.xml`` at any
  precision (the worker's ``--precision`` picks which, unknown here), plus
  the export marker ``_convert`` writes last (``_EXPORT_MARKER``), which an
  IR from an older, faulty export lacks.

``<models>`` is ``<repo>/models/ocr`` (``worker_common.project_root() /
"models" / "ocr"``), overridable with the same ``PADDLEOCR_MODELS_DIR``
environment variable the worker itself reads.

``files`` is the preset's own folders, whole, finished or not. A PP-OCR
preset's is ``<models>/ppocr/<key>`` (``PPOCRModel.__init__``): its
detector, recogniser and dictionary, ppocrv3's archives and what they
extract to (with any ``.partial.<pid>`` staging directory), ``fetch_url``'s
``.part.<pid>`` partials, and the NPU blob cache ``ov_cache``
(``PPOCRModel.load``). A VL preset's are the IR folder above, which holds
the export at every precision (``--precision`` only picks which
``llm_stateful*.xml`` ``_convert`` adds to it); the ``.lock`` folder
``shared_model_lock`` keeps beside it while converting; and the source
checkpoint ``_download_snapshot`` mirrors from Hugging Face or ModelScope
into ``<models>/paddleocr_vl/_source/<model_id with "/" -> "__">``, the
hubs' bookkeeping and partial downloads included. Both hubs get that folder
as ``local_dir``, so no VL preset has a repository in ``models/huggingface``
or ``models/modelscope``. Left out: ``<models>/ppocr/lang/<language>``, the
recognisers for languages other than a preset's own, which every PP-OCR
preset shares (``PPOCRModel._recogniser``).

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
    """Load ``worker_common/paths.py`` by file path, skipping the package ``__init__`` (fastapi).

    Walks up to the ``workers`` root first, since a uv venv's editable-install hook puts no real
    path on ``sys.path``; falls back to scanning ``sys.path``.
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
project_root = paths.project_root

# key -> (det basename, rec basename, dict basename) -- registry.py's _V5 /
# _V5_DICT entries for the ONNX presets.
_PPOCR_ONNX = {
    "ppocrv5": ("ppocrv5-mobile-det.onnx", "ppocrv5-mobile-rec.onnx", "ppocrv5_dict.txt"),
    "ppocrv5-server": ("ppocrv5-server-det.onnx", "ppocrv5-server-rec.onnx", "ppocrv5_dict.txt"),
}

# registry.py's _V3 entries: Paddle .tar archives extracted in place.
_PPOCRV3_ARCHIVES = ("ch_PP-OCRv3_det_infer", "ch_PP-OCRv3_rec_infer")
_PPOCRV3_DICT = "ppocr_keys_v1.txt"
_GRAPH_PATTERNS = ("inference.pdmodel", "*.pdmodel", "inference.json", "*.json")

# registry.py's VL model_ids. The language model file follows main.py's --precision, unknown
# here, so an export at any precision counts as on disk.
_VL_MODEL_IDS = {
    "paddleocr-vl": "PaddlePaddle/PaddleOCR-VL",
    "paddleocr-vl-1.5": "PaddlePaddle/PaddleOCR-VL-1.5",
}
_VL_DEFAULT_REQUIRED = (
    "vision.xml",
    "llm_embd.xml",
    "config.json",
    "export-rev2.done",
)
_VL_LLM_FILES = ("llm_stateful_int8.xml", "llm_stateful.xml", "llm_stateful_int4.xml")


def _models_dir() -> Path:
    override = os.environ.get("PADDLEOCR_MODELS_DIR")
    return Path(override) if override else project_root() / "models" / "ocr"


def _has_graph(extract_dir: Path) -> bool:
    if not extract_dir.is_dir():
        return False
    for pattern in _GRAPH_PATTERNS:
        if any(extract_dir.rglob(pattern)):
            return True
    return False


def _resolve(model_id: str, base: Path) -> dict:
    if model_id in _PPOCR_ONNX:
        det_name, rec_name, dict_name = _PPOCR_ONNX[model_id]
        cache_dir = base / "ppocr" / model_id
        ready = (
            (cache_dir / det_name).is_file()
            and (cache_dir / rec_name).is_file()
            and (cache_dir / dict_name).is_file()
        )
        return {
            "name": model_id,
            "downloaded": ready,
            "path": str(cache_dir),
            "files": paths.existing_paths(cache_dir),
        }

    if model_id == "ppocrv3":
        cache_dir = base / "ppocr" / "ppocrv3"
        det_dir, rec_dir = (cache_dir / name for name in _PPOCRV3_ARCHIVES)
        archives_ready = all(
            (cache_dir / f"{name}.tar").is_file() for name in _PPOCRV3_ARCHIVES
        )
        ready = (
            archives_ready
            and _has_graph(det_dir)
            and _has_graph(rec_dir)
            and (cache_dir / _PPOCRV3_DICT).is_file()
        )
        return {
            "name": model_id,
            "downloaded": ready,
            "path": str(cache_dir),
            "files": paths.existing_paths(cache_dir),
        }

    if model_id in _VL_MODEL_IDS:
        folder = _VL_MODEL_IDS[model_id].replace("/", "__")
        cache_dir = base / "paddleocr_vl" / folder
        ready = all((cache_dir / name).exists() for name in _VL_DEFAULT_REQUIRED) and any(
            (cache_dir / name).exists() for name in _VL_LLM_FILES
        )
        return {
            "name": model_id,
            "downloaded": ready,
            "path": str(cache_dir),
            "files": paths.existing_paths(
                cache_dir,
                # shared_model_lock(cache_dir)'s lock, and _download_snapshot's local_dir.
                cache_dir.with_name(f"{folder}.lock"),
                base / "paddleocr_vl" / "_source" / folder,
            ),
        }

    return {"name": model_id, "downloaded": False, "path": None, "files": []}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    base = _models_dir()
    print(f"paddleocr models dir: {base}", file=sys.stderr)
    print(json.dumps([_resolve(m, base) for m in args.models]))


if __name__ == "__main__":
    main()
