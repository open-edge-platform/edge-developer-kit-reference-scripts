# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Malaya VITS on OpenVINO: the checkpoint is converted once to an IR beside it.

``infer`` is traced with noise scales 0 (deterministic); input length, speaker and length scale stay
inputs. The IR runs ~2x PyTorch on CPU and beats PyTorch on Arc (a kernel build per input length).
"""

import json
import os
from pathlib import Path

import numpy as np
import openvino as ov

from worker_common import get_logger, openvino_pinned_cpu_config, shared_model_lock, staged_model_file

logger = get_logger(__name__)

#: The IR, relative to the model directory.
IR_FILE = Path("openvino") / "malaya.xml"


def load_hparams(model_dir: str):
    try:
        from malaya_boilerplate.hparams import HParams
    except BaseException:
        from malaya_boilerplate.train.config import HParams
    with open(os.path.join(model_dir, "config.json"), encoding="utf-8") as f:
        return HParams(**json.load(f))


def _traceable_relative_embeddings(self, relative_embeddings, length):
    """MultiHeadAttention._get_relative_embeddings without its Python branch.

    Upstream pads by max(length - window - 1, 0), which tracing freezes, breaking inputs shorter than
    window + 1 ids. Padding ``length`` zeros on both sides puts the 2 * length - 1 needed positions
    at ``window + 1`` onward. Concatenated, not padded: OpenVINO's CPU plugin can't run a Pad whose
    pads come from the input length.
    """
    import torch

    zeros = torch.zeros_like(relative_embeddings[:, :1]).expand(-1, length, -1)
    padded = torch.cat([zeros, relative_embeddings, zeros], dim=1)
    start = self.window_size + 1
    return padded[:, start : start + 2 * length - 1]


def _export(model_dir: str, hps, ir_path: Path) -> None:
    import torch
    from malaya_speech.torch_model.vits.attentions import MultiHeadAttention
    from malaya_speech.torch_model.vits.model_infer import SynthesizerTrn
    from malaya_speech.utils.text import TTS_SYMBOLS

    model = SynthesizerTrn(
        len(TTS_SYMBOLS),
        hps.data.filter_length // 2 + 1,
        hps.train.segment_size // hps.data.hop_length,
        n_speakers=hps.data.n_speakers,
        **hps.model,
    ).eval()
    model.load_state_dict(torch.load(os.path.join(model_dir, "model.pth"), map_location="cpu"))

    class Infer(torch.nn.Module):
        def __init__(self, vits):
            super().__init__()
            self.vits = vits

        def forward(self, input_ids, input_lengths, sid, length_scale):
            audio, *_ = self.vits.infer(
                input_ids, input_lengths, sid=sid, noise_scale=0.0,
                length_scale=length_scale, noise_scale_w=0.0,
            )
            return audio[:, 0, :]

    ids = torch.randint(1, len(TTS_SYMBOLS), (1, 40))
    example = (ids, torch.LongTensor([ids.shape[1]]), torch.LongTensor([0]), torch.tensor(1.0))
    original = MultiHeadAttention._get_relative_embeddings
    MultiHeadAttention._get_relative_embeddings = _traceable_relative_embeddings
    try:
        with torch.no_grad():
            ov_model = ov.convert_model(
                Infer(model).eval(),
                example_input=example,
                input=[
                    ("input_ids", ov.PartialShape([1, -1]), ov.Type.i64),
                    ("input_lengths", ov.PartialShape([1]), ov.Type.i64),
                    ("sid", ov.PartialShape([1]), ov.Type.i64),
                    ("length_scale", ov.PartialShape([]), ov.Type.f32),
                ],
            )
    finally:
        MultiHeadAttention._get_relative_embeddings = original
    ir_path.parent.mkdir(parents=True, exist_ok=True)
    with staged_model_file(str(ir_path)) as staged:
        ov.save_model(ov_model, staged, compress_to_fp16=False)


def ensure_ir(model_dir: str, hps) -> str:
    """The IR of the checkpoint in ``model_dir``, converted on first use."""
    ir_path = Path(model_dir) / IR_FILE
    if not (ir_path.is_file() and ir_path.with_suffix(".bin").is_file()):
        # Another instance may be converting it right now; the .xml lands
        # after its .bin (staged), so the check above never sees half.
        with shared_model_lock(str(ir_path)):
            if not (ir_path.is_file() and ir_path.with_suffix(".bin").is_file()):
                logger.info("Converting the Malaya checkpoint to OpenVINO IR: %s", ir_path)
                _export(model_dir, hps, ir_path)
    return str(ir_path)


class OVMalaya:
    """The compiled IR; one call at a time (the worker's lock)."""

    def __init__(self, ir_path: str, device: str):
        self.compiled = ov.Core().compile_model(ir_path, device, openvino_pinned_cpu_config())
        self.device = device

    def __call__(self, ids: list[int], speaker_id: int, length_scale: float) -> np.ndarray:
        result = self.compiled({
            "input_ids": np.asarray([ids], dtype=np.int64),
            "input_lengths": np.asarray([len(ids)], dtype=np.int64),
            "sid": np.asarray([speaker_id], dtype=np.int64),
            "length_scale": np.asarray(length_scale, dtype=np.float32),
        })
        return np.asarray(result[0][0], dtype=np.float32)
