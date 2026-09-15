# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Voice/audio emotion recognition using OpenVINO.

Supports two modes:
- Dimensional (audeering): outputs arousal, dominance, valence scores [0,1]
  then maps to categorical emotions for UI display.
- Categorical (wav2vec2-xlsr): outputs direct emotion class probabilities.

The whole recording is analysed, not a single fixed-length excerpt. Audio is
split into speech-only windows, each window is scored independently, and the
per-window results are aggregated with a duration weighting. Windows are a
fixed sample count so the same code path works on NPU (which needs a static
input shape) as on CPU/GPU.
"""

import json
import logging
import math
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import openvino as ov
import yaml
from transformers import Wav2Vec2FeatureExtractor

from src.models.base import VoiceEmotionBase, ROOT_DIR

logger = logging.getLogger(__name__)

CONFIG_PATH = ROOT_DIR / "config.yaml"

SAMPLE_RATE = 16000
_STATIC_AUDIO_SAMPLES = 80000   # 5 seconds at 16kHz — one analysis window
_MAX_WINDOWS = 60               # cap on windows scored per recording
_MIN_WINDOW_SAMPLES = 8000      # 0.5s — shorter speech fragments are discarded


def load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


# Range each dimension occupies on ordinary calm speech, measured as p5..p95 over
# the 25 read-speech samples in voice_samples/ (87 windows, 5 languages) using the
# audeering model. Inside this band the voice is treated as carrying no polarity;
# a reading only means something once it leaves the band.
#
# The band matters because this model's outputs are compressed AND
# language-dependent: English read speech sits near arousal 0.37 while Arabic and
# Turkish sit near 0.75, so the pooled distribution is not a tight bell around one
# centre. Judging against a single midpoint (or against 0.5) marks a large share of
# perfectly calm speech as emotional. Re-measure if the model changes.
_DEFAULT_CALIBRATION = {
    "arousal_band": [0.377, 0.793],
    "dominance_band": [0.468, 0.744],
    "valence_band": [0.367, 0.681],
}

# Smoothing mass added to every emotion before normalizing, so a clean in-band
# reading reports neutral with high but not absolute confidence.
_EMOTION_SMOOTHING = 0.02


def _band_deviation(value: float, band) -> float:
    """Signed distance outside a neutral band, 0 inside it, saturating at +/-1.

    Scaled by the band's half-width so each dimension contributes comparably.
    """
    low, high = float(band[0]), float(band[1])
    half_width = max((high - low) / 2.0, 1e-6)
    if value < low:
        return -math.tanh((low - value) / half_width)
    if value > high:
        return math.tanh((value - high) / half_width)
    return 0.0


def _dimensional_to_emotion(
    arousal: float, valence: float, dominance: float, calibration: Dict[str, Any] = None
) -> Dict[str, float]:
    """Map arousal/valence/dominance to categorical emotion probabilities.

    Uses Russell's circumplex model extended with dominance, expressed as deviation
    from the neutral band rather than from a fixed midpoint — so speech that looks
    like ordinary calm speech scores neutral regardless of the language-dependent
    offset in the model's raw outputs.
    """
    calib = {**_DEFAULT_CALIBRATION, **(calibration or {})}

    a = _band_deviation(arousal, calib["arousal_band"])
    v = _band_deviation(valence, calib["valence_band"])
    d = _band_deviation(dominance, calib["dominance_band"])

    emotions = {}

    # Neutral: every dimension sits inside the range ordinary speech occupies.
    emotions["neutral"] = math.exp(-(a * a + v * v + d * d) / 1.5)
    # Happy: valence above the band, arousal raised
    emotions["happy"] = max(0.0, v) * max(0.0, a)
    # Calm: valence above the band, arousal lowered
    emotions["calm"] = max(0.0, v) * max(0.0, -a)
    # Surprised: arousal above the band without a clear valence direction
    emotions["surprised"] = max(0.0, a) * max(0.0, 1.0 - abs(v))
    # Angry: valence below the band, arousal raised, asserting dominance
    emotions["angry"] = max(0.0, -v) * max(0.0, a) * max(0.0, 0.5 + d)
    # Fearful: valence below the band, arousal raised, ceding dominance
    emotions["fearful"] = max(0.0, -v) * max(0.0, a) * max(0.0, 0.5 - d)
    # Sad: valence below the band, arousal lowered
    emotions["sad"] = max(0.0, -v) * max(0.0, -a)
    # Disgust: valence below the band with raised arousal and dominance
    emotions["disgust"] = max(0.0, -v) * max(0.0, a) * max(0.0, d) * 0.5

    # Smooth before normalizing. Inside the band every non-neutral term is exactly
    # zero, which would report neutral at a flat 100% — more certainty than a single
    # model reading of a few seconds of audio can support.
    emotions = {k: v + _EMOTION_SMOOTHING for k, v in emotions.items()}

    total = sum(emotions.values())
    emotions = {k: v / total for k, v in emotions.items()}

    return emotions


def _resolve_logit_bias(labels: List[str], model_cfg: Dict[str, Any]) -> np.ndarray:
    """Build the per-class bias vector (aligned to `labels`) from config.

    Keyed by label name rather than position, so it stays correct even if the
    exported model's id2label order differs from config.yaml's.
    """
    bias_cfg = (model_cfg.get("calibration") or {}).get("logit_bias") or {}
    return np.array([float(bias_cfg.get(label, 0.0)) for label in labels], dtype=np.float32)


def _energy_speech_regions(audio: np.ndarray) -> List[Tuple[int, int]]:
    """Fallback speech detection using short-term energy.

    Returns [(start_sample, end_sample), ...]. Used when the Silero VAD that
    ships with faster-whisper is unavailable.
    """
    frame = 400   # 25ms
    hop = 160     # 10ms
    if len(audio) < frame:
        return []

    n_frames = 1 + (len(audio) - frame) // hop
    rms = np.empty(n_frames, dtype=np.float32)
    for i in range(n_frames):
        chunk = audio[i * hop:i * hop + frame]
        rms[i] = np.sqrt(np.mean(chunk * chunk) + 1e-12)

    # Threshold relative to the loudest part of the clip, with an absolute floor
    threshold = max(float(rms.max()) * 0.15, 1e-3)
    voiced = rms > threshold
    if not voiced.any():
        return []

    regions = []
    start = None
    for i, is_voiced in enumerate(voiced):
        if is_voiced and start is None:
            start = i
        elif not is_voiced and start is not None:
            regions.append((start * hop, min(i * hop + frame, len(audio))))
            start = None
    if start is not None:
        regions.append((start * hop, len(audio)))

    # Merge regions separated by less than 300ms, then drop very short ones
    merged: List[Tuple[int, int]] = []
    for region_start, region_end in regions:
        if merged and region_start - merged[-1][1] < int(0.3 * SAMPLE_RATE):
            merged[-1] = (merged[-1][0], region_end)
        else:
            merged.append((region_start, region_end))

    return [(s, e) for s, e in merged if e - s >= _MIN_WINDOW_SAMPLES]


def _speech_regions(audio: np.ndarray) -> List[Tuple[int, int]]:
    """Locate speech regions across the whole recording.

    Prefers the Silero VAD bundled with faster-whisper (already a project
    dependency, runs fully offline); falls back to energy gating.
    """
    try:
        from faster_whisper.vad import get_speech_timestamps

        timestamps = get_speech_timestamps(audio)
        regions = [
            (int(t["start"]), int(t["end"]))
            for t in timestamps
            if int(t["end"]) - int(t["start"]) >= _MIN_WINDOW_SAMPLES
        ]
        if regions:
            return regions
        # VAD ran but found nothing — trust it only if the clip is not silent
        logger.debug("Silero VAD found no speech regions")
        return []
    except Exception as exc:
        logger.debug("Silero VAD unavailable (%s), using energy gating", exc)
        return _energy_speech_regions(audio)


class VoiceEmotionAnalyzer(VoiceEmotionBase):
    """Voice emotion recognition using OpenVINO backend.

    Automatically detects dimensional vs categorical mode from config.
    """

    def __init__(self, device: str = "CPU", config: dict = None) -> None:
        super().__init__(device=device, config=config)
        self._config = config or load_config()

        model_cfg = self._config.get("models", {}).get("voice_emotion", {})
        export_dir = ROOT_DIR / model_cfg.get("export_dir", "models/wav2vec2-emotion-dimensional")
        self._mode = model_cfg.get("mode", "dimensional")
        self._dimensions = model_cfg.get("dimensions", ["arousal", "dominance", "valence"])
        self._window_samples = model_cfg.get("static_audio_samples", _STATIC_AUDIO_SAMPLES)
        self._max_windows = model_cfg.get("max_windows", _MAX_WINDOWS)
        self._calibration = {**_DEFAULT_CALIBRATION, **(model_cfg.get("calibration") or {})}

        # Prefer the exported model's own id2label over the config list — a
        # mismatched order silently mislabels every prediction. Dimensional models
        # are exempt: their id2label holds the three regression outputs, not emotion
        # classes, so comparing the two lists is meaningless and only logs noise.
        if self._mode == "dimensional":
            self._labels = list(model_cfg.get("labels") or self._dimensions)
        else:
            self._labels = self._resolve_labels(export_dir, model_cfg)

        # Per-class logit bias to subtract before softmax (categorical models only).
        # This model's raw logits are not centred at zero per class, so argmax skews
        # toward whichever class has the highest average logit on ordinary speech —
        # measured on voice_samples/ (25 calm files, 65 windows, 5 languages), calm
        # read speech won "angry" or "happy" most of the time and "neutral" only 6%.
        # Subtracting each class's measured mean logit recentres the distribution;
        # re-measure if the model changes.
        self._logit_bias = (
            _resolve_logit_bias(self._labels, model_cfg)
            if self._mode == "categorical"
            else np.zeros(len(self._labels), dtype=np.float32)
        )

        logger.info("Loading voice emotion model from %s on %s (mode=%s)", export_dir, device, self._mode)

        self._feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(str(export_dir))

        # Load classifier head weights for dimensional models (not in OV export)
        self._head = None
        head_path = export_dir / "classifier_head.npz"
        if self._mode == "dimensional" and head_path.exists():
            head_data = np.load(str(head_path))
            self._head = {
                "dense_weight": head_data["dense_weight"],
                "dense_bias": head_data["dense_bias"],
                "out_proj_weight": head_data["out_proj_weight"],
                "out_proj_bias": head_data["out_proj_bias"],
            }
            logger.info("Loaded classifier head from %s", head_path)

        # Without the head there is no regression layer to turn hidden states into
        # arousal/dominance/valence. Reporting the first three hidden dimensions
        # instead would look like a real measurement while being meaningless, so the
        # analyzer reports "unavailable" and the pipeline falls back to text only.
        self._head_missing = self._mode == "dimensional" and self._head is None
        if self._head_missing:
            logger.error(
                "Dimensional voice emotion model at %s has no classifier_head.npz — "
                "voice emotion will report unavailable. Re-export the model.",
                export_dir,
            )

        try:
            self._compiled_model = self._compile_model(export_dir, device)
        except Exception as e:
            if device.upper() != "CPU":
                logger.warning("Failed to load voice emotion on %s (%s), falling back to CPU", device, e)
                device = "CPU"
                self.device = device
                self._compiled_model = self._compile_model(export_dir, "CPU")
            else:
                raise

        self._loaded = True
        logger.info(
            "VoiceEmotionAnalyzer loaded on %s (mode=%s, window=%.1fs, max_windows=%d)",
            self.device, self._mode, self._window_samples / SAMPLE_RATE, self._max_windows,
        )

    @staticmethod
    def _resolve_labels(export_dir: Path, model_cfg: dict) -> List[str]:
        """Read label order from the exported model config, falling back to config.yaml."""
        fallback = model_cfg.get(
            "labels",
            ["angry", "calm", "disgust", "fearful", "happy", "neutral", "sad", "surprised"],
        )
        config_json = export_dir / "config.json"
        try:
            with open(config_json) as f:
                id2label = json.load(f).get("id2label")
            if id2label:
                labels = [id2label[str(i)] for i in range(len(id2label))]
                if labels != list(fallback):
                    logger.warning(
                        "config.yaml labels %s do not match the model's id2label %s — using the model's order",
                        list(fallback), labels,
                    )
                return labels
        except Exception as exc:
            logger.debug("Could not read id2label from %s (%s)", config_json, exc)
        return list(fallback)

    def _compile_model(self, export_dir: Path, device: str):
        core = ov.Core()
        model_xml = export_dir / "openvino_model.xml"
        model = core.read_model(str(model_xml))

        if device.upper() == "NPU":
            static_shape = [1, self._window_samples]
            model.reshape({"input_values": static_shape})
            logger.info("Reshaped voice emotion model to static %s for NPU", static_shape)

        ov_config = {}
        cache_dir = ROOT_DIR / "data" / "model_cache"
        if cache_dir.exists() and os.access(str(cache_dir), os.W_OK):
            ov_config["CACHE_DIR"] = str(cache_dir)

        return core.compile_model(model, device, ov_config)

    def is_loaded(self) -> bool:
        return self._loaded

    # ------------------------------------------------------------------
    # Windowing
    # ------------------------------------------------------------------

    def _build_windows(self, audio: np.ndarray) -> List[Tuple[int, int]]:
        """Split the whole recording into speech-only analysis windows.

        Returns [(start_sample, end_sample), ...] covering every speech region,
        uniformly subsampled if the recording yields more than max_windows.
        """
        regions = _speech_regions(audio)
        if not regions:
            return []

        # A window shorter than this is mostly zero-padding once fed to the
        # model, which is what skewed results before. Drop such remainders —
        # unless the region yields nothing else, since a short utterance still
        # deserves a reading (duration weighting keeps its influence small).
        min_tail = max(_MIN_WINDOW_SAMPLES, int(0.4 * self._window_samples))

        windows: List[Tuple[int, int]] = []
        for region_start, region_end in regions:
            offset = region_start
            region_windows: List[Tuple[int, int]] = []
            while offset < region_end:
                end = min(offset + self._window_samples, region_end)
                length = end - offset
                if length >= min_tail or (not region_windows and length >= _MIN_WINDOW_SAMPLES):
                    region_windows.append((offset, end))
                offset = end
            windows.extend(region_windows)

        if len(windows) > self._max_windows:
            # Spread the sample evenly across the recording rather than
            # truncating to the first N, so the whole timeline is represented.
            idx = np.linspace(0, len(windows) - 1, self._max_windows).round().astype(int)
            kept = [windows[i] for i in sorted(set(idx.tolist()))]
            logger.info(
                "Voice emotion: %d windows exceeds cap %d — analysing %d evenly spaced windows",
                len(windows), self._max_windows, len(kept),
            )
            windows = kept

        return windows

    def _window_scores(self, segment: np.ndarray) -> np.ndarray:
        """Run one window through the model.

        Returns class probabilities (categorical) or the raw pooled hidden
        state (dimensional). Normalisation is applied to the real samples only,
        then the result is zero-padded — padding after normalisation keeps the
        silence at true zero instead of a DC offset, and stops the padding from
        dominating the model's mean-pooling.
        """
        inputs = self._feature_extractor(
            segment, sampling_rate=SAMPLE_RATE, return_tensors="np", padding=False,
        )
        values = inputs["input_values"].astype(np.float32)

        if values.shape[1] < self._window_samples:
            padded = np.zeros((1, self._window_samples), dtype=np.float32)
            padded[0, :values.shape[1]] = values[0]
            values = padded
        elif values.shape[1] > self._window_samples:
            values = values[:, :self._window_samples]

        result = self._compiled_model({"input_values": values})
        return np.asarray(list(result.values())[0][0])

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze_audio(self, audio: np.ndarray) -> Dict[str, Any]:
        start = time.perf_counter()

        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        audio = audio.astype(np.float32)

        total_duration = len(audio) / SAMPLE_RATE

        if self._head_missing:
            return {
                "emotion": None,
                "score": 0.0,
                "all_emotions": {},
                "windowCount": 0,
                "analyzedDurationS": 0.0,
                "totalDurationS": round(total_duration, 2),
                "timeline": [],
                "unavailableReason": "classifier head missing from the exported model",
            }

        windows = self._build_windows(audio)

        if not windows:
            logger.info(
                "Voice emotion: no speech detected in %.1fs of audio — skipping", total_duration
            )
            return {
                "emotion": None,
                "score": 0.0,
                "all_emotions": {},
                "windowCount": 0,
                "analyzedDurationS": 0.0,
                "totalDurationS": round(total_duration, 2),
                "timeline": [],
                "unavailableReason": "no speech detected",
            }

        outputs = []
        weights = []
        for window_start, window_end in windows:
            outputs.append(self._window_scores(audio[window_start:window_end]))
            weights.append((window_end - window_start) / SAMPLE_RATE)

        weights_arr = np.asarray(weights, dtype=np.float32)
        analyzed_duration = float(weights_arr.sum())

        if self._mode == "dimensional":
            result = self._process_dimensional(outputs, weights_arr, windows)
        else:
            result = self._process_categorical(outputs, weights_arr, windows)

        result["windowCount"] = len(windows)
        result["analyzedDurationS"] = round(analyzed_duration, 2)
        result["totalDurationS"] = round(total_duration, 2)

        # Share of windows that independently agreed with the aggregate verdict. A low
        # value means the reading rests on a minority of the recording, so fusion
        # weights it down rather than treating it as a confident measurement.
        timeline = result.get("timeline") or []
        if timeline:
            agreeing = sum(1 for entry in timeline if entry.get("emotion") == result.get("emotion"))
            result["agreement"] = round(agreeing / len(timeline), 3)

        elapsed = time.perf_counter() - start
        logger.debug(
            "Voice emotion (%s) took %.3fs over %d windows (%.1fs speech of %.1fs total) -> %s (%.2f)",
            self._mode, elapsed, len(windows), analyzed_duration, total_duration,
            result.get("emotion"), result.get("score", 0.0),
        )
        return result

    def _process_dimensional(
        self, outputs: List[np.ndarray], weights: np.ndarray, windows: List[Tuple[int, int]]
    ) -> Dict[str, Any]:
        """Aggregate dimensional model outputs across windows.

        Each output is [seq_len, 1024] from the wav2vec2 base model: mean pool
        over time, apply the classifier head, then average the resulting
        arousal/dominance/valence across windows weighted by window duration.
        """
        per_window = []
        for hidden_states in outputs:
            pooled = hidden_states.mean(axis=0) if hidden_states.ndim == 2 else hidden_states

            x = pooled @ self._head["dense_weight"].T + self._head["dense_bias"]
            # audeering's RegressionHead applies tanh here, not ReLU. Verified against
            # the reference output published on the model card: 1s of silence gives
            # [0.5461, 0.6063, 0.4042] with tanh (matches to 9e-5) versus
            # [0.2902, 0.3203, 0.1887] with ReLU (off by 0.29).
            x = np.tanh(x)
            values = x @ self._head["out_proj_weight"].T + self._head["out_proj_bias"]

            per_window.append(np.clip(values[:len(self._dimensions)], 0.0, 1.0))

        stacked = np.stack(per_window)
        averaged = np.average(stacked, axis=0, weights=weights)

        dims = {
            dim_name: float(averaged[i]) if i < len(averaged) else 0.5
            for i, dim_name in enumerate(self._dimensions)
        }

        arousal = dims.get("arousal", 0.5)
        valence = dims.get("valence", 0.5)
        dominance = dims.get("dominance", 0.5)

        all_emotions = _dimensional_to_emotion(arousal, valence, dominance, self._calibration)
        top_emotion = max(all_emotions, key=all_emotions.get)

        timeline = []
        for (window_start, window_end), values in zip(windows, per_window):
            window_dims = {
                dim_name: float(values[i]) if i < len(values) else 0.5
                for i, dim_name in enumerate(self._dimensions)
            }
            window_emotions = _dimensional_to_emotion(
                window_dims.get("arousal", 0.5),
                window_dims.get("valence", 0.5),
                window_dims.get("dominance", 0.5),
                self._calibration,
            )
            window_top = max(window_emotions, key=window_emotions.get)
            timeline.append({
                "startS": round(window_start / SAMPLE_RATE, 2),
                "endS": round(window_end / SAMPLE_RATE, 2),
                "emotion": window_top,
                "score": round(window_emotions[window_top], 4),
            })

        return {
            "emotion": top_emotion,
            "score": all_emotions[top_emotion],
            "all_emotions": all_emotions,
            "dimensions": dims,
            "timeline": timeline,
        }

    def _process_categorical(
        self, outputs: List[np.ndarray], weights: np.ndarray, windows: List[Tuple[int, int]]
    ) -> Dict[str, Any]:
        """Aggregate categorical class probabilities across windows."""
        per_window = []
        for output in outputs:
            logits = output.mean(axis=0) if output.ndim == 2 else output
            if len(self._logit_bias) == len(logits):
                logits = logits - self._logit_bias
            exp_logits = np.exp(logits - np.max(logits))
            per_window.append(exp_logits / exp_logits.sum())

        stacked = np.stack(per_window)
        probs = np.average(stacked, axis=0, weights=weights)

        predicted_idx = int(np.argmax(probs))
        emotion = self._labels[predicted_idx] if predicted_idx < len(self._labels) else "neutral"

        all_emotions = {
            self._labels[i]: float(probs[i])
            for i in range(min(len(self._labels), len(probs)))
        }

        timeline = []
        for (window_start, window_end), window_probs in zip(windows, per_window):
            idx = int(np.argmax(window_probs))
            timeline.append({
                "startS": round(window_start / SAMPLE_RATE, 2),
                "endS": round(window_end / SAMPLE_RATE, 2),
                "emotion": self._labels[idx] if idx < len(self._labels) else "neutral",
                "score": round(float(window_probs[idx]), 4),
            })

        return {
            "emotion": emotion,
            "score": float(probs[predicted_idx]),
            "all_emotions": all_emotions,
            "timeline": timeline,
        }
