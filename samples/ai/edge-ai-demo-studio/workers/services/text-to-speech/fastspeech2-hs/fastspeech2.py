# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Fastspeech2_HS in PyTorch without ESPnet, for the OpenVINO export.

ESPnet won't install on Python 3.12 without a long tail of training deps (pyworld builds from source),
so these modules mirror ESPnet2's FastSpeech2 closely enough to load its ``model.pth`` unchanged;
HiFi-GAN is jik876's V1 generator with weight norm folded in at load. Output was checked with
Whisper, and the IR matches these modules within 0.0002 per sample.
"""
from __future__ import annotations

import json
import math

import torch
import torch.nn.functional as F
import yaml
from torch import nn


class LayerNorm(nn.LayerNorm):
    """ESPnet's LayerNorm: eps 1e-12, optionally over dim 1."""

    def __init__(self, nout: int, dim: int = -1):
        super().__init__(nout, eps=1e-12)
        self.dim = dim

    def forward(self, x):
        if self.dim == -1:
            return super().forward(x)
        return super().forward(x.transpose(self.dim, -1)).transpose(self.dim, -1)


class ScaledPositionalEncoding(nn.Module):
    def __init__(self, d_model: int):
        super().__init__()
        self.d_model = d_model
        self.alpha = nn.Parameter(torch.tensor(1.0))

    def forward(self, x):
        t = x.shape[1]
        position = torch.arange(t, dtype=torch.float32, device=x.device).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, self.d_model, 2, dtype=torch.float32, device=x.device)
            * -(math.log(10000.0) / self.d_model)
        )
        pe = torch.stack([torch.sin(position * div_term), torch.cos(position * div_term)], dim=-1)
        return x + self.alpha * pe.reshape(1, t, self.d_model)


class MultiHeadedAttention(nn.Module):
    def __init__(self, n_head: int, n_feat: int):
        super().__init__()
        self.d_k = n_feat // n_head
        self.h = n_head
        self.linear_q = nn.Linear(n_feat, n_feat)
        self.linear_k = nn.Linear(n_feat, n_feat)
        self.linear_v = nn.Linear(n_feat, n_feat)
        self.linear_out = nn.Linear(n_feat, n_feat)

    def forward(self, x):
        b = x.shape[0]
        q = self.linear_q(x).view(b, -1, self.h, self.d_k).transpose(1, 2)
        k = self.linear_k(x).view(b, -1, self.h, self.d_k).transpose(1, 2)
        v = self.linear_v(x).view(b, -1, self.h, self.d_k).transpose(1, 2)
        attn = torch.softmax(torch.matmul(q, k.transpose(-2, -1)) / math.sqrt(self.d_k), dim=-1)
        out = torch.matmul(attn, v).transpose(1, 2).reshape(b, -1, self.h * self.d_k)
        return self.linear_out(out)


class MultiLayeredConv1d(nn.Module):
    def __init__(self, in_chans: int, hidden_chans: int, kernel_size: int):
        super().__init__()
        pad = (kernel_size - 1) // 2
        self.w_1 = nn.Conv1d(in_chans, hidden_chans, kernel_size, padding=pad)
        self.w_2 = nn.Conv1d(hidden_chans, in_chans, kernel_size, padding=pad)

    def forward(self, x):
        x = torch.relu(self.w_1(x.transpose(-1, 1)))
        return self.w_2(x).transpose(-1, 1)


class EncoderLayer(nn.Module):
    def __init__(self, size: int, heads: int, units: int, kernel: int):
        super().__init__()
        self.self_attn = MultiHeadedAttention(heads, size)
        self.feed_forward = MultiLayeredConv1d(size, units, kernel)
        self.norm1 = LayerNorm(size)
        self.norm2 = LayerNorm(size)

    def forward(self, x):
        x = x + self.self_attn(self.norm1(x))
        return x + self.feed_forward(self.norm2(x))


class Encoder(nn.Module):
    def __init__(self, idim: int | None, adim: int, heads: int, units: int, layers: int, kernel: int):
        super().__init__()
        if idim is None:  # the decoder: positional encoding only
            self.embed = nn.Sequential(ScaledPositionalEncoding(adim))
        else:
            self.embed = nn.Sequential(nn.Embedding(idim, adim, padding_idx=0), ScaledPositionalEncoding(adim))
        self.encoders = nn.ModuleList(EncoderLayer(adim, heads, units, kernel) for _ in range(layers))
        self.after_norm = LayerNorm(adim)

    def forward(self, x):
        x = self.embed(x)
        for layer in self.encoders:
            x = layer(x)
        return self.after_norm(x)


