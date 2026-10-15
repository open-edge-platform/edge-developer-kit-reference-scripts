from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from pydantic import BaseModel

# Corresponds to script names in ../../../../scripts
class JobKind(str, Enum):
    PROCESS_GVHMR = "process_gvhmr"
    PROCESS_GMR = "process_gmr"
    PROCESS_CSV_TO_NPZ = "process_csv_to_npz"
    TRAIN = "train"
    RESUME = "resume"
    PLAY = "play"
    PLAY_CHAIN = "play_chain"
    TENSORBOARD = "tensorboard"


_TRAINING_KINDS = (JobKind.TRAIN.value, JobKind.RESUME.value)
_PLAYBACK_KINDS = (JobKind.PLAY.value, JobKind.PLAY_CHAIN.value)
_TENSORBOARD_KINDS = (JobKind.TENSORBOARD.value,)


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"
    INTERRUPTED = "interrupted"


class Job(BaseModel):
    id: str
    kind: JobKind
    payload: dict[str, Any]
    status: JobStatus
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    exit_code: int | None = None
    error: str | None = None


class Asset(BaseModel):
    id: str
    filename: str
    extension: str
    size_bytes: int
    created_at: datetime


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    id TEXT NOT NULL UNIQUE,
                    kind TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    exit_code INTEGER,
                    error TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    extension TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _to_job(row: sqlite3.Row) -> Job:
        return Job(
            id=row["id"],
            kind=JobKind(row["kind"]),
            payload=json.loads(row["payload"]),
            status=JobStatus(row["status"]),
            created_at=row["created_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            exit_code=row["exit_code"],
            error=row["error"],
        )

    @staticmethod
    def _to_asset(row: sqlite3.Row) -> Asset:
        return Asset(
            id=row["id"],
            filename=row["filename"],
            extension=row["extension"],
            size_bytes=row["size_bytes"],
            created_at=row["created_at"],
        )

    def register_asset(self, asset: Asset) -> Asset:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO assets (id, filename, extension, size_bytes, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    asset.id,
                    asset.filename,
                    asset.extension,
                    asset.size_bytes,
                    asset.created_at.isoformat(),
                ),
            )
        return asset

    def get_asset(self, asset_id: str) -> Asset | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        return self._to_asset(row) if row else None

    def list_assets(self) -> list[Asset]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM assets ORDER BY created_at DESC").fetchall()
        return [self._to_asset(row) for row in rows]

    def delete_asset(self, asset_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
        return cursor.rowcount > 0

    def submit(self, kind: JobKind, payload: dict[str, Any]) -> Job:
        job_id = str(uuid4())
        created_at = _now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO jobs (id, kind, payload, status, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (job_id, kind.value, json.dumps(payload), JobStatus.QUEUED.value, created_at),
            )
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._to_job(row)

    def get(self, job_id: str) -> Job | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._to_job(row) if row else None

    def list(self) -> list[Job]:
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM jobs ORDER BY sequence").fetchall()
        return [self._to_job(row) for row in rows]

    def delete(self, job_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM jobs WHERE id = ? AND status NOT IN (?, ?)",
                (job_id, JobStatus.QUEUED.value, JobStatus.RUNNING.value),
            )
        return cursor.rowcount > 0

    def claim_next(self) -> Job | None:
        """
        Claim the next available job.

        Only one training, playback, and TensorBoard job can run at a time.
        """
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT * FROM jobs AS queued
                WHERE queued.status = ?
                    AND (
                        queued.kind NOT IN (?, ?)
                        OR NOT EXISTS (
                            SELECT 1 FROM jobs AS running
                            WHERE running.status = ? AND running.kind IN (?, ?)
                        )
                    )
                    AND (
                        queued.kind NOT IN (?, ?)
                        OR NOT EXISTS (
                            SELECT 1 FROM jobs AS running
                            WHERE running.status = ? AND running.kind IN (?, ?)
                        )
                    )
                    AND (
                        queued.kind NOT IN (?)
                        OR NOT EXISTS (
                            SELECT 1 FROM jobs AS running
                            WHERE running.status = ? AND running.kind IN (?)
                        )
                    )
                ORDER BY queued.sequence
                LIMIT 1
                """,
                (
                    JobStatus.QUEUED.value,
                    *_TRAINING_KINDS,
                    JobStatus.RUNNING.value,
                    *_TRAINING_KINDS,
                    *_PLAYBACK_KINDS,
                    JobStatus.RUNNING.value,
                    *_PLAYBACK_KINDS,
                    *_TENSORBOARD_KINDS,
                    JobStatus.RUNNING.value,
                    *_TENSORBOARD_KINDS,
                ),
            ).fetchone()
            if row is None:
                return None

            started_at = _now()
            connection.execute(
                "UPDATE jobs SET status = ?, started_at = ? WHERE id = ?",
                (JobStatus.RUNNING.value, started_at, row["id"]),
            )
            updated = connection.execute(
                "SELECT * FROM jobs WHERE id = ?", (row["id"],)
            ).fetchone()
        return self._to_job(updated)

    def finish(self, job_id: str, exit_code: int, error: str | None = None) -> Job | None:
        status = JobStatus.SUCCEEDED if exit_code == 0 else JobStatus.FAILED
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs
                SET status = ?, finished_at = ?, exit_code = ?, error = ?
                WHERE id = ? AND status = ?
                """,
                (status.value, _now(), exit_code, error, job_id, JobStatus.RUNNING.value),
            )
            if cursor.rowcount == 0:
                return None
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._to_job(row)

    def cancel_queued(self, job_id: str) -> Job | None:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs SET status = ?, finished_at = ?
                WHERE id = ? AND status = ?
                """,
                (JobStatus.CANCELED.value, _now(), job_id, JobStatus.QUEUED.value),
            )
            if cursor.rowcount == 0:
                return None
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._to_job(row)

    def cancel_running(self, job_id: str) -> Job | None:
        return self._set_running_terminal(job_id, JobStatus.CANCELED, "Job canceled by user.")

    def interrupt_running(self, job_id: str, reason: str) -> Job | None:
        return self._set_running_terminal(job_id, JobStatus.INTERRUPTED, reason)

    def _set_running_terminal(self, job_id: str, status: JobStatus, error: str) -> Job | None:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs SET status = ?, finished_at = ?, error = ?
                WHERE id = ? AND status = ?
                """,
                (status.value, _now(), error, job_id, JobStatus.RUNNING.value),
            )
            if cursor.rowcount == 0:
                return None
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._to_job(row)

    def mark_interrupted(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE jobs
                SET status = ?, finished_at = ?, error = ?
                WHERE status IN (?, ?)
                """,
                (
                    JobStatus.INTERRUPTED.value,
                    _now(),
                    "Backend restarted; resubmit this job.",
                    JobStatus.QUEUED.value,
                    JobStatus.RUNNING.value,
                ),
            )