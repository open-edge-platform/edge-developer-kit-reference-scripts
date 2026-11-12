# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Where the exam-marking agent reads and writes.

Under the app every folder sits in this instance's data dir (INSTANCE_DATA_DIR / --data-dir); run by
hand, the paper folders stay at the repository root and reports next to this file, as before.
"""

import os
from pathlib import Path

from worker_common import instance_data_dir, project_root

SCRIPT_DIR = Path(__file__).resolve().parent
# Every path this worker accepts from a request or the environment must stay inside the repository.
APP_BASE_DIR = project_root(SCRIPT_DIR)

# prior_mark/, marked/ and results/ live here.
PAPERS_ROOT = instance_data_dir(APP_BASE_DIR)
REPORTS_DIR = instance_data_dir(SCRIPT_DIR) / "reports"

DB_FILENAME = "exam_marking.db"
# The app gives each Exam Marking Database instance <repo>/data/exam-marking-database/<instanceId>/.
DB_INSTANCES_ROOT = APP_BASE_DIR / "data" / "exam-marking-database"
# Where that worker keeps the database when run by hand.
STANDALONE_DB = SCRIPT_DIR.parent / "exam-marking-database" / DB_FILENAME


def default_db_path() -> Path:
    """The running database instance's file (the newest, if several), else the standalone one."""
    candidates = [p for p in DB_INSTANCES_ROOT.glob(f"*/{DB_FILENAME}") if p.is_file()]
    if candidates:
        return max(candidates, key=lambda p: p.stat().st_mtime)
    return STANDALONE_DB


def db_path() -> str:
    """The database to read: EXAM_DB_PATH when set (within the database folders), else the default."""
    raw = os.environ.get("EXAM_DB_PATH")
    resolved = (Path(raw) if raw else default_db_path()).resolve()
    allowed = (DB_INSTANCES_ROOT.resolve(), STANDALONE_DB.parent.resolve())
    if not any(resolved.is_relative_to(root) for root in allowed):
        raise ValueError(f"Invalid database path: {resolved}")
    return str(resolved)
