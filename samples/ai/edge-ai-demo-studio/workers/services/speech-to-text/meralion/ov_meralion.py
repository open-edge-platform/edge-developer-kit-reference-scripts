# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""MERaLiON-3-3B-ASR on OpenVINO: the checkpoint, its one-time export, and transcription.

Decoding follows the ``meralion-3-asr`` package (the model card's reference): a fixed prompt with no
language hint (the model detects the language), greedy decoding with a no-repeat-6-gram guard and at
most 512 tokens, and non-overlapping 30 s chunks transcribed one by one, each padded to 30 s (300
speech tokens) as in training.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
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
from worker_common.startup import startup_stage

logger = get_logger(__name__)

MODEL_ID = "MERaLiON/MERaLiON-3-3B-ASR"
REVISION = "9f226d738dee62c60a2f43b0ab7b9a2585a132c3"
FILES = (
    "config.json",
    "model.safetensors.index.json",
    "model-00001-of-00002.safetensors",
    "model-00002-of-00002.safetensors",
    "tokenizer.json",
)
PRECISIONS = ("int8", "int4")
# Bumped when the export changes, so the next start redoes it.
EXPORT_VERSION = 1

SAMPLE_RATE = 16000
CHUNK_SECONDS = 30
SPEECH_TOKEN_ID = 255999
SPEECH_TOKENS_PER_CHUNK = 300
HIDDEN_SIZE = 2304
EOS_IDS = (1, 107)  # <eos>, <end_of_turn>
MAX_NEW_TOKENS = 512
NO_REPEAT_NGRAM = 6
# meralion_3_asr.prompts in Gemma-2's chat template; the speech tokens go between the two halves.
PROMPT_PREFIX = (
    "<bos><start_of_turn>user\nInstruction: Please transcribe this speech. \n"
    "Follow the text instruction based on the following audio: "
)
PROMPT_SUFFIX = "<end_of_turn>\n<start_of_turn>model\n"
# Below this there is nothing for the model to hear; it would only make something up.
MIN_SECONDS = 0.1


def model_dir() -> Path:
    return models_dir("stt", "meralion", MODEL_ID)


def ir_dir(precision: str) -> Path:
    return model_dir() / f"openvino-{precision}"


def download(source: str) -> Path:
    target = model_dir()
    fetch_snapshot(MODEL_ID, target, source=source, revision=REVISION, allow_patterns=list(FILES))
    return target


def _save(model: ov.Model, path: Path) -> None:
    with staged_model_file(str(path)) as staged:
        ov.save_model(model, staged, compress_to_fp16=False)


def ensure_export(checkpoint: Path, precision: str) -> Path:
    """The IRs for ``precision``, exported once (first start; about a minute, ~20 GB of RAM)."""
    out = ir_dir(precision)
    marker = out / "export.json"
    expected = {"version": EXPORT_VERSION, "precision": precision, "revision": REVISION}
    with shared_model_lock(out):
        try:
            if json.loads(marker.read_text(encoding="utf-8")) == expected:
                return out
        except (OSError, ValueError):
            pass
        with startup_stage("preparing", f"OpenVINO export of {MODEL_ID} ({precision})"):
            import meralion_export

            logger.info("Exporting %s to OpenVINO (%s weights) into %s", MODEL_ID, precision, out)
            out.mkdir(parents=True, exist_ok=True)
            meralion_export.export(checkpoint, out, precision, _save)
            with staged_model_file(str(marker)) as staged:
                Path(staged).write_text(json.dumps(expected), encoding="utf-8")
    return out


@dataclass
class Segment:
    start: float
    end: float
    text: str


def _banned(ids: list[int]) -> list[int]:
    """Tokens that would repeat an n-gram already generated (transformers' NoRepeatNGramLogitsProcessor)."""
    n = NO_REPEAT_NGRAM
    if len(ids) + 1 < n:
        return []
    prefix = tuple(ids[-(n - 1):])
    return [ids[i + n - 1] for i in range(len(ids) - n + 1) if tuple(ids[i:i + n - 1]) == prefix]


def _clean(text: str) -> str:
    """The speaker tag MERaLiON sometimes starts with goes (meralion_3_asr's postprocessing)."""
    text = text.strip()
    for tag in ("<Speaker1>:", "<Speaker1>", "Speaker 1:"):
        if text.startswith(tag):
            text = text[len(tag):].lstrip()
    return text


class MeralionASR:
    """The encoder and the stateful decoder, compiled once; requests take turns (one infer request each)."""

    def __init__(self, checkpoint: Path, irs: Path, device: str):
        from tokenizers import Tokenizer
        from transformers import WhisperFeatureExtractor

        core = ov.Core()
        # The decoder's cache is OpenVINO state with dynamic shapes, which the NPU plugin does not
        # compile; on the NPU the static encoder runs there and the decoder on the CPU.
        on_npu = device.upper().startswith("NPU")
        decoder_device = "CPU" if on_npu else device
        encoder_config = openvino_compile_config(device)
        if on_npu:
            # The NPU takes about 70 s to compile the encoder, a cached start about one. Not for a GPU:
            # its blob holds the weights again (3 GB) to save a few seconds.
            encoder_config["CACHE_DIR"] = str(irs / "cache")
        encoder = core.compile_model(str(irs / "encoder.xml"), device, encoder_config)
        decoder = core.compile_model(
            str(irs / "decoder.xml"), decoder_device, openvino_compile_config(decoder_device)
        )
        self.devices = {
            "encoder": openvino_execution_device(encoder, device),
            "decoder": openvino_execution_device(decoder, decoder_device),
        }
        self.encoder = encoder.create_infer_request()
        self.decoder = decoder.create_infer_request()
        self.tokenizer = Tokenizer.from_file(str(checkpoint / "tokenizer.json"))
        self.prefix = self.tokenizer.encode(PROMPT_PREFIX, add_special_tokens=False).ids
        self.suffix = self.tokenizer.encode(PROMPT_SUFFIX, add_special_tokens=False).ids
        self.features = WhisperFeatureExtractor(
            feature_size=128, sampling_rate=SAMPLE_RATE, hop_length=160, chunk_length=CHUNK_SECONDS, n_fft=400
        )
        self.lock = threading.Lock()

    def _mel(self, chunk: np.ndarray) -> np.ndarray:
        # do_normalize: the processor zero-means / unit-variances each chunk's waveform first.
        return self.features(
            [chunk], sampling_rate=SAMPLE_RATE, return_tensors="np", return_attention_mask=True,
            padding="max_length", do_normalize=True,
        )["input_features"].astype(np.float32)

    def _chunk(self, chunk: np.ndarray) -> str:
        self.encoder.infer({"mel": self._mel(chunk)})
        speech = np.array(self.encoder.get_output_tensor(0).data)
        no_embeds = np.zeros((1, 0, HIDDEN_SIZE), np.float32)
        self.decoder.reset_state()
        self.decoder.infer({"input_ids": np.array([self.prefix], np.int64), "inputs_embeds": speech})
        self.decoder.infer({"input_ids": np.array([self.suffix], np.int64), "inputs_embeds": no_embeds})
        out: list[int] = []
        for _ in range(MAX_NEW_TOKENS):
            logits = self.decoder.get_output_tensor(0).data[0, -1]
            banned = _banned(out)
            if banned:
                logits = logits.copy()
                logits[banned] = -np.inf
            token = int(logits.argmax())
            if token in EOS_IDS:
                break
            out.append(token)
            self.decoder.infer({"input_ids": np.array([[token]], np.int64), "inputs_embeds": no_embeds})
        return _clean(self.tokenizer.decode(out, skip_special_tokens=True))

    def transcribe(self, audio: np.ndarray) -> list[Segment]:
        """16 kHz mono float audio -> one segment per 30 s chunk (blocking)."""
        audio = np.asarray(audio, dtype=np.float32)
        peak = float(np.abs(audio).max()) if audio.size else 0.0
        if peak > 1.0:
            audio = audio / peak
        if audio.size < MIN_SECONDS * SAMPLE_RATE:
            return []
        step = CHUNK_SECONDS * SAMPLE_RATE
        segments = []
        with self.lock:
            for start in range(0, audio.size, step):
                chunk = audio[start:start + step]
                if chunk.size < MIN_SECONDS * SAMPLE_RATE:
                    continue
                text = self._chunk(chunk)
                if text:
                    segments.append(Segment(start / SAMPLE_RATE, (start + chunk.size) / SAMPLE_RATE, text))
        return segments
