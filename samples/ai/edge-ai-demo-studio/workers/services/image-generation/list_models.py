#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report which image-generation presets are already on disk, without
starting the worker.

Layout rule mirrored from
``workers/services/image-generation/utils/image_generation_ovms.py``
(``setup_ovms_server``'s ``model_cache_dir``, ``pull_model``) and
``workers/common/downloader/model_downloader/ovms/pull.py``'s ``pull()``,
which documents and returns ``Path(model_repository_path) / source_model``:
this worker is OVMS-only (there is no diffusers/optimum-intel code path),
the repository directory is ``<repo>/models/ovms`` (int8 conversions and
pre-converted IR) or ``<repo>/models/ovms/precision-<precision>``, and a
pulled model lands at ``<that>/<model_id>`` with the id's own slashes as
nested directories.

"Downloaded" has no first-party Python check: OVMS decides itself, inside
the compiled ``ovms`` binary, whether a pull needs to redo anything. This
mirrors the completeness signal this same pull mechanism is already checked
against elsewhere in this codebase
(``workers/engines/multiserve/modules/ovms/ov_downloader.py``'s
``get_model_info_for_repo``, and the vendored ``model-download`` OVMS
plugin's own served-config generator,
``workers/common/downloader/thirdparty/model-download/src/plugins/openvino_plugin.py``,
which writes ``graph.pbtxt``) -- a ``graph.pbtxt`` file directly inside the
model's directory.

``files`` is, in every repository a pull can use (``models/ovms`` and each
``precision-<p>`` of main.py's ``--precision`` choices), the model's folder
and the ``<model folder>.lfswip`` marker OVMS keeps beside it while a
git-lfs download is unfinished (``pull.py``'s ``drop_lfs_pointers``); and,
for a model OVMS converts (not ``is_preconverted``), the source model's
repository in the shared Hugging Face cache, ``paths.hf_repo_dir(model_id)``:
OVMS converts with ``optimum-cli export openvino --model <id>``, which
downloads into the ``HF_HOME`` the worker launcher exports. A pre-converted
model is cloned straight into its folder and leaves nothing there. Only an
``<org>/<name>`` id gets any: a one-segment id's folder could be another
model's organization folder. Left out: the ``<org>__<name>.lock`` /
``.serve.lock`` pull and serve locks, which exist only while held.

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

# main.py's --precision choices other than int8 (image_generation_ovms.py's
# DEFAULT_PRECISION, which converts into models/ovms itself).
_OTHER_PRECISIONS = ("fp16", "fp32", "int4")


def _is_preconverted(model_id: str) -> bool:
    """``image_generation_ovms.py``'s ``is_preconverted``: IR that ``ovms --pull`` clones as is."""
    name = model_id.lower()
    return name.startswith("openvino/") or name.endswith(("-ov", "-openvino"))


def _is_repo_id(model_id: str) -> bool:
    """``<org>/<name>``, neither part empty, ``.``/``..`` or a ``precision-<p>`` repository."""
    parts = model_id.split("/")
    return (
        len(parts) == 2
        and "\\" not in model_id
        and all(part not in ("", ".", "..") for part in parts)
        and not parts[0].startswith("precision-")
    )


def _resolve(model_id: str, base: Path) -> dict:
    model_dir = base / Path(*model_id.split("/"))
    ready = (model_dir / "graph.pbtxt").is_file()
    return {"name": model_id, "downloaded": ready, "path": str(model_dir)}


def _resolve_any(model_id: str, bases: list[Path]) -> dict:
    """The first repository holding the model, else the default one: the instance's precision
    isn't known here, so any precision counts."""
    results = [_resolve(model_id, base) for base in bases]
    return next((r for r in results if r["downloaded"]), results[0])


def _files(model_id: str, bases: list[Path]) -> list[str]:
    if not _is_repo_id(model_id):
        return []
    candidates: list[Path] = []
    for base in bases:
        model_dir = base / Path(*model_id.split("/"))
        candidates += [model_dir, model_dir.with_name(f"{model_dir.name}.lfswip")]
    if not _is_preconverted(model_id):
        candidates.append(paths.hf_repo_dir(model_id))
    return paths.existing_paths(*candidates)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    base = paths.models_dir("ovms")
    bases = [base] + [base / f"precision-{p}" for p in _OTHER_PRECISIONS]
    print(f"image-generation model repository: {base}", file=sys.stderr)
    print(json.dumps([{**_resolve_any(m, bases), "files": _files(m, bases)} for m in args.models]))


if __name__ == "__main__":
    main()
