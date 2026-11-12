# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException
from fastmcp import FastMCP
import worker_common
from worker_common import instance_data_dir

from utils.database import ExamMarkingDatabase
from utils.schemas import ExamRecordRequest
from utils.mcp_tools import register_mcp_tools


def create_app(database: ExamMarkingDatabase) -> FastAPI:
    mcp = FastMCP(
        name="Exam Marking Insights",
        instructions=(
            "Use these tools to query the exam marking database and generate "
            "insights reports about student performance."
        ),
    )
    register_mcp_tools(mcp, lambda: database)
    mcp_app = mcp.http_app(transport="streamable-http")

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        async with mcp_app.lifespan(mcp_app):
            yield
        database.close()

    app = worker_common.create_app(
        "Exam Marking Database Worker",
        version="1.0.0",
        lifespan=lifespan,
    )

    # ------------------------------------------------------------------ #
    # REST endpoints                                                       #
    # ------------------------------------------------------------------ #

    @app.get("/v1/records")
    def list_records() -> List[Dict[str, Any]]:
        return database.list_records()

    @app.post("/v1/records", status_code=201)
    def upsert_record(payload: ExamRecordRequest) -> Dict[str, Any]:
        data = payload.model_dump()
        record_id = database.upsert_record(data)
        record = database.get_record(record_id)
        if not record:
            raise HTTPException(status_code=500, detail="Failed to save record")
        return record

    @app.get("/v1/records/{record_id}")
    def get_record(record_id: str) -> Dict[str, Any]:
        record = database.get_record(record_id, include_images=True)
        if not record:
            raise HTTPException(status_code=404, detail="Record not found")
        return record

    @app.delete("/v1/records/{record_id}", status_code=204)
    def delete_record(record_id: str) -> None:
        ok = database.delete_record(record_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Record not found")

    @app.delete("/v1/records", status_code=200)
    def delete_all_records() -> Dict[str, Any]:
        count = database.delete_all_records()
        return {"deleted": count}

    @app.get("/v1/stats")
    def get_stats() -> Dict[str, Any]:
        return database.get_stats()

    @app.get("/v1/students")
    def list_student_performances() -> List[Dict[str, Any]]:
        return database.list_student_performances()

    @app.get("/v1/students/{record_id}")
    def get_student_performance(record_id: str) -> Dict[str, Any]:
        perf = database.get_student_performance(record_id)
        if not perf:
            raise HTTPException(status_code=404, detail="Student performance not found")
        return perf

    # ------------------------------------------------------------------ #
    # MCP server (mounted at /mcp, lifespan managed above)               #
    # ------------------------------------------------------------------ #

    app.mount("/mcp", mcp_app)

    return app


def parse_args():
    parser = worker_common.base_parser(
        "Exam Marking Database Worker", default_port=8033, device=False, host=True
    )
    parser.add_argument(
        "--db-path",
        type=str,
        default=None,
        help="SQLite database file path",
    )
    parser.add_argument("--echo-sql", action="store_true", help="Echo SQL statements")
    args = parser.parse_args()

    # Each app instance gets its own data dir; run standalone, the database sits next to this file.
    # The exam-marking-agent reads this file directly (agent_paths.py), so keep the name in step.
    if not args.db_path:
        args.db_path = str(
            instance_data_dir(Path(__file__).resolve().parent, args=args)
            / "exam_marking.db"
        )
    return args


def main():
    args = parse_args()
    database = ExamMarkingDatabase(db_path=args.db_path, echo_sql=args.echo_sql)
    app = create_app(database)
    worker_common.serve(app, args)


if __name__ == "__main__":
    main()