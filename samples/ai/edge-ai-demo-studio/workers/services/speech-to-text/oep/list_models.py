#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report which Whisper presets are already on disk for the OEP (OpenVINO
GenAI) Speech to Text backend, without starting the worker.

Layout rule mirrored from ``workers/services/speech-to-text/oep/main.py``
(``MODELS_DIR``, ``_upstream_model_name``, ``_publish_native_environment``)
and the vendored upstream's
``thirdparty/audio-analyzer/utils/ensure_model.py``
(``get_asr_model_path``, ``_model_dir_name``, ``_ir_exists``):

* the worker strips a leading ``openai/`` from the model id
  (``_upstream_model_name``) and hands the bare name to upstream as
  ``AUDIO_ANALYZER__MODELS__ASR__NAME``, with
  ``AUDIO_ANALYZER__MODELS__ASR__PROVIDER=openvino`` and, for every
  ``--precision`` but fp32, ``AUDIO_ANALYZER__MODELS__ASR__WEIGHT_FORMAT``;
* upstream's ``get_asr_model_path()`` is then
  ``os.path.join(models_base_path, provider, _model_dir_name(name, weight_format))``
  = ``<models>/openvino/<bare-name>`` for fp32 and
  ``<models>/openvino/<bare-name>-<precision>`` otherwise. A preset counts as
  on disk at any precision: the instance's own precision is not known here,
  and converting the snapshot to another one downloads nothing. And
  ``_model_dir_name`` itself
  replaces every ``/`` in the (still possibly namespaced) name with ``_``
  before appending the suffix, so a model id that keeps its HF namespace
  after the ``openai/`` strip (``Qwen/Qwen3-ASR-1.7B-hf``,
  ``distil-whisper/distil-large-v3``) resolves to ``<models>/openvino/<name
  with "/" -> "_">``, not a nested directory;
* ``_ir_exists(output_dir)`` (the export's own idempotency check) is true
  when either ``openvino_model.{xml,bin}`` (a single-file export) or all
  four of ``openvino_encoder_model.{xml,bin}`` +
  ``openvino_decoder_model.{xml,bin}`` exist -- Whisper is
  encoder-decoder, so it always takes the second form in practice, but both
  are checked here to match upstream exactly.

``<models>`` is ``<repo>/models/stt`` (``models_dir("stt")``), overridable
with the same ``STT_MODELS_DIR`` environment variable the worker itself
reads. The frontend's Runtime Settings only offer ``openai/whisper-*`` ids
for this backend (Qwen3-ASR is OVMS-only, see
``services/speech-to-text/ovms``), but the ``/`` -> ``_`` mapping above is
applied unconditionally so any namespaced id resolves the same way the
worker would resolve it.

``files`` is every folder of the preset on disk, finished or not (upstream's
``_download_openvino_model`` creates the export folder before optimum-cli
writes into it): the export folder at each precision above; the folders of
the providers a deployment can switch upstream to instead
(``AUDIO_ANALYZER__MODELS__ASR__PROVIDER``, which main.py only defaults):
``<models>/openai/<name>`` and ``<models>/whispercpp/<name>[-q5_0|-q5_1|-q8_0]``
(``get_asr_model_path``, ``_normalize_whispercpp_weight_format``); and the
Hugging Face repository optimum-cli exports from -- upstream's
``ensure_model`` asks for ``openai/<bare-name>`` -- in the shared cache
(``paths.hf_repo_dir``) and in ``<models>/huggingface/hub``, the cache this
worker kept before ``use_shared_hf_cache`` (main.py,
``_publish_native_environment``), which moves it on the next start. Left out,
as every preset needs them: the speaker-diarization pipeline
(``<models>/huggingface/pyannote_*``, ``get_diarization_model_path``), the
sentiment model (``<models>/sentiment``), the ``.oep-startup`` lock and the
models folder itself.

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


def _upstream_model_name(model: str) -> str:
    """``openai/whisper-base`` -> ``whisper-base`` (main.py's own helper)."""
    name = model.strip()
    if name.lower().startswith("openai/"):
        name = name[len("openai/"):]
    return name


# main.py's PRECISIONS other than fp32, each exported under its own suffix.
_SUFFIXED_PRECISIONS = ("int8", "fp16", "int4")


def _model_dir_names(name: str) -> list[str]:
    """Upstream's ``_model_dir_name`` at every exported precision (``-<precision>`` for all but fp32)."""
    slug = name.replace("/", "_")
    return [slug] + [f"{slug}-{precision}" for precision in _SUFFIXED_PRECISIONS]


def _ir_exists(output_dir: Path) -> bool:
    single = output_dir / "openvino_model.xml"
    if single.is_file() and single.with_suffix(".bin").is_file():
        return True
    enc = output_dir / "openvino_encoder_model.xml"
    dec = output_dir / "openvino_decoder_model.xml"
    return (
        enc.is_file() and enc.with_suffix(".bin").is_file()
        and dec.is_file() and dec.with_suffix(".bin").is_file()
    )


# Upstream's whisper.cpp quantisations (_WHISPER_CPP_SUPPORTED_QUANTIZATION),
# each in a folder of its own beside the unquantised one.
_WHISPERCPP_SUFFIXES = ("q5_0", "q5_1", "q8_0")


def _preset_files(name: str, base: Path, openvino_dirs: list[Path]) -> list[str]:
    """What deleting the preset removes (see the module docstring)."""
    slug = name.replace("/", "_")
    if slug in ("", ".", ".."):
        return []  # not a model name; it would name a parent folder
    repo = paths.hf_repo_dir(f"openai/{name}")
    return paths.existing_paths(
        *openvino_dirs,
        base / "openai" / slug,
        base / "whispercpp" / slug,
        *(base / "whispercpp" / f"{slug}-{suffix}" for suffix in _WHISPERCPP_SUFFIXES),
        repo,
        base / "huggingface" / "hub" / repo.name,
    )


def _resolve(model_id: str, base: Path) -> dict:
    name = _upstream_model_name(model_id)
    dirs = [base / "openvino" / d for d in _model_dir_names(name)]
    exported = next((d for d in dirs if _ir_exists(d)), None)
    return {
        "name": model_id,
        "downloaded": exported is not None,
        # Where it is, else where the default (int8) export would go.
        "path": str(exported or dirs[1]),
        "files": _preset_files(name, base, dirs),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    base = Path(os.environ.get("STT_MODELS_DIR") or paths.models_dir("stt"))
    print(f"speech-to-text (oep) models dir: {base}", file=sys.stderr)
    print(json.dumps([_resolve(m, base) for m in args.models]))


if __name__ == "__main__":
    main()
