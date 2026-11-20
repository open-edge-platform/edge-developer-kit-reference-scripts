# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Runs the Wan networks with PyTorch, in bf16 on an Intel GPU (``xpu``) or on the CPU."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterator, Optional

import torch

logger = logging.getLogger(__name__)

GIB = 2**30
#: Room left on the device for activations: a 5B step at 1280x704x121 peaks near this.
ACTIVATION_HEADROOM = 6 * GIB


def _module_bytes(module: torch.nn.Module) -> int:
    return sum(p.numel() * p.element_size() for p in module.parameters())


def _sync(device: torch.device) -> None:
    if device.type == "xpu":
        torch.xpu.synchronize()


class TorchBackend:
    """``text_encoder`` placement: ``device`` (kept there), ``cpu`` (run on the CPU), ``swap`` (kept
    in RAM, moved to the device for each new prompt), or ``auto``: ``device`` when every network fits
    beside ``ACTIVATION_HEADROOM``, else ``cpu``. On an Arc Pro B60 a new prompt costs 0.03 s on the
    device, 4 s on a Core Ultra 9 285K, and 6 s to swap the 11 GiB encoder in and out.

    ``experts``: the transformers' subfolders (``Preset.experts``). Wan2.2 A14B's two are 27 GiB each
    in bf16: both stay on the device when they fit beside ``ACTIVATION_HEADROOM``, else the idle one
    waits in RAM and they trade places where the denoising loop switches (twice a video)."""

    def __init__(
        self,
        transformer_dir: Path,
        base_dir: Path,
        text_encoder_dir: Path,
        device: str = "xpu",
        text_encoder: str = "auto",
        vae_dtype: torch.dtype = torch.bfloat16,
        tiny_decoder: Optional[Path] = None,
        family: str = "wan2.1",
        tiny_encoder: Optional[Path] = None,
        experts: tuple[str, ...] = ("transformer",),
    ):
        import json

        from diffusers import AutoencoderKLWan, WanTransformer3DModel, WanVACETransformer3DModel
        from transformers import UMT5EncoderModel

        self.device = torch.device(device)
        self.dtype = torch.bfloat16
        self.vae_dtype = vae_dtype
        self.text_model = UMT5EncoderModel.from_pretrained(
            text_encoder_dir / "text_encoder", torch_dtype=self.dtype
        ).eval()
        config = json.loads((transformer_dir / "transformer" / "config.json").read_text(encoding="utf-8"))
        self.vace = config.get("_class_name") == "WanVACETransformer3DModel"
        model_class = WanVACETransformer3DModel if self.vace else WanTransformer3DModel
        self.dits = [
            model_class.from_pretrained(transformer_dir / subfolder, torch_dtype=self.dtype).eval()
            for subfolder in experts
        ]
        self.dit = self.dits[0]
        self.vae = AutoencoderKLWan.from_pretrained(base_dir / "vae", torch_dtype=vae_dtype).eval()

        sizes = [_module_bytes(dit) for dit in self.dits]
        total = torch.xpu.get_device_properties(self.device).total_memory if self.device.type == "xpu" else None
        if total is not None and max(sizes) + _module_bytes(self.vae) > total:
            raise RuntimeError(
                f"A transformer of this model is {max(sizes) / GIB:.1f} GiB in bf16 and {device} has "
                f"{total / GIB:.1f} GiB; run it on OpenVINO at int8 instead"
            )
        self.keep_all_experts = total is None or sum(sizes) + _module_bytes(self.vae) + ACTIVATION_HEADROOM <= total
        #: The transformer on the device when they take turns.
        self._active = 0
        for i, dit in enumerate(self.dits):
            if self.keep_all_experts or i == self._active:
                dit.to(self.device)
        self.vae.to(self.device)
        # Decodes instead of the VAE when given; the VAE still encodes the first frame of an
        # image-to-video request.
        self.tiny = None
        if tiny_decoder is not None:
            from .tiny_vae import TinyWanDecoder

            self.tiny = TinyWanDecoder.from_safetensors(tiny_decoder, family).to(self.device, torch.float16)
        # Encodes VACE's control videos (the full VAE's encoder still encodes images).
        self.tiny_encoder = None
        if tiny_encoder is not None:
            from .tiny_vae import TinyWanEncoder

            self.tiny_encoder = TinyWanEncoder.from_safetensors(tiny_encoder, family).to(self.device, torch.float16)
        if text_encoder == "auto":
            text_encoder = "device"
            if total is not None:
                resident = sum(sizes) if self.keep_all_experts else max(sizes)
                needed = resident + _module_bytes(self.vae) + _module_bytes(self.text_model)
                if needed + ACTIVATION_HEADROOM > total:
                    text_encoder = "cpu"
        self.text_placement = text_encoder
        if text_encoder == "device":
            self.text_model.to(self.device)
        logger.info(
            "PyTorch backend on %s: %s %.1f GiB, VAE %.1f GiB (%s), text encoder %.1f GiB (%s), %s decoder",
            self.device,
            "transformer" if len(sizes) == 1
            else f"{len(sizes)} transformers ({'all on the device' if self.keep_all_experts else 'taking turns'}) of",
            max(sizes) / GIB,
            _module_bytes(self.vae) / GIB,
            str(vae_dtype).removeprefix("torch."),
            _module_bytes(self.text_model) / GIB,
            text_encoder,
            "tiny" if self.tiny is not None else "VAE",
        )

    @property
    def execution_device(self) -> str:
        if self.device.type == "xpu":
            return torch.xpu.get_device_name(self.device)
        return "CPU"

    def prepare(self, width: int, height: int, latent_frames: int) -> None:
        pass

    def release(self) -> None:
        pass

    @torch.inference_mode()
    def encode_text(self, input_ids: torch.Tensor) -> torch.Tensor:
        if self.text_placement == "cpu":
            return self.text_model(input_ids).last_hidden_state.float()
        if self.text_placement == "swap":
            self.text_model.to(self.device)
        try:
            out = self.text_model(input_ids.to(self.device)).last_hidden_state.float()
            _sync(self.device)
            return out
        finally:
            if self.text_placement == "swap":
                self.text_model.to("cpu")
                if self.device.type == "xpu":
                    torch.xpu.empty_cache()

    @torch.inference_mode()
    def transformer(
        self,
        latents: torch.Tensor,
        timestep: torch.Tensor,
        context: torch.Tensor,
        control: Optional[torch.Tensor] = None,
        control_scale: float = 1.0,
        expert: int = 0,
    ) -> torch.Tensor:
        if expert != self._active and not self.keep_all_experts:
            self.dits[self._active].to("cpu")
            if self.device.type == "xpu":
                torch.xpu.empty_cache()
            self.dits[expert].to(self.device)
            self._active = expert
        dit = self.dits[expert]
        extra = {}
        if self.vace:
            layers = len(self.dit.config.vace_layers)
            extra = {
                "control_hidden_states": control.to(self.dtype),
                "control_hidden_states_scale": torch.full((layers,), control_scale, dtype=self.dtype, device=self.device),
            }
        out = dit(
            hidden_states=latents.to(self.dtype),
            timestep=timestep,
            encoder_hidden_states=context.to(self.dtype),
            return_dict=False,
            **extra,
        )[0].float()
        # XPU work is queued, not done: without a sync the step reported done is still running, and
        # its seconds land on the next phase (the progress bar and estimate would lag a whole step).
        _sync(self.device)
        return out

    @torch.inference_mode()
    def vae_encode(self, pixels: torch.Tensor) -> torch.Tensor:
        return self.vae.encode(pixels.to(self.vae_dtype)).latent_dist.mode().float()

    @torch.inference_mode()
    def encode_control(self, video: torch.Tensor) -> torch.Tensor:
        if self.tiny_encoder is None:
            return self.vae.encode(video.to(self.device, self.vae_dtype)).latent_dist.mode().float()
        return self.tiny_encoder.encode_video(video.to(self.device, torch.float16)).float()

    @torch.inference_mode()
    def vae_decode_frames(self, latents: torch.Tensor) -> Iterator[torch.Tensor]:
        if self.tiny is not None:
            yield from self.tiny.decode_frames(latents.to(torch.float16))
            return
        # diffusers' AutoencoderKLWan._decode, one latent frame per call, so each chunk is handed on
        # (and a cancel lands) before the next is decoded.
        from diffusers.models.autoencoders.autoencoder_kl_wan import unpatchify

        vae = self.vae
        vae.clear_cache()
        try:
            x = vae.post_quant_conv(latents.to(self.vae_dtype))
            for i in range(x.shape[2]):
                vae._conv_idx = [0]
                out = vae.decoder(
                    x[:, :, i : i + 1], feat_cache=vae._feat_map, feat_idx=vae._conv_idx, first_chunk=i == 0
                )
                if vae.config.patch_size is not None:
                    out = unpatchify(out, patch_size=vae.config.patch_size)
                yield out.clamp(-1, 1)
        finally:
            vae.clear_cache()
