# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Cohere Transcribe speech-to-text using OpenVINO's ONNX frontend directly.

CohereLabs/cohere-transcribe-03-2026 ("Cohere Transcribe") is a 2B-parameter
Conformer-encoder / Transformer-decoder ASR model. Its `cohere_asr` architecture
has no export config in optimum-intel (`TasksManager` doesn't know it), so it
can't go through the usual OVModelForSpeechSeq2Seq.from_pretrained(export=True)
path used for Whisper.

Instead this wrapper consumes the community ONNX export
(onnx-community/cohere-transcribe-03-2026-ONNX) and compiles the graphs directly
via `Core.read_model()` / `Core.compile_model()` — OpenVINO's ONNX frontend
supports this model's ops (including the `MatMulNBits`/`MultiHeadAttention`
com.microsoft ops used by the quantized encoder) without going through
optimum-intel at all. The one graph that does NOT survive an IR
save-then-reload round trip is the merged decoder: serializing it to
.xml/.bin and reloading raises `Cannot create NullNode layer ... unsupported
opset: extension` (a leftover placeholder node from an optional/unused input
on the fused attention op that only gets folded away during a live
read-then-compile, not after XML re-deserialization). Reading directly from
ONNX and compiling in one step avoids that bug entirely, so this wrapper never
calls `ov.save_model()` — it relies on OpenVINO's own compiled-blob cache
(`CACHE_DIR`) for fast reloads instead of pre-converted IR.

