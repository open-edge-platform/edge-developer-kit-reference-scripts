# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Pocket TTS on OpenVINO: ``flow_lm.xml`` is one FlowLM step (the next 80 ms latent; K/V caches as
OpenVINO state; int8 weights, >2x faster on CPU), ``mimi_decoder.xml`` decodes a chunk of latents to
24 kHz audio. Text embedding and latent projection are numpy lookups (``tables.npz``); voice prompts
are Mimi-encoded once. Core Ultra 9 285K: 18x real time vs 8x PyTorch CPU, 7x on an Arc Pro B60.
"""

from __future__ import annotations

import json
import math
from functools import partial
from pathlib import Path

import numpy as np
import openvino as ov

from worker_common import get_logger, openvino_compile_config, shared_model_lock, staged_model_file

logger = get_logger(__name__)

#: Bumped when the export changes, so an older one is redone.
EXPORT_VERSION = 1
EXPORT_MARKER = "export.json"


def _flow_lm_step_module(flow_lm):
    import torch
    import torch.nn.functional as F
    from pocket_tts.models.flow_lm import lsd_decode
    from pocket_tts.modules.rope import apply_rope

    class FlowLMStep(torch.nn.Module):
        """FlowLMModel.forward for one call, K/V caches as explicit inputs/outputs."""

        def __init__(self):
            super().__init__()
            self.fl = flow_lm
            attn = flow_lm.transformer.layers[0].self_attn
            self.heads, self.head_dim = attn.num_heads, attn.dim_per_head

        def forward(self, x, noise, *past):
            b, t, _ = x.shape
            offset = past[0].shape[2]
            q_pos = torch.arange(t, dtype=torch.float32) + offset
            k_pos = torch.arange(t + offset, dtype=torch.float32)
            mask = (k_pos[None, :] <= q_pos[:, None])[None, None]
            h = x
            presents = []
            for i, layer in enumerate(self.fl.transformer.layers):
                attn = layer.self_attn
                qkv = attn.in_proj(layer.norm1(h)).view(b, t, 3, self.heads, self.head_dim)
                q, k, v = torch.unbind(qkv, dim=2)
                q, k = apply_rope(q, k, offset, attn.rope.max_period)
                k = torch.cat([past[2 * i], k.transpose(1, 2)], dim=2)
                v = torch.cat([past[2 * i + 1], v.transpose(1, 2)], dim=2)
                presents += [k, v]
                o = F.scaled_dot_product_attention(q.transpose(1, 2), k, v, mask)
                o = attn.out_proj(o.transpose(1, 2).reshape(b, t, self.heads * self.head_dim))
                h = layer._ff_block(h + layer.layer_scale_1(o))
            last = self.fl.out_norm(h)[:, -1]
            latent = lsd_decode(partial(self.fl.flow_net, last), noise, 1)
            return (latent, self.fl.out_eos(last), *presents)

    return FlowLMStep().eval()


def _mimi_decode_module(tts):
    import torch

    class MimiDecode(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.mimi = tts.mimi
            self.register_buffer("emb_std", tts.flow_lm.emb_std.clone())
            self.register_buffer("emb_mean", tts.flow_lm.emb_mean.clone())

        def forward(self, latents):
            z = latents * self.emb_std + self.emb_mean
            emb = self.mimi.upsample(self.mimi.quantizer(z.transpose(-1, -2)), None)
            (emb,) = self.mimi.decoder_transformer(emb, None)
            return self.mimi.decoder(emb, None)[:, 0]

    return MimiDecode().eval()


def _stateless_convtr(self, x, mimi_state):
    # StreamingConvTranspose1d from a fresh (zero) state, which is what decoding
    # a whole chunk at once starts from: the overlap tail is dropped.
    y = self.convtr(x)
    tail = self._kernel_size - self._stride
    return y[..., :-tail] if tail > 0 else y


def _traced_causal_mask(t, context, device):
    # pocket-tts caches this mask at module level, which a trace would freeze
    # at the example's length; built from the traced length instead.
    import torch
    from pocket_tts.modules.attention import _build_attention_mask

    pos = torch.arange(t, device=device).view(1, -1)
    return _build_attention_mask(pos, pos, context)


def _save(model: ov.Model, path: Path) -> None:
    with staged_model_file(str(path)) as staged:
        ov.save_model(model, staged, compress_to_fp16=False)


def _export(config_path: str, voices: dict[str, str], out_dir: Path) -> None:
    import nncf
    import torch
    from openvino._offline_transformations import apply_make_stateful_transformation
    import pocket_tts.modules.transformer as transformer_module
    from pocket_tts import TTSModel
    from pocket_tts.data.audio import audio_read
    from pocket_tts.data.audio_utils import convert_audio
    from pocket_tts.modules.conv import StreamingConvTranspose1d

    tts = TTSModel.load_model(config=config_path)
    fl = tts.flow_lm
    out_dir.mkdir(parents=True, exist_ok=True)

    step = _flow_lm_step_module(fl)
    layers = len(fl.transformer.layers)
    names_in, names_out = ["x", "noise"], ["latent", "eos_logit"]
    shapes = [ov.PartialShape([1, -1, fl.dim]), ov.PartialShape([1, fl.ldim])]
    example = [torch.randn(1, 5, fl.dim), torch.zeros(1, fl.ldim)]
    for i in range(layers):
        for kv in ("key", "value"):
            names_in.append(f"past_{kv}.{i}")
            names_out.append(f"present_{kv}.{i}")
            shapes.append(ov.PartialShape([1, step.heads, -1, step.head_dim]))
            example.append(torch.zeros(1, step.heads, 3, step.head_dim))
    with torch.no_grad():
        flow = ov.convert_model(step, example_input=tuple(example), input=shapes)
    for port, name in zip(flow.inputs, names_in):
        port.get_tensor().set_names({name})
    for port, name in zip(flow.outputs, names_out):
        port.get_tensor().set_names({name})
    apply_make_stateful_transformation(
        flow, {f"past_{kv}.{i}": f"present_{kv}.{i}" for i in range(layers) for kv in ("key", "value")}
    )
    _save(nncf.compress_weights(flow, mode=nncf.CompressWeightsMode.INT8_ASYM), out_dir / "flow_lm.xml")

    patched = StreamingConvTranspose1d.forward, transformer_module._cached_causal_mask
    StreamingConvTranspose1d.forward = _stateless_convtr
    transformer_module._cached_causal_mask = _traced_causal_mask
    try:
        with torch.no_grad():
            mimi = ov.convert_model(
                _mimi_decode_module(tts),
                example_input=(torch.randn(1, 7, fl.ldim),),
                input=[ov.PartialShape([1, -1, fl.ldim])],
            )
    finally:
        StreamingConvTranspose1d.forward, transformer_module._cached_causal_mask = patched
    mimi.inputs[0].get_tensor().set_names({"latents"})
    mimi.outputs[0].get_tensor().set_names({"audio"})
    _save(mimi, out_dir / "mimi_decoder.xml")

    with staged_model_file(str(out_dir / "tables.npz")) as staged:
        with open(staged, "wb") as f:
            np.savez(
                f,
                text_emb=fl.conditioner.embed.weight.detach().numpy(),
                input_linear=fl.input_linear.weight.detach().numpy().T.copy(),
                bos_emb=fl.bos_emb.detach().numpy(),
            )

    # The voice prompts as the FlowLM sees them (TTSModel.get_state_for_audio_prompt
    # before it runs the transformer): Mimi-encoded, projected, after the BOS.
    (out_dir / "voices").mkdir(exist_ok=True)
    for voice_id, audio_path in voices.items():
        audio, sample_rate = audio_read(Path(audio_path))
        audio = convert_audio(audio, sample_rate, tts.config.mimi.sample_rate, 1)
        with torch.no_grad():
            prompt = tts._encode_audio(audio.unsqueeze(0))
            if fl.insert_bos_before_voice:
                prompt = torch.cat([fl.bos_before_voice, prompt], dim=1)
        with staged_model_file(str(out_dir / "voices" / f"{voice_id}.npy")) as staged:
            with open(staged, "wb") as f:
                np.save(f, prompt.numpy().astype(np.float32))

    (out_dir / EXPORT_MARKER).write_text(
        json.dumps({"version": EXPORT_VERSION, "voices": sorted(voices)}), encoding="utf-8"
    )


def is_exported(out_dir: Path, voices: dict[str, str]) -> bool:
    try:
        marker = json.loads((out_dir / EXPORT_MARKER).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return marker.get("version") == EXPORT_VERSION and set(marker.get("voices", [])) >= set(voices)


def ensure_export(config_path: str, voices: dict[str, str], out_dir: Path) -> None:
    """The IRs, tables and voice prompts in ``out_dir``, exported on first use."""
    if is_exported(out_dir, voices):
        return
    # Another instance may be exporting right now; the marker is written last.
    with shared_model_lock(str(out_dir / EXPORT_MARKER)):
        if not is_exported(out_dir, voices):
            logger.info("Exporting Pocket TTS to OpenVINO IR in %s", out_dir)
            _export(config_path, voices, out_dir)


class PocketTTS:
    """pocket-tts' generation loop on the exported IRs; one call at a time."""

    def __init__(self, config_path: str, out_dir: Path, voices: list[str], device: str):
        from pocket_tts.models.tts_model import TTSModel
        from pocket_tts.modules.text_conditioner import SentencePieceTokenizer
        from pocket_tts.utils.config import load_config

        self.config = load_config(config_path)
        lookup = self.config.flow_lm.lookup_table
        self.tokenizer = SentencePieceTokenizer(lookup.n_bins, lookup.tokenizer_path)
        self.sample_rate = self.config.mimi.sample_rate
        self.temperature = self.config.default_temperature
        # TTSModel's generation constants, read off the class so they follow the library.
        self.tokens_per_second = TTSModel._TOKENS_PER_SECOND_ESTIMATE
        self.padding_seconds = TTSModel._GEN_SECONDS_PADDING
        self.min_frames_before_eos = TTSModel._MIN_FRAMES_BEFORE_EOS

        core = ov.Core()
        # flow_lm keeps its KV cache in states, which an AUTO infer request
        # only has with AUTO's CPU fallbacks off (openvino_compile_config).
        config = openvino_compile_config(device)
        self.flow = core.compile_model(str(out_dir / "flow_lm.xml"), device, config)
        self.request = self.flow.create_infer_request()
        self.mimi = core.compile_model(str(out_dir / "mimi_decoder.xml"), device, config)
        tables = np.load(out_dir / "tables.npz")
        self.text_emb = tables["text_emb"]
        self.input_linear = tables["input_linear"]
        self.bos = (tables["bos_emb"] @ self.input_linear)[None, None].astype(np.float32)
        self.latent_dim = self.input_linear.shape[0]
        self.voices = {v: np.load(out_dir / "voices" / f"{v}.npy") for v in voices}
        self.rng = np.random.default_rng()

    def _step(self, x: np.ndarray, noise: np.ndarray) -> tuple[np.ndarray, float]:
        self.request.infer({"x": x, "noise": noise})
        latent = self.request.get_tensor("latent").data.copy()
        return latent, float(self.request.get_tensor("eos_logit").data[0, 0])

    def chunks(self, text: str) -> list[tuple[str, int]]:
        """``text`` as pocket-tts splits it (at most 50 tokens a chunk), each
        prepared for the model with its frames-after-end-of-speech guess."""
        from pocket_tts.models.text_chunking import prepare_text_prompt, split_into_best_sentences

        c = self.config
        options = (
            c.pad_with_spaces_for_short_inputs, c.remove_semicolons,
            c.append_terminal_punctuation, c.capitalize_first_letter, c.replace_characters,
        )
        out = []
        for chunk in split_into_best_sentences(self.tokenizer, text, 50, *options):
            prompt, guess = prepare_text_prompt(chunk, *options)
            frames = c.model_recommended_frames_after_eos
            out.append((prompt, frames if frames is not None else guess + 2))
        return out

    def generate(self, voice: str, text: str, frames_after_eos: int, eos_threshold: float) -> np.ndarray:
        """One chunk of speech (TTSModel._generate_audio_stream_short_text)."""
        tokens = self.tokenizer.encode(text)
        gen_seconds = len(tokens) / self.tokens_per_second + self.padding_seconds
        max_frames = math.ceil(gen_seconds * self.config.mimi.frame_rate)
        no_noise = np.zeros((1, self.latent_dim), np.float32)
        std = math.sqrt(self.temperature)

        self.request.reset_state()
        self._step(self.voices[voice], no_noise)
        self._step(self.text_emb[tokens][None].astype(np.float32), no_noise)
        x, latents, eos_step = self.bos, [], None
        for step in range(max_frames):
            noise = (self.rng.standard_normal((1, self.latent_dim)) * std).astype(np.float32)
            latent, eos_logit = self._step(x, noise)
            if eos_logit > eos_threshold and eos_step is None and step >= self.min_frames_before_eos:
                eos_step = step
            if eos_step is not None and step >= eos_step + frames_after_eos:
                break
            latents.append(latent)
            x = (latent @ self.input_linear)[None].astype(np.float32)
        if not latents:
            return np.zeros(0, np.float32)
        audio = self.mimi({"latents": np.stack(latents, axis=1)})[0]
        return np.asarray(audio[0], dtype=np.float32)
