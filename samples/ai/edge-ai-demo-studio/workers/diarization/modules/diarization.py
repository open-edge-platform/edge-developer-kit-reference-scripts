# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Stateless diarization/embedding inference helpers.

Both `compute_embedding` and `compute_diarization` accept an already-loaded
pyannote `Pipeline` as their first argument so this module has no dependency
on global state and can be unit tested in isolation.
"""

import json
import logging
from typing import Optional

import numpy as np

from modules.audio import prepare_audio_input

logger = logging.getLogger("uvicorn.error")

SPEAKER_MATCH_THRESHOLD = 0.5


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def _normalize(vec: np.ndarray) -> np.ndarray:
    """L2-normalize a vector, returning it unchanged if it has zero norm."""
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 0 else vec


def compute_embedding(pipeline, audio_bytes: bytes) -> dict:
    """CPU-bound embedding inference (runs in thread pool).

    Runs the diarization pipeline with num_speakers=1 so the whole clip is
    treated as a single speaker, then returns the embedding the pipeline
    produced for that speaker.
    """
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

    # Build all (similarity, speaker_id, profile_idx, label) candidates and
    # greedily assign best matches first, without reusing a speaker or profile.
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
) -> dict:
    """CPU-bound diarization inference (runs in thread pool)."""
    threshold = (
        speaker_match_threshold
        if speaker_match_threshold is not None
        else SPEAKER_MATCH_THRESHOLD
    )
    audio_input = prepare_audio_input(audio_bytes)

    diarize_kwargs = {}
    if num_speakers is not None:
        diarize_kwargs["num_speakers"] = num_speakers

    output = pipeline(audio_input, **diarize_kwargs)
    if hasattr(output, "speaker_diarization"):
        annotation = output.speaker_diarization
        raw_embeddings = getattr(output, "speaker_embeddings", None)
    else:
        annotation = output
        raw_embeddings = None

    # Build a {speaker_label: normalized embedding} map straight from the
    # pipeline output — community-1 returns one embedding per speaker,
    # aligned with annotation.labels(), so no separate embedding model or
    # per-segment inference pass is needed.
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
