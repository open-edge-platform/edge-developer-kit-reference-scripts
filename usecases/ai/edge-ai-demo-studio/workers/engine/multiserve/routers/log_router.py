# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import re
import argparse
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Union

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

MAX_READ_SIZE = 64_000  # 64KB
DEFAULT_TAIL_LINES = 500
DEFAULT_PAGE_SIZE = 100


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
            # Skip invalid JSON lines
            continue
    return parsed


def read_file_content(file_path: str, size: int, offset: int = 0) -> str:
    with open(file_path, "r", encoding="utf-8") as file:
        file.seek(offset)
        content = file.read(size)
    return content


def get_last_lines(log_file: str, file_size: int, line_count: int) -> List[LogEntry]:
    content = read_file_content(log_file, file_size)
    all_lines = [line for line in content.split("\n") if line.strip()]
    last_lines = all_lines[-line_count:] if len(all_lines) > line_count else all_lines
    return parse_log_lines(last_lines)


def determine_log_file_name(name: str, backend: str) -> str:
    if name == "text_generation":
        if backend == "llamacpp":
            return "text_generation_server.log"
        else:
            return "ovms_server.log"
    else:
        return f"{name}_server.log"


def get_filtered_logs(
    log_file: str, offset: int, read_size: int, since_time: float
) -> Dict[str, Union[List[LogEntry], int]]:
    content = read_file_content(log_file, read_size, offset)
    lines = [line for line in content.split("\n") if line.strip()]
    filtered = []

    for line in lines:
        timestamp_match = re.search(r'"timestamp":"([^"]+)"', line)
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

    return {"logs": filtered, "actual_read_size": read_size}


def get_paginated_logs(
    log_file: str, page: int, page_size: int, since_time: float = 0
) -> Dict[str, Union[List[LogEntry], int, bool]]:
    try:
        stat = Path(log_file).stat()
        file_size = stat.st_size
    except FileNotFoundError:
        return {"logs": [], "total_count": 0, "has_more": False}

    content = read_file_content(log_file, file_size)
    all_lines = [line for line in content.split("\n") if line.strip()]

    if since_time > 0:
        filtered_lines = []
        for line in all_lines:
            timestamp_match = re.search(r'"timestamp":"([^"]+)"', line)
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

    @router.get("/logs", response_model=LogResponse)
    async def get_logs(
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
        log_file_name = determine_log_file_name(name=name, backend=backend)
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
                logs = get_last_lines(str(log_file_path), file_size, DEFAULT_TAIL_LINES)
                new_timestamp = logs[-1].timestamp if logs else None

                return LogResponse(logs=logs, offset=file_size, timestamp=new_timestamp)

            if offset >= file_size:
                return LogResponse(logs=[], offset=file_size, timestamp=since)

            read_size = min(MAX_READ_SIZE, file_size - offset)
            result = get_filtered_logs(
                str(log_file_path), offset, read_size, since_time
            )
            logs = result["logs"]
            actual_read_size = result["actual_read_size"]

            new_timestamp = logs[-1].timestamp if logs else since

            return LogResponse(
                logs=logs, offset=offset + actual_read_size, timestamp=new_timestamp
            )

        except Exception as e:
            print(f"Error reading log file: {e}")
            raise HTTPException(status_code=500, detail="Internal server error")

    return router
