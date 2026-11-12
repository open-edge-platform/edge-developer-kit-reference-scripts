# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from datetime import datetime
import os
import re
from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Float,
    Boolean,
    ForeignKey,
    Index,
    text,
)
from sqlalchemy.engine import URL
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class ExamRecord(Base):
    """One graded student paper."""

    __tablename__ = "exam_records"

    id = Column(Integer, primary_key=True)
    record_id = Column(String(100), unique=True, nullable=False, index=True)
    timestamp = Column(DateTime, default=datetime.now, nullable=False)
    student_name = Column(String(255))
    student_id = Column(String(100))
    subject_id = Column(String(100), default="12345", nullable=False)
    # Serialised DataEntry array (JSON)
    data_entries_json = Column(Text)
    # Latest graded paper's artifacts, shown in history and exported PDFs
    ocr_text = Column(Text)
    llm_prompt = Column(Text)
    annotated_image = Column(Text)  # data URL
    overlay_image = Column(Text)  # data URL

    grading_entries = relationship(
        "GradingEntry",
        back_populates="exam_record",
        cascade="all, delete-orphan",
    )
    performance = relationship(
        "StudentPerformance",
        back_populates="exam_record",
        cascade="all, delete-orphan",
        uselist=False,
    )

    __table_args__ = (
        Index("idx_exam_records_student_id", "student_id"),
        Index("idx_exam_records_subject_id", "subject_id"),
        Index("idx_exam_records_student_subject", "student_id", "subject_id"),
        Index("idx_exam_records_timestamp", "timestamp"),
    )


class GradingEntry(Base):
    """One graded question within a student paper."""

    __tablename__ = "grading_entries"

    id = Column(Integer, primary_key=True)
    exam_record_id = Column(
        Integer, ForeignKey("exam_records.id"), nullable=False, index=True
    )
    question_number = Column(String(20), nullable=False)
    extracted_answer = Column(Text)
    feedback = Column(Text)
    # e.g. "3/5"
    marks_awarded_over_max = Column(String(20))
    marks_awarded = Column(Float)
    max_marks = Column(Float)
    # e.g. "8/15"
    marks_accumulated_over_max = Column(String(20))
    human_review = Column(Boolean, default=False)

    exam_record = relationship("ExamRecord", back_populates="grading_entries")

    __table_args__ = (
        Index(
            "idx_grading_entries_record_question", "exam_record_id", "question_number"
        ),
    )


class ClassSnapshot(Base):
    """Single-row cache of class-wide exam statistics, updated on every write."""

    __tablename__ = "class_snapshots"

    id = Column(Integer, primary_key=True)
    updated_at = Column(DateTime, default=datetime.now, nullable=False)
    # Full stats JSON (mirrors the shape returned by GET /v1/stats)
    stats_json = Column(Text, nullable=False, default="{}")


class StudentPerformance(Base):
    """Precomputed performance summary for one student paper, updated on every write."""

    __tablename__ = "student_performances"

    id = Column(Integer, primary_key=True)
    exam_record_id = Column(
        Integer, ForeignKey("exam_records.id"), unique=True, nullable=False, index=True
    )
    # Denormalised for fast standalone queries
    record_id = Column(String(100), unique=True, nullable=False, index=True)
    student_name = Column(String(255))
    student_id = Column(String(100), index=True)
    subject_id = Column(String(100), default="12345", nullable=False, index=True)
    graded_at = Column(DateTime, nullable=False)
    # Aggregated score fields
    total_awarded = Column(Float)
    total_max = Column(Float)
    score_pct = Column(Float)  # 0–100
    passed = Column(Boolean)  # score_pct >= 50
    human_review_count = Column(Integer, default=0)
    # JSON array: [{"questionNumber": "1", "marksAwarded": 3, "maxMarks": 5, "pct": 60}, …]
    question_breakdown_json = Column(Text, nullable=False, default="[]")
    updated_at = Column(DateTime, default=datetime.now, nullable=False)

    exam_record = relationship("ExamRecord", back_populates="performance")


