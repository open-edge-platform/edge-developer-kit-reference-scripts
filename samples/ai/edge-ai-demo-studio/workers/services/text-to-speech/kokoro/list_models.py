#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether the Kokoro text-to-speech model is already on disk,
without starting the worker.

Layout rule mirrored from ``workers/services/text-to-speech/kokoro/main.py``
(``model_dir = os.path.join(project_root, "models", "tts", "kokoro")``) and
``export.py`` (``export_to_openvino``, ``export_static_model``): there is
only one model id ("kokoro" -- the ~60 voices in the frontend's Runtime
Settings are a separate, per-request ``voice`` parameter, downloaded lazily
by ``KokoroTTSService.get_results()`` on first use of each voice, never part
of the ``--model``/download path, so they are out of scope here even though
``initialize()`` also warms up one voice, ``af_heart``, at startup -- that
warm-up is wrapped in its own try/except and only logs a warning on failure,
so it never blocks startup and is not part of this gate), and its files live
flat, directly under that one directory, not nested per model id:

* ``config.json`` + ``kokoro-v1_0.pth`` -- the raw Hugging Face checkpoint;
* ``openvino_model.xml`` + ``.bin`` -- the dynamic-shape OpenVINO IR, the
  IR pair ``export.py`` actually serves from and skips re-exporting once
  present.

"Downloaded" here means both the OpenVINO IR pair is present (the ``.xml``
path the worker's own export step checks before deciding it has nothing to
do -- checking the ``.bin`` sibling too is this script's own, stricter
addition) *and* ``config.json`` exists, since ``OVKModel.__init__``
(``ov_kokoro.py``) opens ``config.json`` unconditionally, every time the
worker loads the model, regardless of whether the IR was already exported.
The raw checkpoint (``kokoro-v1_0.pth``) existing without the IR is reported
as not yet downloaded, since the worker would still need to run a
torch-based export on first start.

``files`` is everything the worker keeps for that one model, all of it
directly under that directory and none of it in the shared Hugging Face
cache (``model_downloader.fetch_file`` fetches into the folder itself):
the raw checkpoint (``config.json``, ``kokoro-v1_0.pth`` --
``export.py:_load_pytorch_model``, ``main.py:init_model_and_pipeline``),
every IR the worker exports, whatever the device (``openvino_model.xml``/
``.bin`` from ``export_to_openvino``, ``openvino_model-npu.xml``/``.bin``
from ``export_static_model``, and the ``openvino_model-static.xml``/``.bin``
older versions wrote), the voice packs ``main.py:get_results`` downloads
lazily (``voices/<voice>.pt``, af_heart from the warm-up included -- they
belong to this model alone), ``.cache/`` (the hub's local-dir bookkeeping
with any partial Hugging Face download, the download lock, and the GPU and
NPUW compile caches ``ov_kokoro.py`` keeps for this IR), and a partial
ModelScope download (``<file>.incomplete``). Left out: the directory itself
and its ``.export.lock`` (start.sh's flock; every start recreates both), and
the export venv ``workers/.venv-kokoro-export`` (tooling, not a model).

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

# What the worker writes into models/tts/kokoro; the directory and its .export.lock stay.
_FILES = (
    "config.json",
    "kokoro-v1_0.pth",  # KModel.MODEL_NAMES["hexgrad/Kokoro-82M"]
    "openvino_model.xml",
    "openvino_model.bin",
    "openvino_model-npu.xml",  # export.NPU_MODEL_NAME
    "openvino_model-npu.bin",
    "openvino_model-static.xml",  # export.LEGACY_STATIC_MODEL_NAME
    "openvino_model-static.bin",
    "voices",
    ".cache",
    # A ModelScope download in progress (modelscope_hub writes beside the file).
    "config.json.incomplete",
    "kokoro-v1_0.pth.incomplete",
)


def _resolve(model_id: str, model_dir: Path) -> dict:
    if model_id.strip().lower() != "kokoro":
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    xml_path = model_dir / "openvino_model.xml"
    ready = (
        xml_path.is_file()
        and xml_path.with_suffix(".bin").is_file()
        and (model_dir / "config.json").is_file()
    )
    return {
        "name": model_id,
        "downloaded": ready,
        "path": str(model_dir),
        "files": paths.existing_paths(*(model_dir / name for name in _FILES)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    model_dir = paths.models_dir("tts", "kokoro")
    print(f"kokoro model dir: {model_dir}", file=sys.stderr)
    print(json.dumps([_resolve(m, model_dir) for m in args.models]))


if __name__ == "__main__":
    main()
