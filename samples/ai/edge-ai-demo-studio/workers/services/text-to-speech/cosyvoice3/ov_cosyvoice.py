# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Fun-CosyVoice3-0.5B with its heavy parts on OpenVINO; upstream's code (vendored, unmodified) for the rest.

CosyVoice 3 is a Qwen2-0.5B speech-token LLM, a flow-matching DiT that turns tokens into a mel
spectrogram (10 Euler steps with classifier-free guidance), and the HiFT vocoder. Exported once:

- ``llm.xml``: one Qwen2 call (inputs_embeds -> last hidden state), K/V cache as OpenVINO state, int8.
- ``estimator.xml``: the DiT, read from the repository's ONNX (made for TensorRT).
- ``hift.xml``: HiFT from mel up to its iSTFT, always on the CPU (the Arc B60 GPU plugin fails to build one
  of its concats).

Placement and step count are chosen for real time on the device given (measured on a Core Ultra 9 285K):
the LLM stays on a discrete GPU, and otherwise runs on the CPU (12 ms a token there against 20 ms on the
integrated GPU); on a GPU the DiT runs at fixed lengths (128-frame buckets, padded with its own mask), as an
integrated GPU otherwise recompiles it for every new length. Off a discrete GPU the DiT also takes 5 Euler
steps instead of 10 and a voice without a transcript is cut to its first ~4 s at a pause (the DiT processes
the voice prompt with the speech), and the DiT computes in int8 (``estimator_int8.xml``, quantized on the
first start): 0.41x real time on the CPU becomes 1.46x. MERaLiON ASR still read every sentence back exactly;
the speaker similarity to the reference (CAM++ embeddings) fell from 0.69 to 0.61.

The speech-token head, sampling, the flow's token encoder, the iSTFT and the frontend (text normalisation,
the ONNX speech tokenizer and speaker encoder for voice prompts) stay in PyTorch / ONNX Runtime on the CPU.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import types
from pathlib import Path

import numpy as np
import openvino as ov

from model_downloader import fetch_snapshot
from worker_common import (
    get_logger,
    models_dir,
    openvino_compile_config,
    openvino_execution_device,
    shared_model_lock,
    staged_model_file,
)
from worker_common.audio import decode_to_pcm16
from worker_common.startup import startup_stage

logger = get_logger(__name__)