Feature extraction (mel-spectrogram) and decoder prompt construction are a
manual numpy re-implementation of `CohereAsrFeatureExtractor` /
`CohereAsrProcessor.get_decoder_prompt_ids` (transformers>=5.4, not installed
here) — ported by reading the reference source directly. See `_extract_features`
and `_build_prompt_ids` for the algorithm.
"""

import logging
import os
import re
# Only invoked below with hardcoded argv lists, never shell=True.
import subprocess  # nosec B404
import tempfile
import time
from pathlib import Path
from typing import Optional

import numpy as np
import yaml

from src.models.base import TranscriberBase, ROOT_DIR

logger = logging.getLogger(__name__)

CONFIG_PATH = ROOT_DIR / "config.yaml"

SAMPLE_RATE = 16000
N_FFT = 512
HOP_LENGTH = 160
WIN_LENGTH = 400
PREEMPHASIS = 0.97
LOG_ZERO_GUARD_VALUE = 2 ** -24
NORM_EPSILON = 1e-5
N_MELS = 128
CHUNK_SECONDS = 30  # model's own limit is 35s; stay under it with margin

N_DECODER_LAYERS = 8
N_KV_HEADS = 8
HEAD_DIM = 128
EOS_TOKEN_ID = 3
MAX_NEW_TOKENS = 256

# From CohereAsrProcessor.LANGUAGES — languages the model was trained on.
SUPPORTED_LANGUAGES = {"ar", "de", "el", "en", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt", "vi", "zh"}
_NO_SPACE_LANGUAGES = {"ja", "zh"}

_ONNX_REPO = "onnx-community/cohere-transcribe-03-2026-ONNX"
_ENCODER_FILE = "encoder_model_q4f16.onnx"
_DECODER_FILE = "decoder_model_merged_fp16.onnx"


def _load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


def _hann_window(win_length: int) -> np.ndarray:
    """Symmetric Hann window — matches torch.hann_window(win_length, periodic=False)."""
    if win_length == 1:
        return np.ones(1, dtype=np.float32)
    n = np.arange(win_length)
    return (0.5 - 0.5 * np.cos(2 * np.pi * n / (win_length - 1))).astype(np.float32)


class TranscriberCohereASR(TranscriberBase):
    """Cohere Transcribe (cohere-transcribe-03-2026) speech-to-text via raw OpenVINO.

    Runs the community ONNX export's Conformer encoder + autoregressive
    Transformer decoder directly through OpenVINO's Core API (no optimum-intel
    involved — that library has no export config for this architecture).
    """

    def __init__(self, device: str = "GPU", config: dict = None) -> None:
        super().__init__(device=device, config=config)
        self._config = config or _load_config()
        self._loaded = False

        model_cfg = self._config.get("models", {}).get("whisper", {})
        export_dir = ROOT_DIR / model_cfg.get("export_dir", "models/cohere-transcribe-03-2026")
        self._export_dir = export_dir

        ov_device = device.upper()
        if ov_device == "NPU":
            ov_device = "GPU"
            logger.warning("NPU not supported for Cohere Transcribe (dynamic-shape autoregressive decoder); using GPU")
        self.device = ov_device

        # The decoder's growing KV-cache gives it fully dynamic shapes, which
        # the OpenVINO GPU plugin can't run ("[GPU] Count is called for
        # dynamic shape" — a plugin-level limitation, confirmed by testing,
        # not a config knob). The encoder holds >90% of the model's compute
        # (per Cohere's own design) and has no such issue on GPU, so it runs
        # on the requested device while the small 8-layer decoder always runs
        # on CPU — this still captures most of the possible GPU speedup.
        self._decoder_device = "CPU"

        encoder_path = export_dir / _ENCODER_FILE
        decoder_path = export_dir / _DECODER_FILE
        mel_filters_path = export_dir / "mel_filters.npy"
        tokenizer_path = export_dir / "tokenizer.json"
        for required in (encoder_path, decoder_path, mel_filters_path, tokenizer_path):
            if not required.exists():
                raise FileNotFoundError(
                    f"Cohere Transcribe artifact missing: {required}. "
                    f"Download the model first (Settings > Transcription > Download)."
                )

        import openvino as ov
        from tokenizers import Tokenizer

        logger.info("Loading Cohere Transcribe on %s (export_dir=%s)", ov_device, export_dir)

        core = ov.Core()
        core.set_property({"CACHE_DIR": str(export_dir / "ov_cache")})

        t0 = time.perf_counter()
        self._encoder = core.compile_model(core.read_model(str(encoder_path)), ov_device)
        self._decoder = core.compile_model(core.read_model(str(decoder_path)), self._decoder_device)
        logger.debug("Cohere Transcribe compiled in %.2fs (encoder=%s, decoder=%s)",
                     time.perf_counter() - t0, ov_device, self._decoder_device)

        self._mel_filters = np.load(mel_filters_path)  # (128, n_fft//2+1)
        self._window = _hann_window(WIN_LENGTH)
        self._tokenizer = Tokenizer.from_file(str(tokenizer_path))

        self._decoder_out_names = [o.get_any_name() for o in self._decoder.outputs]

        self._loaded = True
        logger.info("Cohere Transcribe loaded on %s", ov_device)

    def is_loaded(self) -> bool:
        return self._loaded

    # -- feature extraction -------------------------------------------------

    def _extract_features(self, waveform: np.ndarray) -> np.ndarray:
        """Log-mel features matching CohereAsrFeatureExtractor exactly.

        Ported from transformers' feature_extraction_cohere_asr.py: dither,
        preemphasis, centered STFT, slaney-normalized mel filterbank, log
        compression, then per-mel-bin (per_feature) mean/std normalization
        over the utterance's valid (non-padded) frames.
        """
        x = waveform.astype(np.float32).copy()
        n = len(x)

        # Dither: deterministic small noise seeded by length, only to avoid
        # log(0) on true silence — magnitude (1e-5) is too small for exact
        # RNG choice to matter.
        rng = np.random.RandomState(n)
        x = x + 1e-5 * rng.standard_normal(n).astype(np.float32)

        # Preemphasis
        y = np.empty_like(x)
        y[0] = x[0]
        y[1:] = x[1:] - PREEMPHASIS * x[:-1]
        x = y

        # Centered STFT (zero-padded edges, matches torch.stft(center=True, pad_mode="constant"))
        pad = N_FFT // 2
        x_padded = np.pad(x, (pad, pad), mode="constant")
        n_frames = 1 + (len(x_padded) - N_FFT) // HOP_LENGTH

        win_pad = (N_FFT - WIN_LENGTH) // 2
        full_window = np.zeros(N_FFT, dtype=np.float32)
        full_window[win_pad:win_pad + WIN_LENGTH] = self._window

        frames = np.lib.stride_tricks.as_strided(
            x_padded,
            shape=(n_frames, N_FFT),
            strides=(x_padded.strides[0] * HOP_LENGTH, x_padded.strides[0]),
        )
        spec = np.fft.rfft(frames * full_window, n=N_FFT, axis=1)
        power = (spec.real ** 2 + spec.imag ** 2).T  # (n_fft//2+1, n_frames)

        mel = self._mel_filters @ power  # (128, n_frames)
        log_mel = np.log(mel + LOG_ZERO_GUARD_VALUE).T  # (n_frames, 128)

        valid_frames = min(n // HOP_LENGTH, n_frames)
        valid = log_mel[:valid_frames]
        mean = valid.mean(axis=0, keepdims=True)
        variance = ((valid - mean) ** 2).sum(axis=0, keepdims=True) / max(valid_frames - 1, 1)
        std = np.sqrt(variance)
        normed = (log_mel - mean) / (std + NORM_EPSILON)
        normed[valid_frames:] = 0.0
        return normed[None, :, :].astype(np.float32)  # (1, T, 128)

    # -- prompt construction --------------------------------------------------

    def _build_prompt_ids(self, language: str, punctuation: bool = True) -> np.ndarray:
        """Decoder prompt tokens — matches CohereAsrProcessor.get_decoder_prompt_ids."""
        pnc_token = "<|pnc|>" if punctuation else "<|nopnc|>"
        tokens = [
            "▁",
            "<|startofcontext|>",
            "<|startoftranscript|>",
            "<|emo:undefined|>",
            f"<|{language}|>",
            f"<|{language}|>",
            pnc_token,
            "<|noitn|>",
            "<|notimestamp|>",
            "<|nodiarize|>",
        ]
        ids = [self._tokenizer.token_to_id(t) for t in tokens]
        return np.array([ids], dtype=np.int64)

    # -- decoding ---------------------------------------------------------------

    def _run_decoder(self, encoder_hidden_states: np.ndarray, language: str, punctuation: bool = True) -> str:
        prompt_ids = self._build_prompt_ids(language, punctuation)
        seq_len = prompt_ids.shape[1]

        empty_kv = np.zeros((1, N_KV_HEADS, 0, HEAD_DIM), dtype=np.float16)
        inputs = {
            "input_ids": prompt_ids,
            "attention_mask": np.ones((1, seq_len), dtype=np.int64),
            "position_ids": np.arange(seq_len, dtype=np.int64)[None, :],
            "num_logits_to_keep": np.array(1, dtype=np.int64),
            "encoder_hidden_states": encoder_hidden_states,
        }
        for i in range(N_DECODER_LAYERS):
            inputs[f"past_key_values.{i}.decoder.key"] = empty_kv
            inputs[f"past_key_values.{i}.decoder.value"] = empty_kv
            inputs[f"past_key_values.{i}.encoder.key"] = empty_kv
            inputs[f"past_key_values.{i}.encoder.value"] = empty_kv

        generated = []
        total_len = seq_len
        result = self._decoder(inputs)
        out_map = {name: result[self._decoder.output(name)] for name in self._decoder_out_names}
        next_id = int(np.argmax(out_map["logits"][0, -1]))

        for _ in range(MAX_NEW_TOKENS):
            if next_id == EOS_TOKEN_ID:
                break
            generated.append(next_id)
            total_len += 1
            step_inputs = {
                "input_ids": np.array([[next_id]], dtype=np.int64),
                "attention_mask": np.ones((1, total_len), dtype=np.int64),
                "position_ids": np.array([[total_len - 1]], dtype=np.int64),
                "num_logits_to_keep": np.array(1, dtype=np.int64),
                "encoder_hidden_states": encoder_hidden_states,
            }
            for i in range(N_DECODER_LAYERS):
                step_inputs[f"past_key_values.{i}.decoder.key"] = out_map[f"present.{i}.decoder.key"]
                step_inputs[f"past_key_values.{i}.decoder.value"] = out_map[f"present.{i}.decoder.value"]
                step_inputs[f"past_key_values.{i}.encoder.key"] = out_map[f"present.{i}.encoder.key"]
                step_inputs[f"past_key_values.{i}.encoder.value"] = out_map[f"present.{i}.encoder.value"]
            result = self._decoder(step_inputs)
            out_map = {name: result[self._decoder.output(name)] for name in self._decoder_out_names}
            next_id = int(np.argmax(out_map["logits"][0, -1]))

        text = self._tokenizer.decode(generated, skip_special_tokens=True)
        return text.strip()

    def _transcribe_chunk(self, audio_chunk: np.ndarray, language: str) -> str:
        features = self._extract_features(audio_chunk)
        encoder_hidden_states = self._encoder([features])[self._encoder.output(0)]
        return self._run_decoder(encoder_hidden_states, language)

    # -- public API --------------------------------------------------------

    def transcribe(self, audio: np.ndarray, language: Optional[str] = None) -> str:
        text, _ = self.transcribe_with_language(audio, language)
        return text

    def transcribe_with_language(self, audio: np.ndarray, language: Optional[str] = None) -> tuple:
        start = time.perf_counter()

        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        resolved_language = language if language in SUPPORTED_LANGUAGES else "en"
        if language and language not in SUPPORTED_LANGUAGES:
            logger.warning(
                "Cohere Transcribe doesn't support language '%s' (supports: %s) — using 'en'",
                language, sorted(SUPPORTED_LANGUAGES),
            )

        chunk_size = CHUNK_SECONDS * SAMPLE_RATE
        chunks = [audio[i:i + chunk_size] for i in range(0, len(audio), chunk_size)] or [audio]

        segments = []
        for chunk in chunks:
            if len(chunk) < SAMPLE_RATE * 0.5:
                continue
            text = self._transcribe_chunk(chunk, resolved_language)
            if text:
                segments.append(text)

        separator = "" if resolved_language in _NO_SPACE_LANGUAGES else " "
        transcription = separator.join(segments)

        elapsed = time.perf_counter() - start
        duration = len(audio) / SAMPLE_RATE
        logger.debug(
            "Cohere Transcribe [device=%s, lang=%s] took %.3fs for %.1fs audio (RTF=%.2f)",
            self.device, resolved_language, elapsed, duration,
            elapsed / duration if duration > 0 else 0,
        )
        return transcription, resolved_language

    def transcribe_file(self, file_path: str, language: Optional[str] = None) -> str:
        text, _ = self.transcribe_file_with_language(file_path, language)
        return text

    def transcribe_file_with_language(self, file_path: str, language: Optional[str] = None) -> tuple:
        fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", file_path, "-ar", str(SAMPLE_RATE), "-ac", "1", wav_path],
                capture_output=True, check=True,
            )
            from scipy.io import wavfile
            _, audio_int = wavfile.read(wav_path)
            if audio_int.dtype == np.int16:
                audio = audio_int.astype(np.float32) / 32768.0
            elif audio_int.dtype == np.int32:
                audio = audio_int.astype(np.float32) / 2147483648.0
            else:
                audio = audio_int.astype(np.float32)
        finally:
            if os.path.exists(wav_path):
                os.unlink(wav_path)

        return self.transcribe_with_language(audio, language)
