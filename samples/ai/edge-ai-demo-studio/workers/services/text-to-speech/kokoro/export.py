# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Download the Kokoro model and export it to OpenVINO IR; ``--npu`` adds the static NPU model."""

import os
import argparse
import json
import logging
import types
from contextlib import contextmanager
from pathlib import Path

import torch
import openvino as ov
from model_downloader import fetch_file

from kokoro import KPipeline, KModel
from kokoro import modules as kokoro_modules
from utils import configure_system_espeak

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

REPO_ID = "hexgrad/Kokoro-82M"
STATIC_SHAPE = {"input_ids": [1, 512], "ref_s": [1, 256], "speed": [1]}

#: The fixed-width model the NPU runs (see :func:`export_static_model`).
NPU_MODEL_NAME = "openvino_model-npu.xml"
#: The dynamic IR reshaped to STATIC_SHAPE, from older versions. It never compiled on the NPU
#: (data-dependent encoder dimensions), so the NPU export removes it.
LEGACY_STATIC_MODEL_NAME = "openvino_model-static.xml"


def is_windows():
    return os.name == "nt"


def download_file(
    repo_id: str,
    filename: str,
    model_dir: str,
    source: str = "huggingface",
) -> str:
    """Download one file from Hugging Face or ModelScope through the shared model-downloader."""
    logger.info("Downloading %s from %s (%s)", filename, repo_id, source)
    return str(fetch_file(repo_id, filename, model_dir, source=source))


def _load_pytorch_model(model_dir: str, repo_id: str, source: str) -> KModel:
    """Download the config and weights (cheap when present) and load ``KModel``."""
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

    if not is_windows():
        # The system espeak-ng instead of espeakng-loader's.
        configure_system_espeak()

    logger.info("Loading PyTorch model for conversion ...")
    model = KModel(repo_id=repo_id, config=config, model=kokoro_weights).eval()
    pipeline = KPipeline(lang_code="a", repo_id=repo_id, model=model)
    return pipeline.model