MODEL_ID = "cosyvoice3"
REPO = "FunAudioLLM/Fun-CosyVoice3-0.5B-2512"
REVISION = "29e01c4e8d000f4bcd70751be16fa94bf3d85a18"
ALLOW_PATTERNS = [
    "cosyvoice3.yaml",
    "llm.pt",
    "flow.pt",
    "hift.pt",
    "campplus.onnx",
    "speech_tokenizer_v3.onnx",
    "flow.decoder.estimator.fp32.onnx",
    "CosyVoice-BlankEN/*",
]
# The built-in voice: upstream's own sample speaker, a woman speaking Mandarin (median F0 ~250 Hz), the
# recording its examples clone, vendored from the repository at the pinned commit (Apache-2.0; the
# "cosyvoice-asset" source in workers/upstream.json), with upstream's transcript of it.
DEFAULT_VOICE = "zh_female"
DEFAULT_VOICE_RECORDING = Path(__file__).resolve().parent / "asset" / "zero_shot_prompt.wav"
DEFAULT_VOICE_TRANSCRIPT = "希望你以后能够做的比我还好呦。"
# The built-in voice before it: MERaLiON-OmniVoice-Hokkien-TTS's reference recording, under a licence the
# app no longer takes. Removed from voices/ when found unchanged, with the folder it was downloaded into.
RETIRED_VOICE = ("sg_female", "d27815b0a5a8a26bb64b4b1a80a4498286f1f1c6af131f1e6cd181edb2abed87")
# CosyVoice 3 expects its system prompt before the text it reads (and before a voice prompt's transcript).
SYSTEM_PROMPT = "You are a helpful assistant.<|endofprompt|>"
# Bumped when the export changes, so the next start redoes it.
EXPORT_VERSION = 1
# DiT lengths compiled on a GPU (mel frames, 50 a second), and the Euler steps per device kind. The
# buckets a ~4 s voice prompt plus up to ~6 s of speech need are compiled at startup, not on a request.
BUCKET_FRAMES = 128
STARTUP_BUCKETS = (256, 384, 512)
FLOW_STEPS = {"discrete": 10, "other": 5}
# A voice without a transcript is cut at the quietest 100 ms in this window (seconds).
PROMPT_CUT = (3.0, 4.5)
# Voices added through the API: the name is the file stem and the request's `voice`. The recording is
# stored as mono 24 kHz WAV (the model's rate), between these lengths in seconds: upstream's speech
# tokenizer refuses prompts over 30 s, and under a second there is too little of the speaker.
VOICE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,39}")
VOICE_RATE = 24000
VOICE_SECONDS = (1.0, 30.0)
# The Chinese dialects CosyVoice 3 was trained to speak on instruction, by the id a request names. The
# instruction is upstream's own (cosyvoice.utils.common.instruct_list), checked at startup.
DIALECTS = {
    "cantonese": "广东话",
    "minnan": "闽南话",
    "sichuan": "四川话",
    "shanghai": "上海话",
    "dongbei": "东北话",
    "tianjin": "天津话",
    "shandong": "山东话",
    "henan": "河南话",
    "hubei": "湖北话",
    "hunan": "湖南话",
    "jiangxi": "江西话",
    "guizhou": "贵州话",
    "yunnan": "云南话",
    "gansu": "甘肃话",
    "ningxia": "宁夏话",
    "shanxi": "山西话",
    "shaanxi": "陕西话",
}
# Off a discrete GPU the DiT runs with int8 activations too, quantized once on this machine from its own
# runs of these sentences. Its projections and feed-forward layers only: quantizing the timestep
# conditioning, the attention scores or the input/output layers as well left no speech at all.
# 2: calibrated with the built-in voice that replaced sg_female.
INT8_DIT_VERSION = 2
INT8_DIT_FLOAT = [r".*attn/MatMul.*", r".*attn_norm.*", r".*time_embed.*", r".*norm_out.*", r".*proj_out.*",
                  r".*input_embed.*"]
CALIBRATION = [
    "欢迎来到马来西亚。", "我们明天早上九点在吉隆坡中央车站见面。", "今天的天气非常热，记得多喝水。",
    "你吃饱了没有？我们去喝茶吧。", "这个周末我们去槟城吃炒粿条，好不好？", "请在下一站下车，谢谢。",
    "Good morning everyone, welcome to the demo.", "The next train will arrive in three minutes.",
    "Please remember to bring your umbrella.", "我今天真的很忙，没有时间去吃午饭。",
]
# The config's inference sections; the rest (training data pipeline, GAN discriminators) would import
# pyarrow, pyworld and training modules for nothing.
CONFIG_KEYS = ("sample_rate", "llm_input_size", "llm_output_size", "spk_embed_dim", "qwen_pretrain_path",
               "token_frame_rate", "token_mel_ratio", "chunk_size", "num_decoding_left_chunks", "llm", "flow",
               "hift", "get_tokenizer", "allowed_special", "feat_extractor")


def dialect_instruction(dialect: str) -> str:
    """The instruction CosyVoice 3 was trained to speak ``dialect`` with, word for word."""
    return f"You are a helpful assistant. 请用{DIALECTS[dialect]}表达。<|endofprompt|>"


def model_dir() -> Path:
    return models_dir("tts", MODEL_ID, REPO)


def voices_dir() -> Path:
    """Drop ``<name>.wav`` here (optionally ``<name>.txt`` with its transcript) to add a cloned voice."""
    return models_dir("tts", MODEL_ID, "voices")


