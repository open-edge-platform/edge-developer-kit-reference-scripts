# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Stateless diarization/embedding inference; each helper takes the loaded pyannote `Pipeline`."""

import json
import logging
from typing import Callable, Optional

import numpy as np

from modules.audio import prepare_audio_input

logger = logging.getLogger("uvicorn.error")

SPEAKER_MATCH_THRESHOLD = 0.5

# Each stage's share of a job's 0-1 progress, roughly by time taken: pyannote's embedding pass
# (one voice print per chunk and local speaker) dominates.
STAGE_SPANS = {
    "decoding": (0.0, 0.02),
    "segmentation": (0.02, 0.3),
    "embeddings": (0.3, 0.92),
    "clustering": (0.92, 0.97),
    "matching": (0.97, 1.0),
}


class PipelineProgress:
    """Reports a diarization job as stages of one 0-1 progress; also the pipeline's ``hook=``.

    pyannote calls the hook repeatedly with ``completed``/``total`` during segmentation and
    embeddings, and once with the step's artifact when a step is done.
    """

    def __init__(self, report: Callable[[str, float], None]):
        self._report = report

    def stage(self, name: str, fraction: float = 0.0) -> None:
        start, end = STAGE_SPANS[name]
        self._report(name, start + (end - start) * min(max(fraction, 0.0), 1.0))

    def __call__(self, step_name, step_artifact=None, file=None, total=None, completed=None):
        if step_name in ("segmentation", "embeddings") and total:
            self.stage(step_name, (completed or 0) / total)
        elif step_name == "embeddings" and step_artifact is not None:
            self.stage("clustering")
        elif step_name == "discrete_diarization":
            self.stage("clustering", 1.0)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def _normalize(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 0 else vec


def compute_embedding(pipeline, audio_bytes: bytes) -> dict:
    """Speaker embedding for a clip, run with num_speakers=1 so the whole clip is one speaker."""
    audio_input = prepare_audio_input(audio_bytes)

    output = pipeline(audio_input, num_speakers=1)
    raw_embeddings = getattr(output, "speaker_embeddings", None)
    if raw_embeddings is None or len(raw_embeddings) == 0:
        raise ValueError("Pipeline did not return a speaker embedding for this audio")

    embedding = _normalize(np.array(raw_embeddings[0], dtype=np.float32).flatten())
    return {"embedding": embedding.tolist()}


def _match_multi_speaker_profiles(
    speaker_embeddings: dict[str, np.ndarray],
    speaker_profiles: str,
    unknown_label: str,
    threshold: float,
    all_spk_ids: set[str],
) -> dict[str, str]:
    """Greedy 1-to-1 assignment of detected speakers to labelled profiles."""
    try:
        profiles = json.loads(speaker_profiles)
    except json.JSONDecodeError as exc:
        raise ValueError("speaker_profiles is not valid JSON") from exc
    if not isinstance(profiles, list) or len(profiles) > 50:
        raise ValueError("speaker_profiles must be an array of at most 50 entries")

    ref_entries: list[tuple[str, np.ndarray]] = []
    for p in profiles:
        if not isinstance(p, dict) or "label" not in p or "embedding" not in p:
            raise ValueError("Each profile must have 'label' and 'embedding' keys")
        if not isinstance(p["embedding"], list) or not all(
            isinstance(x, (int, float)) for x in p["embedding"]
        ):
            raise ValueError("Embedding must be a list of numbers")
        emb = _normalize(np.array(p["embedding"], dtype=np.float32))
        ref_entries.append((p["label"], emb))

    # Best matches first, never reusing a speaker or a profile.
    candidates = []
    for spk_id, spk_emb in speaker_embeddings.items():
        for pi, (plabel, pemb) in enumerate(ref_entries):
            sim = cosine_similarity(spk_emb, pemb)
            logger.debug(
                "Speaker matching: %s vs profile '%s' => similarity %.4f (threshold %.2f)",
                spk_id,
                plabel,
                sim,
                threshold,
            )
            candidates.append((sim, spk_id, pi, plabel))
    candidates.sort(key=lambda x: x[0], reverse=True)

    assigned_labels: dict[str, str] = {}
    used_profiles: set[int] = set()
    used_speakers: set[str] = set()
    for sim, spk_id, pi, plabel in candidates:
        if spk_id in used_speakers or pi in used_profiles:
            continue
        if sim >= threshold:
            assigned_labels[spk_id] = plabel
            used_speakers.add(spk_id)
            used_profiles.add(pi)

    return {sid: assigned_labels.get(sid, unknown_label) for sid in all_spk_ids}


def _match_legacy_reference(
    speaker_embeddings: dict[str, np.ndarray],
    reference_embedding: str,
    reference_label: str,
    other_label: str,
    threshold: float,
) -> dict[str, str]:
    """Match a single reference embedding against detected speakers."""
    try:
        ref_data = json.loads(reference_embedding)
    except json.JSONDecodeError as exc:
        raise ValueError("reference_embedding is not valid JSON") from exc
    if not isinstance(ref_data, list) or not all(
        isinstance(x, (int, float)) for x in ref_data
    ):
        raise ValueError("reference_embedding must be a list of numbers")
    ref_emb = _normalize(np.array(ref_data, dtype=np.float32))

    best_ref_speaker = None
    best_similarity = -1.0
    for spk_id, spk_emb in speaker_embeddings.items():
        sim = cosine_similarity(spk_emb, ref_emb)
        if sim > best_similarity:
            best_similarity = sim
            best_ref_speaker = spk_id

    return {
        spk_id: (
            reference_label
            if spk_id == best_ref_speaker and best_similarity >= threshold
            else other_label
        )
        for spk_id in speaker_embeddings
    }


def compute_diarization(
    pipeline,
    audio_bytes: bytes,
    reference_embedding: Optional[str],
    reference_label: str,
    other_label: str,
    speaker_profiles: Optional[str],
    unknown_label: str,
    num_speakers: Optional[int],
    speaker_match_threshold: Optional[float] = None,
    progress: Optional[Callable[[str, float], None]] = None,
) -> dict:
    """Diarization on the pipeline thread; ``progress(stage, fraction)`` gets the job's fraction."""
    threshold = (
        speaker_match_threshold
        if speaker_match_threshold is not None
        else SPEAKER_MATCH_THRESHOLD
    )
    tracker = PipelineProgress(progress) if progress else None
    if tracker:
        tracker.stage("decoding")
    audio_input = prepare_audio_input(audio_bytes)

    diarize_kwargs = {}
    if num_speakers is not None:
        diarize_kwargs["num_speakers"] = num_speakers
    if tracker:
        tracker.stage("segmentation")
        diarize_kwargs["hook"] = tracker

    output = pipeline(audio_input, **diarize_kwargs)
    if tracker:
        tracker.stage("matching")
    if hasattr(output, "speaker_diarization"):
        annotation = output.speaker_diarization
        raw_embeddings = getattr(output, "speaker_embeddings", None)
    else:
        annotation = output
        raw_embeddings = None

    # community-1 returns one embedding per speaker, aligned with annotation.labels(), so no
    # separate embedding pass is needed.
    speaker_embeddings: dict[str, np.ndarray] = {}
    if raw_embeddings is not None:
        labels = list(annotation.labels())
        if len(labels) != len(raw_embeddings):
            logger.warning(
                "Speaker label/embedding count mismatch: %d labels vs %d "
                "embeddings; some speakers may be left unmatched",
                len(labels),
                len(raw_embeddings),
            )
        for label, emb in zip(labels, raw_embeddings):
            speaker_embeddings[label] = _normalize(
                np.array(emb, dtype=np.float32).flatten()
            )

    segments = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        segments.append(
            {
                "speaker_id": speaker,
                "start": round(turn.start, 3),
                "end": round(turn.end, 3),
            }
        )

    if speaker_profiles is not None and speaker_embeddings:
        all_spk_ids = {seg["speaker_id"] for seg in segments}
        speaker_map = _match_multi_speaker_profiles(
            speaker_embeddings, speaker_profiles, unknown_label, threshold, all_spk_ids
        )
    elif reference_embedding is not None and speaker_embeddings:
        speaker_map = _match_legacy_reference(
            speaker_embeddings, reference_embedding, reference_label, other_label, threshold
        )
    else:
        speaker_map = {}

    # Apply speaker labels, merge consecutive same-speaker segments, strip internal IDs
    merged = []
    for seg in segments:
        spk_id = seg.pop("speaker_id")
        seg["speaker"] = speaker_map.get(spk_id, spk_id)
        if merged and merged[-1]["speaker"] == seg["speaker"]:
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(seg)

    return {"segments": merged}
