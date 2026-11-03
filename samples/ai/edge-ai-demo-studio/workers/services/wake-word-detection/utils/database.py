# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from sqlmodel import SQLModel, create_engine, Session
from worker_common import instance_data_dir

# Per-instance "data" directory (./data when run standalone), so instances never share a sqlite file.
DATA_DIR = instance_data_dir("data")
sqlite_file_name = DATA_DIR / "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