def download(source: str) -> Path:
    target = model_dir()
    fetch_snapshot(REPO, target, source=source, revision=REVISION, allow_patterns=ALLOW_PATTERNS)
    voices = voices_dir()
    voices.mkdir(parents=True, exist_ok=True)
    retired, retired_sha256 = RETIRED_VOICE
    old = voices / f"{retired}.wav"
    if old.is_file() and hashlib.sha256(old.read_bytes()).hexdigest() == retired_sha256:
        logger.info("Removing the former built-in voice %s", retired)
        old.unlink()
        old.with_suffix(".txt").unlink(missing_ok=True)
    shutil.rmtree(voices / ".download", ignore_errors=True)
    # Kept as upstream ships it, so a start after a pin bump installs the new one.
    recording = DEFAULT_VOICE_RECORDING.read_bytes()
    local = voices / f"{DEFAULT_VOICE}.wav"
    if not local.is_file() or local.read_bytes() != recording:
        with staged_model_file(str(local)) as staged:
            Path(staged).write_bytes(recording)
    transcript = local.with_suffix(".txt")
    if not transcript.is_file() or transcript.read_text(encoding="utf-8").strip() != DEFAULT_VOICE_TRANSCRIPT:
        transcript.write_text(DEFAULT_VOICE_TRANSCRIPT + "\n", encoding="utf-8")
    return target


def _config_text(checkpoint: Path) -> str:
    """cosyvoice3.yaml reduced to :data:`CONFIG_KEYS` (top-level blocks, in file order)."""
    blocks, keep = [], False
    for line in (checkpoint / "cosyvoice3.yaml").read_text(encoding="utf-8").splitlines():
        top = re.match(r"^([A-Za-z_0-9]+):", line)
        if top:
            keep = top.group(1) in CONFIG_KEYS
        if keep:
            blocks.append(line)
    return "\n".join(blocks) + "\n"


def _compat_patches() -> None:
    """transformers 5.x, not the 4.51 CosyVoice was written for: fp32 Qwen2 load, no 1-column decode mask."""
    import torch
    import transformers
    from cosyvoice.llm.llm import Qwen2Encoder

    from_pretrained = transformers.Qwen2ForCausalLM.from_pretrained.__func__
    # 4.51 loaded fp32; 5.x keeps the checkpoint's bf16 beside CosyVoice's fp32 speech embeddings.
    transformers.Qwen2ForCausalLM.from_pretrained = classmethod(
        lambda cls, *a, **k: from_pretrained(cls, *a, **{"dtype": torch.float32, **k})
    )

    def forward_one_step(self, xs, masks, cache=None):
        # Upstream passes the mask's last row, one column long after the first step: 4.51 ignored an all-ones
        # mask, 5.x reads the missing columns as padding (each token then sees only itself). One unpadded
        # sequence needs only causal masking, which the model applies itself.
        outs = self.model(inputs_embeds=xs, output_hidden_states=True, return_dict=True, use_cache=True,
                          past_key_values=cache)
        return outs.hidden_states[-1], outs.past_key_values

    Qwen2Encoder.forward_one_step = forward_one_step


def load_torch(checkpoint: Path):
    """Upstream's frontend and model (CPU, fp32), built from the inference sections of the config."""
    import torch
    from cosyvoice.cli.frontend import CosyVoiceFrontEnd
    from cosyvoice.cli.model import CosyVoice3Model
    from hyperpyyaml import load_hyperpyyaml

    _compat_patches()
    configs = load_hyperpyyaml(_config_text(checkpoint),
                               overrides={"qwen_pretrain_path": str(checkpoint / "CosyVoice-BlankEN")})
    frontend = CosyVoiceFrontEnd(configs["get_tokenizer"], configs["feat_extractor"], str(checkpoint / "campplus.onnx"),
                                 str(checkpoint / "speech_tokenizer_v3.onnx"), str(checkpoint / "spk2info.pt"),
                                 configs["allowed_special"])
    model = CosyVoice3Model(configs["llm"], configs["flow"], configs["hift"], False)
    model.load(str(checkpoint / "llm.pt"), str(checkpoint / "flow.pt"), str(checkpoint / "hift.pt"))
    torch.set_grad_enabled(False)
    return frontend, model, configs["sample_rate"]


def _load_wav(wav, target_sr, min_sr=16000):
    """cosyvoice.utils.file_utils.load_wav through soundfile: torchaudio 2.11's load needs TorchCodec."""
    import soundfile as sf
    import torch
    import torchaudio

    if hasattr(wav, "seek"):
        # An in-memory prompt is read three times (mel, speech tokens, speaker embedding).
        wav.seek(0)
    data, sample_rate = sf.read(wav, dtype="float32", always_2d=True)
    speech = torch.from_numpy(data.T.copy()).mean(dim=0, keepdim=True)
    if sample_rate != target_sr:
        if sample_rate < min_sr:
            raise ValueError(f"voice prompt sample rate {sample_rate} is below {min_sr} Hz")
        speech = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=target_sr)(speech)
    return speech


