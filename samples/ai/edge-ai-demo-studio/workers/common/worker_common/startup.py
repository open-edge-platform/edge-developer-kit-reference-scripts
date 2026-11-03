# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Structured startup reports: what a worker is doing while the app starts it.

Each is one ``EDGE_AI_STUDIO_STARTUP <json>`` line on stdout, sent only when the app sets
``EDGE_AI_STUDIO_STARTUP_EVENTS=1``. A failure keeps its stage and carries a short summary, never raw log
text, a token or a full path (:func:`safe_text`).
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Callable, Iterator

__all__ = [
    "ENABLE_ENV",
    "PREFIX",
    "STAGES",
    "UNITS",
    "StartupStage",
    "enabled",
    "end_stage",
    "failure_reported",
    "report_failure",
    "report_progress",
    "report_stage",
    "safe_text",
    "startup_stage",
]

#: What every report line starts with; the app's process handler matches it.
PREFIX = "EDGE_AI_STUDIO_STARTUP "
#: Set (to anything but ``0``) by the app when it reads the reports.
ENABLE_ENV = "EDGE_AI_STUDIO_STARTUP_EVENTS"
#: The stages the app knows; anything else is a programming error here.
STAGES = ("downloading", "preparing", "loading-model", "checking-readiness")
#: Units the app can label: a byte count or a file count.
UNITS = ("bytes", "files")

#: Fewest seconds between two progress lines of one stage; the app only polls every few seconds.
PROGRESS_INTERVAL = 1.0
DETAIL_LIMIT = 120
SUMMARY_LIMIT = 200

_lock = threading.Lock()
# The stage reported last (None: back to generic), when its last progress
# line went out, and whether a failure was reported since that stage began.
_state: dict = {"stage": None, "progress_at": 0.0, "failed": False}
# The startup_stage blocks open in this thread or asyncio task, innermost
# last: closing an inner one hands the stage back to the outer one. Work a
# block hands to a thread (asyncio.to_thread copies the context) nests inside it.
_open: ContextVar[tuple[tuple[str, str | None], ...]] = ContextVar("startup_open_blocks", default=())


def enabled() -> bool:
    """Whether the app reads startup reports from this process."""
    return os.environ.get(ENABLE_ENV, "") not in ("", "0")


def _emit(payload: dict) -> None:
    # The leading newline ends any partial line another print left behind;
    # the app skips blank lines.
    line = f"\n{PREFIX}{json.dumps(payload, separators=(',', ':'))}\n"
    stream = sys.stdout
    if stream is None:
        return
    try:
        stream.write(line)
        stream.flush()
    except (OSError, ValueError):  # a closed stdout on shutdown
        pass


# The match starts at the beginning of a run of scheme characters, not at each letter in it, so a long
# run with no "://" is scanned once: linear on any input. Same in startup-events.ts.
_URL = re.compile(
    r"(?<![a-z0-9+.-])(?=(?<!_)[a-z]|[a-z0-9+.-]*?[+.-][a-z])([a-z0-9+.-]*)://"
    r"(?:[^\s/@]*@)?([^\s/?#'\"<>]+)([^\s?#'\"<>]*)(?:[?#][^\s'\"<>]*)?",
    re.IGNORECASE | re.ASCII,
)
_PATH = re.compile(r"(?<![\w:/.\\])(?:[A-Za-z]:)?(?:[\\/][^\s\\/'\"`<>]+){2,}[\\/]?")
_HF_TOKEN = re.compile(r"\bhf_[A-Za-z0-9]{6,}")
_AUTH_SCHEME = re.compile(r"\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
_SECRET_FIELD = re.compile(
    r"\b(token|access_token|api[_-]?key|apikey|password|passwd|secret|authorization|auth)"
    r"([\"']?\s*[=:]\s*[\"']?)[^\s\"'&,;]+",
    re.IGNORECASE,
)
# A 40+ character word run is a token (hash, key) when 16 consecutive alphanumerics mix letters and
# digits, so long hyphenated model names stay readable. ASCII word boundaries, as in startup-events.ts.
_LONG_RUN = re.compile(r"\b[A-Za-z0-9_-]{40,}\b", re.ASCII)
_TOKEN_PART = re.compile(r"(?<![A-Za-z0-9])(?=[A-Za-z]*[0-9])(?=[0-9]*[A-Za-z])[A-Za-z0-9]{16}")


def _basename(match: re.Match) -> str:
    parts = [p for p in re.split(r"[\\/]", match.group(0)) if p]
    return parts[-1] if parts else ""


def _mask_token(match: re.Match) -> str:
    run = match.group(0)
    return "***" if _TOKEN_PART.search(run) else run


def safe_text(text: object, limit: int = SUMMARY_LIMIT) -> str:
    """One short line of ``text`` that is safe to show: its first non-empty
    line, with tokens and credentials masked, URLs cut to host and path, and
    absolute paths cut to their last part, at most ``limit`` characters."""
    lines = [line.strip() for line in str(text).splitlines() if line.strip()]
    value = lines[0] if lines else ""
    value = _URL.sub(lambda m: f"{m.group(1)}://{m.group(2)}{m.group(3)}", value)
    value = _HF_TOKEN.sub("hf_***", value)
    value = _AUTH_SCHEME.sub(lambda m: f"{m.group(1)} ***", value)
    value = _SECRET_FIELD.sub(lambda m: f"{m.group(1)}{m.group(2)}***", value)
    value = _PATH.sub(_basename, value)
    value = _LONG_RUN.sub(_mask_token, value)
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) > limit:
        value = value[: limit - 1].rstrip() + "…"
    return value


