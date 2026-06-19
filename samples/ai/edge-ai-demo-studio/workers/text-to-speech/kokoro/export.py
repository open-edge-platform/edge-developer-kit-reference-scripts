# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Standalone script to download the Kokoro model and export it to OpenVINO IR format.

Usage:
    python export.py --model_dir /path/to/model/dir [--source huggingface|modelscope] [--npu]
"""

import os
import argparse
import json
import logging
from pathlib import Path

import torch
import openvino as ov
from huggingface_hub import hf_hub_download
from modelscope.hub.file_download import model_file_download as ms_hub_download
from misaki.espeak import EspeakWrapper

from kokoro import KPipeline, KModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REPO_ID = "hexgrad/Kokoro-82M"
STATIC_SHAPE = {"input_ids": [1, 512], "ref_s": [1, 256], "speed": [1]}


def is_windows():
    """Check if the current operating system is Windows."""
    return os.name == "nt"


def download_file(
    repo_id: str,
    filename: str,
    model_dir: str,
    source: str = "huggingface",
) -> str:
    """Download a single file from HuggingFace or ModelScope."""
    logger.info("Downloading %s from %s", filename, repo_id)
    if source == "modelscope":
        return ms_hub_download(
            model_id=repo_id,
            file_path=filename,
            local_dir=model_dir,
        )
    return hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=model_dir,
    )


def export_to_openvino(
    model_dir: str,
    repo_id: str = REPO_ID,
    source: str = "huggingface",
) -> Path:
    """
    Download the Kokoro PyTorch model and convert it to OpenVINO IR (dynamic shapes).

    Returns the path to the saved ``openvino_model.xml`` file.
    Skips conversion if the file already exists.
    """
    model_path = Path(model_dir) / "openvino_model.xml"
    if model_path.exists():
        logger.info("OpenVINO model already exists at %s, skipping export.", model_path)
        return model_path

    # Download config and weights
    config_file = download_file(
        repo_id=repo_id,
        filename="config.json",
        model_dir=model_dir,
        source=source,
    )
    with open(config_file, "r", encoding="utf-8") as f:
        config = json.load(f)

    kokoro_weights = download_file(
        repo_id=repo_id,
        filename=KModel.MODEL_NAMES[repo_id],
        model_dir=model_dir,
        source=source,
    )

    model = None
    try:
        if not is_windows():
            # Disable espeakng-loader, use system wide espeak (should be installed)
            EspeakWrapper.set_library(None)
            EspeakWrapper.set_data_path(None)
            os.environ["PHONEMIZER_ESPEAK_PATH"] = "/usr/bin"
            os.environ["PHONEMIZER_ESPEAK_DATA"] = "/usr/share/espeak-ng-data"
            os.environ["ESPEAK_DATA_PATH"] = "/usr/share/espeak-ng-data"

        logger.info("Loading PyTorch model for conversion ...")
        model = KModel(repo_id=repo_id, config=config, model=kokoro_weights).eval()
        pipeline = KPipeline(lang_code="a", repo_id=repo_id, model=model)
        model = pipeline.model
        model.forward = model.forward_with_tokens

        # Build representative example inputs (fixed values used for model tracing only)
        input_ids = torch.LongTensor([[0, *([50] * 48), 0]])
        style = torch.zeros(1, 256)
        speed = torch.ones(1, dtype=torch.float32)

        logger.info("Converting model to OpenVINO IR ...")
        ov_model = ov.convert_model(
            model,
            example_input=(input_ids, style, speed),
            input=[
                ov.PartialShape("[1, 2..]"),
                ov.PartialShape([1, -1]),
                ov.PartialShape([1]),
            ],
        )
        # Name outputs explicitly so the NPU NPUW Kokoro split can locate them by name.
        ov_model.outputs[0].tensor.set_names({"audio"})
        ov_model.outputs[1].tensor.set_names({"pred_dur"})
        ov.save_model(ov_model, model_path)
        logger.info("OpenVINO model saved to %s", model_path)
    except Exception as e:
        logger.error("Failed to convert model with OpenVINO: %s", e)
        raise RuntimeError("Model conversion failed") from e
    finally:
        if model is not None:
            del model

    return model_path


def export_static_model(model_dir: str, dynamic_model_path: Path | None = None) -> Path:
    """
    Reshape the dynamic OpenVINO model to static input shapes required by the NPU.

    Returns the path to the saved ``openvino_model-static.xml`` file.
    Skips reshaping if the file already exists.
    """
    static_model_path = Path(model_dir) / "openvino_model-static.xml"
    if static_model_path.exists():
        logger.info(
            "Static OpenVINO model already exists at %s, skipping.", static_model_path
        )
        return static_model_path

    if dynamic_model_path is None:
        dynamic_model_path = Path(model_dir) / "openvino_model.xml"

    if not dynamic_model_path.exists():
        raise FileNotFoundError(
            f"Dynamic OpenVINO model not found at {dynamic_model_path}. "
            "Run export_to_openvino() first."
        )

    logger.info("Reshaping model to static shapes for NPU ...")
    core = ov.Core()
    ov_model = core.read_model(dynamic_model_path)
    ov_model.reshape(STATIC_SHAPE)
    ov.save_model(ov_model, static_model_path)
    logger.info("Static OpenVINO model saved to %s", static_model_path)
    return static_model_path


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download and export Kokoro TTS model to OpenVINO IR format."
    )
    parser.add_argument(
        "--model_dir",
        type=str,
        required=True,
        help="Directory where the model files will be stored.",
    )
    parser.add_argument(
        "--repo_id",
        type=str,
        default=REPO_ID,
        help=f"HuggingFace / ModelScope repo ID (default: {REPO_ID}).",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="huggingface",
        choices=["huggingface", "modelscope"],
        help="Model hub to download from (default: huggingface).",
    )
    parser.add_argument(
        "--npu",
        action="store_true",
        help="Also export a static-shape model optimised for NPU.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_arguments()

    dynamic_path = export_to_openvino(
        model_dir=args.model_dir,
        repo_id=args.repo_id,
        source=args.source,
    )

    if args.npu:
        export_static_model(model_dir=args.model_dir, dynamic_model_path=dynamic_path)

    logger.info("Export complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
