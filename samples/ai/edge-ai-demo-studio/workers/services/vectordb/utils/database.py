# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from sqlmodel import Session, SQLModel, create_engine

from worker_common import instance_data_dir

# One SQLite file per instance; instance_data_dir creates the directory.
sqlite_file_name = str(instance_data_dir("data") / "database.db")
sqlite_url = f"sqlite:///{sqlite_file_name}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
