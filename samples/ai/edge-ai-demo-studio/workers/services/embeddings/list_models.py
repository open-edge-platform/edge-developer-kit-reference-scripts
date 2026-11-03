#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Report which OEP text-embedding presets are already exported to
OpenVINO IR, without starting the worker.

Layout rule mirrored from ``workers/services/embeddings/main.py``
(``EMBEDDING_OV_MODELS_DIR=<repo>/models/embeddings/ov-models``) and the
vendored upstream's per-handler conversion code:

* CLIP / SigLIP
  (``thirdparty/multimodal-embedding-serving/src/models/handlers/clip_handler.py``
  and ``siglip_handler.py``, ``convert_to_openvino``) -- flat files directly
  under ``ov-models``, named
  ``<model_key>_image_encoder.xml``/``_text_encoder.xml`` (+ ``.bin``
  siblings), where ``model_key = f"{model_name}_{pretrained}".replace("/",
  "_").replace("-", "_")``. ``model_name``/``pretrained`` come from a fixed
  lookup (``src/models/config.py``'s ``MODEL_CONFIGS``), copied below rather
  than derived mechanically from the frontend id, since it is not a
  mechanical transform;
* Qwen text embeddings
  (``.../src/models/handlers/qwen_handler.py``, ``_export_openvino``,
  ``_sanitized_model_dir``) -- ``ov-models/<sanitized hf_model_id>/<weight_format
  upper-cased>/openvino_model.xml`` (+ ``.bin``), where
  ``_sanitized_model_dir()`` is ``re.sub(r"[^a-zA-Z0-9]+", "_",
  hf_model_id).lower().strip("_")`` and ``weight_format`` is a fixed
  per-preset config value (``"int8"`` for the one model in scope).

"Downloaded" checks that both encoder ``.xml``/``.bin`` pairs (CLIP/SigLIP)
or the single ``openvino_model.xml``/``.bin`` (Qwen) exist. Each handler's
own conversion-skip check (``clip_handler.py``'s ``convert_to_openvino``,
``qwen_handler.py``'s ``_export_openvino``) only tests the ``.xml`` path(s);
requiring the ``.bin`` sibling(s) too is a deliberate stricter check by this
script, on the assumption that a directory with an ``.xml`` but no ``.bin``
is a partial/corrupt export rather than something the worker would actually
be able to load.

``files`` is everything one preset left on disk:

* CLIP / SigLIP -- the two encoder ``.xml``/``.bin`` pairs, any
  ``ov-models/optimum_<model_key>_<8 chars>`` staging folder an interrupted
  CLIP conversion left (``clip_handler.py``'s ``convert_to_openvino``,
  ``tempfile.mkdtemp``), and the checkpoint's Hugging Face repository,
  open_clip's ``hf_hub`` for the preset (``open_clip/pretrained.py``, copied
  below): CLIP converts through optimum-intel with ``cache_dir=HF_HOME``, so
  its repository sits at the top of the shared cache
  (``<HF_HOME>/models--org--name``); SigLIP's ``open_clip`` weights and
  tokenizer go to the hub's own ``<HF_HOME>/hub/models--org--name``;
* Qwen -- ``ov-models/<sanitized hf_model_id>``, whole: it holds the export
  at every precision (``FP16/``, ``INT8/``; main.py's ``PRECISIONS``) and
  nothing else; and ``hf_model_id``'s repository in the hub cache
  (``AutoTokenizer`` / ``OVModelForFeatureExtraction.from_pretrained``).

Each repository is looked for in both places of the shared cache and of the
cache this worker kept before (``<models>/huggingface``, which main.py's
``use_shared_hf_cache`` moves into the shared one on the next start). Left
out, as every CLIP/SigLIP preset uses it: ``ov-models/ov_cache``, the NPU
compiled-blob cache (``src/models/utils/openvino_utils.py``,
``_enable_model_cache``); and the worker's ``.oep-startup`` lock.

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
models_dir = paths.models_dir

# Every CLIP/SigLIP preset the worker advertises (upstream src/models/config.py's MODEL_CONFIGS),
# including ids the frontend doesn't offer, so custom ids resolve. Third value: open_clip's
# get_pretrained_cfg(...)["hf_hub"] (open-clip-torch 3.3.0), the checkpoint's repository.
_CLIP_SIGLIP_MODELS = {
    "CLIP/clip-vit-b-32": ("ViT-B-32", "laion2b_s34b_b79k", "laion/CLIP-ViT-B-32-laion2B-s34B-b79K"),
    "CLIP/clip-vit-b-16": ("ViT-B-16", "openai", "timm/vit_base_patch16_clip_224.openai"),
    "CLIP/clip-vit-l-14": (
        "ViT-L-14", "datacomp_xl_s13b_b90k", "laion/CLIP-ViT-L-14-DataComp.XL-s13B-b90K"
    ),
    "CLIP/clip-vit-h-14": ("ViT-H-14", "laion2b_s32b_b79k", "laion/CLIP-ViT-H-14-laion2B-s32B-b79K"),
    "SigLIP/siglip2-vit-b-16": ("ViT-B-16-SigLIP2", "webli", "timm/ViT-B-16-SigLIP2"),
    "SigLIP/siglip2-vit-l-16": ("ViT-L-16-SigLIP2-256", "webli", "timm/ViT-L-16-SigLIP2-256"),
    "SigLIP/siglip2-so400m-patch16-384": (
        "ViT-SO400M-16-SigLIP2-384", "webli", "timm/ViT-SO400M-16-SigLIP2-384"
    ),
}

# qwen_handler.py's QwenEmbeddingHandler config: hf_model_id + weight_format.
_QWEN_MODELS = {
    "QwenText/qwen3-embedding-0.6b": ("Qwen/Qwen3-Embedding-0.6B", "int8"),
    "QwenText/qwen3-embedding-4b": ("Qwen/Qwen3-Embedding-4B", "int8"),
    "QwenText/qwen3-embedding-8b": ("Qwen/Qwen3-Embedding-8B", "int8"),
}


def _model_key(model_name: str, pretrained: str) -> str:
    return f"{model_name}_{pretrained}".replace("/", "_").replace("-", "_")


def _sanitized_model_dir(hf_model_id: str) -> str:
    import re

    return re.sub(r"[^a-zA-Z0-9]+", "_", hf_model_id).lower().strip("_")


def _hf_repo_dirs(repo_id: str, legacy_hf_home: Path) -> list[Path]:
    """``repo_id``'s possible folders: hub and top level (optimum-intel's ``cache_dir=HF_HOME``)
    of the shared cache, then of ``legacy_hf_home``."""
    name = paths.hf_repo_dir(repo_id).name
    return [
        paths.hf_repo_dir(repo_id),
        paths.hf_home() / name,
        legacy_hf_home / "hub" / name,
        legacy_hf_home / name,
    ]


def _staging_dirs(ov_models_dir: Path, key: str) -> list[Path]:
    """Folders of ``clip_handler.py``'s ``mkdtemp(prefix=f"optimum_{model_key}_")``."""
    prefix = f"optimum_{key}_"
    if not ov_models_dir.is_dir():
        return []
    return sorted(
        entry for entry in ov_models_dir.iterdir()
        if entry.name.startswith(prefix) and len(entry.name) == len(prefix) + 8
    )


def _resolve(model_id: str, base: Path) -> dict:
    ov_models_dir = base / "ov-models"
    legacy_hf_home = base / "huggingface"
    if model_id in _CLIP_SIGLIP_MODELS:
        model_name, pretrained, hf_hub_id = _CLIP_SIGLIP_MODELS[model_id]
        key = _model_key(model_name, pretrained)
        image_xml = ov_models_dir / f"{key}_image_encoder.xml"
        text_xml = ov_models_dir / f"{key}_text_encoder.xml"
        ready = (
            image_xml.is_file() and image_xml.with_suffix(".bin").is_file()
            and text_xml.is_file() and text_xml.with_suffix(".bin").is_file()
        )
        files = paths.existing_paths(
            image_xml,
            image_xml.with_suffix(".bin"),
            text_xml,
            text_xml.with_suffix(".bin"),
            *_staging_dirs(ov_models_dir, key),
            *_hf_repo_dirs(hf_hub_id, legacy_hf_home),
        )
        return {"name": model_id, "downloaded": ready, "path": str(image_xml), "files": files}

    if model_id in _QWEN_MODELS:
        # --precision overrides weight_format and the instance's precision isn't known here, so
        # an export at either precision counts.
        hf_model_id, weight_format = _QWEN_MODELS[model_id]
        export_root = ov_models_dir / _sanitized_model_dir(hf_model_id)
        dirs = [export_root / fmt.upper() for fmt in (weight_format, "fp16")]
        found = next(
            (
                d for d in dirs
                if (d / "openvino_model.xml").is_file() and (d / "openvino_model.bin").is_file()
            ),
            None,
        )
        # export_root holds only this model's exports, at every precision.
        files = paths.existing_paths(export_root, *_hf_repo_dirs(hf_model_id, legacy_hf_home))
        return {
            "name": model_id,
            "downloaded": found is not None,
            "path": str(found or dirs[0]),
            "files": files,
        }

    return {"name": model_id, "downloaded": False, "path": None, "files": []}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True, metavar="ID")
    args = parser.parse_args()

    base = Path(os.environ.get("EMBEDDINGS_MODELS_DIR") or models_dir("embeddings"))
    print(f"embeddings ov-models dir: {base / 'ov-models'}", file=sys.stderr)
    print(json.dumps([_resolve(m, base) for m in args.models]))


if __name__ == "__main__":
    main()