class VariancePredictor(nn.Module):
    def __init__(self, idim: int, n_layers: int, n_chans: int, kernel_size: int):
        super().__init__()
        self.conv = nn.ModuleList()
        for i in range(n_layers):
            self.conv.append(nn.Sequential(
                nn.Conv1d(idim if i == 0 else n_chans, n_chans, kernel_size, padding=(kernel_size - 1) // 2),
                nn.ReLU(),
                LayerNorm(n_chans, dim=1),
                nn.Identity(),
            ))
        self.linear = nn.Linear(n_chans, 1)

    def forward(self, xs):
        xs = xs.transpose(1, -1)
        for f in self.conv:
            xs = f(xs)
        return self.linear(xs.transpose(1, -1))  # (B, T, 1)


class Postnet(nn.Module):
    def __init__(self, odim: int, n_layers: int, n_chans: int, n_filts: int):
        super().__init__()
        self.postnet = nn.ModuleList()
        pad = (n_filts - 1) // 2
        for i in range(n_layers):
            ichans = odim if i == 0 else n_chans
            ochans = odim if i == n_layers - 1 else n_chans
            layers = [nn.Conv1d(ichans, ochans, n_filts, padding=pad, bias=False), nn.BatchNorm1d(ochans)]
            if i != n_layers - 1:
                layers.append(nn.Tanh())
            self.postnet.append(nn.Sequential(*layers))

    def forward(self, xs):
        for f in self.postnet:
            xs = f(xs)
        return xs


def length_regulate(hs: torch.Tensor, ds: torch.Tensor) -> torch.Tensor:
    """hs (1, T, D) repeated ds (T,) times each, without repeat_interleave
    (data-dependent repeats do not convert to OpenVINO)."""
    ds = torch.where(ds.sum() == 0, torch.ones_like(ds), ds)
    ends = torch.cumsum(ds, dim=0)
    frames = torch.arange(ends[-1], device=hs.device)
    index = (frames.unsqueeze(1) >= ends.unsqueeze(0)).sum(dim=1)
    return hs[:, index]


class FastSpeech2(nn.Module):
    def __init__(self, idim: int, odim: int, conf: dict):
        super().__init__()
        adim = conf["adim"]
        self.eos = idim - 1
        self.encoder = Encoder(idim, adim, conf["aheads"], conf["eunits"], conf["elayers"], conf["positionwise_conv_kernel_size"])
        self.duration_predictor = VariancePredictor(adim, conf["duration_predictor_layers"], conf["duration_predictor_chans"], conf["duration_predictor_kernel_size"])
        self.pitch_predictor = VariancePredictor(adim, conf["pitch_predictor_layers"], conf["pitch_predictor_chans"], conf["pitch_predictor_kernel_size"])
        self.pitch_embed = nn.Sequential(nn.Conv1d(1, adim, conf["pitch_embed_kernel_size"], padding=(conf["pitch_embed_kernel_size"] - 1) // 2))
        self.energy_predictor = VariancePredictor(adim, conf["energy_predictor_layers"], conf["energy_predictor_chans"], conf["energy_predictor_kernel_size"])
        self.energy_embed = nn.Sequential(nn.Conv1d(1, adim, conf["energy_embed_kernel_size"], padding=(conf["energy_embed_kernel_size"] - 1) // 2))
        self.decoder = Encoder(None, adim, conf["aheads"], conf["dunits"], conf["dlayers"], conf["positionwise_conv_kernel_size"])
        self.feat_out = nn.Linear(adim, odim)
        self.postnet = Postnet(odim, conf["postnet_layers"], conf["postnet_chans"], conf["postnet_filts"])

    def forward(self, tokens: torch.Tensor, alpha: torch.Tensor) -> torch.Tensor:
        """tokens (1, T) without eos -> normalized mel (1, T_feats, odim)."""
        xs = F.pad(tokens, [0, 1], "constant", self.eos)
        hs = self.encoder(xs)
        p_outs = self.pitch_predictor(hs)
        e_outs = self.energy_predictor(hs)
        d = self.duration_predictor(hs)[0, :, 0]
        ds = torch.clamp(torch.round(d.exp() - 1.0), min=0)
        ds = torch.round(ds * alpha).long()
        hs = hs + self.energy_embed(e_outs.transpose(1, 2)).transpose(1, 2) + self.pitch_embed(p_outs.transpose(1, 2)).transpose(1, 2)
        hs = length_regulate(hs, ds)
        zs = self.decoder(hs)
        before = self.feat_out(zs)
        return before + self.postnet(before.transpose(1, 2)).transpose(1, 2)


LRELU_SLOPE = 0.1


def _padding(k: int, d: int = 1) -> int:
    return (k * d - d) // 2


class ResBlock1(nn.Module):
    def __init__(self, ch: int, k: int, dilation):
        super().__init__()
        self.convs1 = nn.ModuleList(nn.Conv1d(ch, ch, k, 1, dilation=d, padding=_padding(k, d)) for d in dilation)
        self.convs2 = nn.ModuleList(nn.Conv1d(ch, ch, k, 1, dilation=1, padding=_padding(k)) for _ in dilation)

    def forward(self, x):
        for c1, c2 in zip(self.convs1, self.convs2):
            x = c2(F.leaky_relu(c1(F.leaky_relu(x, LRELU_SLOPE)), LRELU_SLOPE)) + x
        return x


class HiFiGAN(nn.Module):
    def __init__(self, h: dict):
        super().__init__()
        assert str(h["resblock"]) == "1"
        c0 = h["upsample_initial_channel"]
        self.num_kernels = len(h["resblock_kernel_sizes"])
        self.conv_pre = nn.Conv1d(h["num_mels"], c0, 7, 1, padding=3)
        self.ups = nn.ModuleList(
            nn.ConvTranspose1d(c0 // 2**i, c0 // 2**(i + 1), k, u, padding=(k - u) // 2)
            for i, (u, k) in enumerate(zip(h["upsample_rates"], h["upsample_kernel_sizes"]))
        )
        self.resblocks = nn.ModuleList()
        for i in range(len(self.ups)):
            ch = c0 // 2**(i + 1)
            for k, d in zip(h["resblock_kernel_sizes"], h["resblock_dilation_sizes"]):
                self.resblocks.append(ResBlock1(ch, k, d))
        self.conv_post = nn.Conv1d(ch, 1, 7, 1, padding=3)

    def forward(self, x):
        x = self.conv_pre(x)
        for i, up in enumerate(self.ups):
            x = up(F.leaky_relu(x, LRELU_SLOPE))
            xs = self.resblocks[i * self.num_kernels](x)
            for j in range(1, self.num_kernels):
                xs = xs + self.resblocks[i * self.num_kernels + j](x)
            x = xs / self.num_kernels
        return torch.tanh(self.conv_post(F.leaky_relu(x)))


def _fold_weight_norm(sd: dict) -> dict:
    out = {}
    for k, v in sd.items():
        if k.endswith(".weight_g"):
            base = k[: -len("_g")]
            g, w = v, sd[base + "_v"]
            norm = w.norm(dim=tuple(range(1, w.dim())), keepdim=True)
            out[base] = g * w / norm
        elif not k.endswith(".weight_v"):
            out[k] = v
    return out


class TTS(nn.Module):
    """Tokens and a duration scale (1 / speed) -> 22.05 kHz waveform in [-1, 1]."""

    MEL_SCALE = 2.3262  # inference.py: ESPnet log10 mel -> HiFi-GAN natural-log mel

    def __init__(self, model_dir: str, vocoder_dir: str):
        super().__init__()
        with open(f"{model_dir}/config.yaml", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        self.token_list: list[str] = cfg["token_list"]
        odim = cfg["feats_extract_conf"]["n_mels"]
        self.sample_rate = cfg["feats_extract_conf"]["fs"]
        self.fs2 = FastSpeech2(len(self.token_list), odim, cfg["tts_conf"])
        sd = torch.load(f"{model_dir}/model.pth", map_location="cpu", weights_only=True)
        self.fs2.load_state_dict({k[4:]: v for k, v in sd.items() if k.startswith("tts.")})
        self.register_buffer("mel_mean", sd["normalize.mean"].float())
        self.register_buffer("mel_std", sd["normalize.std"].float())
        with open(f"{vocoder_dir}/config.json", encoding="utf-8") as f:
            h = json.load(f)
        self.vocoder = HiFiGAN(h)
        g = torch.load(f"{vocoder_dir}/generator", map_location="cpu", weights_only=True)["generator"]
        self.vocoder.load_state_dict(_fold_weight_norm(g))
        self.eval()

    def forward(self, tokens: torch.Tensor, alpha: torch.Tensor) -> torch.Tensor:
        mel = self.fs2(tokens, alpha)
        mel = (mel * self.mel_std + self.mel_mean) * self.MEL_SCALE
        return self.vocoder(mel.transpose(1, 2))[:, 0]
