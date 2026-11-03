# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""What a pulled model needs before OVMS serves it right.

``ovms --pull`` takes a pre-converted repository as it is and gets three kinds of model wrong:

* Decoder-based embedding models without a sentence-transformers pooling config: OVMS pools on
  the first token, which in a causal model has seen only itself, so every text embeds about the
  same. :func:`embeddings_pooling` asks for the last token.
* Rerank models whose OpenVINO tokenizer adds special tokens (``OpenVINO/bge-reranker-*-ov``):
  OVMS adds them again and every document scores near zero. :func:`repair_rerank_tokenizer`
  reconverts the tokenizer without them.
* Image pipelines exported without OpenVINO tokenizers (``Aminfri/sdxl-turbo-openvino``): every
  generation request fails. :func:`add_pipeline_tokenizers` converts them.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess  # nosec B404 - runs convert_tokenizer from the OVMS export environment
import sys
from pathlib import Path

from .._startup import startup_stage
from ..errors import OvmsError
from .env import OvmsEnv

__all__ = [
    "RERANK_TOKENIZER_MARKER",
    "add_pipeline_tokenizers",
    "embeddings_pooling",
    "repair_rerank_tokenizer",
]

logger = logging.getLogger(__name__)

#: Left next to a rerank model once its tokenizer no longer adds special
#: tokens, so the conversion runs once per model.
RERANK_TOKENIZER_MARKER = ".ovms_rerank_tokenizer"

#: The Hugging Face tokenizer files a conversion starts from (any one).
_HF_TOKENIZER_FILES = ("tokenizer.json", "tokenizer_config.json")

#: The line a Python traceback ends with: ``ImportError: ...``.
_EXCEPTION_LINE = re.compile(r"^\w+(Error|Exception)\b")


def embeddings_pooling(model_dir: str | os.PathLike[str]) -> str | None:
    """``--pooling`` for an embedding model, or ``None`` to let OVMS decide.

    ``LAST`` for a causal (decoder-only) model without a sentence-transformers
    pooling config; OVMS reads that config itself when there is one.
    """
    root = Path(model_dir)
    if (root / "modules.json").is_file() or (root / "1_Pooling" / "config.json").is_file():
        return None
    try:
        config = json.loads((root / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    architectures = config.get("architectures") or []
    if any(str(name).endswith("ForCausalLM") for name in architectures):
        return "LAST"
    return None


def _conversion_error(output: str) -> str:
    """The first exception a failed ``convert_tokenizer`` printed (a line or two), else its last
    line. The first, because transformers hides a tokenizer it cannot load behind an ImportError
    for protobuf when that is not installed."""
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    for index in range(len(lines)):
        if _EXCEPTION_LINE.match(lines[index]):
            if lines[index].endswith(":") and index + 1 < len(lines):
                return f"{lines[index]} {lines[index + 1]}"
            return lines[index]
    return lines[-1] if lines else "no output"


def _convert_tokenizer(env: OvmsEnv) -> Path | None:
    name = "convert_tokenizer.exe" if sys.platform == "win32" else "convert_tokenizer"
    folder = "Scripts" if sys.platform == "win32" else "bin"
    executable = env.optimum_home / folder / name
    return executable if executable.is_file() else None


def repair_rerank_tokenizer(model_dir: str | os.PathLike[str], env: OvmsEnv) -> bool:
    """Convert a rerank model's tokenizer again, without special tokens.

    Once per model (:data:`RERANK_TOKENIZER_MARKER`); later pulls keep the result. Returns whether
    it converted now, so a server that already loaded the model must reload it. A model that cannot
    be converted is logged and left as it is.
    """
    root = Path(model_dir)
    if (root / RERANK_TOKENIZER_MARKER).is_file():
        return False
    if not any((root / name).is_file() for name in _HF_TOKENIZER_FILES):
        logger.warning(f"{root}: no Hugging Face tokenizer files to convert the rerank tokenizer from")
        return False
    executable = _convert_tokenizer(env)
    if executable is None:
        logger.warning(
            f"convert_tokenizer not found in {env.optimum_home}; {root} keeps a tokenizer "
            "that adds special tokens, which OVMS's reranker adds again"
        )
        return False
    command = [str(executable), str(root), "--not-add-special-tokens", "-o", str(root)]
    result = subprocess.run(  # nosec B603 - fixed argument list, no shell
        command, env=env.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    if result.returncode != 0:
        logger.warning(f"convert_tokenizer failed for {root}: {result.stdout.strip()[-2000:]}")
        return False
    (root / RERANK_TOKENIZER_MARKER).write_text("converted without special tokens\n", encoding="utf-8")
    logger.info(f"Rerank tokenizer of {root} converted without special tokens")
    return True


def add_pipeline_tokenizers(model_dir: str | os.PathLike[str], env: OvmsEnv) -> list[str]:
    """Convert the OpenVINO tokenizers a diffusers-layout pipeline lacks.

    Every ``tokenizer*`` folder with Hugging Face files but no ``openvino_tokenizer.xml`` gets one,
    plus a detokenizer. Returns the folders converted. Raises :class:`OvmsError` when one cannot
    be: OVMS would load the pipeline, then fail every generation request without saying why.
    """
    root = Path(model_dir)
    folders = sorted(
        folder
        for folder in root.glob("tokenizer*")
        if folder.is_dir()
        and not (folder / "openvino_tokenizer.xml").is_file()
        and any((folder / name).is_file() for name in _HF_TOKENIZER_FILES)
    )
    if not folders:
        return []
    converted = []
    with startup_stage("preparing", f"OpenVINO tokenizers of {root.name}", failure=str):
        executable = _convert_tokenizer(env)
        if executable is None:
            raise OvmsError(f"convert_tokenizer not found in {env.optimum_home}; {root.name} has no OpenVINO tokenizers")
        for folder in folders:
            command = [str(executable), str(folder), "--with-detokenizer", "-o", str(folder)]
            result = subprocess.run(  # nosec B603 - fixed argument list, no shell
                command, env=env.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
            )
            if result.returncode != 0:
                logger.error(f"convert_tokenizer failed for {folder}: {result.stdout.strip()[-8000:]}")
                raise OvmsError(
                    f"Could not convert the OpenVINO tokenizer in {folder.name} of {root.name}: "
                    f"{_conversion_error(result.stdout)}"
                )
            converted.append(folder.name)
    if converted:
        logger.info(f"Converted OpenVINO tokenizers for {root}: {', '.join(converted)}")
    return converted
