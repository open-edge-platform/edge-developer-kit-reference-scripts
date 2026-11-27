# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Parallel batch Generate: deterministic attempt plans, a spawn worker pool, and ordered commit.

The collection owner (the Generate worker or the headless CLI) reserves recording indices and
derives every attempt seed before any worker starts (:func:`build_batch_plan`), so results do not
depend on the worker count. :class:`BatchRunner` runs attempts in spawned processes; each attempt
writes a staged episode under ``dataset/staging/<jobId>/attempt-<planIndex>/``. :class:`BatchJob`
commits staged episodes into the collection strictly in plan order as the resolved prefix grows,
keeps progress counters, and deletes the job's staging directory when the job ends.
"""

from __future__ import annotations

import argparse
import copy
import inspect
import json
import multiprocessing as mp
import os
import shutil
import signal
import sys
import threading
import time
import traceback
import uuid
from collections import deque
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from multiprocessing.connection import wait as wait_for_connections
from pathlib import Path
from typing import Any

from .dataset import CollectedEpisode, IncrementalEpisodeWriter, JSONNPZStagingWriter, atomic_write_json

# A crashed attempt is retried this many times before it is reported as ``worker-crashed``.
DEFAULT_CRASH_RETRIES = 1
# The job aborts on the crash after this many tolerated worker crashes (the third crash).
DEFAULT_MAX_WORKER_CRASHES = 2
# Children send at most this many progress messages per second per attempt.
PROGRESS_INTERVAL_SECONDS = 0.5
TERMINAL_OUTCOMES = frozenset({"recorded", "failed", "worker-crashed"})
_PR_SET_PDEATHSIG = 1


@dataclass(frozen=True)
class BatchAttempt:
    plan_index: int
    state_id: str
    recording_index: int
    attempt_seed: int


@dataclass(frozen=True)
class AttemptFailed:
    """Returned by an attempt function when the attempt ran but produced no episode."""

    reason: str
    message: str | None = None


@dataclass(frozen=True)
class BatchOutcome:
    plan_index: int
    status: str
    reason: str | None = None
    message: str | None = None
    staged_directory: str | None = None
    frames: int = 0
    elapsed_seconds: float = 0.0
    seed: int | None = None
    # Collection entry of a staged episode (as the interactive save writes it, minus the index).
    episode: Mapping[str, Any] | None = None

    @property
    def terminal(self) -> bool:
        return self.status in TERMINAL_OUTCOMES

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["episode"] = dict(self.episode) if self.episode is not None else None
        return value


@dataclass(frozen=True)
class BatchProgress:
    """Recorded frames so far of one in-flight attempt."""

    plan_index: int
    frames: int


@dataclass(frozen=True)
class BatchResult:
    job_id: str
    plan: tuple[BatchAttempt, ...]
    outcomes: tuple[BatchOutcome, ...]
    committed_episode_ids: tuple[str, ...]
    cancelled: bool
    aborted: bool = False
    error: str | None = None
    crashes: int = 0


def build_batch_plan(
    state_ids: Iterable[str],
    episodes_per_state: int,
    recording_indices: Iterable[int],
    derive_attempt_seed: Callable[[str, int], int],
) -> tuple[BatchAttempt, ...]:
    if not isinstance(episodes_per_state, int) or isinstance(episodes_per_state, bool) or episodes_per_state < 1:
        raise ValueError("episodes_per_state must be a positive integer.")
    states = tuple(state_ids)
    indices = iter(recording_indices)
    attempts: list[BatchAttempt] = []
    for state_id in states:
        if not isinstance(state_id, str) or not state_id:
            raise ValueError("Every batch state ID must be a non-empty string.")
        for _ in range(episodes_per_state):
            try:
                recording_index = next(indices)
            except StopIteration as error:
                raise ValueError("Not enough reserved recording indices for the batch plan.") from error
            attempts.append(
                BatchAttempt(
                    plan_index=len(attempts),
                    state_id=state_id,
                    recording_index=recording_index,
                    attempt_seed=int(derive_attempt_seed(state_id, recording_index)),
                )
            )
    try:
        next(indices)
    except StopIteration:
        return tuple(attempts)
    raise ValueError("Too many reserved recording indices for the batch plan.")


def attempt_directory(staging_root: str | Path, plan_index: int) -> Path:
    return Path(staging_root) / f"attempt-{plan_index:06d}"


def cpu_count() -> int:
    return os.cpu_count() or 1


def physical_core_count() -> int:
    """Best-effort physical CPU count, reserving two cores for Studio and rendering."""
    try:
        import psutil

        count = psutil.cpu_count(logical=False)
    except ImportError:
        count = None
    if count is None:
        count = cpu_count()
    return max(1, count - 2)


def cleanup_stale_staging(dataset_root: str | Path) -> None:
    """Delete leftover ``dataset/staging/*`` job directories (the owner calls this at startup)."""
    root = Path(dataset_root) / "staging"
    if not root.exists():
        return
    for child in root.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


class CollectionLock:
    """Exclusive ``flock`` on ``<collection>/collection.lock`` held by the collection's owner."""

    def __init__(self, collection_root: str | Path) -> None:
        self.path = Path(collection_root) / "collection.lock"
        self._stream: Any = None

    @property
    def held(self) -> bool:
        return self._stream is not None

    def acquire(self) -> CollectionLock:
        import fcntl

        if self._stream is not None:
            return self
        self.path.parent.mkdir(parents=True, exist_ok=True)
        stream = self.path.open("a+")
        try:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            stream.close()
            raise RuntimeError(f"Collection is already owned by another process: {self.path.parent}") from error
        self._stream = stream
        return self

    def release(self) -> None:
        import fcntl

        stream, self._stream = self._stream, None
        if stream is not None:
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
            finally:
                stream.close()

    def __enter__(self) -> CollectionLock:
        return self.acquire()

    def __exit__(self, *_args: Any) -> None:
        self.release()


# --- worker processes -------------------------------------------------------------------------


def _set_parent_death_signal(parent_pid: int) -> None:
    """Make the kernel SIGTERM this child when its parent dies, then close the startup race."""
    if sys.platform.startswith("linux"):
        try:
            import ctypes

            libc = ctypes.CDLL(None, use_errno=True)
            if libc.prctl(_PR_SET_PDEATHSIG, int(signal.SIGTERM), 0, 0, 0) != 0:
                print(
                    f"batch worker {os.getpid()}: PR_SET_PDEATHSIG failed (errno {ctypes.get_errno()}); "
                    "falling back to parent polling.",
                    file=sys.stderr,
                    flush=True,
                )
        except (OSError, AttributeError) as error:
            print(
                f"batch worker {os.getpid()}: PR_SET_PDEATHSIG unavailable ({error}); "
                "falling back to parent polling.",
                file=sys.stderr,
                flush=True,
            )
    _exit_if_orphaned(parent_pid)


def _exit_if_orphaned(parent_pid: int) -> None:
    if os.getppid() != parent_pid:
        os._exit(1)


def _accepts_keyword(function: Callable[..., Any], name: str) -> bool:
    try:
        parameters = inspect.signature(function).parameters.values()
    except (TypeError, ValueError):
        return False
    return any(
        parameter.kind is inspect.Parameter.VAR_KEYWORD
        or (parameter.name == name and parameter.kind is not inspect.Parameter.POSITIONAL_ONLY)
        for parameter in parameters
    )


def _worker_main(
    task_connection: Any,
    result_connection: Any,
    worker: Callable[..., Any],
    parent_pid: int,
    staging_root: str,
    environment: Mapping[str, str],
) -> None:
    # Before any renderer exists: per-worker EGL device and similar settings.
    os.environ.update(environment)
    # The owner handles Ctrl-C (cancel); workers are stopped by the owner, not by the terminal.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    _set_parent_death_signal(parent_pid)
    accepts_progress = _accepts_keyword(worker, "progress")
    while True:
        _exit_if_orphaned(parent_pid)
        if not task_connection.poll(1.0):
            continue
        try:
            task = task_connection.recv()
        except EOFError:
            return
        if task is None:
            return
        attempt, arguments = task
        directory = attempt_directory(staging_root, attempt.plan_index)
        # Retries and replacement workers always start from an empty attempt directory.
        shutil.rmtree(directory, ignore_errors=True)
        started = time.monotonic()
        last_progress = 0.0

        def progress(frames: int, *, _index: int = attempt.plan_index) -> None:
            nonlocal last_progress
            now = time.monotonic()
            if now - last_progress < PROGRESS_INTERVAL_SECONDS:
                return
            last_progress = now
            _exit_if_orphaned(parent_pid)
            result_connection.send(("progress", _index, int(frames)))

        keyword_arguments = dict(arguments)
        if accepts_progress:
            keyword_arguments["progress"] = progress
        try:
            result = worker(attempt, **keyword_arguments)
        except Exception as error:  # noqa: BLE001 - an attempt failure, not a worker crash.
            shutil.rmtree(directory, ignore_errors=True)
            payload = (type(error).__name__, str(error), traceback.format_exc(limit=20))
            result_connection.send(("done", attempt.plan_index, "error", payload, time.monotonic() - started))
            continue
        if result is None or isinstance(result, AttemptFailed):
            shutil.rmtree(directory, ignore_errors=True)
        result_connection.send(("done", attempt.plan_index, "ok", result, time.monotonic() - started))


@dataclass
class _PoolWorker:
    slot: int
    process: Any
    tasks: Any
    results: Any
    attempt: BatchAttempt | None = None


class BatchRunner:
    """Run picklable attempt callbacks in spawned workers and report outcomes as they resolve.

    Each worker process receives one attempt at a time over its own pipe, so the owner always
    knows which attempt a process runs. A crashed process is replaced immediately; its attempt is
    retried ``crash_retries`` times and then reported as ``worker-crashed``. Exceptions raised by
    an attempt are attempt failures (``failed`` with reason ``exception``) and are not retried.
    The job aborts after more than ``max_worker_crashes`` crashes (by default the third crash).
    """

    def __init__(self, *, workers: int, staging_root: str | Path, job_id: str | None = None) -> None:
        if not isinstance(workers, int) or isinstance(workers, bool) or workers < 1:
            raise ValueError("workers must be a positive integer.")
        self.workers = workers
        self.job_id = job_id or f"batch-{uuid.uuid4()}"
        self.staging_root = Path(staging_root) / self.job_id
        self.staging_root.mkdir(parents=True, exist_ok=False)

    def run(
        self,
        plan: Iterable[BatchAttempt],
        worker: Callable[..., Any],
        *,
        worker_arguments: Mapping[str, Any] | None = None,
        cancel_event: Any | None = None,
        on_progress: Callable[[BatchProgress], None] | None = None,
        on_outcome: Callable[[BatchOutcome], None] | None = None,
        max_worker_crashes: int = DEFAULT_MAX_WORKER_CRASHES,
        crash_retries: int = DEFAULT_CRASH_RETRIES,
        egl_devices: Sequence[int] | None = None,
    ) -> BatchResult:
        attempts = tuple(plan)
        if [attempt.plan_index for attempt in attempts] != list(range(len(attempts))):
            raise ValueError("Batch plan indices must be contiguous and ordered from zero.")
        context = mp.get_context("spawn")
        arguments = dict(worker_arguments or {})
        devices = tuple(int(device) for device in egl_devices or ())
        parent_pid = os.getpid()
        pending = deque(attempts)
        outcomes: dict[int, BatchOutcome] = {}
        crash_counts: dict[int, int] = {}
        crashes = 0
        cancelled = False
        aborted = False
        error: str | None = None
        pool: list[_PoolWorker] = []

        def spawn(slot: int) -> _PoolWorker:
            task_reader, task_writer = context.Pipe(duplex=False)
            result_reader, result_writer = context.Pipe(duplex=False)
            environment = {"MUJOCO_EGL_DEVICE_ID": str(devices[slot % len(devices)])} if devices else {}
            process = context.Process(
                target=_worker_main,
                args=(task_reader, result_writer, worker, parent_pid, str(self.staging_root), environment),
                name=f"{self.job_id}-worker-{slot}",
                daemon=True,
            )
            process.start()
            # Close the child's ends here so a dead child reads as EOF.
            task_reader.close()
            result_writer.close()
            return _PoolWorker(slot, process, task_writer, result_reader)

        def resolve(outcome: BatchOutcome) -> None:
            outcomes[outcome.plan_index] = outcome
            if on_outcome is not None:
                on_outcome(outcome)

        def handle(member: _PoolWorker, message: Any) -> None:
            kind = message[0]
            if kind == "progress":
                _kind, plan_index, frames = message
                if on_progress is not None and member.attempt is not None and member.attempt.plan_index == plan_index:
                    on_progress(BatchProgress(plan_index, int(frames)))
                return
            _kind, plan_index, status, payload, elapsed = message
            attempt = member.attempt
            if attempt is None or attempt.plan_index != plan_index:
                return
            member.attempt = None
            resolve(self._outcome(attempt, status, payload, float(elapsed)))

        def drain(member: _PoolWorker) -> None:
            while True:
                try:
                    if not member.results.poll():
                        return
                    message = member.results.recv()
                except (EOFError, OSError):
                    return
                handle(member, message)

        def close(member: _PoolWorker) -> None:
            for connection in (member.tasks, member.results):
                try:
                    connection.close()
                except OSError:
                    pass

        try:
            for slot in range(min(self.workers, len(attempts))):
                pool.append(spawn(slot))
            while pending or any(member.attempt is not None for member in pool):
                if cancel_event is not None and cancel_event.is_set():
                    cancelled = True
                    break
                for member in pool:
                    if member.attempt is None and pending and member.process.is_alive():
                        attempt = pending.popleft()
                        try:
                            member.tasks.send((attempt, arguments))
                        except (BrokenPipeError, OSError):
                            pending.appendleft(attempt)
                            continue
                        member.attempt = attempt
                wait_for_connections(
                    [member.results for member in pool] + [member.process.sentinel for member in pool],
                    timeout=0.1,
                )
                for member in pool:
                    drain(member)
                for position, member in enumerate(pool):
                    if member.process.is_alive():
                        continue
                    member.process.join()
                    # A result sent just before the process exited still counts.
                    drain(member)
                    close(member)
                    crashes += 1
                    attempt = member.attempt
                    member.attempt = None
                    if attempt is not None:
                        shutil.rmtree(attempt_directory(self.staging_root, attempt.plan_index), ignore_errors=True)
                        crash_counts[attempt.plan_index] = crash_counts.get(attempt.plan_index, 0) + 1
                        if crash_counts[attempt.plan_index] <= crash_retries:
                            pending.appendleft(attempt)
                        else:
                            resolve(
                                BatchOutcome(
                                    attempt.plan_index,
                                    "worker-crashed",
                                    "worker-crashed",
                                    f"The worker process exited with code {member.process.exitcode}.",
                                    seed=attempt.attempt_seed,
                                )
                            )
                    if crashes > max_worker_crashes:
                        aborted = True
                        error = f"Batch aborted after {crashes} worker crashes."
                        break
                    pool[position] = spawn(member.slot)
                if aborted:
                    break
        finally:
            for member in pool:
                if member.attempt is not None:
                    # Cancel, abort, or an owner-side failure: in-flight attempts are dropped.
                    member.process.terminate()
                else:
                    try:
                        member.tasks.send(None)
                    except (BrokenPipeError, OSError):
                        pass
            for member in pool:
                member.process.join(timeout=5)
                if member.process.is_alive():
                    member.process.kill()
                    member.process.join()
                close(member)
        resolved = tuple(
            outcomes.get(attempt.plan_index, BatchOutcome(attempt.plan_index, "cancelled", seed=attempt.attempt_seed))
            for attempt in attempts
        )
        return BatchResult(self.job_id, attempts, resolved, (), cancelled, aborted, error, crashes)

    def _outcome(self, attempt: BatchAttempt, status: str, payload: Any, elapsed: float) -> BatchOutcome:
        seed = attempt.attempt_seed
        if status == "error":
            name, message, _trace = payload
            return BatchOutcome(attempt.plan_index, "failed", "exception", f"{name}: {message}", elapsed_seconds=elapsed, seed=seed)
        if payload is None:
            return BatchOutcome(attempt.plan_index, "failed", "failed", elapsed_seconds=elapsed, seed=seed)
        if isinstance(payload, AttemptFailed):
            return BatchOutcome(attempt.plan_index, "failed", payload.reason, payload.message, elapsed_seconds=elapsed, seed=seed)
        if isinstance(payload, Mapping):
            staged = payload.get("artifactPath")
            frames = payload.get("frameCount")
            if not isinstance(staged, str) or not isinstance(frames, int) or frames < 1:
                return BatchOutcome(
                    attempt.plan_index, "failed", "invalid-result",
                    "The attempt returned an incomplete staged episode.", elapsed_seconds=elapsed, seed=seed,
                )
            return BatchOutcome(attempt.plan_index, "recorded", None, None, staged, frames, elapsed, seed, dict(payload))
        if isinstance(payload, CollectedEpisode):
            summary = payload.summary
            if not payload.successful:
                return BatchOutcome(
                    attempt.plan_index, "failed", summary.failure_reason or summary.status,
                    summary.failure_message, elapsed_seconds=elapsed, seed=seed,
                )
            staged_directory = (
                Path(summary.artifact_path)
                if summary.artifact_path
                else attempt_directory(self.staging_root, attempt.plan_index)
            )
            try:
                if not staged_directory.is_dir():
                    JSONNPZStagingWriter(staged_directory.parent, successful_only=False).write_episode_at(
                        payload, staged_directory
                    )
            except Exception as error:  # noqa: BLE001 - staging failures fail only this attempt.
                shutil.rmtree(staged_directory, ignore_errors=True)
                return BatchOutcome(
                    attempt.plan_index, "failed", "staging-failed", f"{type(error).__name__}: {error}",
                    elapsed_seconds=elapsed, seed=seed,
                )
            frames = len(payload.frames) or int(summary.steps)
            entry = {
                "episodeId": f"episode-{uuid.uuid4()}",
                "episodeIndex": 0,
                "stateId": attempt.state_id,
                "status": "recorded",
                "frameCount": frames,
                "controlMode": summary.control_mode,
                "recordingIndex": attempt.recording_index,
                "attemptSeed": attempt.attempt_seed,
                "artifactPath": str(staged_directory),
            }
            return BatchOutcome(
                attempt.plan_index, "recorded", None, None, str(staged_directory), frames, elapsed, seed, entry
            )
        return BatchOutcome(
            attempt.plan_index, "failed", "invalid-result",
            f"Batch attempts must return a staged episode, AttemptFailed, or None, not {type(payload).__name__}.",
            elapsed_seconds=elapsed, seed=seed,
        )


# --- ordered commit and job state -------------------------------------------------------------


class OrderedCommitter:
    """Commit staged successful attempts in plan order, regardless of worker completion order."""

    def __init__(self, collection: Any, dataset_root: str | Path) -> None:
        self.collection = collection
        self.dataset_root = Path(dataset_root)
        self._next_plan_index = 0
        self._resolved: dict[int, BatchOutcome] = {}
        self.committed: list[Mapping[str, Any]] = []

    @property
    def next_plan_index(self) -> int:
        """Attempts ``0..next_plan_index-1`` are resolved and committed (or skipped)."""
        return self._next_plan_index

    def resolve(
        self,
        outcome: BatchOutcome,
        *,
        state_id: str | None = None,
        seed: int | None = None,
    ) -> tuple[Mapping[str, Any], ...]:
        """Record one terminal outcome and commit every newly contiguous recorded attempt."""
        if not outcome.terminal:
            raise ValueError(f"Batch plan index {outcome.plan_index} is not resolved ({outcome.status}).")
        if outcome.plan_index < self._next_plan_index or outcome.plan_index in self._resolved:
            raise ValueError(f"Batch plan index {outcome.plan_index} was resolved more than once.")
        self._resolved[outcome.plan_index] = outcome
        committed_now: list[Mapping[str, Any]] = []
        while self._next_plan_index in self._resolved:
            current = self._resolved[self._next_plan_index]
            if current.status == "recorded" and current.staged_directory is not None:
                entry = dict(current.episode or {})
                entry.pop("artifactPath", None)
                entry.setdefault("episodeId", f"episode-{uuid.uuid4()}")
                entry.setdefault("status", "recorded")
                entry.setdefault("frameCount", current.frames)
                if state_id is not None:
                    entry.setdefault("stateId", state_id)
                if current.seed is not None or seed is not None:
                    entry.setdefault("attemptSeed", current.seed if current.seed is not None else seed)
                entry["episodeIndex"] = self.collection.next_episode_index
                committed = self.collection.append_staged_episode(
                    entry,
                    current.staged_directory,
                    dataset_root=self.dataset_root,
                )
                self.committed.append(committed)
                committed_now.append(committed)
            del self._resolved[self._next_plan_index]
            self._next_plan_index += 1
        return tuple(committed_now)


def idle_batch_status(cpus: int | None = None) -> dict[str, Any]:
    return {
        "jobId": "",
        "status": "idle",
        "total": 0,
        "resolved": 0,
        "saved": 0,
        "committed": 0,
        "failed": 0,
        "failuresByReason": {},
        "recordedFrames": 0,
        "framesPerSecond": 0.0,
        "etaSeconds": None,
        "workerCount": 0,
        "crashes": 0,
        "cpuCount": cpu_count() if cpus is None else cpus,
        "cancelRequested": False,
    }


class BatchJob:
    """Owner-side state of one batch: ordered commit, status counters, and staging cleanup.

    Call :meth:`progress` and :meth:`resolve` from the thread that owns the collection, and
    :meth:`finish` once when the runner has returned (or failed).
    """

    def __init__(
        self,
        *,
        collection: Any,
        plan: Sequence[BatchAttempt],
        dataset_root: str | Path,
        workers: int,
        job_id: str | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.job_id = job_id or f"batch-{uuid.uuid4()}"
        self.plan = tuple(plan)
        self.dataset_root = Path(dataset_root)
        self.staging_root = self.dataset_root / "staging" / self.job_id
        self.committer = OrderedCommitter(collection, self.dataset_root)
        self._clock = clock
        self._started = clock()
        self._attempts = {attempt.plan_index: attempt for attempt in self.plan}
        self._terminal: dict[int, BatchOutcome] = {}
        self._in_flight_frames: dict[int, int] = {}
        self.status = idle_batch_status()
        self.status.update(
            {"jobId": self.job_id, "status": "running", "total": len(self.plan), "workerCount": workers}
        )

    @property
    def committed(self) -> tuple[Mapping[str, Any], ...]:
        return tuple(self.committer.committed)

    def progress(self, progress: BatchProgress) -> None:
        if progress.plan_index in self._terminal:
            return
        self._in_flight_frames[progress.plan_index] = max(0, int(progress.frames))
        self._update()

    def resolve(self, outcome: BatchOutcome) -> tuple[Mapping[str, Any], ...]:
        """Record a terminal outcome and commit the newly resolved plan prefix."""
        if not outcome.terminal or outcome.plan_index in self._terminal:
            return ()
        self._terminal[outcome.plan_index] = outcome
        self._in_flight_frames.pop(outcome.plan_index, None)
        attempt = self._attempts.get(outcome.plan_index)
        try:
            return self.committer.resolve(
                outcome,
                state_id=attempt.state_id if attempt is not None else None,
                seed=attempt.attempt_seed if attempt is not None else None,
            )
        finally:
            self._update()

    def request_cancel(self) -> None:
        self.status["cancelRequested"] = True

    def _update(self) -> None:
        terminal = self._terminal.values()
        failures: dict[str, int] = {}
        recorded_frames = 0
        saved = 0
        for outcome in terminal:
            if outcome.status == "recorded":
                saved += 1
                recorded_frames += outcome.frames
            else:
                reason = outcome.reason or outcome.status
                failures[reason] = failures.get(reason, 0) + 1
        resolved = len(self._terminal)
        recorded_frames += sum(self._in_flight_frames.values())
        elapsed = max(self._clock() - self._started, 1e-9)
        remaining = max(0, len(self.plan) - resolved)
        if remaining == 0:
            eta: float | None = 0.0
        elif resolved:
            eta = remaining * elapsed / resolved
        else:
            eta = None
        self.status.update(
            {
                "resolved": resolved,
                "saved": saved,
                "committed": len(self.committer.committed),
                "failed": resolved - saved,
                "failuresByReason": failures,
                "recordedFrames": recorded_frames,
                "framesPerSecond": recorded_frames / elapsed,
                "etaSeconds": eta,
            }
        )

    def finish(self, result: BatchResult | None, *, error: str | None = None) -> dict[str, Any]:
        """Set the final status and delete the job's staging directory."""
        self._update()
        if result is not None:
            self.status["crashes"] = result.crashes
        message = error or (result.error if result is not None else None)
        if message is not None or result is None or result.aborted:
            self.status["status"] = "failed"
            self.status["error"] = message or "The batch failed."
        elif result.cancelled:
            self.status["status"] = "cancelled"
        else:
            self.status["status"] = "completed"
        self.status["etaSeconds"] = 0.0 if self.status["status"] == "completed" else None
        shutil.rmtree(self.staging_root, ignore_errors=True)
        return dict(self.status)

    def report(self, result: BatchResult | None) -> dict[str, Any]:
        return {
            **dict(self.status),
            "plan": [asdict(attempt) for attempt in self.plan],
            "outcomes": [outcome.to_dict() for outcome in result.outcomes] if result is not None else [],
            "committedEpisodes": [dict(entry) for entry in self.committed],
        }


# --- SO-101 attempt -----------------------------------------------------------------------------


@dataclass(frozen=True)
class BatchWorkerContext:
    """Picklable inputs of :func:`run_so101_attempt`; the scene is an extracted bundle directory."""

    scene_root: str
    scene_path: str
    scene_name: str
    profile: Mapping[str, Any]
    collection_dir: str
    collection_id: str
    staging_root: str
    scene_manifest: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def for_scene(
        cls,
        scene: Any,
        profile: Mapping[str, Any],
        *,
        collection_dir: str | Path,
        collection_id: str,
        staging_root: str | Path,
    ) -> BatchWorkerContext:
        bundle = scene.bundle
        return cls(
            scene_root=str(bundle.root),
            scene_path=str(bundle.scene_path),
            scene_name=str(bundle.scene_name),
            profile=dict(profile),
            collection_dir=str(collection_dir),
            collection_id=str(collection_id),
            staging_root=str(staging_root),
            scene_manifest=dict(bundle.manifest or {}),
        )


@dataclass
class _WorkerResources:
    bundle: Any
    model: Any
    collection: Any


# One compiled scene and collection view per worker process, reused by every attempt it runs.
_WORKER_RESOURCES: dict[tuple[str, str, str], _WorkerResources] = {}
_WORKER_RESOURCES_LOCK = threading.Lock()


def _worker_resources(context: BatchWorkerContext) -> _WorkerResources:
    key = (context.scene_path, context.collection_dir, context.collection_id)
    with _WORKER_RESOURCES_LOCK:
        cached = _WORKER_RESOURCES.get(key)
        if cached is not None:
            return cached
        from ..teleoperation.collection import TeleoperationCollectionStore
        from .native_scene import NativeScene
        from .scene_bundle import SceneBundle

        bundle = SceneBundle(
            Path(context.scene_root),
            Path(context.scene_path),
            context.scene_name,
            dict(context.scene_manifest),
        )
        scene = NativeScene.compile(bundle)
        collection = TeleoperationCollectionStore.load_read_only(
            context.collection_dir,
            collection_id=context.collection_id,
            scene_id=str(context.profile["sceneId"]),
            scene_fingerprint=str(context.profile["sceneFingerprint"]),
        )
        cached = _WORKER_RESOURCES[key] = _WorkerResources(bundle, scene.model, collection)
        return cached


def run_so101_attempt(
    attempt: BatchAttempt,
    *,
    context: BatchWorkerContext,
    progress: Callable[[int], None] | None = None,
) -> Mapping[str, Any] | AttemptFailed:
    """Record one planned SO-101 pick-and-place attempt into its staging directory.

    The scene is compiled once per worker process; each attempt simulates on a copy of that
    pristine model, which is identical to a fresh compile, so results do not depend on which
    worker ran which attempts. The environment, session, and recording settings match the
    interactive Generate worker. Returns the staged collection entry, or ``AttemptFailed``.
    """
    import mujoco

    from ..frame_clock import capture_fps_from_profile
    from ..robots.so101 import REST_POSE_DEGREES, PickPlaceTask, PickPlaceTuning, record_episode
    from ..teleoperation.local import LocalTeleoperation
    from ..teleoperation.session import TeleoperationSession, build_teleoperation_environment
    from .native_scene import NativeScene

    resources = _worker_resources(context)
    profile = dict(context.profile)
    staging = attempt_directory(context.staging_root, attempt.plan_index)
    model = copy.deepcopy(resources.model)
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    environment = build_teleoperation_environment(
        NativeScene(bundle=resources.bundle, model=model, data=data), profile
    )
    local: LocalTeleoperation | None = None
    try:
        session = TeleoperationSession(
            environment,
            profile,
            context.collection_dir,
            collection_id=context.collection_id,
            writer=IncrementalEpisodeWriter(staging, fps=capture_fps_from_profile(profile)),
            staging_directory=staging,
            collection_store=resources.collection.open_read_only(),
            read_only=True,
            lease_timeout=None,
        )
        local = LocalTeleoperation(
            environment,
            profile,
            context.collection_dir,
            mujoco_module=mujoco,
            local_model=copy.deepcopy(resources.model),
            session=session,
        )
        session.prepare_staging_attempt(
            recording_index=attempt.recording_index,
            attempt_seed=attempt.attempt_seed,
        )
        if progress is not None:
            step = local.step

            def step_with_progress(**kwargs: Any) -> Any:
                snapshot = step(**kwargs)
                progress(session.recorded_frame_count)
                return snapshot

            local.step = step_with_progress  # type: ignore[method-assign]
        task = PickPlaceTask.for_session(local)
        # Start and end at the rest pose, as serial recording does (generate_dataset.py).
        tuning = PickPlaceTuning(home_pose=REST_POSE_DEGREES)
        outcome = record_episode(local, mujoco, task, tuning, state_id=attempt.state_id)
        staged = session.last_staged_episode
        if not outcome.saved or staged is None:
            shutil.rmtree(staging, ignore_errors=True)
            return AttemptFailed(outcome.reason or "failed", outcome.message)
        return dict(staged)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    finally:
        if local is not None:
            local.close()
        else:
            environment.close()


# --- headless CLI -----------------------------------------------------------------------------


def _egl_devices(values: Sequence[str] | None) -> tuple[int, ...]:
    devices: list[int] = []
    for value in values or ():
        for item in str(value).split(","):
            if item.strip():
                device = int(item)
                if device < 0:
                    raise ValueError("EGL device IDs must be non-negative.")
                devices.append(device)
    return tuple(devices)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run deterministic SO-101 batch Generate without Studio.")
    parser.add_argument("--scene-bundle", required=True, type=Path)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--collection-dir", required=True, type=Path)
    parser.add_argument(
        "--collection-id",
        help="Collection ID (default: the profile's collectionId, else the existing collection.json).",
    )
    parser.add_argument("--states", nargs="*", help="State IDs to record (default: every state).")
    parser.add_argument("--episodes-per-state", type=int, default=1)
    parser.add_argument("--workers", type=int, default=physical_core_count())
    parser.add_argument("--report", type=Path, help="Write the final job report as JSON.")
    parser.add_argument(
        "--egl-devices",
        nargs="*",
        help="EGL device IDs assigned round-robin to workers, for example 0,1 or 0 1.",
    )
    return parser


def _collection_id(arguments: argparse.Namespace, profile: Mapping[str, Any]) -> str:
    if arguments.collection_id:
        return str(arguments.collection_id)
    if isinstance(profile.get("collectionId"), str) and profile["collectionId"]:
        return str(profile["collectionId"])
    path = Path(arguments.collection_dir) / "collection.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(
            f"{path} does not exist; pass --collection-id to create a new collection."
        ) from None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not read {path}: {error}") from error
    collection_id = value.get("collectionId") if isinstance(value, dict) else None
    if not isinstance(collection_id, str) or not collection_id:
        raise SystemExit(f"{path} has no collectionId.")
    return collection_id


def main(argv: Sequence[str] | None = None) -> int:
    from ..frame_clock import capture_fps_from_profile
    from ..runtime import load_profile, load_scene
    from ..teleoperation.collection import TeleoperationCollectionStore
    from ..teleoperation.session import TeleoperationSession, build_teleoperation_environment
    from .randomization import derive_seed

    arguments = build_parser().parse_args(argv)
    if arguments.episodes_per_state < 1:
        raise SystemExit("--episodes-per-state must be positive.")
    if not 1 <= arguments.workers <= cpu_count():
        raise SystemExit(f"--workers must be between 1 and {cpu_count()}.")
    try:
        egl_devices = _egl_devices(arguments.egl_devices)
    except ValueError as error:
        raise SystemExit(f"--egl-devices: {error}") from error
    profile = load_profile(arguments.profile)
    collection_id = _collection_id(arguments, profile)
    collection_dir = Path(arguments.collection_dir)
    dataset_root = collection_dir / "dataset"
    scene = load_scene(arguments.scene_bundle)
    try:
        with CollectionLock(collection_dir):
            store = TeleoperationCollectionStore(
                collection_dir,
                collection_id=collection_id,
                scene_id=str(profile["sceneId"]),
                scene_fingerprint=str(profile["sceneFingerprint"]),
            )
            # Open the collection as the Generate worker does (base state, deletion recovery);
            # the owner itself never renders, only the workers do.
            environment = build_teleoperation_environment(scene, {**profile, "captureRgb": False})
            try:
                TeleoperationSession(
                    environment, profile, collection_dir, collection_id=collection_id, collection_store=store
                )
            finally:
                environment.close()
            cleanup_stale_staging(dataset_root)
            known = {state.state_id: state for state in store.states}
            state_ids = list(arguments.states or known)
            missing = [state_id for state_id in state_ids if state_id not in known]
            if missing:
                raise SystemExit(f"Unknown state(s): {', '.join(missing)}.")
            plan = build_batch_plan(
                state_ids,
                arguments.episodes_per_state,
                store.reserve_recording_indices(len(state_ids) * arguments.episodes_per_state),
                lambda state_id, recording_index: derive_seed(known[state_id].seed, recording_index),
            )
            workers = min(arguments.workers, len(plan))
            job = BatchJob(collection=store, plan=plan, dataset_root=dataset_root, workers=workers)
            runner = BatchRunner(workers=workers, staging_root=dataset_root / "staging", job_id=job.job_id)
            context = BatchWorkerContext.for_scene(
                scene,
                profile,
                collection_dir=collection_dir,
                collection_id=collection_id,
                staging_root=runner.staging_root,
            )
            cancel = threading.Event()
            previous_handler = signal.signal(signal.SIGINT, lambda *_args: (cancel.set(), job.request_cancel()))

            def report_progress(_value: Any) -> None:
                status = job.status
                print(
                    f"\r{status['resolved']}/{status['total']} resolved, {status['committed']} saved, "
                    f"{status['failed']} failed, {status['framesPerSecond']:.0f} frames/s",
                    end="",
                    file=sys.stderr,
                    flush=True,
                )

            def on_outcome(outcome: BatchOutcome) -> None:
                job.resolve(outcome)
                report_progress(outcome)

            def on_progress(value: BatchProgress) -> None:
                job.progress(value)

            result: BatchResult | None = None
            error: str | None = None
            try:
                result = runner.run(
                    plan,
                    run_so101_attempt,
                    worker_arguments={"context": context},
                    cancel_event=cancel,
                    on_progress=on_progress,
                    on_outcome=on_outcome,
                    egl_devices=egl_devices,
                )
            except Exception as failure:  # noqa: BLE001 - reported in the job status and report.
                error = f"{type(failure).__name__}: {failure}"
            finally:
                signal.signal(signal.SIGINT, previous_handler)
                job.finish(result, error=error)
                print(file=sys.stderr)
            JSONNPZStagingWriter(dataset_root, video_fps=capture_fps_from_profile(profile)).finalize(
                {
                    "version": 1,
                    "kind": "teleoperation",
                    "collectionId": collection_id,
                    "sceneId": store.scene_id,
                    "sceneFingerprint": store.scene_fingerprint,
                    "profile": profile,
                    "collection": store.to_dict(),
                }
            )
            report = job.report(result)
            if arguments.report:
                atomic_write_json(arguments.report, report)
            print(json.dumps(dict(job.status)))
            return 0 if job.status["status"] == "completed" else 1
    finally:
        scene.bundle.close()


if __name__ == "__main__":
    raise SystemExit(main())
