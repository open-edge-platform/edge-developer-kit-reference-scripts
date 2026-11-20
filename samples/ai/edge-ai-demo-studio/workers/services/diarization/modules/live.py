# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Live diarization for ``WS /v1/audio/stream``: the speech-to-text worker's VAD stream, answered
with speakers instead of text.

The stream cuts utterances at the same pauses the speech-to-text stream does (same segmenter, same
defaults). Each utterance re-runs pyannote over the session's latest ``WINDOW_SECONDS`` of audio,
so speakers are clustered with all of that context rather than one utterance at a time, and every
answer carries the speaker segments of the whole session so far.
"""

import json
import logging
from collections import deque
from typing import Optional

import numpy as np
from audio_input_stream import SAMPLE_RATE
from worker_common import CancelToken, JobCancelled

from modules.audio import prepare_pcm_input
from modules.diarization import diarize_input
from modules.jobs import run_on_pipeline

logger = logging.getLogger("uvicorn.error")

# Audio each pass diarizes, seconds. Longer gives the clustering more of each voice to tell them
# apart; shorter keeps a pass (and so how far the labels lag) short on a CPU. Audio older than
# this keeps the speakers its last pass gave it.
WINDOW_SECONDS = 120.0
# Less speech than this gives pyannote too little to cluster: no pass yet.
MIN_AUDIO_SECONDS = 1.0


def relabel_by_overlap(
    next_segments: list[dict], prev_segments: list[dict], since: float = 0.0
) -> list[dict]:
    """Renames a pass's speakers to the previous ones they share the most time with.

    pyannote names speakers per run (``SPEAKER_00``...), so the same voice can come back under
    another name once more audio is re-clustered. Matching is one to one, greatest overlap
    first; a speaker with no counterpart keeps its name unless an earlier speaker holds it, and
    then gets an unused one. ``since`` is where the pass's audio starts: earlier segments cannot
    overlap it, so they only reserve their names.
    """
    if not prev_segments:
        return next_segments
    recent = [p for p in prev_segments if p["end"] > since]
    overlap: dict[tuple[str, str], float] = {}
    for n in next_segments:
        for p in recent:
            shared = min(n["end"], p["end"]) - max(n["start"], p["start"])
            if shared > 0:
                key = (n["speaker"], p["speaker"])
                overlap[key] = overlap.get(key, 0.0) + shared

    renamed: dict[str, str] = {}
    taken: set[str] = set()
    for (new, old), _ in sorted(overlap.items(), key=lambda kv: kv[1], reverse=True):
        if new in renamed or old in taken:
            continue
        renamed[new] = old
        taken.add(old)
    taken.update(p["speaker"] for p in prev_segments)
    for seg in next_segments:
        speaker = seg["speaker"]
        if speaker in renamed:
            continue
        name, n = speaker, 0
        while name in taken:
            name = f"SPEAKER_{n:02d}"
            n += 1
        renamed[speaker] = name
        taken.add(name)
    return [{**seg, "speaker": renamed[seg["speaker"]]} for seg in next_segments]


def merge_window(prev_segments: list[dict], next_segments: list[dict], window_start: float) -> list[dict]:
    """The earlier segments up to ``window_start``, then the newer pass's from there on."""
    before = [
        {**seg, "end": min(seg["end"], window_start)}
        for seg in prev_segments
        if seg["start"] < window_start
    ]
    merged = before + next_segments
    # A turn the window boundary split in two is one turn again.
    out: list[dict] = []
    for seg in merged:
        if out and out[-1]["speaker"] == seg["speaker"] and seg["start"] - out[-1]["end"] < 1e-3:
            out[-1] = {**out[-1], "end": max(out[-1]["end"], seg["end"])}
        else:
            out.append(seg)
    return out


def _optional_int(config: dict, name: str) -> Optional[int]:
    value = config.get(name)
    if value is None:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _embedding_json(value, name: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, list) or not all(
        isinstance(x, (int, float)) and not isinstance(x, bool) for x in value
    ):
        raise ValueError(f"{name} must be a list of numbers")
    return json.dumps(value)


