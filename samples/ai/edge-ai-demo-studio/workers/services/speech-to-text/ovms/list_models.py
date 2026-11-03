#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report which ASR presets are already on disk for the OpenVINO Model
Server Speech to Text backend, without starting the worker.

Layout rule mirrored from ``workers/services/speech-to-text/ovms/main.py``
(``_ovms_repository_dir``) and
``workers/common/downloader/model_downloader/ovms/pull.py``'s ``pull()``,
which documents and returns ``Path(model_repository_path) / source_model``:
the repository directory is ``<repo>/models/stt/ovms`` (fp32 and
pre-converted IR) or ``<repo>/models/stt/ovms-<precision>`` (a conversion at
another precision), and a pulled model
lands at ``<that>/<model_id>`` with the id's own slashes as nested
directories (``util.validate_and_sanitize_model_id`` only validates the
``org/model`` shape -- it never rewrites slashes to underscores).

"Downloaded" has no first-party Python check: OVMS decides itself, inside
the compiled ``ovms`` binary, whether a pull needs to redo anything (the
worker's own comment: "Re-running on an existing model is cheap: OVMS keeps
the weights and only regenerates ``graph.pbtxt``"). This mirrors the
completeness signal this same pull mechanism is already checked against
elsewhere in this codebase (``workers/engines/multiserve/modules/ovms/ov_downloader.py``'s
``get_model_info_for_repo``, and the vendored ``model-download`` OVMS
plugin's own served-config generator,
``workers/common/downloader/thirdparty/model-download/src/plugins/openvino_plugin.py``,
which writes ``graph.pbtxt``) -- a ``graph.pbtxt`` file directly inside the
model's directory.

Only the ASR model ids the frontend's Runtime Settings lists are in scope
(Whisper and ``Qwen/Qwen3-ASR-*``); the OMZ noise-suppression "denoise"
model is a separate, fixed asset that is not one of the ids Runtime Settings
offers, so it is out of scope here.

``files`` is, in each of the four repositories, the model's directory and
the ``<model>.lfswip`` marker OVMS keeps beside it while a git-lfs download
is unfinished (``pull.py``'s ``drop_lfs_pointers``) -- a half-done pull or
conversion counts -- plus the model's own repository in the shared Hugging
Face cache (``paths.hf_repo_dir``), which optimum-cli exports from when OVMS
converts (``env.py``'s ``ovms_env`` hands it the launcher's ``HF_HOME``).
Left out: the pull and serve locks (``<org>__<name>.lock``,
``.serve.lock``; held only while a pull or start runs), and what every
preset shares -- the denoise model (``<repo>/models/stt/omz``) and the
repository folders themselves.

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

    Found by walking up to the workers root (in a worker's own venv the editable install's import
    hook puts no real path on ``sys.path``), else on ``sys.path``.
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


def _model_dir(model_id: str, base: Path) -> Path:
    return base / Path(*model_id.split("/"))


def _resolve(model_id: str, base: Path) -> dict:
    model_dir = _model_dir(model_id, base)
    ready = (model_dir / "graph.pbtxt").is_file()
    return {"name": model_id, "downloaded": ready, "path": str(model_dir)}


def _preset_files(model_id: str, bases: list[Path]) -> list[str]:
    """What deleting the preset removes (see the module docstring)."""
    if any(part in ("", ".", "..") for part in model_id.split("/")):
        return []  # an id the worker rejects; it would name a parent folder
    dirs = [_model_dir(model_id, base) for base in bases]
    return paths.existing_paths(
        *(part for d in dirs for part in (d, d.with_name(f"{d.name}.lfswip"))),
        paths.hf_repo_dir(model_id),
    )


def _resolve_any(model_id: str, bases: list[Path]) -> dict:
    """The first repository holding the model (any precision counts), else the default pull target
    (``ovms`` for pre-converted IR, ``ovms-int8`` otherwise)."""
    results = [_resolve(model_id, base) for base in bases]
    preconverted = model_id.startswith("OpenVINO/") or model_id.endswith("-ov")
    found = next((r for r in results if r["downloaded"]), results[0 if preconverted else 1])
    return {**found, "files": _preset_files(model_id, bases)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    bases = [paths.models_dir("stt", leaf) for leaf in ("ovms", "ovms-int8", "ovms-fp16", "ovms-int4")]
    print(f"speech-to-text (ovms) model repositories: {', '.join(map(str, bases))}", file=sys.stderr)
    print(json.dumps([_resolve_any(m, bases) for m in args.models]))


if __name__ == "__main__":
    main()
