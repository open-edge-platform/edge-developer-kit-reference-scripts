# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import re
import argparse
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

MAX_READ_SIZE = 64_000  # 64KB
DEFAULT_TAIL_LINES = 500
DEFAULT_PAGE_SIZE = 100
MAX_TAIL_BYTES = 1_048_576  # 1 MiB, bounds the "last N lines" read
MAX_PAGINATION_BYTES = 4 * 1_048_576  # 4 MiB, bounds page-based reads
_TAIL_START_CHUNK = 65_536  # 64 KiB, first window size when growing the tail read
# JSONLogger writes json.dumps defaults: a space after the colon.
TIMESTAMP_RE = re.compile(r'"timestamp":\s*"([^"]+)"')


class LogEntry(BaseModel):
    timestamp: str
    level: Optional[str] = None
    message: Optional[str] = None

    class Config:
        extra = "allow"


class LogResponse(BaseModel):
    logs: List[LogEntry]
    offset: int
    timestamp: Optional[str]
    total_count: Optional[int] = None
    page: Optional[int] = None
    page_size: Optional[int] = None
    has_more: Optional[bool] = None


class ErrorResponse(BaseModel):
    error: str


def parse_log_lines(lines: List[str]) -> List[LogEntry]:
    parsed = []
    for line in lines:
        if not line.strip():
            continue
        try:
            log_entry_dict = json.loads(line)
            log_entry_dict.pop("pid", None)
            parsed.append(LogEntry(**log_entry_dict))
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return parsed


def read_file_bytes(file_path: str, size: int, offset: int = 0) -> bytes:
    with open(file_path, "rb") as file:
        file.seek(offset)
        return file.read(size)


def _read_tail_chunk(file_path: str, file_size: int, window_size: int) -> Tuple[bytes, int]:
    """The last ``window_size`` bytes of the file and the offset they start at."""
    window_size = min(window_size, file_size)
    start = file_size - window_size
    return read_file_bytes(file_path, window_size, start), start


def _drop_partial_first_line(raw: bytes, window_start: int) -> bytes:
    """``raw`` minus its leading partial line, when the window starts mid-file."""
    if window_start == 0:
        return raw
    newline_idx = raw.find(b"\n")
    return raw[newline_idx + 1 :] if newline_idx != -1 else b""


def get_last_lines(
    log_file: str, file_size: int, line_count: int
) -> Tuple[List[LogEntry], int]:
    if file_size == 0:
        return [], 0

    window_size = _TAIL_START_CHUNK
    raw = b""
    window_start = file_size
    lines: List[str] = []
    while True:
        raw, window_start = _read_tail_chunk(log_file, file_size, window_size)
        content = _drop_partial_first_line(raw, window_start)
        lines = [
            line
            for line in content.decode("utf-8", errors="replace").split("\n")
            if line.strip()
        ]
        if len(lines) > line_count or window_start == 0 or window_size >= MAX_TAIL_BYTES:
            break
        window_size = min(window_size * 2, MAX_TAIL_BYTES)

    last_lines = lines[-line_count:] if len(lines) > line_count else lines

    if raw.endswith(b"\n"):
        tail_offset = file_size
    else:
        # Trailing partial line: resume before it so it's re-read whole once the writer finishes it.
        last_newline = raw.rfind(b"\n")
        tail_offset = window_start + last_newline + 1 if last_newline != -1 else window_start

    return parse_log_lines(last_lines), tail_offset


def determine_log_file_name(name: str, backend: str, logs_dir: str = ".") -> str:
    llamacpp_log, ovms_log = f"{name}_server.log", "ovms_server.log"
    if backend == "llamacpp":
        return llamacpp_log
    if backend != "hybrid":
        return ovms_log
    # Each backend truncates its log when its server starts, so the newer file is the current one.
    newest, newest_time = ovms_log, None
    for candidate in (llamacpp_log, ovms_log):
        try:
            modified = (Path(logs_dir) / candidate).stat().st_mtime
        except OSError:
            continue
        if newest_time is None or modified > newest_time:
            newest, newest_time = candidate, modified
    return newest


def get_filtered_logs(
    log_file: str, offset: int, since_time: float
) -> Dict[str, Union[List[LogEntry], int]]:
    raw = read_file_bytes(log_file, MAX_READ_SIZE, offset)
    if not raw:
        return {"logs": [], "actual_read_size": 0}

    newline_idx = raw.rfind(b"\n")
    if newline_idx == -1:
        if len(raw) >= MAX_READ_SIZE:
            # A line longer than MAX_READ_SIZE: skip it rather than stall the cursor forever.
            consumed = len(raw)
        else:
            # Writer is still mid-line at EOF; wait for it to finish.
            return {"logs": [], "actual_read_size": 0}
    else:
        consumed = newline_idx + 1

    text = raw[:consumed].decode("utf-8", errors="replace")
    lines = [line for line in text.split("\n") if line.strip()]
    filtered = []

    for line in lines:
        timestamp_match = TIMESTAMP_RE.search(line)
        if not timestamp_match:
            continue

        try:
            timestamp_str = timestamp_match.group(1)
            line_time = (
                datetime.fromisoformat(timestamp_str.replace("Z", "+00:00")).timestamp()
                * 1000
            )
            if line_time < since_time:
                continue

            log_entry_dict = json.loads(line)
            log_entry_dict.pop("pid", None)
            filtered.append(LogEntry(**log_entry_dict))
        except (json.JSONDecodeError, ValueError, TypeError):
            continue

    return {"logs": filtered, "actual_read_size": consumed}