def _qwen_step(qwen_model):
    import torch

    class QwenStep(torch.nn.Module):
        """One Qwen2 call over ``inputs_embeds`` with K/V passed in and out; the last hidden state only."""

        def __init__(self, m):
            super().__init__()
            self.m = m
            c = m.config
            self.heads, self.kv_heads = c.num_attention_heads, c.num_key_value_heads
            self.head_dim = c.hidden_size // c.num_attention_heads
            self.n_layers = c.num_hidden_layers

        def forward(self, inputs_embeds, *past):
            from transformers.models.qwen2.modeling_qwen2 import apply_rotary_pos_emb

            x = inputs_embeds
            t = x.shape[1]
            p = past[0].shape[2]
            pos = torch.arange(p, p + t).unsqueeze(0)
            cos, sin = self.m.rotary_emb(x, pos)
            mask = torch.where(torch.arange(p + t)[None, :] <= pos[0][:, None], 0.0, -math.inf)
            rep = self.heads // self.kv_heads
            presents = []
            for i, layer in enumerate(self.m.layers):
                a = layer.self_attn
                h = layer.input_layernorm(x)
                q = a.q_proj(h).view(1, t, self.heads, self.head_dim).transpose(1, 2)
                k = a.k_proj(h).view(1, t, self.kv_heads, self.head_dim).transpose(1, 2)
                v = a.v_proj(h).view(1, t, self.kv_heads, self.head_dim).transpose(1, 2)
                q, k = apply_rotary_pos_emb(q, k, cos, sin)
                k = torch.cat([past[2 * i], k], dim=2)
                v = torch.cat([past[2 * i + 1], v], dim=2)
                presents += [k, v]
                w = torch.matmul(q, k.repeat_interleave(rep, dim=1).transpose(2, 3)) / math.sqrt(self.head_dim)
                w = torch.softmax(w + mask, dim=-1)
                o = torch.matmul(w, v.repeat_interleave(rep, dim=1)).transpose(1, 2).reshape(1, t, -1)
                x = x + a.o_proj(o)
                x = x + layer.mlp(layer.post_attention_layernorm(x))
            return (self.m.norm(x[:, -1:]), *presents)

    return QwenStep(qwen_model).eval()


def _hift_to_spec(hift):
    import torch

    class HiftToSpec(torch.nn.Module):
        """CausalHiFTGenerator.inference(finalize=True) up to, not including, its exp/sin and iSTFT."""

        def __init__(self, h):
            super().__init__()
            self.h = h

        def forward(self, mel):
            h = self.h
            f0 = h.f0_predictor(mel, finalize=True)
            s = h.f0_upsamp(f0[:, None]).transpose(1, 2)
            s, _, _ = h.m_source(s)
            s = s.transpose(1, 2)
            captured = {}
            istft = h._istft

            def grab(magnitude, phase):
                # decode() hands exp(x) and sin(x) to the iSTFT; log/asin give back what rebuilds them.
                captured["spec"] = torch.cat([torch.log(magnitude), torch.asin(phase.clamp(-1, 1))], dim=1)
                return magnitude[:, :1, :]

            h._istft = grab
            try:
                h.decode(x=mel, s=s, finalize=True)
            finally:
                h._istft = istft
            return captured["spec"]

    return HiftToSpec(hift).eval()


def _short_prompt(wav: Path):
    """The recording cut at its quietest 100 ms within :data:`PROMPT_CUT`, as an in-memory WAV (or the path)."""
    import io

    import soundfile as sf

    audio, rate = sf.read(wav, dtype="float32", always_2d=True)
    if audio.shape[0] <= PROMPT_CUT[1] * rate:
        return wav
    frame = int(0.1 * rate)
    start, end = int(PROMPT_CUT[0] * rate), int(PROMPT_CUT[1] * rate)
    energy = [float(np.abs(audio[i:i + frame]).mean()) for i in range(start, end - frame, frame)]
    cut = start + int(np.argmin(energy)) * frame + frame // 2
    buffer = io.BytesIO()
    sf.write(buffer, audio[:cut], rate, format="WAV")
    return buffer