class LiveDiarization:
    """One stream's diarization state (an ``audio_input_stream.UtteranceProcessor``).

    The client configures it with ``{"event": "config", ...}`` before its audio: the
    ``POST /v1/diarize`` fields, as JSON (``reference_embedding``/``speaker_profiles`` as lists).
    """

    def __init__(self, pipeline):
        self._pipeline = pipeline
        self._options: dict = {
            "reference_embedding": None,
            "reference_label": "Reference",
            "other_label": "Other",
            "speaker_profiles": None,
            "unknown_label": "Unknown",
            "num_speakers": None,
            "speaker_match_threshold": None,
            "min_speakers": None,
            "max_speakers": None,
        }
        # The latest WINDOW_SECONDS (plus a frame) of received audio; `_first_sample` is the index
        # of its first sample in the stream.
        self._frames: deque[np.ndarray] = deque()
        self._first_sample = 0
        self._samples = 0
        self._segments: list[dict] = []
        # How far into the received audio the last pass heard, seconds.
        self._covered_until = 0.0
        self._token = CancelToken()

    @property
    def _named_by_profile(self) -> bool:
        """Speakers are named by matching voice prints, the same voice the same name every pass."""
        return bool(self._options["reference_embedding"] or self._options["speaker_profiles"])

    def configure(self, event: dict) -> None:
        if event.get("event") != "config":
            raise ValueError(f"Unknown event {event.get('event')!r}")
        options = dict(self._options)
        for name in ("reference_label", "other_label", "unknown_label"):
            if name in event:
                if not isinstance(event[name], str) or not event[name]:
                    raise ValueError(f"{name} must be a non-empty string")
                options[name] = event[name]
        for name in ("num_speakers", "min_speakers", "max_speakers"):
            if name in event:
                options[name] = _optional_int(event, name)
        if "speaker_match_threshold" in event:
            value = event["speaker_match_threshold"]
            if value is not None and (not isinstance(value, (int, float)) or isinstance(value, bool)):
                raise ValueError("speaker_match_threshold must be a number")
            options["speaker_match_threshold"] = value
        if "reference_embedding" in event:
            options["reference_embedding"] = _embedding_json(
                event["reference_embedding"], "reference_embedding"
            )
        if "speaker_profiles" in event:
            profiles = event["speaker_profiles"]
            if profiles is not None and not isinstance(profiles, list):
                raise ValueError("speaker_profiles must be a list")
            # compute_diarization validates each profile.
            options["speaker_profiles"] = json.dumps(profiles) if profiles is not None else None
        if (
            options["min_speakers"] is not None
            and options["max_speakers"] is not None
            and options["min_speakers"] > options["max_speakers"]
        ):
            raise ValueError("min_speakers must not exceed max_speakers")
        self._options = options

    def add_audio(self, frame: np.ndarray) -> None:
        self._frames.append(frame)
        self._samples += len(frame)
        window = int(WINDOW_SECONDS * SAMPLE_RATE)
        while self._frames and self._samples - self._first_sample - len(self._frames[0]) >= window:
            self._first_sample += len(self._frames.popleft())

    async def process(self, utterance: dict) -> dict:
        # Everything received so far, not only up to this utterance: the speech after it is
        # where the next one starts.
        window_start = self._first_sample / SAMPLE_RATE
        covered_until = self._samples / SAMPLE_RATE
        if covered_until - window_start < MIN_AUDIO_SECONDS or not self._frames:
            return self._answer()
        pcm = np.concatenate(list(self._frames))
        # `configure` replaces the options rather than changing them, so this pass keeps its own.
        options = self._options
        try:
            result = await run_on_pipeline(self._diarize, pcm, options)
        except JobCancelled:
            # The stream closed mid-pass: what was known before stands.
            return self._answer()

        found = [
            {
                "speaker": seg["speaker"],
                "start": round(seg["start"] + window_start, 3),
                "end": round(seg["end"] + window_start, 3),
            }
            for seg in result["segments"]
        ]
        if not self._named_by_profile:
            found = relabel_by_overlap(found, self._segments, since=window_start)
        self._segments = merge_window(self._segments, found, window_start)
        self._covered_until = round(covered_until, 3)
        return self._answer()

    def _answer(self) -> dict:
        """The speakers known so far, and how much of the audio they cover."""
        return {
            "type": "speakers",
            "segments": self._segments,
            "covered_until": self._covered_until,
        }

    def _diarize(self, pcm: np.ndarray, options: dict) -> dict:
        """On the pipeline thread, after the jobs and passes queued before it."""
        # Raises JobCancelled out of the pipeline's hook once the stream has closed.
        self._token.check()
        return diarize_input(
            self._pipeline,
            prepare_pcm_input(pcm, SAMPLE_RATE),
            options["reference_embedding"],
            options["reference_label"],
            options["other_label"],
            options["speaker_profiles"],
            options["unknown_label"],
            options["num_speakers"],
            options["speaker_match_threshold"],
            options["min_speakers"],
            options["max_speakers"],
            progress=lambda _stage, _fraction: self._token.check(),
        )

    def close(self) -> None:
        self._token.cancel()
        self._frames.clear()
