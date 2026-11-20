# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""MERaLiON-3-3B-ASR rebuilt from transformers' Whisper encoder and Gemma-2, and its OpenVINO export.

The repository's ``modeling_meralion3.py`` (trust_remote_code, written for transformers 4.50) is not run:
the checkpoint is a Whisper-large-v3 encoder, a LayerNorm, a two-layer adapter that stacks 5 encoder
frames (30 s -> 1500 frames -> 300 decoder embeddings) and Gemma-2-2B, all loaded here from the
safetensors. Only the first start imports this module (torch, transformers); ``ov_meralion`` runs the
result without them.
"""

from __future__ import annotations

import gc
import json
import math
from pathlib import Path

import torch
from torch import nn


class _Adapter(nn.Module):
    """``MERaLiON3ASRSpeechAudioAdaperLarge`` without the projection branch (``speech_mlp_use_projection`` false)."""

    def __init__(self, d_in: int, d_out: int, scale: int):
        super().__init__()
        self.scale = scale
        self.mlp_adapter = nn.Sequential(nn.Linear(d_in * scale, d_in * 5), nn.SiLU(), nn.Dropout(0.0))
        self.out_proj = nn.Linear(d_in * 5, d_out)

    def forward(self, x):
        b, t, c = x.shape
        return self.out_proj(self.mlp_adapter(x.reshape(b, t // self.scale, c * self.scale)))


class Meralion(nn.Module):
    def __init__(self, config: dict):
        super().__init__()
        from transformers import Gemma2Config, Gemma2ForCausalLM, WhisperConfig
        from transformers.models.whisper.modeling_whisper import WhisperEncoder

        speech = WhisperConfig(**config["speech_config"])
        speech._attn_implementation = "sdpa"
        text = Gemma2Config(**config["text_config"])
        # Gemma-2's attention-logit soft-capping is applied by eager attention only.
        text._attn_implementation = "eager"
        self.speech_encoder = WhisperEncoder(speech)
        self.ln_speech = nn.LayerNorm(speech.d_model)
        self.speech_audio_adapter = _Adapter(speech.d_model, text.hidden_size, config["speech_mlp_scale_factor"])
        self.text_decoder = Gemma2ForCausalLM(text)

    def speech_embeds(self, mel: torch.Tensor) -> torch.Tensor:
        """``[1, 128, 3000]`` log-mel -> ``[1, 300, 2304]`` embeddings ready for the decoder.

        Gemma-2 scales its input embeddings by sqrt(hidden). transformers 4.50, which the model was
        trained with, scaled the spliced sequence (speech included); 5.x scales inside ``embed_tokens``,
        so the speech part is scaled here.
        """
        h = self.speech_encoder(mel).last_hidden_state
        e = self.speech_audio_adapter(self.ln_speech(h))
        return e * torch.tensor(self.text_decoder.config.hidden_size**0.5, dtype=e.dtype)


def load(model_dir: Path) -> Meralion:
    """The checkpoint in fp32 on the CPU (meta-initialised, so the random init never runs)."""
    from safetensors.torch import load_file
    from transformers.models.gemma2.modeling_gemma2 import Gemma2RotaryEmbedding

    config = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
    with torch.device("meta"):
        model = Meralion(config)
    state: dict[str, torch.Tensor] = {}
    for shard in sorted(model_dir.glob("model-*.safetensors")):
        state.update(load_file(str(shard)))
    missing, unexpected = model.load_state_dict(state, strict=False, assign=True)
    # The LM head is tied to the embeddings and not stored.
    missing = [k for k in missing if k != "text_decoder.lm_head.weight"]
    if missing or unexpected:
        raise RuntimeError(f"MERaLiON checkpoint mismatch: missing {missing[:5]}, unexpected {unexpected[:5]}")
    decoder = model.text_decoder
    decoder.lm_head.weight = decoder.model.embed_tokens.weight
    # Non-persistent buffers are not in the checkpoint: rebuild them off the meta device.
    decoder.model.rotary_emb = Gemma2RotaryEmbedding(config=decoder.config)
    decoder.model.embed_tokens.embed_scale = torch.tensor(decoder.config.hidden_size**0.5)
    return model.float().eval()


class DecoderStep(nn.Module):
    """One Gemma-2 call over ``input_ids`` then ``inputs_embeds``, with the K/V cache passed in and out.

    The export turns the cache into OpenVINO state. Only the last position's logits are computed, with
    Gemma-2's final soft-capping. The prompt goes in as (prefix ids, speech embeds), then (suffix ids, no
    embeds); each generated token as (that id, no embeds).
    """

    def __init__(self, lm):
        super().__init__()
        self.lm = lm
        cfg = lm.config
        self.cfg = cfg
        self.n_layers = cfg.num_hidden_layers
        self.heads, self.kv_heads, self.head_dim = cfg.num_attention_heads, cfg.num_key_value_heads, cfg.head_dim

    def forward(self, input_ids, inputs_embeds, *past):
        from transformers.models.gemma2.modeling_gemma2 import apply_rotary_pos_emb

        cfg, m = self.cfg, self.lm.model
        x = torch.cat([m.embed_tokens(input_ids), inputs_embeds], dim=1)
        t = x.shape[1]
        p = past[0].shape[2]
        pos = torch.arange(p, p + t, device=x.device).unsqueeze(0)
        cos, sin = m.rotary_emb(x, pos)
        mask = torch.where(torch.arange(p + t, device=x.device)[None, :] <= pos[0][:, None], 0.0, -math.inf).to(x.dtype)
        rep = self.heads // self.kv_heads
        presents = []
        # Every layer attends to the whole cache: a chunk's prompt plus answer stays far below Gemma-2's
        # 4096-token sliding window.
        for i, layer in enumerate(m.layers):
            a = layer.self_attn
            h = layer.input_layernorm(x)
            q = a.q_proj(h).view(1, t, self.heads, self.head_dim).transpose(1, 2)
            k = a.k_proj(h).view(1, t, self.kv_heads, self.head_dim).transpose(1, 2)
            v = a.v_proj(h).view(1, t, self.kv_heads, self.head_dim).transpose(1, 2)
            q, k = apply_rotary_pos_emb(q, k, cos, sin)
            k = torch.cat([past[2 * i], k], dim=2)
            v = torch.cat([past[2 * i + 1], v], dim=2)
            presents += [k, v]
            w = torch.matmul(q, k.repeat_interleave(rep, dim=1).transpose(2, 3)) * (cfg.query_pre_attn_scalar**-0.5)
            w = torch.tanh(w / cfg.attn_logit_softcapping) * cfg.attn_logit_softcapping
            w = torch.softmax((w + mask).float(), dim=-1).to(q.dtype)
            o = torch.matmul(w, v.repeat_interleave(rep, dim=1)).transpose(1, 2).reshape(1, t, -1)
            x = x + layer.post_attention_layernorm(a.o_proj(o))
            x = x + layer.post_feedforward_layernorm(layer.mlp(layer.pre_feedforward_layernorm(x)))
        logits = self.lm.lm_head(m.norm(x[:, -1:]))
        logits = torch.tanh(logits / cfg.final_logit_softcapping) * cfg.final_logit_softcapping
        return (logits, *presents)


class _Encoder(nn.Module):
    def __init__(self, model: Meralion):
        super().__init__()
        self.model = model

    def forward(self, mel):
        return self.model.speech_embeds(mel)


def export(model_dir: Path, out_dir: Path, precision: str, save) -> None:
    """Write ``encoder.xml`` (static 30 s input) and the stateful ``decoder.xml`` with ``precision`` weights.

    ``save(model, path)`` writes an IR so that no reader sees it half written. The encoder always gets
    int8 weights: on the CPU they matched fp32's transcripts, and they halve its size.
    """
    import nncf
    import openvino as ov
    from openvino._offline_transformations import apply_make_stateful_transformation

    model = load(model_dir)
    with torch.no_grad():
        encoder = ov.convert_model(
            _Encoder(model), example_input=(torch.randn(1, 128, 3000),), input=[ov.PartialShape([1, 128, 3000])]
        )
    encoder.inputs[0].get_tensor().set_names({"mel"})
    encoder.outputs[0].get_tensor().set_names({"speech_embeds"})
    save(nncf.compress_weights(encoder, mode=nncf.CompressWeightsMode.INT8_ASYM), out_dir / "encoder.xml")
    del encoder
    # Only the decoder from here on: drop the encoder's fp32 weights before the larger conversion.
    model.speech_encoder = model.speech_audio_adapter = None
    gc.collect()

    step = DecoderStep(model.text_decoder).eval()
    hidden, n_layers = step.cfg.hidden_size, step.n_layers
    names_in, names_out = ["input_ids", "inputs_embeds"], ["logits"]
    shapes = [ov.PartialShape([1, -1]), ov.PartialShape([1, -1, hidden])]
    example = [torch.zeros(1, 5, dtype=torch.long), torch.randn(1, 3, hidden)]
    for i in range(n_layers):
        for kv in ("key", "value"):
            names_in.append(f"past_{kv}.{i}")
            names_out.append(f"present_{kv}.{i}")
            shapes.append(ov.PartialShape([1, step.kv_heads, -1, step.head_dim]))
            example.append(torch.zeros(1, step.kv_heads, 7, step.head_dim))
    with torch.no_grad():
        decoder = ov.convert_model(step, example_input=tuple(example), input=shapes)
    del model, step
    gc.collect()
    for port, name in zip(decoder.inputs, names_in):
        port.get_tensor().set_names({name})
    for port, name in zip(decoder.outputs, names_out):
        port.get_tensor().set_names({name})
    apply_make_stateful_transformation(
        decoder, {f"past_{kv}.{i}": f"present_{kv}.{i}" for i in range(n_layers) for kv in ("key", "value")}
    )
    if precision == "int4":
        # Group-wise symmetric int4; NNCF keeps the tied embedding / LM head at int8.
        decoder = nncf.compress_weights(decoder, mode=nncf.CompressWeightsMode.INT4_SYM, group_size=128, ratio=1.0)
    else:
        decoder = nncf.compress_weights(decoder, mode=nncf.CompressWeightsMode.INT8_ASYM)
    save(decoder, out_dir / "decoder.xml")