def _is_discrete_gpu(core: ov.Core, device: str) -> bool:
    try:
        return str(core.get_property(device, "DEVICE_TYPE")).lower().endswith("discrete")
    except Exception:  # noqa: BLE001 - devices without the property (CPU) are not discrete GPUs
        return False


def _save(model: ov.Model, path: Path, fp16: bool = False) -> None:
    with staged_model_file(str(path)) as staged:
        ov.save_model(model, staged, compress_to_fp16=fp16)


def _export(checkpoint: Path, model, out: Path) -> None:
    import nncf
    import torch
    from openvino._offline_transformations import apply_make_stateful_transformation

    step = _qwen_step(model.llm.llm.model.model)
    hidden = step.m.config.hidden_size
    names_in, names_out = ["inputs_embeds"], ["hidden"]
    shapes = [ov.PartialShape([1, -1, hidden])]
    example = [torch.randn(1, 5, hidden)]
    for i in range(step.n_layers):
        for kv in ("key", "value"):
            names_in.append(f"past_{kv}.{i}")
            names_out.append(f"present_{kv}.{i}")
            shapes.append(ov.PartialShape([1, step.kv_heads, -1, step.head_dim]))
            example.append(torch.zeros(1, step.kv_heads, 3, step.head_dim))
    with torch.no_grad():
        llm = ov.convert_model(step, example_input=tuple(example), input=shapes)
    for port, name in zip(llm.inputs, names_in):
        port.get_tensor().set_names({name})
    for port, name in zip(llm.outputs, names_out):
        port.get_tensor().set_names({name})
    apply_make_stateful_transformation(
        llm, {f"past_{kv}.{i}": f"present_{kv}.{i}" for i in range(step.n_layers) for kv in ("key", "value")}
    )
    _save(nncf.compress_weights(llm, mode=nncf.CompressWeightsMode.INT8_ASYM), out / "llm.xml")
    _save(ov.Core().read_model(str(checkpoint / "flow.decoder.estimator.fp32.onnx")), out / "estimator.xml", fp16=True)
    with torch.no_grad():
        spec = ov.convert_model(_hift_to_spec(model.hift), example_input=(torch.randn(1, 80, 200),),
                                input=[ov.PartialShape([1, 80, -1])])
    spec.inputs[0].get_tensor().set_names({"mel"})
    _save(spec, out / "hift.xml")


def ensure_export(checkpoint: Path, model) -> Path:
    """The IRs, exported once from the loaded PyTorch ``model`` (first start, under a minute)."""
    out = checkpoint / "openvino"
    marker = out / "export.json"
    expected = {"version": EXPORT_VERSION, "revision": REVISION}
    with shared_model_lock(out):
        try:
            if json.loads(marker.read_text(encoding="utf-8")) == expected:
                return out
        except (OSError, ValueError):
            pass
        with startup_stage("preparing", f"OpenVINO export of {REPO}"):
            logger.info("Exporting %s to OpenVINO into %s", REPO, out)
            out.mkdir(parents=True, exist_ok=True)
            _export(checkpoint, model, out)
            with staged_model_file(str(marker)) as staged:
                Path(staged).write_text(json.dumps(expected), encoding="utf-8")
    return out


