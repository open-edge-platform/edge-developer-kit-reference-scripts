#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether the Wav2Lip / MuseTalk lipsync models are already on
disk, without starting the worker.

Layout rule mirrored from ``workers/services/lipsync/main.py`` (Wav2Lip's
``CHECKPOINT_PATH``, ``OV_FP16_PATH``, ``OV_INT8_PATH`` constants) and
``workers/services/lipsync/modules/lipsync/musetalk/musetalk_models.py``
(MuseTalk's ``OV_UNET_PATH`` etc. and ``ensure_musetalk_openvino_models``,
the worker's own readiness gate). Both sets of constants are resolved
through ``worker_common.paths.models_dir``, i.e. ``<repo>/models/wav2lip``
and ``<repo>/models/musetalk`` -- the shared root every instance of this
worker (and the frontend's declared ``modelDirectories``) uses, not this
worker's own directory. This script loads ``worker_common/paths.py`` the
same way ``workers/services/face-recognition/list_models.py`` does -- by
file path, walking up to the ``workers`` root -- rather than a plain package
import, so it needs none of the worker's own third-party dependencies.

* ``Wav2Lip`` -- the served precision depends on the device: ``args.int8``
  defaults to ``True`` on CPU, NPU and integrated GPUs and ``False`` on a
  discrete GPU (``default_int8``; for ``AUTO``, on the device OpenVINO's AUTO
  selects), and whenever ``--int8``/that default is true the worker
  quantises FP16 -> INT8 on first start if the INT8 IR is not already there
  (``ensure_int8_model``), which takes minutes on CPU/NPU. Since this
  script has no device to decide against, "downloaded" means both IR pairs
  are present -- the FP16 export
  (``wav2lip/checkpoints/wav2lipv2_ov/wav2lip.{xml,bin}``) *and* the
  INT8 export (``wav2lip/checkpoints/wav2lipv2_ov_int8/wav2lip.{xml,bin}``,
  ``OV_INT8_PATH`` in ``main.py``) -- so a CPU/NPU start is never reported as
  ready while it would still have to spend that time quantising. (The
  original ``.pth`` checkpoint is deleted once conversion succeeds, so it is
  not a reliable signal on its own.)
* ``MuseTalk`` -- needs five things per ``ensure_musetalk_openvino_models``:
  four OpenVINO IRs under ``musetalk/ov/`` (``unet.xml``,
  ``vae_encoder.xml``, ``vae_decoder.xml``, ``whisper_encoder.xml``, each
  with its ``.bin``) plus ``musetalk/whisper/preprocessor_config.json``,
  needed at runtime even once the IRs exist.

``files`` is everything directly inside the preset's own folder,
``models/wav2lip`` or ``models/musetalk``: each holds that one preset alone,
and ``fetch_snapshot`` mirrors into it as ``local_dir``
(``download_wav2lip_checkpoint`` in main.py, ``download_musetalk_models``),
so the hubs' bookkeeping and partial downloads land there too (Hugging
Face's ``.cache/``, ModelScope's ``.msc``/``.mv``/``._____temp``). That is
``checkpoints/`` for Wav2Lip -- the ``.pth``, the FP16 and the INT8 IR and
the ``.prepare`` lock -- and ``musetalkV15/``, ``sd-vae/``, ``whisper/``,
``ov/`` for MuseTalk. Left out, because they lie outside the folders the app
deletes from: the pre-shared-root copy
``workers/services/lipsync/models/<folder>`` that ``_migrate_legacy_models``
(main.py) leaves in place when both exist, MuseTalk's FAN landmark weights,
which ``musetalk_face_prep._compute_musetalk_coords`` fetches with torch's
``load_url`` into ``<TORCH_HOME>/hub/checkpoints``, and the s3fd face
detector the avatar preparation of both presets runs (Wav2Lip's
``face_detection`` package, the same torch cache). Also left out: the
avatars, which are instance data rather than models.

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
models_dir = paths.models_dir

_WAV2LIP_OV_DIR = models_dir("wav2lip", "checkpoints", "wav2lipv2_ov")
_WAV2LIP_XML = _WAV2LIP_OV_DIR / "wav2lip.xml"
_WAV2LIP_INT8_XML = models_dir("wav2lip", "checkpoints", "wav2lipv2_ov_int8", "wav2lip.xml")

_MUSETALK_OV_DIR = models_dir("musetalk", "ov")
_MUSETALK_OV_FILES = ("unet.xml", "vae_encoder.xml", "vae_decoder.xml", "whisper_encoder.xml")
_MUSETALK_WHISPER_CONFIG = models_dir("musetalk", "whisper", "preprocessor_config.json")


def _wav2lip_ready() -> bool:
    return (
        _WAV2LIP_XML.is_file()
        and _WAV2LIP_XML.with_suffix(".bin").is_file()
        and _WAV2LIP_INT8_XML.is_file()
        and _WAV2LIP_INT8_XML.with_suffix(".bin").is_file()
    )


def _musetalk_ready() -> bool:
    ir_ok = all(
        (_MUSETALK_OV_DIR / name).is_file() and (_MUSETALK_OV_DIR / name).with_suffix(".bin").is_file()
        for name in _MUSETALK_OV_FILES
    )
    return ir_ok and _MUSETALK_WHISPER_CONFIG.is_file()


def _files(folder: str) -> list[str]:
    """Everything in the preset's own ``models/<folder>`` (see the module docstring)."""
    root = models_dir(folder)
    try:
        entries = sorted(root.iterdir()) if root.is_dir() else []
    except OSError as error:
        print(f"Could not list {root}: {error}", file=sys.stderr)
        entries = []
    return paths.existing_paths(*entries)


def _resolve(model_id: str) -> dict:
    name = model_id.strip().lower()
    if name == "musetalk":
        return {
            "name": model_id,
            "downloaded": _musetalk_ready(),
            "path": str(_MUSETALK_OV_DIR),
            "files": _files("musetalk"),
        }
    if name == "wav2lip":
        return {
            "name": model_id,
            "downloaded": _wav2lip_ready(),
            "path": str(_WAV2LIP_XML),
            "files": _files("wav2lip"),
        }
    return {"name": model_id, "downloaded": False, "path": None, "files": []}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    print(f"lipsync models dir: {models_dir()}", file=sys.stderr)
    print(json.dumps([_resolve(m) for m in args.models]))


if __name__ == "__main__":
    main()
