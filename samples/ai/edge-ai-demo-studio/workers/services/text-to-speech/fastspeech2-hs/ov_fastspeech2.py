# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Fastspeech2_HS voices on OpenVINO: each acoustic model + vocoder becomes one IR (tokens and a
duration scale in, 22.05 kHz audio out). On a Core Ultra 9 285K the IR runs at 9x real time on CPU,
vs 4-7x for PyTorch on CPU and 4-5x on an Arc Pro B60 (which rebuilds kernels per input length).
"""

from pathlib import Path

import numpy as np
import openvino as ov
import yaml

from worker_common import get_logger, openvino_pinned_cpu_config, shared_model_lock, staged_model_file

logger = get_logger(__name__)

# Phone dictionary entries written with glyphs a model's token list lacks
# (U+0909, U+0929, U+0931), and the symbol the models learned for that phone.
_GLYPH_FALLBACK = {"\u0909": "\u0B89", "\u0929": "\u0928", "\u0931": "\u0930"}


def _export(model_dir: Path, vocoder_dir: Path, ir_path: Path) -> None:
    import torch

    from fastspeech2 import TTS

    tts = TTS(str(model_dir), str(vocoder_dir))
    tokens = torch.randint(2, len(tts.token_list) - 1, (1, 30))
    with torch.no_grad():
        model = ov.convert_model(
            tts,
            example_input=(tokens, torch.tensor(1.0)),
            input=[ov.PartialShape([1, -1]), ov.PartialShape([])],
        )
    model.inputs[0].get_tensor().set_names({"tokens"})
    model.inputs[1].get_tensor().set_names({"alpha"})
    model.outputs[0].get_tensor().set_names({"audio"})
    ir_path.parent.mkdir(parents=True, exist_ok=True)
    with staged_model_file(str(ir_path)) as staged:
        ov.save_model(model, staged, compress_to_fp16=False)


def ensure_ir(model_dir: Path, vocoder_dir: Path, ir_path: Path) -> Path:
    """The IR of one voice, converted on first use."""
    if not (ir_path.is_file() and ir_path.with_suffix(".bin").is_file()):
        # Another instance may be converting it right now; the .xml lands
        # after its .bin (staged), so the check above never sees half.
        with shared_model_lock(str(ir_path)):
            if not (ir_path.is_file() and ir_path.with_suffix(".bin").is_file()):
                logger.info("Converting %s to OpenVINO IR: %s", model_dir, ir_path)
                _export(model_dir, vocoder_dir, ir_path)
    return ir_path


class Voice:
    """One voice's compiled IR and the token list of its model."""

    def __init__(self, ir_path: Path, model_dir: Path, device: str):
        with open(model_dir / "config.yaml", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        self.token_list: list[str] = config["token_list"]
        self.sample_rate: int = config["feats_extract_conf"]["fs"]
        self._ids = {token: i for i, token in enumerate(self.token_list)}
        self.compiled = ov.Core().compile_model(str(ir_path), device, openvino_pinned_cpu_config())

    def tokens(self, text: str) -> list[int]:
        """ESPnet's char tokenizer: one token per character, a space as
        <space>, which these token lists lack, so <unk> as in training."""
        ids, unk = self._ids, self._ids["<unk>"]
        out = []
        for c in text:
            c = "<space>" if c == " " else c
            if c not in ids:
                c = _GLYPH_FALLBACK.get(c, c)
            out.append(ids.get(c, unk))
        return out

    def __call__(self, text: str, alpha: float) -> np.ndarray:
        result = self.compiled({
            "tokens": np.asarray([self.tokens(text)], dtype=np.int64),
            "alpha": np.asarray(alpha, dtype=np.float32),
        })
        return np.asarray(result["audio"][0], dtype=np.float32)