class CosyVoiceTTS:
    """Upstream frontend + model with the LLM, DiT and HiFT swapped for compiled OpenVINO models."""

    def __init__(self, source: str, device: str, flow_steps: int = 0):
        """``flow_steps`` 0 picks :data:`FLOW_STEPS` by where the DiT runs."""
        import cosyvoice.cli.frontend as cv_frontend
        import torch
        from cosyvoice.utils.common import instruct_list

        untrained = [d for d in DIALECTS if dialect_instruction(d) not in instruct_list]
        if untrained:
            raise RuntimeError(f"upstream's instruct_list has no instruction for {', '.join(untrained)}; "
                               "update DIALECTS to the pinned CosyVoice")
        cv_frontend.load_wav = _load_wav
        checkpoint = download(source)
        self.frontend, self.model, self.sample_rate = load_torch(checkpoint)
        irs = ensure_export(checkpoint, self.model)
        core = ov.Core()
        # AUTO goes to OpenVINO as it is; what it picks decides the placement below.
        llm = core.compile_model(str(irs / "llm.xml"), device, openvino_compile_config(device))
        target = openvino_execution_device(llm, device)
        discrete = _is_discrete_gpu(core, target)
        if not discrete and target != "CPU":
            llm = core.compile_model(str(irs / "llm.xml"), "CPU", openvino_compile_config("CPU"))
        hift = core.compile_model(str(irs / "hift.xml"), "CPU", openvino_compile_config("CPU"))
        self.flow_steps = flow_steps or FLOW_STEPS["discrete" if discrete else "other"]
        self.full_prompts = discrete
        self.devices = {"llm": target if discrete else "CPU", "flow": target, "vocoder": "CPU"}
        # Off a discrete GPU the fp16 DiT first runs on the CPU, for the int8 one's calibration.
        estimator = self._estimator(core, irs / "estimator.xml", target if discrete else "CPU", torch)
        self._swap(llm.create_infer_request(), estimator, hift.create_infer_request(), torch)
        self.voices: dict[str, tuple[Path, str]] = {}
        # Per voice, the recording's mtime and the transcript it was encoded with: a replaced file re-encodes.
        self._encoded: dict[str, tuple[int, str]] = {}
        self.refresh_voices()
        if not discrete:
            # About 3x faster than fp16 on the CPU, 1.4x on an integrated GPU.
            self.model.flow.decoder.estimator = self._estimator(core, self._int8_dit(core, irs), target, torch)

    def _estimator(self, core: ov.Core, xml: Path, device: str, torch):
        """The DiT as a torch Module (so CausalConditionalCFM calls it like its own, not its TensorRT path)."""
        if not device.startswith("GPU"):
            request = core.compile_model(str(xml), device, openvino_compile_config(device)).create_infer_request()
        compiled: dict[int, object] = {}

        def bucket(size: int):
            if size not in compiled:
                model = core.read_model(str(xml))
                model.reshape({"x": [2, 80, size], "mask": [2, 1, size], "mu": [2, 80, size], "t": [2],
                               "spks": [2, 80], "cond": [2, 80, size]})
                logger.info("Compiling the flow DiT for %d frames on %s", size, device)
                compiled[size] = core.compile_model(model, device, openvino_compile_config(device)).create_infer_request()
            return compiled[size]

        if device.startswith("GPU"):
            for size in STARTUP_BUCKETS:
                bucket(size)

        def infer(feed: dict, frames: int):
            if device.startswith("GPU"):
                size = -(-frames // BUCKET_FRAMES) * BUCKET_FRAMES
                req = bucket(size)
                # Padding carries mask 0, which the DiT already honours for batched training.
                feed = {k: np.pad(v, ((0, 0), (0, 0), (0, size - frames))) if v.ndim == 3 else v for k, v in feed.items()}
            else:
                req = request
            req.infer(feed)
            return np.array(req.get_output_tensor(0).data[:, :, :frames])

        class Estimator(torch.nn.Module):
            def forward(self, x, mask, mu, t, spks, cond, streaming=False):
                feed = {"x": x.float().numpy(), "mask": mask.float().numpy(), "mu": mu.float().numpy(),
                        "t": t.float().numpy(), "spks": spks.float().numpy(), "cond": cond.float().numpy()}
                return torch.from_numpy(infer(feed, x.shape[2])).to(x.dtype)

        return Estimator()

    def _int8_dit(self, core: ov.Core, irs: Path) -> Path:
        """``estimator_int8.xml``, quantized once from the DiT's inputs while synthesizing :data:`CALIBRATION`."""
        out = irs / "estimator_int8.xml"
        marker = irs / "estimator_int8.json"
        expected = {"version": INT8_DIT_VERSION, "export": EXPORT_VERSION}
        with shared_model_lock(out):
            try:
                if json.loads(marker.read_text(encoding="utf-8")) == expected:
                    return out
            except (OSError, ValueError):
                pass
            with startup_stage("preparing", "int8 flow DiT for real time on this device"):
                import nncf

                logger.info("Calibrating an int8 flow DiT on %d sentences (once)", len(CALIBRATION))
                estimator, feeds = self.model.flow.decoder.estimator, []
                original = estimator.forward

                def capture(x, mask, mu, t, spks, cond, streaming=False):
                    feeds.append({"x": x.float().numpy(), "mask": mask.float().numpy(), "mu": mu.float().numpy(),
                                  "t": t.float().numpy(), "spks": spks.float().numpy(), "cond": cond.float().numpy()})
                    return original(x, mask, mu, t, spks, cond, streaming)

                estimator.forward = capture
                try:
                    for text in CALIBRATION:
                        for _ in self.synthesize(text, DEFAULT_VOICE, 1.0):
                            pass
                finally:
                    estimator.forward = original
                quantized = nncf.quantize(
                    core.read_model(str(irs / "estimator.xml")), nncf.Dataset(feeds),
                    model_type=nncf.ModelType.TRANSFORMER, subset_size=len(feeds),
                    ignored_scope=nncf.IgnoredScope(patterns=INT8_DIT_FLOAT, validate=False),
                )
                _save(quantized, out)
                with staged_model_file(str(marker)) as staged:
                    Path(staged).write_text(json.dumps(expected), encoding="utf-8")
        return out

    def _swap(self, llm_req, estimator, hift_req, torch) -> None:
        from cosyvoice.llm.llm import Qwen2Encoder

        def forward_one_step(_self, xs, masks, cache=None):
            # The cache lives in the infer request's state; a fresh sequence (cache None) resets it.
            if cache is None:
                llm_req.reset_state()
            llm_req.infer({"inputs_embeds": xs.float().numpy()})
            return torch.from_numpy(np.array(llm_req.get_output_tensor(0).data)), True

        Qwen2Encoder.forward_one_step = forward_one_step

        decoder = self.model.flow.decoder
        decoder.estimator = estimator
        forward = decoder.forward
        # The flow asks for 10 steps; CausalConditionalCFM takes the count per call.
        decoder.forward = lambda *a, **k: forward(*a, **{**k, "n_timesteps": self.flow_steps})
        n_fft = self.model.hift.istft_params["n_fft"]

        def inference(_self, speech_feat, finalize=True):
            hift_req.infer({"mel": speech_feat.float().numpy()})
            x = torch.from_numpy(np.array(hift_req.get_output_tensor(0).data))
            speech = _self._istft(torch.exp(x[:, : n_fft // 2 + 1, :]), torch.sin(x[:, n_fft // 2 + 1:, :]))
            return torch.clamp(speech, -_self.audio_limit, _self.audio_limit), None

        self.model.hift.inference = types.MethodType(inference, self.model.hift)

    def _encode(self, wav: Path, text: str) -> dict:
        """The voice prompt of a recording, as CosyVoice.add_zero_shot_spk keeps it (without the text)."""
        # A voice with a transcript clones zero-shot (closest match); without one, cross-lingual (the
        # prompt's language does not matter, e.g. a Mandarin recording reading English or Japanese).
        # A transcript must match the whole recording; without one, ~4 s do off a discrete GPU.
        source = str(wav) if text or self.full_prompts else _short_prompt(wav)
        prompt = self.frontend.frontend_zero_shot("", f"{SYSTEM_PROMPT}{text}", source, self.sample_rate, "")
        del prompt["text"], prompt["text_len"]
        return prompt

    def _register(self, name: str, wav: Path, text: str, prompt: dict) -> None:
        self.frontend.spk2info[name] = prompt
        self.voices[name] = (wav, text)
        self._encoded[name] = (wav.stat().st_mtime_ns, text)

    def _forget(self, name: str) -> None:
        self.voices.pop(name, None)
        self._encoded.pop(name, None)
        self.frontend.spk2info.pop(name, None)

    def refresh_voices(self) -> None:
        """Encode (once each) every ``voices/<name>.wav``; ``<name>.txt`` beside it switches to transcript cloning.

        A recording replaced since is encoded again, and a voice whose recording is gone is dropped.
        """
        found = set()
        for wav in sorted(voices_dir().glob("*.wav")):
            name = wav.stem
            found.add(name)
            transcript = wav.with_suffix(".txt")
            text = transcript.read_text(encoding="utf-8").strip() if transcript.exists() else ""
            if self._encoded.get(name) == (wav.stat().st_mtime_ns, text):
                continue
            logger.info("Encoding voice %s from %s", name, wav.name)
            self._register(name, wav, text, self._encode(wav, text))
        for name in set(self.voices) - found:
            logger.info("Voice %s: its recording was removed", name)
            self._forget(name)

    def add_voice(self, name: str, audio: bytes, transcript: str) -> float:
        """Clone ``name`` from ``audio`` (any format ffmpeg reads), replacing a voice of that name; its seconds.

        Saved as ``voices/<name>.wav`` (and ``<name>.txt`` when there is a transcript) only once it has
        encoded, so a recording that fails leaves the voice it would have replaced as it was. ValueError
        for a recording that is not usable audio of :data:`VOICE_SECONDS`.
        """
        import soundfile as sf

        try:
            pcm = np.frombuffer(decode_to_pcm16(audio, VOICE_RATE), dtype=np.int16)
        except RuntimeError as e:
            logger.warning("Voice %s: %s", name, e)
            raise ValueError("The file could not be read as audio") from e
        seconds = pcm.size / VOICE_RATE
        if not VOICE_SECONDS[0] <= seconds <= VOICE_SECONDS[1]:
            raise ValueError(f"The recording is {seconds:.1f} s long; a voice needs "
                             f"{VOICE_SECONDS[0]:g}-{VOICE_SECONDS[1]:g} s (3-10 s works best)")
        text = transcript.strip()
        voices = voices_dir()
        # Beside the voices, not among them: refresh_voices lists only voices/*.wav.
        staged = voices / ".upload" / f"{name}.wav"
        staged.parent.mkdir(parents=True, exist_ok=True)
        try:
            sf.write(staged, pcm, VOICE_RATE, subtype="PCM_16")
            prompt = self._encode(staged, text)
        except Exception as e:
            staged.unlink(missing_ok=True)
            raise ValueError(f"The recording could not be cloned: {e}") from e
        wav, txt = voices / f"{name}.wav", voices / f"{name}.txt"
        if text:
            txt.write_text(text + "\n", encoding="utf-8")
        else:
            txt.unlink(missing_ok=True)
        os.replace(staged, wav)
        logger.info("Added voice %s (%.1f s, %s)", name, seconds, "zero-shot" if text else "cross-lingual")
        self._register(name, wav, text, prompt)
        return seconds

    def remove_voice(self, name: str) -> None:
        """Delete ``voices/<name>.wav`` and its transcript."""
        wav = voices_dir() / f"{name}.wav"
        wav.unlink(missing_ok=True)
        wav.with_suffix(".txt").unlink(missing_ok=True)
        self._forget(name)

    def synthesize(self, text: str, voice: str, speed: float, dialect: str | None = None):
        """Speech for ``text`` (24 kHz float32), a normalised sentence or so at a time, in ``dialect`` if given."""
        wav, transcript = self.voices[voice]
        instruction = self.frontend._extract_text_token(dialect_instruction(dialect)) if dialect else None
        for sentence in self.frontend.text_normalize(text, split=True, text_frontend=True):
            if instruction is not None:
                # Upstream's frontend_instruct2 for a stored voice takes the voice's prompt as it is, so the
                # instruction would be lost: set here as frontend_instruct2 sets it for a recording, in place
                # of the prompt text and with no speech prompt for the LLM (the voice stays in the flow's).
                model_input = self.frontend.frontend_zero_shot(sentence, "", str(wav), self.sample_rate, voice)
                model_input["prompt_text"], model_input["prompt_text_len"] = instruction
                del model_input["llm_prompt_speech_token"], model_input["llm_prompt_speech_token_len"]
            elif transcript:
                model_input = self.frontend.frontend_zero_shot(sentence, "", str(wav), self.sample_rate, voice)
            else:
                model_input = self.frontend.frontend_cross_lingual(f"{SYSTEM_PROMPT}{sentence}", str(wav),
                                                                   self.sample_rate, voice)
            for out in self.model.tts(**model_input, stream=False, speed=speed):
                yield out["tts_speech"][0].numpy().astype(np.float32)