class AgentExamSummary(Base):
    """Lean agent-optimised summary — numeric scores only, no question/answer text.

    Purpose-built for fast agent queries. Populated on every write to
    ExamRecord and kept in sync with the parent record lifecycle.
    """

    __tablename__ = "agent_exam_summaries"

    id = Column(Integer, primary_key=True)
    record_id = Column(String(100), unique=True, nullable=False, index=True)
    student_name = Column(String(255))
    student_id = Column(String(100), index=True)
    subject_id = Column(String(100), default="12345", nullable=False, index=True)
    graded_at = Column(DateTime, nullable=False)
    total_awarded = Column(Float)
    total_max = Column(Float)
    score_pct = Column(Float)   # 0–100
    passed = Column(Boolean)    # score_pct >= 50
    human_review_count = Column(Integer, default=0)
    # Compact per-question scores keyed as question1, question2, …
    # {"question1": {"awarded": 3.0, "max": 5.0, "pct": 60, "hr": false}, …}
    questions_json = Column(Text, nullable=False, default="{}")
    updated_at = Column(DateTime, default=datetime.now, nullable=False)

    __table_args__ = (
        Index("idx_agent_summaries_student_id", "student_id"),
        Index("idx_agent_summaries_subject_id", "subject_id"),
        Index("idx_agent_summaries_graded_at", "graded_at"),
    )


def init_db(db_path: str, echo_sql: bool = False):
    resolved = os.path.realpath(db_path)
    if not re.fullmatch(r"[A-Za-z0-9_./ :\\-]+", resolved):
        raise ValueError(f"Invalid database path: {resolved!r}")
    engine = create_engine(URL.create("sqlite", database=resolved), echo=echo_sql)
    Base.metadata.create_all(engine)
    _run_sqlite_migrations(engine)
    return engine


def _has_column(conn, table_name: str, column_name: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table_name})")).mappings().all()
    return any(row.get("name") == column_name for row in rows)


def _run_sqlite_migrations(engine) -> None:
    """Best-effort schema upgrades for existing SQLite databases."""
    with engine.begin() as conn:
        if not _has_column(conn, "exam_records", "subject_id"):
            conn.execute(
                text(
                    "ALTER TABLE exam_records "
                    "ADD COLUMN subject_id VARCHAR(100) NOT NULL DEFAULT '12345'"
                )
            )
        conn.execute(
            text(
                "UPDATE exam_records SET subject_id='12345' "
                "WHERE subject_id IS NULL OR TRIM(subject_id)=''"
            )
        )

        for column in ("ocr_text", "llm_prompt", "annotated_image", "overlay_image"):
            if not _has_column(conn, "exam_records", column):
                conn.execute(text(f"ALTER TABLE exam_records ADD COLUMN {column} TEXT"))

        if _has_column(conn, "student_performances", "exam_record_id") and not _has_column(
            conn, "student_performances", "subject_id"
        ):
            conn.execute(
                text(
                    "ALTER TABLE student_performances "
                    "ADD COLUMN subject_id VARCHAR(100) NOT NULL DEFAULT '12345'"
                )
            )
        if _has_column(conn, "student_performances", "subject_id"):
            conn.execute(
                text(
                    "UPDATE student_performances SET subject_id='12345' "
                    "WHERE subject_id IS NULL OR TRIM(subject_id)=''"
                )
            )

        if _has_column(conn, "agent_exam_summaries", "record_id") and not _has_column(
            conn, "agent_exam_summaries", "subject_id"
        ):
            conn.execute(
                text(
                    "ALTER TABLE agent_exam_summaries "
                    "ADD COLUMN subject_id VARCHAR(100) NOT NULL DEFAULT '12345'"
                )
            )
        if _has_column(conn, "agent_exam_summaries", "subject_id"):
            conn.execute(
                text(
                    "UPDATE agent_exam_summaries SET subject_id='12345' "
                    "WHERE subject_id IS NULL OR TRIM(subject_id)=''"
                )
            )