StartupStage = str


def report_stage(stage: StartupStage, detail: str | None = None) -> None:
    """The worker is now in ``stage`` (``detail``: what it works on, e.g. a
    file or model name). Clears the previous stage's progress and failure."""
    if stage not in STAGES:
        raise ValueError(f"unknown startup stage {stage!r}; one of {', '.join(STAGES)}")
    if not enabled():
        return
    payload: dict = {"event": "stage", "stage": stage}
    if detail:
        cleaned = safe_text(detail, DETAIL_LIMIT)
        if cleaned:
            payload["detail"] = cleaned
    with _lock:
        _state.update(stage=stage, progress_at=0.0, failed=False)
        _emit(payload)


def report_progress(
    current: float,
    total: float | None = None,
    unit: str = "bytes",
    *,
    force: bool = False,
) -> None:
    """How far the current stage is, in ``unit``; nothing is sent without a current stage.

    Pass ``total`` only when known (else the app shows no percentage). Lines are thinned to one per
    :data:`PROGRESS_INTERVAL`; the final one always goes out.
    """
    if unit not in UNITS:
        raise ValueError(f"unknown progress unit {unit!r}; one of {', '.join(UNITS)}")
    if not enabled() or current is None or current < 0:
        return
    with _lock:
        stage = _state["stage"]
        if stage is None:
            return
        now = time.monotonic()
        done = total is not None and total > 0 and current >= total
        if not (force or done) and now - _state["progress_at"] < PROGRESS_INTERVAL:
            return
        _state["progress_at"] = now
        payload: dict = {"event": "progress", "stage": stage, "current": int(current), "unit": unit}
        if total is not None and total > 0:
            payload["total"] = int(total)
        _emit(payload)


def end_stage(stage: StartupStage | None = None) -> None:
    """The current stage (``stage``, if given, must be it) is over: the app
    goes back to its generic "Starting" until the next report."""
    if not enabled():
        return
    with _lock:
        current = _state["stage"]
        if current is None or (stage is not None and stage != current):
            return
        _state.update(stage=None, progress_at=0.0)
        _emit({"event": "stage-end", "stage": current})


def report_failure(summary: str) -> None:
    """Why the start failed, in one short line (:func:`safe_text` applies).
    The stage it failed in stays, so the app can say where it stopped."""
    if not enabled():
        return
    text = safe_text(summary)
    if not text:
        return
    with _lock:
        _state["failed"] = True
        _emit({"event": "failure", "summary": text})


def failure_reported() -> bool:
    """Whether a failure was reported since the current stage began -- so a
    generic catch-all does not overwrite a more specific summary."""
    with _lock:
        return bool(_state["failed"])


class _Stage:
    """What a :func:`startup_stage` block hands out."""

    def __init__(self, stage: str) -> None:
        self.stage = stage
        self.failed = False

    def progress(self, current: float, total: float | None = None, unit: str = "bytes") -> None:
        report_progress(current, total, unit)

    def fail(self, summary: str) -> None:
        """The stage failed without an exception (a readiness poll that gave
        up, say): report ``summary`` and keep the stage when the block ends."""
        self.failed = True
        report_failure(summary)


@contextmanager
def startup_stage(
    stage: StartupStage,
    detail: str | None = None,
    *,
    failure: Callable[[Exception], str] | None = None,
) -> Iterator[_Stage]:
    """Reports ``stage`` for the block; its end hands the stage back to an enclosing block, or to "Starting".

    An ``Exception`` leaving the block is reported as a failure (summary from ``failure(exc)``) unless a
    more specific one was already reported, then re-raised; the stage stays. A ``BaseException`` such as
    ``KeyboardInterrupt`` (a worker being stopped) reports nothing.
    """
    report_stage(stage, detail)
    handle = _Stage(stage)
    token = _open.set((*_open.get(), (stage, detail)))
    try:
        yield handle
    except Exception as exc:
        if not failure_reported():
            try:
                summary = failure(exc) if failure is not None else f"{type(exc).__name__}: {exc}"
            except Exception:  # noqa: BLE001 - a summary must never mask the error
                summary = type(exc).__name__
            report_failure(summary)
        raise
    finally:
        _open.reset(token)
    blocks = _open.get()
    outer = blocks[-1] if blocks else None
    if handle.failed:
        return
    if outer is not None:
        report_stage(*outer)
    else:
        end_stage(stage)