def _example_inputs(width: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Representative inputs of ``width`` tokens (fixed values, used for tracing only)."""
    input_ids = torch.LongTensor([[0, *([50] * (width - 2)), 0]])
    style = torch.zeros(1, 256)
    speed = torch.ones(1, dtype=torch.float32)
    return input_ids, style, speed


def _save(ov_model: ov.Model, model_path: Path) -> None:
    # Name outputs explicitly so the NPU NPUW Kokoro split can locate them by name.
    ov_model.outputs[0].tensor.set_names({"audio"})
    ov_model.outputs[1].tensor.set_names({"pred_dur"})
    ov.save_model(ov_model, model_path)
    logger.info("OpenVINO model saved to %s", model_path)


def export_to_openvino(
    model_dir: str,
    repo_id: str = REPO_ID,
    source: str = "huggingface",
) -> Path:
    """Export the dynamic-shape IR (``openvino_model.xml``) unless it exists; return its path."""
    model_path = Path(model_dir) / "openvino_model.xml"
    if model_path.exists():
        logger.info("OpenVINO model already exists at %s, skipping export.", model_path)
        return model_path

    model = None
    try:
        model = _load_pytorch_model(model_dir, repo_id, source)
        model.forward = model.forward_with_tokens

        logger.info("Converting model to OpenVINO IR ...")
        ov_model = ov.convert_model(
            model,
            example_input=_example_inputs(50),
            input=[
                ov.PartialShape("[1, 2..]"),
                ov.PartialShape([1, -1]),
                ov.PartialShape([1]),
            ],
        )
        _save(ov_model, model_path)
    except Exception as e:
        logger.error("Failed to convert model with OpenVINO: %s", e)
        raise RuntimeError("Model conversion failed") from e
    finally:
        if model is not None:
            del model

    return model_path


# NPU export. The NPU compiler needs static shapes, and reshaping the dynamic IR is not enough: the
# encoders' ``input_lengths.max()`` masks and packed LSTMs trace into data-dependent dimensions
# (``LLVM ERROR: Failed to infer result type(s)``). NPU requests are padded to the full width, so the
# forwards below assume it; NPUW_KOKORO runs the dynamic alignment and decoder in fixed blocks.


def _static_text_encoder_forward(self, x, input_lengths, m):
    """``TextEncoder.forward`` for inputs that fill the whole width (no packing)."""
    x = self.embedding(x).transpose(1, 2)  # [B, emb, T]
    m = m.unsqueeze(1)
    x = x.masked_fill(m, 0.0)
    for c in self.cnn:
        x = c(x).masked_fill(m, 0.0)
    x = x.transpose(1, 2)  # [B, T, chn]
    x, _ = self.lstm(x)
    x = x.transpose(-1, -2)
    return x.masked_fill(m, 0.0)


def _static_duration_encoder_forward(self, x, style, text_lengths, m):
    """``DurationEncoder.forward`` for inputs that fill the whole width (no packing)."""
    masks = m
    x = x.permute(2, 0, 1)
    s = style.expand(x.shape[0], x.shape[1], -1)
    x = torch.cat([x, s], axis=-1)
    x = x.masked_fill(masks.unsqueeze(-1).transpose(0, 1), 0.0)
    x = x.transpose(0, 1).transpose(-1, -2)
    for block in self.lstms:
        if isinstance(block, kokoro_modules.AdaLayerNorm):
            x = block(x.transpose(-1, -2), style).transpose(-1, -2)
            x = torch.cat([x, s.permute(1, 2, 0)], axis=1)
            x = x.masked_fill(masks.unsqueeze(-1).transpose(-1, -2), 0.0)
        else:
            x, _ = block(x.transpose(-1, -2))
            x = x.transpose(-1, -2)
    return x.transpose(-1, -2)


def _static_forward_with_tokens(self, input_ids, ref_s, speed=1):
    """``KModel.forward_with_tokens`` with the text mask spelled out for a full-width input."""
    width = input_ids.shape[-1]
    input_lengths = torch.full((input_ids.shape[0],), width, dtype=torch.long)
    text_mask = torch.zeros((input_ids.shape[0], width), dtype=torch.bool)
    bert_dur = self.bert(
        input_ids, attention_mask=torch.ones_like(input_ids, dtype=torch.int32)
    )
    d_en = self.bert_encoder(bert_dur).transpose(-1, -2)
    s = ref_s[:, 128:]
    d = self.predictor.text_encoder(d_en, s, input_lengths, text_mask)
    x, _ = self.predictor.lstm(d)
    duration = self.predictor.duration_proj(x)
    duration = torch.sigmoid(duration).sum(axis=-1) / speed
    pred_dur = torch.round(duration).clamp(min=1).long().squeeze()
    indices = torch.repeat_interleave(torch.arange(width), pred_dur)
    pred_aln_trg = torch.zeros((width, indices.shape[0]))
    pred_aln_trg[indices, torch.arange(indices.shape[0])] = 1
    pred_aln_trg = pred_aln_trg.unsqueeze(0)
    en = d.transpose(-1, -2) @ pred_aln_trg
    F0_pred, N_pred = self.predictor.F0Ntrain(en, s)
    t_en = self.text_encoder(input_ids, input_lengths, text_mask)
    asr = t_en @ pred_aln_trg
    audio = self.decoder(asr, F0_pred, N_pred, ref_s[:, :128]).squeeze()
    return audio, pred_dur


@contextmanager
def _static_encoders():
    """Swap the encoder forwards for their full-width versions while tracing."""
    originals = (
        kokoro_modules.TextEncoder.forward,
        kokoro_modules.DurationEncoder.forward,
    )
    kokoro_modules.TextEncoder.forward = _static_text_encoder_forward
    kokoro_modules.DurationEncoder.forward = _static_duration_encoder_forward
    try:
        yield
    finally:
        kokoro_modules.TextEncoder.forward, kokoro_modules.DurationEncoder.forward = originals


def export_static_model(
    model_dir: str,
    repo_id: str = REPO_ID,
    source: str = "huggingface",
) -> Path:
    """Export the fixed-width NPU model (``openvino_model-npu.xml``) unless it exists; return its path."""
    static_model_path = Path(model_dir) / NPU_MODEL_NAME
    if static_model_path.exists():
        logger.info(
            "NPU OpenVINO model already exists at %s, skipping.", static_model_path
        )
        return static_model_path

    for suffix in (".xml", ".bin"):
        legacy = (Path(model_dir) / LEGACY_STATIC_MODEL_NAME).with_suffix(suffix)
        if legacy.exists():
            logger.info("Removing %s (reshaped model that does not compile on the NPU)", legacy)
            legacy.unlink()

    model = None
    try:
        model = _load_pytorch_model(model_dir, repo_id, source)
        model.forward = types.MethodType(_static_forward_with_tokens, model)

        logger.info("Converting model to OpenVINO IR with static shapes for the NPU ...")
        with _static_encoders():
            ov_model = ov.convert_model(
                model,
                example_input=_example_inputs(STATIC_SHAPE["input_ids"][1]),
                input=[
                    ov.PartialShape(STATIC_SHAPE["input_ids"]),
                    ov.PartialShape(STATIC_SHAPE["ref_s"]),
                    ov.PartialShape(STATIC_SHAPE["speed"]),
                ],
            )
        _save(ov_model, static_model_path)
    except Exception as e:
        logger.error("Failed to convert the NPU model with OpenVINO: %s", e)
        raise RuntimeError("NPU model conversion failed") from e
    finally:
        if model is not None:
            del model

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

    export_to_openvino(
        model_dir=args.model_dir,
        repo_id=args.repo_id,
        source=args.source,
    )

    if args.npu:
        export_static_model(
            model_dir=args.model_dir, repo_id=args.repo_id, source=args.source
        )

    logger.info("Export complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
