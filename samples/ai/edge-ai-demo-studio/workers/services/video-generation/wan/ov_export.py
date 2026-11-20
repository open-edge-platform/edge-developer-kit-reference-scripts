# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Converts a preset's networks to OpenVINO IR once, under ``models/video-generation``.

Neither optimum-intel nor OpenVINO GenAI export Wan (2026.2), so each network is traced with
``ov.convert_model`` as the OpenVINO notebooks ``wan2.1-text-to-video`` and
``wan2.2-text-image-to-video`` do. Videos are decoded by the tiny decoder (``tiny_vae``), exported
with each memory block's carried frame as an input and an output, so a video decodes chunk by chunk.
The official VAE's decoder is not exported: its causal 3-D convolutions run slowly on the GPU plugin
(see the README). The VAE encoder is, for the first frame of image-to-video.

What presets share is converted once: the UMT5-XXL text encoder (every preset), each family's VAE
encoder and tiny decoder. Layout::

    <root>/text-encoder/umt5-xxl/<precision>/text_encoder.xml
    <root>/transformer/<org>--<name>/<precision>/transformer.xml (and transformer_2.xml for A14B)
    <root>/vae/<family>/vae_encoder.xml, tiny_decoder.xml
"""

from __future__ import annotations

import gc
import logging
from contextlib import nullcontext
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, ContextManager, Optional

import torch

from .presets import Preset

logger = logging.getLogger(__name__)

PRECISIONS = ("fp16", "int8", "int4")


@dataclass(frozen=True)
class IRPaths:
    text_encoder: Path
    transformer: Path
    tiny_decoder: Path
    #: The first frame of image-to-video, or VACE's reference image.
    vae_encoder: Optional[Path]
    #: VACE's control videos.
    tiny_encoder: Optional[Path] = None
    #: Wan2.2 A14B's low-noise transformer.
    transformer_2: Optional[Path] = None

    @property
    def experts(self) -> list[Path]:
        """The transformers, in ``Preset.experts`` order."""
        return [p for p in (self.transformer, self.transformer_2) if p]

    def all(self) -> list[Path]:
        return [
            p
            for p in (
                self.text_encoder,
                self.transformer,
                self.transformer_2,
                self.tiny_decoder,
                self.vae_encoder,
                self.tiny_encoder,
            )
            if p
        ]


def ir_paths(preset: Preset, root: Path, precision: str) -> IRPaths:
    vae = root / "vae" / preset.family
    folder = root / "transformer" / preset.transformer_repo.replace("/", "--") / precision
    return IRPaths(
        text_encoder=root / "text-encoder" / "umt5-xxl" / precision / "text_encoder.xml",
        transformer=folder / "transformer.xml",
        tiny_decoder=vae / "tiny_decoder.xml",
        vae_encoder=vae / "vae_encoder.xml" if preset.image_to_video or preset.vace else None,
        tiny_encoder=vae / "tiny_encoder.xml" if preset.vace else None,
        transformer_2=folder / "transformer_2.xml" if len(preset.experts) > 1 else None,
    )


def _compress(ov_model, precision: str):
    if precision == "fp16":
        return ov_model
    import nncf

    if precision == "int8":
        return nncf.compress_weights(ov_model, mode=nncf.CompressWeightsMode.INT8_ASYM)
    # The Wan2.2 notebook's INT4 setting: every layer, groups of 64.
    return nncf.compress_weights(ov_model, mode=nncf.CompressWeightsMode.INT4_ASYM, group_size=64, ratio=1.0)


def _save(ov_model, path: Path) -> None:
    import openvino as ov

    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.stem + ".partial.xml")
    ov.save_model(ov_model, partial)
    # The .xml last: an .xml on disk means a complete model.
    partial.with_suffix(".bin").replace(path.with_suffix(".bin"))
    partial.replace(path)


def _clear_trace_cache() -> None:
    torch._C._jit_clear_class_registry()
    torch.jit._recursive.concrete_type_store = torch.jit._recursive.ConcreteTypeStore()
    torch.jit._state._clear_class_state()
    gc.collect()


def export_text_encoder(text_encoder_dir: Path, out: Path, precision: str) -> None:
    import openvino as ov
    from openvino.frontend.pytorch.patch_model import __make_16bit_traceable
    from transformers import UMT5EncoderModel

    logger.info("Converting the UMT5-XXL text encoder to OpenVINO (%s)", precision)
    model = UMT5EncoderModel.from_pretrained(text_encoder_dir / "text_encoder", torch_dtype=torch.bfloat16).eval()
    __make_16bit_traceable(model)
    with torch.no_grad():
        # Token ids only, any length: the pipeline sends the prompt's real tokens, no padding.
        ov_model = ov.convert_model(model, example_input={"input_ids": torch.ones((1, 16), dtype=torch.long)})
    del model
    _save(_compress(ov_model, precision), out)
    del ov_model
    _clear_trace_cache()


def export_transformer(
    preset: Preset, transformer_dir: Path, out: Path, precision: str, subfolder: str = "transformer"
) -> None:
    import openvino as ov
    from diffusers import WanTransformer3DModel, WanVACETransformer3DModel
    from openvino.frontend.pytorch.patch_model import __make_16bit_traceable
    from openvino.frontend.pytorch.ts_decoder import TorchScriptPythonDecoder

    logger.info("Converting the %s %s to OpenVINO (%s)", preset.label, subfolder, precision)
    model_class = WanVACETransformer3DModel if preset.vace else WanTransformer3DModel
    model = model_class.from_pretrained(transformer_dir / subfolder, torch_dtype=torch.bfloat16).eval()
    # A small example; every dimension stays dynamic.
    t, h, w = 3, 2 * 7, 2 * 9
    example = {
        "hidden_states": torch.ones([1, preset.z_dim, t, h, w]),
        "timestep": torch.full([1, t * h * w // 4] if preset.per_token_timesteps else [1], 500.0),
        "encoder_hidden_states": torch.ones([1, 512, 4096]),
    }
    if preset.vace:
        example["control_hidden_states"] = torch.ones([1, model.config.vace_in_channels, t, h, w])
        example["control_hidden_states_scale"] = torch.ones([len(model.config.vace_layers)])
    __make_16bit_traceable(model)
    decoder = TorchScriptPythonDecoder(model, example_input=example, trace_kwargs={"check_trace": False})
    with torch.no_grad():
        ov_model = ov.convert_model(decoder, example_input=example)
    # In this order; the timestep's traced name is a number otherwise.
    for port, name in zip(ov_model.inputs, example):
        port.get_tensor().set_names({name})
    if preset.vace:
        # Their sizes come from the model, not the video: pinned so a reshape can read them.
        ov_model.reshape(
            {
                ov_model.inputs[3]: ov.PartialShape([1, model.config.vace_in_channels, -1, -1, -1]),
                ov_model.inputs[4]: ov.PartialShape([len(model.config.vace_layers)]),
            }
        )
    del decoder, model
    _save(_compress(ov_model, precision), out)
    del ov_model
    _clear_trace_cache()


def export_vae_encoder(preset: Preset, base_dir: Path, out: Path) -> None:
    import openvino as ov
    from diffusers import AutoencoderKLWan

    logger.info("Converting the %s VAE encoder to OpenVINO", preset.family)
    vae = AutoencoderKLWan.from_pretrained(base_dir / "vae", torch_dtype=torch.float32).eval()

    class Encoder(torch.nn.Module):
        def __init__(self, vae):
            super().__init__()
            self.vae = vae

        def forward(self, x):
            return self.vae.encode(x, return_dict=False)[0].mode()

    s = preset.vae_scale_spatial
    with torch.no_grad():
        # One frame: the image an image-to-video request starts from.
        ov_model = ov.convert_model(Encoder(vae).eval(), example_input=torch.ones((1, 3, 1, 14 * s, 18 * s)))
    _save(ov_model, out)
    del ov_model, vae
    _clear_trace_cache()


def export_tiny_decoder(preset: Preset, weights: Path, out: Path) -> None:
    import openvino as ov

    from .tiny_vae import TinyWanDecoder

    logger.info("Converting the %s tiny decoder to OpenVINO", preset.family)
    model = TinyWanDecoder.from_safetensors(weights, preset.family)

    class Chunk(torch.nn.Module):
        """``(latents, *memory) -> (frames, *memory)``: one chunk, the carried frames explicit."""

        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, x, *memory):
            frames, carried = self.model(x, list(memory))
            return (frames, *carried)

    t, h, w = 2, 6, 8
    x = torch.randn(t, model.decoder[1].in_channels, h, w)
    with torch.no_grad():
        _, carried = model(x)
        memory = [torch.zeros_like(c) for c in carried]
        ov_model = ov.convert_model(Chunk(model).eval(), example_input=(x, *memory))
    for i, port in enumerate(ov_model.inputs):
        port.get_tensor().set_names({"latents" if i == 0 else f"memory.{i - 1}"})
    _save(ov_model, out)
    del ov_model, model
    _clear_trace_cache()


def export_tiny_encoder(preset: Preset, weights: Path, out: Path) -> None:
    import openvino as ov

    from .tiny_vae import TinyWanEncoder

    logger.info("Converting the %s tiny encoder to OpenVINO", preset.family)
    model = TinyWanEncoder.from_safetensors(weights, preset.family)

    class Chunk(torch.nn.Module):
        """``(frames, *memory) -> (latents, *memory)``: one chunk, the carried frames explicit."""

        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, x, *memory):
            latents, carried = self.model(x, list(memory))
            return (latents, *carried)

    x = torch.rand(8, 3, 64, 96)
    with torch.no_grad():
        _, carried = model(x)
        memory = [torch.zeros_like(c) for c in carried]
        ov_model = ov.convert_model(Chunk(model).eval(), example_input=(x, *memory))
    for i, port in enumerate(ov_model.inputs):
        port.get_tensor().set_names({"frames" if i == 0 else f"memory.{i - 1}"})
    _save(ov_model, out)
    del ov_model, model
    _clear_trace_cache()


def export_preset(
    preset: Preset,
    root: Path,
    precision: str,
    base_dir: Path,
    transformer_dir: Path,
    text_encoder_dir: Path,
    tiny_weights: Path,
    lock: Callable[[Path], ContextManager] = lambda path: nullcontext(),
) -> IRPaths:
    """Converts what is missing and returns the IR paths. ``lock(path)`` guards each conversion
    across processes (the worker passes ``shared_model_lock``)."""
    if precision not in PRECISIONS:
        raise ValueError(f"precision must be one of {', '.join(PRECISIONS)}")
    paths = ir_paths(preset, root, precision)
    steps = [
        (paths.text_encoder, lambda: export_text_encoder(text_encoder_dir, paths.text_encoder, precision)),
    ]
    for subfolder, path in zip(preset.experts, paths.experts):
        steps.append(
            (path, lambda s=subfolder, p=path: export_transformer(preset, transformer_dir, p, precision, s))
        )
    steps.append((paths.tiny_decoder, lambda: export_tiny_decoder(preset, tiny_weights, paths.tiny_decoder)))
    if paths.vae_encoder is not None:
        steps.append((paths.vae_encoder, lambda: export_vae_encoder(preset, base_dir, paths.vae_encoder)))
    if paths.tiny_encoder is not None:
        steps.append((paths.tiny_encoder, lambda: export_tiny_encoder(preset, tiny_weights, paths.tiny_encoder)))
    for path, export in steps:
        if not path.exists():
            with lock(path.parent):
                if not path.exists():
                    export()
    return paths
