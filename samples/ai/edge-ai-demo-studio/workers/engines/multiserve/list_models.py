# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Print the multiserve model catalogue as JSON, without starting the engine.

Standalone CLI wrapping the same ``OVDownloader``/``GGUFDownloader`` classes
``app-hybrid.py`` builds (see ``modules/ovms/cli.py`` and
``modules/llamacpp/cli.py``), so the shape matches ``GET /v1/models`` on a
running engine exactly: ``{"openvino"?: [...], "llamacpp"?: [...]}`` where
each entry is ``{repo_id, task_type, verified, downloaded, sources}``. Used by
the frontend to show model state (verified catalogue + what is on disk)
before an engine instance exists or while it is stopped, so nothing here may
start a server or the tray — this only reads ``verified.yaml`` and scans the
model directory.

Usage::

    python list_models.py --model-dir <dir> [--provider openvino|llamacpp]

``--model-dir`` is the same directory the engine itself is started with
(``app-hybrid.py --model-dir``); ``OV/`` and ``GGUF/`` under it hold each
backend's weights (see ``getModelsDir`` in the frontend's
``engines/multiserve/data.ts``). ``--provider`` restricts the result to one
backend, matching the query router's own filter. A directory that does not
exist yet is not an error: it simply reports nothing downloaded.

A backend that fails to load (bad ``verified.yaml``, unreadable directory,
...) never fails the whole call: its key comes back as an empty list and the
top-level ``warnings`` array gains one entry describing it, and the process
still exits 0. All diagnostics (including tracebacks) go to stderr only —
stdout carries nothing but the final JSON document.
"""

import argparse
import json
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent
VERIFIED_MODEL_PATH = ENGINE_DIR / "verified.yaml"

PROVIDERS = ("openvino", "llamacpp")


def _list_openvino(model_dir: Path) -> list:
    """Builds the OVDownloader OVMSManagerCLI would, without standing up the model server config."""
    # Lazy import: a broken OpenVINO backend must not stop llama.cpp being listed (and vice versa).
    from modules.ovms.ov_downloader import OVDownloader

    downloader = OVDownloader(
        models_base_dir=str(model_dir / "OV"),
        verified_model_file=str(VERIFIED_MODEL_PATH),
    )
    return downloader.list_models()


def _list_llamacpp(model_dir: Path) -> list:
    """Builds the GGUFDownloader LlamaManagerCLI would."""
    from modules.llamacpp.gguf_downloader import GGUFDownloader

    downloader = GGUFDownloader(
        models_base_dir=str(model_dir / "GGUF"),
        verified_model_file=str(VERIFIED_MODEL_PATH),
    )
    return downloader.list_models()


_LISTERS = {
    "openvino": _list_openvino,
    "llamacpp": _list_llamacpp,
}


def build_catalog(model_dir: Path, provider: str | None) -> dict:
    """`GET /v1/models` body for `provider` (default: all); one that raises becomes `[]` + a warning."""
    wanted = [provider] if provider else list(PROVIDERS)
    result: dict = {}
    warnings: list = []

    for name in wanted:
        try:
            result[name] = _LISTERS[name](model_dir)
        except Exception as exc:  # noqa: BLE001 - reported, never raised
            print(f"{name}: {exc}", file=sys.stderr)
            result[name] = []
            warnings.append(f"{name}: {exc}")

    if warnings:
        result["warnings"] = warnings

    return result


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model-dir",
        required=True,
        help="Multiserve model directory (contains OV/ and GGUF/), i.e. the "
        "same path the engine is started with via --model-dir.",
    )
    parser.add_argument(
        "--provider",
        choices=PROVIDERS,
        help="Only list this backend's models (default: both).",
    )
    args = parser.parse_args(argv)

    catalog = build_catalog(Path(args.model_dir), args.provider)
    json.dump(catalog, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
