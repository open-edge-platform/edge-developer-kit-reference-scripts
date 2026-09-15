# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Sentiment analysis OpenVINO wrapper.

Supports multi-class emotion models (Go Emotions 28-class, 7-class, 3-class).
Uses direct OpenVINO Core API with static shape reshaping for NPU compatibility.
NPU requires fixed input dimensions — dynamic shapes cause compilation failure.

Text longer than the model's window is split into sentence-aligned chunks and
each chunk is scored separately, then aggregated — the model never silently
truncates a long transcript down to its opening.
"""

import logging
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import os

import numpy as np
import openvino as ov
import yaml
from transformers import AutoTokenizer

from src.models.base import SentimentBase, ROOT_DIR

logger = logging.getLogger(__name__)

CONFIG_PATH = ROOT_DIR / "config.yaml"

_NPU_STATIC_SEQ_LEN = 128

# Sentence boundaries: Latin terminators, CJK full-width terminators, the Arabic
# question mark, Hindi/Devanagari danda (।), double danda (॥), or newlines. Matches
# the splitter used by the translator so both stages break text at the same places.
_SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?。！？؟।॥])\s+|\n+')
# CJK text is usually written without a space after the terminator, so the rule
# above never sees the boundary. Without this a Chinese or Japanese paragraph is one
# huge "sentence" that falls through to token-boundary splitting, which cuts
# mid-sentence instead of between sentences.
_CJK_SPLIT_RE = re.compile(r'(?<=[。！？])')

# Upper bound on chunks scored per message. Beyond this the chunks are sampled
# evenly across the whole text rather than truncated, so a very long transcript
# is still represented end-to-end at bounded cost.
_MAX_CHUNKS = 40

# Go Emotions labels mapped to high-level sentiment polarity
_EMOTION_TO_POLARITY: Dict[str, str] = {
    "admiration": "positive", "amusement": "positive", "approval": "positive",
    "caring": "positive", "desire": "positive", "excitement": "positive",
    "gratitude": "positive", "joy": "positive", "love": "positive",
    "optimism": "positive", "pride": "positive", "relief": "positive",
    "anger": "negative", "annoyance": "negative", "disappointment": "negative",
    "disapproval": "negative", "disgust": "negative", "embarrassment": "negative",
    "fear": "negative", "grief": "negative", "nervousness": "negative",
    "remorse": "negative", "sadness": "negative",
    "confusion": "neutral", "curiosity": "neutral", "realization": "neutral",
    "surprise": "neutral", "neutral": "neutral",
}


def load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


def _split_sentences(text: str) -> List[str]:
    """Split text into sentences for chunk-based analysis."""
    sentences: List[str] = []
    for part in _SENTENCE_SPLIT_RE.split(text.strip()):
        if not part:
            continue
        sentences.extend(piece for piece in _CJK_SPLIT_RE.split(part) if piece.strip())
    return [s.strip() for s in sentences if s.strip()]


class SentimentAnalyzer(SentimentBase):
    """Sentiment analysis using OpenVINO backend with NPU support.

    Handles both multi-class (Go Emotions 28, 7-class) and simple 3-class models.
    Output always includes a high-level polarity label (positive/neutral/negative)
    plus fine-grained emotion details when available.
    """

    def __init__(self, device: str = "CPU", config: dict = None) -> None:
        super().__init__(device=device, config=config)
        self._config = config or load_config()

        model_cfg = self._config.get("models", {}).get("sentiment", {})
        export_dir = ROOT_DIR / model_cfg.get("export_dir", "models/roberta-go-emotions")
        self._labels = model_cfg.get("labels", ["NEGATIVE", "NEUTRAL", "POSITIVE"])

        logger.info("Loading sentiment model from %s on %s", export_dir, device)

        self._tokenizer = AutoTokenizer.from_pretrained(str(export_dir))
        self._use_static_shapes = device.upper() == "NPU"
        self._max_length = _NPU_STATIC_SEQ_LEN if self._use_static_shapes else 512
        self._is_multilabel = len(self._labels) > 5
        self._max_chunks = int(model_cfg.get("max_chunks", _MAX_CHUNKS))

        try:
            self._num_special_tokens = int(self._tokenizer.num_special_tokens_to_add())
        except Exception:  # tokenizer without the helper — assume [CLS]/[SEP]
            self._num_special_tokens = 2

        try:
            self._compiled_model = self._compile_model(export_dir, device)
        except Exception as e:
            if device.upper() != "CPU":
                logger.warning("Failed to load sentiment on %s (%s), falling back to CPU", device, e)
                device = "CPU"
                self.device = device
                self._use_static_shapes = False
                self._max_length = 512
                self._compiled_model = self._compile_model(export_dir, "CPU")
            else:
                raise

        self._loaded = True
        logger.info("SentimentAnalyzer loaded on %s (%d labels)", self.device, len(self._labels))

    def _compile_model(self, export_dir: Path, device: str):
        core = ov.Core()
        model_xml = export_dir / "openvino_model.xml"
        model = core.read_model(str(model_xml))

        if device.upper() == "NPU":
            static_shape = [1, _NPU_STATIC_SEQ_LEN]
            model.reshape({inp.any_name: static_shape for inp in model.inputs})
            logger.info("Reshaped model to static %s for NPU", static_shape)

        ov_config = {}
        cache_dir = ROOT_DIR / "data" / "model_cache"
        if cache_dir.exists() and os.access(str(cache_dir), os.W_OK):
            ov_config["CACHE_DIR"] = str(cache_dir)

        return core.compile_model(model, device, ov_config)

    def is_loaded(self) -> bool:
        return self._loaded

    # ------------------------------------------------------------------
    # Chunking — the model window is a window, not a limit on what we read
    # ------------------------------------------------------------------

    def _token_budget(self) -> int:
        """Content tokens that fit in one pass, leaving room for specials.

        Must never exceed the window — a chunk built over budget would just be
        truncated again by the tokenizer, which is the bug this replaces.
        """
        return max(1, self._max_length - self._num_special_tokens)

    def _count_tokens(self, text: str) -> int:
        return len(self._tokenizer.encode(text, add_special_tokens=False))

    def _split_oversized(self, sentence: str, budget: int) -> List[str]:
        """Break a single sentence that exceeds the window on token boundaries.

        Rare (a sentence with no terminator, e.g. an unpunctuated transcript),
        but without this such a sentence would be dropped or truncated.
        """
        ids = self._tokenizer.encode(sentence, add_special_tokens=False)
        pieces = []
        for i in range(0, len(ids), budget):
            piece = self._tokenizer.decode(ids[i:i + budget], skip_special_tokens=True).strip()
            if piece:
                pieces.append(piece)
        return pieces or [sentence]

    def _build_chunks(self, text: str) -> List[Tuple[str, int]]:
        """Group sentences into (chunk, token_count) pairs that fit the window."""
        budget = self._token_budget()
        chunks: List[Tuple[str, int]] = []
        current: List[str] = []
        current_tokens = 0

        for sentence in _split_sentences(text):
            for part in (
                [sentence]
                if self._count_tokens(sentence) <= budget
                else self._split_oversized(sentence, budget)
            ):
                count = self._count_tokens(part)
                if current and current_tokens + count > budget:
                    chunks.append((" ".join(current), current_tokens))
                    current, current_tokens = [], 0
                current.append(part)
                current_tokens += count

        if current:
            chunks.append((" ".join(current), current_tokens))

        # Beyond the cap, sample evenly across the text instead of truncating,
        # so the reading still reflects the end of a long transcript.
        if len(chunks) > self._max_chunks:
            idx = np.linspace(0, len(chunks) - 1, self._max_chunks).round().astype(int)
            kept = [chunks[i] for i in sorted(set(idx.tolist()))]
            logger.info(
                "Sentiment: %d chunks exceeds cap %d — scoring %d sampled across the text",
                len(chunks), self._max_chunks, len(kept),
            )
            chunks = kept

        return chunks

    def _score_chunk(self, chunk: str) -> np.ndarray:
        """Run one chunk through the model and return per-label probabilities."""
        padding = "max_length" if self._use_static_shapes else False
        inputs = self._tokenizer(
            chunk, return_tensors="np", truncation=True,
            max_length=self._max_length, padding=padding,
        )

        input_data = {
            "input_ids": inputs["input_ids"].astype(np.int64),
            "attention_mask": inputs["attention_mask"].astype(np.int64),
        }

        result = self._compiled_model(input_data)
        logits = list(result.values())[0][0]

        if self._is_multilabel:
            # Multi-label sigmoid for Go Emotions
            return 1.0 / (1.0 + np.exp(-logits))

        # Softmax for single-label models
        exp_logits = np.exp(logits - np.max(logits))
        return exp_logits / exp_logits.sum()

    def analyze(self, text: str) -> Dict[str, Any]:
        start = time.perf_counter()

        chunks = self._build_chunks(text or "")
        if not chunks:
            chunks = [(text or "", 0)]

        scored = [(self._score_chunk(chunk), max(tokens, 1)) for chunk, tokens in chunks]

        # Length-weighted mean so a long chunk counts for more than a short one.
        # For text that fits in one pass this is identical to the old single-pass
        # result, so short messages behave exactly as before.
        probs = np.average(
            np.stack([p for p, _ in scored]),
            axis=0,
            weights=[w for _, w in scored],
        )

        predicted_idx = int(np.argmax(probs))
        top_emotion = self._labels[predicted_idx] if predicted_idx < len(self._labels) else "neutral"
        top_score = float(probs[predicted_idx])

        # Build all-emotions dict
        all_emotions = {self._labels[i]: float(probs[i]) for i in range(min(len(self._labels), len(probs)))}

        # Map to high-level polarity
        polarity = self._compute_polarity(all_emotions)

        # Averaging flattens a short outburst inside a long, calm transcript.
        # Surface the most-polarised chunk separately so that signal is not lost.
        peak = self._peak_chunk(scored, chunks)

        analyzed_tokens = sum(tokens for _, tokens in chunks)
        elapsed = time.perf_counter() - start
        logger.debug("Sentiment took %.3fs over %d chunk(s)/%d tokens: '%s' -> %s (%.2f) [%s]",
                     elapsed, len(chunks), analyzed_tokens, text[:50],
                     top_emotion, top_score, polarity["label"])

        return {
            "label": polarity["label"],
            "score": polarity["score"],
            "topEmotion": top_emotion,
            "topEmotionScore": top_score,
            "allEmotions": all_emotions,
            "chunkCount": len(chunks),
            "analyzedTokens": analyzed_tokens,
            "peak": peak,
        }

    def _peak_chunk(
        self,
        scored: List[Tuple[np.ndarray, int]],
        chunks: List[Tuple[str, int]],
    ) -> Optional[Dict[str, Any]]:
        """The chunk whose polarity is furthest from neutral, if any stands out."""
        if len(scored) < 2:
            return None

        best = None
        for i, (probs, _) in enumerate(scored):
            emotions = {
                self._labels[j]: float(probs[j])
                for j in range(min(len(self._labels), len(probs)))
            }
            polarity = self._compute_polarity(emotions)
            if polarity["label"] == "NEUTRAL":
                continue
            if best is None or polarity["score"] > best["score"]:
                best = {
                    "label": polarity["label"],
                    "score": polarity["score"],
                    "chunkIndex": i,
                    "excerpt": chunks[i][0][:160],
                }

        return best

    def _compute_polarity(self, all_emotions: Dict[str, float]) -> Dict[str, float]:
        """Aggregate fine-grained emotions into positive/neutral/negative polarity."""
        polarity_scores = {"positive": 0.0, "neutral": 0.0, "negative": 0.0}

        for emotion, score in all_emotions.items():
            polarity = _EMOTION_TO_POLARITY.get(emotion.lower(), "neutral")
            polarity_scores[polarity] += score

        total = sum(polarity_scores.values())
        if total > 0:
            for k in polarity_scores:
                polarity_scores[k] /= total

        best = max(polarity_scores, key=polarity_scores.get)
        return {"label": best.upper(), "score": polarity_scores[best]}
