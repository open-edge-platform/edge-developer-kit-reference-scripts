# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from datetime import datetime
from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Float,
    ForeignKey,
    Boolean,
    Index,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker

Base = declarative_base()


class Session(Base):
    """Medical scribe session"""

    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True)
    session_id = Column(String(100), unique=True, nullable=False, index=True)
    doctor_profile_id = Column(String(100), nullable=False, index=True)
    session_name = Column(String(255))
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    status = Column(String(20), default="idle")  # idle, active, stopped, completed

    # Relationships
    audio_buffers = relationship(
        "AudioBuffer", back_populates="session", cascade="all, delete-orphan"
    )
    transcripts = relationship(
        "Transcript", back_populates="session", cascade="all, delete-orphan"
    )
    diarization_segments = relationship(
        "DiarizationSegment", back_populates="session", cascade="all, delete-orphan"
    )
    reports = relationship(
        "Report", back_populates="session", cascade="all, delete-orphan"
    )
    dialogue = relationship(
        "SessionDialogue",
        back_populates="session",
        cascade="all, delete-orphan",
        uselist=False,
    )


class AudioBuffer(Base):
    """Stores audio buffer chunks"""

    __tablename__ = "audio_buffers"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    timestamp = Column(DateTime, default=datetime.now, nullable=False)
    audio_data = Column(Text)  # Base64 encoded audio data or file path
    sample_rate = Column(Integer)
    duration = Column(Float)

    session = relationship("Session", back_populates="audio_buffers")

    __table_args__ = (Index("idx_audio_session_chunk", "session_id", "chunk_index"),)


class Transcript(Base):
    """Stores transcription results"""

    __tablename__ = "transcripts"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    timestamp = Column(DateTime, default=datetime.now, nullable=False)
    text = Column(Text, nullable=False)
    start_time = Column(Float)  # Start time in seconds
    end_time = Column(Float)  # End time in seconds
    confidence = Column(Float)

    session = relationship("Session", back_populates="transcripts")

    __table_args__ = (
        Index("idx_transcript_session_chunk", "session_id", "chunk_index"),
    )


class DiarizationSegment(Base):
    """Stores speaker diarization data"""

    __tablename__ = "diarization_segments"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False, index=True)
    speaker_id = Column(String(50), nullable=False)  # e.g., "SPEAKER_00", "SPEAKER_01"
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    text = Column(Text)  # Associated transcript text
    confidence = Column(Float)

    session = relationship("Session", back_populates="diarization_segments")

    __table_args__ = (
        Index("idx_diarization_session_time", "session_id", "start_time"),
    )


class Report(Base):
    """Stores generated medical reports"""

    __tablename__ = "reports"

    id = Column(Integer, primary_key=True)
    session_id = Column(
        Integer, ForeignKey("sessions.id"), nullable=False, unique=True, index=True
    )
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    content = Column(Text, nullable=False)
    format = Column(String(20), default="markdown")  # markdown, html, plain
    is_final = Column(Boolean, default=True)

    session = relationship("Session", back_populates="reports")


class SessionDialogue(Base):
    """Stores a compiled dialogue view for a session"""

    __tablename__ = "session_dialogues"

    id = Column(Integer, primary_key=True)
    session_id = Column(
        Integer, ForeignKey("sessions.id"), nullable=False, unique=True, index=True
    )
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    content = Column(Text, nullable=False)
    format = Column(String(20), default="dialogue")

    session = relationship("Session", back_populates="dialogue")


class DoctorProfile(Base):
    """Stores doctor profiles and voice enrollment data"""

    __tablename__ = "doctor_profiles"

    id = Column(Integer, primary_key=True)
    profile_id = Column(String(100), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    embeddings = Column(Text)  # JSON array string of floats, e.g. "[0.12, -0.34, ...]"


def init_db(db_path: str, echo_sql: bool = False):
    """Initialize the medical-scribe database with schema"""
    engine = create_engine(f"sqlite:///{db_path}", echo=echo_sql)
    Base.metadata.create_all(engine)
    print(f"Medical Scribe Database initialized at: {db_path}")
    return engine


def get_session_maker(db_path: str, echo_sql: bool = False):
    """Get a session maker for medical-scribe database operations"""
    engine = init_db(db_path, echo_sql=echo_sql)
    return sessionmaker(bind=engine)
