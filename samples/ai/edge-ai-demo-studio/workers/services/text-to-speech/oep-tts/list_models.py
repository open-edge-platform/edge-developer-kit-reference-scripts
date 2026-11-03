#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report which OEP text-to-speech presets are already exported to
OpenVINO IR, without starting the worker.

Layout rule mirrored from
``workers/services/text-to-speech/oep-tts/main.py``
(``TEXT_TO_SPEECH__MODELS__TTS__MODELS_BASE_PATH=<repo>/models/tts/oep-tts``,
``--dtype`` only overrides ``TEXT_TO_SPEECH__MODELS__TTS__DTYPE`` when
actually passed) and the vendored upstream's
``thirdparty/text-to-speech/utils/ensure_model.py``
(``get_tts_model_path``, ``_ov_dtype``) plus its
``ensure_speecht5.py`` (``model_exists``, ``_REQUIRED_FILES``):

* ``get_tts_model_path()`` = ``<models_base_path>/openvino/<model with "/"
  -> "_">__<ov_dtype>`` -- runtime is always ``openvino`` for this backend,
  and ``ov_dtype`` defaults to ``int8`` (upstream's ``config.yaml``) unless
  the preset's ``quant``/``--dtype`` says otherwise;
* SpeechT5 needs 12 fixed files directly in that directory: ``config.json``,
  ``generation_config.json``, and five OpenVINO IR pairs whose names are
  *not* all uniform -- ``openvino_encoder_model``/``openvino_decoder_model``
  carry a ``_model`` suffix, but ``openvino_postnet``, ``openvino_vocoder``
  and ``openvino_tokenizer`` do not -- each with its own ``.xml``/``.bin``.

``files`` is everything the worker keeps for one served model id, whatever
part of it is on disk (a half-done export included):

* its export at every precision, ``<models_base_path>/openvino/<model>__<dtype>``
  for each of the four ``_DTYPE_MAP`` targets (the precision is an instance
  setting), plus the checkpoint ``ensure_model`` snapshots to
  ``<models_base_path>/pytorch/<model>`` for a deployment that sets
  ``TEXT_TO_SPEECH__MODELS__TTS__RUNTIME=pytorch``;
* its own Hugging Face repository (``paths.hf_repo_dir``) in the shared
  cache, where the checkpoint is read from by ``main_export`` and
  ``AutoTokenizer`` in ``ensure_speecht5.py`` (``convert``);
* for ``microsoft/speecht5_tts``, also ``microsoft/speecht5_hifigan``, the
  vocoder ``main_export`` folds into the export (``_VOCODER``): that preset
  is the only one that uses it, so another SpeechT5 id never claims it;
* the same repositories in the cache this worker kept before,
  ``<models_base_path>/huggingface/hub``, which ``main.py``
  (``use_shared_hf_cache``) moves into the shared one on its next start.

Left out as shared: the ``.oep-startup.lock`` every start takes, and the
models base path and its ``openvino``/``pytorch`` folders.

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

# Upstream's default dtype (config.yaml), then the other Runtime Settings precisions. An export at
# any of them counts as on disk: the instance's precision is unknown here, and another downloads nothing.
_DEFAULT_DTYPE = "int8"
_DTYPES = (_DEFAULT_DTYPE, "fp16", "fp32", "int4")

# ensure_speecht5.py's _REQUIRED_FILES.
_SPEECHT5_FILES = (
    "config.json",
    "generation_config.json",
    "openvino_encoder_model.xml",
    "openvino_encoder_model.bin",
    "openvino_decoder_model.xml",
    "openvino_decoder_model.bin",
    "openvino_postnet.xml",
    "openvino_postnet.bin",
    "openvino_vocoder.xml",
    "openvino_vocoder.bin",
    "openvino_tokenizer.xml",
    "openvino_tokenizer.bin",
)

# ensure_speecht5.py's _VOCODER, and the one preset whose export pulls it.
_SPEECHT5_PRESET = "microsoft/speecht5_tts"
_SPEECHT5_VOCODER = "microsoft/speecht5_hifigan"


def _is_model(name: str, *patterns: str) -> bool:
    """``ensure_model.py``'s ``_is_model``: a case-insensitive substring match."""
    lowered = name.strip().lower()
    return any(pattern in lowered for pattern in patterns)


def _model_dir(model_id: str, base: Path, dtype: str) -> Path:
    safe_name = model_id.replace("/", "_")
    return base / "openvino" / f"{safe_name}__{dtype}"


def _exported(model_id: str, model_dir: Path) -> bool | None:
    """Whether ``model_dir`` holds a complete export; None for a model id
    the OEP wrapper does not serve."""
    if _is_model(model_id, "speecht5"):
        return all((model_dir / f).is_file() for f in _SPEECHT5_FILES)
    return None


def _repos(model_id: str) -> list[str]:
    """The Hugging Face repositories only ``model_id``'s export needs: its
    own, plus SpeechT5's vocoder for the one preset that uses it."""
    repos = [model_id.strip()]
    if model_id.strip().lower() == _SPEECHT5_PRESET:
        repos.append(_SPEECHT5_VOCODER)
    return repos


def _files(model_id: str, base: Path, dirs: list[Path]) -> list[str]:
    repos = _repos(model_id)
    legacy_hub = base / "huggingface" / "hub"
    return paths.existing_paths(
        *dirs,
        base / "pytorch" / model_id.replace("/", "_"),
        *(paths.hf_repo_dir(repo) for repo in repos),
        *(legacy_hub / paths.hf_repo_dir(repo).name for repo in repos),
    )


def _resolve(model_id: str, base: Path) -> dict:
    dirs = [_model_dir(model_id, base, dtype) for dtype in _DTYPES]
    if _exported(model_id, dirs[0]) is None:
        return {"name": model_id, "downloaded": False, "path": None, "files": []}
    found = next((d for d in dirs if _exported(model_id, d)), None)
    return {
        "name": model_id,
        "downloaded": found is not None,
        "path": str(found or dirs[0]),
        "files": _files(model_id, base, dirs),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    base = paths.models_dir("tts", "oep-tts")
    print(f"oep-tts models base path: {base}", file=sys.stderr)
    print(json.dumps([_resolve(m, base) for m in args.models]))


if __name__ == "__main__":
    main()
