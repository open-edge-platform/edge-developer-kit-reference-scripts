#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report whether the Piper text-to-speech worker's startup preload would
succeed, without starting the worker.

The frontend's Runtime Settings only ever sends the literal model id
``"piper"`` (see ``frontend/src/services/text-to-speech/config.ts`` and
``piper/main.py``'s ``SpeechRequest.model``, documented as ``"piper"``);
Piper voices are a separate, per-request ``voice`` parameter chosen at
request time and downloaded on demand from ``rhasspy/piper-voices``
(flattened locally by ``download_utils.ensure_voice``). There is no fixed
voice catalogue to check "downloaded" against for that id.

Instead, "downloaded" for ``piper`` mirrors the one thing the worker actually
gates its own startup on: ``PiperTTSService.initialize()`` calls
``self.get_voice(DEFAULT_VOICE)`` (``DEFAULT_VOICE = "en_US-lessac-medium"``
in ``main.py``) *unguarded* -- unlike the warm-up synthesis call right after
it, a failure here is not caught and aborts startup. ``get_voice()`` calls
``ensure_voice()`` (``download_utils.py``), which is what would need the
network if the default voice is missing; this mirrors its own skip check
exactly: both ``<voice>.onnx`` and ``<voice>.onnx.json`` must already exist
directly under ``model_dir`` (``<repo>/models/tts/piper``). The OpenVINO IR
conversion that follows (``<voice>.xml``/``.bin`` from ``ov_piper.py``)
always succeeds locally once those two files exist and needs no network, so
it is not part of this gate.

Any id other than ``"piper"`` is still resolved the same way, as a voice
stem, rather than reported as unknown -- Piper's id space is open-ended, and
a caller may reasonably pass a real voice code (e.g. ``en_US-amy-low``)
instead of ``"piper"``.

``files`` for ``piper`` is every voice the worker holds: they all belong to
that one model, and nothing else reads ``models/tts/piper``. That is each
voice's flat ``<voice>.onnx``/``.onnx.json`` (``download_utils._download_voice``)
and the IR ``<voice>.xml``/``.bin`` converted beside them
(``ov_piper.ensure_ir``), the ``rhasspy/piper-voices`` snapshot each source
mirrors them from first (``.huggingface``/``.modelscope``, the
``<model_dir>/.<source>`` of ``_download_voice``, partial downloads in it
included), and any staging folder (``worker_common.staged_model_file``) an
interrupted copy or conversion left. For a voice code it is that voice's
four files and staging folders, its folder in each snapshot
(``<family>/<lang>/<name>/<quality>``, ``download_utils.voice_rel_paths``)
and the hub's bookkeeping for it there. None of it is in the shared Hugging
Face cache; the directory itself and ``shared_model_lock``'s ``*.lock``
folders stay.

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

# main.py's DEFAULT_VOICE, preloaded (unguarded) at startup.
DEFAULT_VOICE = "en_US-lessac-medium"
# worker_common.cli.SOURCES; _download_voice mirrors each into <model_dir>/.<source>.
SOURCES = ("huggingface", "modelscope")
# One voice's files in model_dir: download_utils._flat_paths plus the IR converted from them.
VOICE_SUFFIXES = (".onnx", ".onnx.json", ".xml", ".bin")
# download_utils._VOICE_PATTERN.
_VOICE_PATTERN = re.compile(
    r"^(?P<lang_family>[^_]+)_(?P<lang_region>[^-]+)-(?P<voice_name>.+)-(?P<voice_quality>[^-]+)$"
)


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


def _snapshot_dir(voice: str) -> Path | None:
    """The voice's folder in a ``rhasspy/piper-voices`` snapshot
    (``download_utils.voice_rel_paths``); None for a code that does not parse."""
    match = _VOICE_PATTERN.match(voice)
    if not match:
        return None
    family = match.group("lang_family")
    return Path(
        family,
        f"{family}_{match.group('lang_region')}",
        match.group("voice_name"),
        match.group("voice_quality"),
    )


def _staging(model_dir: Path, name: str) -> list[Path]:
    """What ``staged_model_file`` left for ``name``: ``.<name>.staging-<pid>-<ns>``."""
    try:
        return sorted(p for p in model_dir.iterdir() if p.name.startswith(f".{name}.staging-"))
    except OSError:
        return []


def _voice_files(model_dir: Path, voice: str) -> list[Path]:
    """One voice's files, staging folders and snapshot folders."""
    if not voice or voice.startswith(".") or "/" in voice or "\\" in voice:
        return []  # not a voice code; never a path outside model_dir
    names = [f"{voice}{suffix}" for suffix in VOICE_SUFFIXES]
    candidates = [model_dir / name for name in names]
    for name in names:
        candidates += _staging(model_dir, name)
    rel = _snapshot_dir(voice)
    if rel is not None:
        for source in SOURCES:
            snapshot = model_dir / f".{source}"
            # The files, and huggingface_hub's local-dir metadata and partial
            # downloads for them (ModelScope's partials sit beside the files).
            candidates += [snapshot / rel, snapshot / ".cache" / "huggingface" / "download" / rel]
    return candidates


def _all_voices(model_dir: Path) -> list[Path]:
    """Every voice in model_dir, the snapshots they came from and leftover
    staging folders -- everything but the folder itself and its locks."""
    try:
        entries = sorted(model_dir.iterdir())
    except OSError:
        return []
    return [
        *(model_dir / f".{source}" for source in SOURCES),
        *(p for p in entries if not p.name.startswith(".") and p.name.endswith(VOICE_SUFFIXES)),
        *(p for p in entries if p.name.startswith(".") and ".staging-" in p.name),
    ]


def _resolve(model_id: str, model_dir: Path) -> dict:
    # "piper" (the only id the app ever sends) maps to the default voice that
    # gates startup; any other value is taken verbatim as a voice stem.
    is_piper = model_id.strip().lower() == "piper"
    voice = DEFAULT_VOICE if is_piper else model_id
    onnx_path = model_dir / f"{voice}.onnx"
    json_path = model_dir / f"{voice}.onnx.json"
    ready = onnx_path.is_file() and json_path.is_file()
    files = _all_voices(model_dir) if is_piper else _voice_files(model_dir, voice)
    return {
        "name": model_id,
        "downloaded": ready,
        "path": str(onnx_path),
        "files": paths.existing_paths(*files),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    model_dir = paths.models_dir("tts", "piper")
    print(f"piper model dir: {model_dir}", file=sys.stderr)
    print(json.dumps([_resolve(m, model_dir) for m in args.models]))


if __name__ == "__main__":
    main()
