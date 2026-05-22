# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import contextmanager
import json
import uuid
from utils.models import (
    Session,
    AudioBuffer,
    Transcript,
    DiarizationSegment,
    Report,
    DoctorProfile,
    SessionDialogue,
)


class MedicalScribeDatabase:
    """Medical Scribe Database interface for Medical Scribe"""

    def __init__(self, db_path: str, echo_sql: bool = False):
        """
        Initialize medical-scribe database connection

        Args:
            db_path: Path to SQLite medical-scribe database file.
            echo_sql: Whether SQLAlchemy should log SQL statements.
        """
        self.db_path = db_path
        self.echo_sql = echo_sql
        from utils.models import init_db

        self.engine = init_db(self.db_path, echo_sql=self.echo_sql)
        from sqlalchemy.orm import sessionmaker

        self.SessionMaker = sessionmaker(bind=self.engine)

    @contextmanager
    def _get_session(self):
        """Get a medical-scribe database session with automatic cleanup and error handling"""
        session = self.SessionMaker()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def close(self):
        """Close medical-scribe database connection and dispose of engine"""
        if hasattr(self, "engine"):
            self.engine.dispose()

    # Session operations
    def create_session(
        self, doctor_profile_id: str, session_name: str
    ) -> Dict[str, Any]:
        session_id = str(uuid.uuid4())
        with self._get_session() as db_session:
            created_ts = datetime.now()
            session = Session(
                session_id=session_id,
                doctor_profile_id=doctor_profile_id,
                session_name=session_name,
                created_at=created_ts,
                start_time=None,
                status="idle",
            )
            db_session.add(session)
            db_session.flush()
            return {
                "session_id": session_id,
                "session_name": session.session_name,
                "created_at": session.created_at.isoformat(),
            }

    def mark_session_started(self, session_id: str) -> bool:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                return False
            if session.start_time is None:
                session.start_time = datetime.now()
            session.status = "active"
            return True

    def list_sessions(self) -> List[Dict[str, Any]]:
        with self._get_session() as db_session:
            sessions = (
                db_session.query(Session).order_by(Session.created_at.desc()).all()
            )
            return [
                {
                    "session_id": s.session_id,
                    "doctor_profile_id": s.doctor_profile_id,
                    "session_name": s.session_name,
                    "created_at": s.created_at.isoformat(),
                    "start_time": s.start_time.isoformat() if s.start_time else None,
                    "end_time": s.end_time.isoformat() if s.end_time else None,
                    "status": s.status,
                }
                for s in sessions
            ]

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                return None
            return {
                "id": session.id,
                "session_id": session.session_id,
                "doctor_profile_id": session.doctor_profile_id,
                "session_name": session.session_name,
                "created_at": session.created_at.isoformat(),
                "start_time": (
                    session.start_time.isoformat() if session.start_time else None
                ),
                "end_time": session.end_time.isoformat() if session.end_time else None,
                "status": session.status,
            }

    def delete_session(self, session_id: str) -> bool:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                return False
            db_session.delete(session)
            return True

    def stop_session(self, session_id: str) -> bool:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                return False
            session.end_time = datetime.now()
            session.status = "stopped"
            return True

    # Audio buffer operations
    def store_audio_buffer(
        self,
        session_id: str,
        chunk_index: int,
        audio_data: str,
        sample_rate: int,
        duration: float,
    ) -> int:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                raise ValueError(f"Session not found: {session_id}")
            buffer = AudioBuffer(
                session_id=session.id,
                chunk_index=chunk_index,
                audio_data=audio_data,
                sample_rate=sample_rate,
                duration=duration,
            )
            db_session.add(buffer)
            db_session.flush()
            return buffer.id

    # Transcript operations
    def store_transcript(
        self,
        session_id: str,
        text: str,
        chunk_index: int,
        start_time: float,
        end_time: float,
        confidence: Optional[float] = None,
    ) -> int:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                raise ValueError(f"Session not found: {session_id}")
            transcript = Transcript(
                session_id=session.id,
                chunk_index=chunk_index,
                text=text,
                start_time=start_time,
                end_time=end_time,
                confidence=confidence,
            )
            db_session.add(transcript)
            db_session.flush()
            return transcript.id

    def get_transcript(self, session_id: str) -> str:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                return ""
            transcripts = (
                db_session.query(Transcript)
                .filter_by(session_id=session.id)
                .order_by(Transcript.chunk_index)
                .all()
            )
            return " ".join([t.text for t in transcripts])

    def get_transcript_chunks(self, session_id: str) -> List[Dict[str, Any]]:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                return []
            transcripts = (
                db_session.query(Transcript)
                .filter_by(session_id=session.id)
                .order_by(Transcript.chunk_index.asc())
                .all()
            )
            return [
                {
                    "chunk_index": t.chunk_index,
                    "timestamp": t.timestamp,
                    "start_time": t.start_time,
                    "end_time": t.end_time,
                    "text": t.text,
                    "confidence": t.confidence,
                }
                for t in transcripts
            ]

    # Diarization operations
    def store_diarization(
        self,
        session_id: str,
        speaker_id: str,
        start_time: float,
        end_time: float,
        text: Optional[str] = None,
        confidence: Optional[float] = None,
    ) -> int:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                raise ValueError(f"Session not found: {session_id}")
            segment = DiarizationSegment(
                session_id=session.id,
                speaker_id=speaker_id,
                start_time=start_time,
                end_time=end_time,
                text=text,
                confidence=confidence,
            )
            db_session.add(segment)
            db_session.flush()
            return segment.id

    def get_diarization(self, session_id: str) -> List[Dict[str, Any]]:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                return []
            segments = (
                db_session.query(DiarizationSegment)
                .filter_by(session_id=session.id)
                .order_by(DiarizationSegment.start_time)
                .all()
            )
            return [
                {
                    "speaker_id": seg.speaker_id,
                    "start_time": seg.start_time,
                    "end_time": seg.end_time,
                    "text": seg.text,
                    "confidence": seg.confidence,
                }
                for seg in segments
            ]

    # Session dialogue persistence operations
    def store_session_dialogue(
        self, session_id: str, content: str, format: str = "dialogue"
    ) -> bool:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                raise ValueError(f"Session not found: {session_id}")
            dialogue = (
                db_session.query(SessionDialogue)
                .filter_by(session_id=session.id)
                .first()
            )
            if dialogue is None:
                dialogue = SessionDialogue(
                    session_id=session.id,
                    content=content,
                    format=format,
                )
                db_session.add(dialogue)
            else:
                dialogue.content = content
                dialogue.format = format
                dialogue.created_at = datetime.now()
            return True

    def get_session_dialogue(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                return None
            dialogue = (
                db_session.query(SessionDialogue)
                .filter_by(session_id=session.id)
                .first()
            )
            if not dialogue:
                return None
            return {
                "session_id": session.session_id,
                "created_at": dialogue.created_at,
                "content": dialogue.content,
                "format": dialogue.format,
            }

    # Report operations
    def store_report(
        self, session_id: str, content: str, format: str = "markdown"
    ) -> bool:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                raise ValueError(f"Session not found: {session_id}")
            report = db_session.query(Report).filter_by(session_id=session.id).first()
            if report is None:
                report = Report(
                    session_id=session.id,
                    content=content,
                    format=format,
                )
                db_session.add(report)
            else:
                report.content = content
                report.format = format
                report.created_at = datetime.now()
            session.status = "completed"
            return True

    def get_report(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                return None
            report = db_session.query(Report).filter_by(session_id=session.id).first()
            if not report:
                return None
            return {
                "session_id": session.session_id,
                "created_at": report.created_at,
                "content": report.content,
                "format": report.format,
            }

    # Doctor profile operations
    def create_doctor_profile(self, name: str) -> str:
        profile_id = str(uuid.uuid4())
        with self._get_session() as db_session:
            profile = DoctorProfile(profile_id=profile_id, name=name)
            db_session.add(profile)
            return profile_id

    def get_doctor_profile(self, profile_id: str) -> Optional[Dict[str, Any]]:
        with self._get_session() as db_session:
            profile = (
                db_session.query(DoctorProfile).filter_by(profile_id=profile_id).first()
            )
            if not profile:
                return None
            return {
                "profile_id": profile.profile_id,
                "name": profile.name,
                "embeddings": (
                    json.loads(profile.embeddings) if profile.embeddings else None
                ),
                "created_at": profile.created_at.isoformat(),
            }

    def list_doctor_profiles(self) -> List[Dict[str, Any]]:
        with self._get_session() as db_session:
            profiles = (
                db_session.query(DoctorProfile)
                .order_by(DoctorProfile.created_at.desc())
                .all()
            )
            return [
                {
                    "profile_id": p.profile_id,
                    "name": p.name,
                    "embeddings": json.loads(p.embeddings) if p.embeddings else None,
                    "created_at": p.created_at.isoformat(),
                }
                for p in profiles
            ]

    def update_doctor_profile_data(
        self, profile_id: str, embeddings: Optional[List[float]] = None
    ) -> bool:
        with self._get_session() as db_session:
            profile = (
                db_session.query(DoctorProfile).filter_by(profile_id=profile_id).first()
            )
            if not profile:
                return False
            if embeddings is not None:
                profile.embeddings = json.dumps(embeddings)
            return True

    def delete_doctor_profile(self, profile_id: str) -> bool:
        with self._get_session() as db_session:
            profile = (
                db_session.query(DoctorProfile).filter_by(profile_id=profile_id).first()
            )
            if not profile:
                return False
            db_session.delete(profile)
            return True

    def update_session_data(
        self,
        session_id: str,
        session_name: Optional[str] = None,
        doctor_profile_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> bool:
        with self._get_session() as db_session:
            session = db_session.query(Session).filter_by(session_id=session_id).first()
            if not session:
                return False
            if session_name is not None:
                session.session_name = session_name
            if doctor_profile_id is not None:
                session.doctor_profile_id = doctor_profile_id
            if status is not None:
                session.status = status
            return True

    def store_session_state(self, session_id: str, state: Dict[str, Any]) -> bool:
        """Persist frontend session state snapshot as JSON in SessionDialogue."""
        content = json.dumps(state)
        return self.store_session_dialogue(
            session_id=session_id,
            content=content,
            format="medical_scribe_session_state",
        )

    def get_session_state(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Load persisted frontend session state snapshot."""
        record = self.get_session_dialogue(session_id)
        if not record:
            return None
        if record.get("format") != "medical_scribe_session_state":
            return None
        try:
            return json.loads(record.get("content", "{}"))
        except json.JSONDecodeError:
            return None