def get_paginated_logs(
    log_file: str, page: int, page_size: int, since_time: float = 0
) -> Dict[str, Union[List[LogEntry], int, bool]]:
    try:
        stat = Path(log_file).stat()
        file_size = stat.st_size
    except FileNotFoundError:
        return {"logs": [], "total_count": 0, "has_more": False}

    if file_size == 0:
        return {"logs": [], "total_count": 0, "has_more": False}

    raw, window_start = _read_tail_chunk(log_file, file_size, MAX_PAGINATION_BYTES)
    content = _drop_partial_first_line(raw, window_start)
    all_lines = [
        line
        for line in content.decode("utf-8", errors="replace").split("\n")
        if line.strip()
    ]

    if since_time > 0:
        filtered_lines = []
        for line in all_lines:
            timestamp_match = TIMESTAMP_RE.search(line)
            if timestamp_match:
                try:
                    timestamp_str = timestamp_match.group(1)
                    line_time = (
                        datetime.fromisoformat(
                            timestamp_str.replace("Z", "+00:00")
                        ).timestamp()
                        * 1000
                    )
                    if line_time >= since_time:
                        filtered_lines.append(line)
                except (ValueError, TypeError):
                    continue
        all_lines = filtered_lines
    all_logs = parse_log_lines(all_lines)
    total_count = len(all_logs)

    start_idx = (page - 1) * page_size
    end_idx = start_idx + page_size
    paginated_logs = all_logs[start_idx:end_idx]

    has_more = end_idx < total_count

    return {"logs": paginated_logs, "total_count": total_count, "has_more": has_more}


def create_log_router(backend: str, logs_dir: str = "logs") -> APIRouter:
    router = APIRouter()

    # Reads log files: a sync handler, so FastAPI runs it off the event loop.
    @router.get("/logs", response_model=LogResponse)
    def get_logs(
        name: str = Query(..., description="Service name (e.g., 'text_generation')"),
        since: Optional[str] = Query(
            None, description="ISO timestamp to filter logs from"
        ),
        offset: Optional[int] = Query(None, description="File offset for pagination"),
        page: Optional[int] = Query(
            None, description="Page number (1-based) for pagination"
        ),
        page_size: Optional[int] = Query(
            DEFAULT_PAGE_SIZE, description="Number of logs per page"
        ),
        use_pagination: Optional[bool] = Query(
            False, description="Use page-based pagination instead of offset-based"
        ),
    ) -> LogResponse:
        # The name becomes part of a file name under logs_dir: a task-like word, never a path.
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
            raise HTTPException(
                status_code=400,
                detail="name must be 1-64 letters, digits, '_' or '-' (e.g. 'text_generation')",
            )
        log_file_name = determine_log_file_name(name=name, backend=backend, logs_dir=logs_dir)
        log_file_path = Path(logs_dir) / log_file_name

        since_time = 0
        if since:
            try:
                since_time = (
                    datetime.fromisoformat(since.replace("Z", "+00:00")).timestamp()
                    * 1000
                )
            except ValueError:
                raise HTTPException(
                    status_code=400, detail="Invalid timestamp format. Use ISO format."
                )

        if not log_file_path.exists():
            raise HTTPException(
                status_code=404, detail=f"Log file not found: {log_file_name}"
            )

        try:
            if use_pagination and page is not None:
                if page < 1:
                    raise HTTPException(
                        status_code=400, detail="Page number must be 1 or greater"
                    )

                if page_size < 1 or page_size > 1000:
                    raise HTTPException(
                        status_code=400, detail="Page size must be between 1 and 1000"
                    )

                result = get_paginated_logs(
                    str(log_file_path), page, page_size, since_time
                )

                return LogResponse(
                    logs=result["logs"],
                    offset=0,
                    timestamp=result["logs"][-1].timestamp if result["logs"] else since,
                    total_count=result["total_count"],
                    page=page,
                    page_size=page_size,
                    has_more=result["has_more"],
                )

            if (since and offset is None) or (not since and offset is not None):
                if not (not since and offset == 0):
                    raise HTTPException(
                        status_code=400,
                        detail="Both timestamp and offset parameters are required when using offset-based pagination",
                    )

            offset = offset or 0
            stat = log_file_path.stat()
            file_size = stat.st_size

            if not since and offset == 0 and not use_pagination:
                logs, tail_offset = get_last_lines(
                    str(log_file_path), file_size, DEFAULT_TAIL_LINES
                )
                new_timestamp = logs[-1].timestamp if logs else None

                return LogResponse(logs=logs, offset=tail_offset, timestamp=new_timestamp)

            if offset >= file_size:
                return LogResponse(logs=[], offset=file_size, timestamp=since)

            result = get_filtered_logs(str(log_file_path), offset, since_time)
            logs = result["logs"]
            actual_read_size = result["actual_read_size"]

            new_timestamp = logs[-1].timestamp if logs else since

            return LogResponse(
                logs=logs, offset=offset + actual_read_size, timestamp=new_timestamp
            )

        except HTTPException:
            raise
        except Exception as e:
            print(f"Error reading log file: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")

    return router
