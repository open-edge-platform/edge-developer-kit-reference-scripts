# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from contextlib import contextmanager
from datetime import datetime
from typing import Optional, List, Dict, Any
import json
import re
import uuid

from sqlalchemy.orm import defer

from utils.models import (
    AgentExamSummary,
    ExamRecord,
    GradingEntry,
    ClassSnapshot,
    StudentPerformance,
    init_db,
)


DEFAULT_SUBJECT_ID = "12345"


class ExamMarkingDatabase:
    """Database interface for AI Exam Marking."""

    def __init__(self, db_path: str, echo_sql: bool = False):
        self.db_path = db_path
        self.echo_sql = echo_sql
        self.engine = init_db(db_path, echo_sql=echo_sql)
        from sqlalchemy.orm import sessionmaker

        self.SessionMaker = sessionmaker(bind=self.engine)
        # Keep derived analytics tables consistent after code-level scoring changes.
        self._rebuild_derived_tables()

    @contextmanager
    def _get_session(self):
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
        if hasattr(self, "engine"):
            self.engine.dispose()

    def _rebuild_derived_tables(self) -> None:
        """Recompute derived analytics rows from source exam/grading data."""
        with self._get_session() as db:
            records = db.query(ExamRecord).all()

            db.query(AgentExamSummary).delete()
            db.query(StudentPerformance).delete()
            db.flush()

            for record in records:
                _recompute_cumulative_scores(record)
                _update_student_performance(db, record)
                _update_agent_summary(db, record)

            _update_snapshot(db)

    # ------------------------------------------------------------------ #
    # Exam records                                                         #
    # ------------------------------------------------------------------ #

    def upsert_record(self, data: Dict[str, Any]) -> str:
        """Insert or update a student+subject record and merge graded questions."""
        incoming_record_id = (data.get("id") or "").strip() or None
        incoming_student_id = (data.get("studentId") or "").strip()
        subject_id = _normalize_subject_id(data.get("subjectId"))

        with self._get_session() as db:
            record = None
            if incoming_student_id:
                record = (
                    db.query(ExamRecord)
                    .filter_by(student_id=incoming_student_id, subject_id=subject_id)
                    .order_by(ExamRecord.timestamp.desc())
                    .first()
                )

            if not record and incoming_record_id:
                record = db.query(ExamRecord).filter_by(record_id=incoming_record_id).first()

            if not record:
                record = ExamRecord(record_id=incoming_record_id or str(uuid.uuid4()))
                db.add(record)
                db.flush()  # populate record.id before using it in GradingEntry FK

            record_id = record.record_id

            record.timestamp = (
                datetime.fromisoformat(data["timestamp"])
                if data.get("timestamp")
                else datetime.now()
            )
            record.subject_id = subject_id
            record.student_name = (data.get("studentName") or record.student_name or "").strip()
            record.student_id = incoming_student_id or record.student_id or ""
            record.data_entries_json = json.dumps(
                _merge_data_entries(record.data_entries_json, data.get("dataEntries", []))
            )

            ocr = data.get("ocrResult") or {}
            if ocr.get("text"):
                record.ocr_text = ocr["text"]
            prompt = (data.get("llmResult") or {}).get("prompt")
            if prompt:
                record.llm_prompt = prompt
            annotated = _image_data_url(ocr.get("imagePreview"))
            if annotated:
                record.annotated_image = annotated
            overlay = _image_data_url(ocr.get("overlayImage"))
            if overlay:
                record.overlay_image = overlay

            for entry in data.get("llmResult", {}).get("response", []):
                question_number = str(entry.get("questionNumber", "")).strip()
                if not question_number:
                    continue

                awarded, max_marks = _parse_score(
                    entry.get("marksAwardedOverMaxMarks", "")
                )

                grading_entry = (
                    db.query(GradingEntry)
                    .filter_by(exam_record_id=record.id, question_number=question_number)
                    .first()
                )
                if grading_entry is None:
                    grading_entry = GradingEntry(
                        exam_record_id=record.id,
                        question_number=question_number,
                    )
                    db.add(grading_entry)

                grading_entry.extracted_answer = entry.get("extractedAnswer", "")
                grading_entry.feedback = entry.get("feedback", "")
                grading_entry.marks_awarded_over_max = entry.get(
                    "marksAwardedOverMaxMarks", ""
                )
                grading_entry.marks_awarded = awarded
                grading_entry.max_marks = max_marks
                grading_entry.human_review = bool(entry.get("humanReview", False))

            _recompute_cumulative_scores(record)

            _update_student_performance(db, record)
            _update_agent_summary(db, record)
            _update_snapshot(db)

        return record_id

    def list_records(self) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            rows = (
                db.query(ExamRecord)
                .options(defer(ExamRecord.annotated_image), defer(ExamRecord.overlay_image))
                .order_by(ExamRecord.timestamp.desc())
                .all()
            )
            return [_serialize_record(r) for r in rows]

    def get_record(
        self, record_id: str, include_images: bool = False
    ) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            row = db.query(ExamRecord).filter_by(record_id=record_id).first()
            return _serialize_record(row, include_images) if row else None

    def delete_record(self, record_id: str) -> bool:
        with self._get_session() as db:
            row = db.query(ExamRecord).filter_by(record_id=record_id).first()
            if not row:
                return False
            db.query(AgentExamSummary).filter_by(record_id=record_id).delete()
            db.delete(row)
            db.flush()
            _update_snapshot(db)
        return True

    def delete_all_records(self) -> int:
        with self._get_session() as db:
            count = db.query(ExamRecord).count()
            db.query(AgentExamSummary).delete()
            db.query(StudentPerformance).delete()
            db.query(GradingEntry).delete()
            db.query(ExamRecord).delete()
            db.flush()
            _update_snapshot(db)
        return count

    # ------------------------------------------------------------------ #
    # Student performance                                                  #
    # ------------------------------------------------------------------ #

    def list_student_performances(self) -> List[Dict[str, Any]]:
        """Return all student performance summaries, newest first."""
        with self._get_session() as db:
            rows = (
                db.query(StudentPerformance)
                .order_by(StudentPerformance.graded_at.desc())
                .all()
            )
            return [_serialize_performance(p) for p in rows]

    def get_student_performance(self, record_id: str) -> Optional[Dict[str, Any]]:
        with self._get_session() as db:
            row = db.query(StudentPerformance).filter_by(record_id=record_id).first()
            return _serialize_performance(row) if row else None

    # ------------------------------------------------------------------ #
    # Insights helpers (used by MCP tools)                                #
    # ------------------------------------------------------------------ #

    def get_stats(self) -> Dict[str, Any]:
        """Return the persisted class statistics snapshot."""
        with self._get_session() as db:
            snapshot = db.query(ClassSnapshot).first()
            if not snapshot:
                return {"total_students": 0}
            return json.loads(snapshot.stats_json)

    def get_student_results(
        self, student_name: str = "", student_id: str = ""
    ) -> List[Dict[str, Any]]:
        with self._get_session() as db:
            q = db.query(ExamRecord)
            if student_name:
                q = q.filter(ExamRecord.student_name.ilike(f"%{student_name}%"))
            if student_id:
                q = q.filter(ExamRecord.student_id == student_id)
            return [_serialize_record(r) for r in q.all()]


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #


def _update_agent_summary(db, record: ExamRecord) -> None:
    """Populate/refresh the lean AgentExamSummary row for a single ExamRecord.

    Stores only numeric scores keyed as question1, question2, … — no question
    text, extracted answers, feedback, or marking schemes.
    """
    entries = sorted(record.grading_entries, key=lambda e: _question_sort_key(e.question_number))

    questions: Dict[str, Any] = {}
    human_review_count = 0
    for e in entries:
        pct = (
            round(e.marks_awarded / e.max_marks * 100)
            if (e.max_marks and e.max_marks > 0)
            else None
        )
        key = f"question{e.question_number}"
        questions[key] = {
            "awarded": e.marks_awarded,
            "max": e.max_marks,
            "pct": pct,
            "hr": bool(e.human_review),
        }
        if e.human_review:
            human_review_count += 1

    total_awarded: Optional[float] = None
    total_max: Optional[float] = None
    score_pct: Optional[float] = None
    passed: Optional[bool] = None
    graded_awarded, graded_max = _sum_scores(entries)
    configured_max = _configured_total_max_from_json(record.data_entries_json)
    denominator = configured_max if configured_max > 0 else graded_max

    if entries:
        total_awarded = graded_awarded
        total_max = denominator

    if total_awarded is not None and total_max is not None and total_max > 0:
        raw_pct = total_awarded / total_max * 100
        score_pct = round(raw_pct, 2)
        passed = raw_pct >= 50

    summary = db.query(AgentExamSummary).filter_by(record_id=record.record_id).first()
    if summary is None:
        summary = AgentExamSummary(record_id=record.record_id)
        db.add(summary)

    summary.student_name = record.student_name or ""
    summary.student_id = record.student_id or ""
    summary.subject_id = _normalize_subject_id(record.subject_id)
    summary.graded_at = record.timestamp
    summary.total_awarded = total_awarded
    summary.total_max = total_max
    summary.score_pct = score_pct
    summary.passed = passed
    summary.human_review_count = human_review_count
    summary.questions_json = json.dumps(questions)
    summary.updated_at = datetime.now()


def _update_student_performance(db, record: ExamRecord) -> None:
    """Compute and persist the StudentPerformance row for a single ExamRecord."""
    entries = sorted(record.grading_entries, key=lambda e: _question_sort_key(e.question_number))

    # Per-question breakdown
    breakdown = []
    human_review_count = 0
    for e in entries:
        pct = (
            round(e.marks_awarded / e.max_marks * 100)
            if (e.max_marks and e.max_marks > 0)
            else None
        )
        breakdown.append(
            {
                "questionNumber": e.question_number,
                "marksAwarded": e.marks_awarded,
                "maxMarks": e.max_marks,
                "pct": pct,
                "humanReview": bool(e.human_review),
            }
        )
        if e.human_review:
            human_review_count += 1

    total_awarded: Optional[float] = None
    total_max: Optional[float] = None
    score_pct: Optional[float] = None
    passed: Optional[bool] = None
    awarded_sum, graded_max_sum = _sum_scores(entries)
    configured_max = _configured_total_max_from_json(record.data_entries_json)
    denominator = configured_max if configured_max > 0 else graded_max_sum

    if entries:
        total_awarded = awarded_sum
        total_max = denominator

    if total_awarded is not None and total_max is not None and total_max > 0:
        raw_pct = total_awarded / total_max * 100
        score_pct = round(raw_pct, 2)
        passed = raw_pct >= 50

    perf = db.query(StudentPerformance).filter_by(exam_record_id=record.id).first()
    if perf is None:
        perf = StudentPerformance(exam_record_id=record.id)
        db.add(perf)

    perf.record_id = record.record_id
    perf.student_name = record.student_name or ""
    perf.student_id = record.student_id or ""
    perf.subject_id = _normalize_subject_id(record.subject_id)
    perf.graded_at = record.timestamp
    perf.total_awarded = total_awarded
    perf.total_max = total_max
    perf.score_pct = score_pct
    perf.passed = passed
    perf.human_review_count = human_review_count
    perf.question_breakdown_json = json.dumps(breakdown)
    perf.updated_at = datetime.now()


def _serialize_performance(p: StudentPerformance) -> Dict[str, Any]:
    return {
        "recordId": p.record_id,
        "studentName": p.student_name or "",
        "studentId": p.student_id or "",
        "subjectId": _normalize_subject_id(p.subject_id),
        "gradedAt": p.graded_at.isoformat() if p.graded_at else None,
        "totalAwarded": p.total_awarded,
        "totalMax": p.total_max,
        "scorePct": p.score_pct,
        "passed": p.passed,
        "humanReviewCount": p.human_review_count,
        "questionBreakdown": json.loads(p.question_breakdown_json or "[]"),
        "updatedAt": p.updated_at.isoformat() if p.updated_at else None,
    }


def _update_snapshot(db) -> None:
    """Recompute class statistics and persist them to ClassSnapshot within an open session."""
    rows = db.query(ExamRecord).all()
    records = [_serialize_record(r) for r in rows]

    total = len(records)
    if total == 0:
        stats: Dict[str, Any] = {"total_students": 0}
    else:
        scored: List[float] = []
        human_review_count = 0
        for r in records:
            pct = _record_pct(r)
            if pct is not None:
                scored.append(pct)
            for e in r.get("gradingEntries", []):
                if e.get("humanReview"):
                    human_review_count += 1

        avg_pct = round(sum(scored) / len(scored)) if scored else None
        pass_count = sum(1 for p in scored if p >= 50)
        pass_rate = round(pass_count / len(scored) * 100) if scored else None

        buckets = [
            {"label": "0-20%", "min": 0, "max": 20, "count": 0},
            {"label": "21-40%", "min": 21, "max": 40, "count": 0},
            {"label": "41-60%", "min": 41, "max": 60, "count": 0},
            {"label": "61-80%", "min": 61, "max": 80, "count": 0},
            {"label": "81-100%", "min": 81, "max": 100, "count": 0},
        ]
        for p in scored:
            display_pct = round(p)
            for b in buckets:
                if b["min"] <= display_pct <= b["max"]:
                    b["count"] += 1
                    break

        q_map: Dict[str, Dict[str, Any]] = {}
        for r in records:
            for e in r.get("gradingEntries", []):
                key = f"{r['subjectId']} Q{e['questionNumber']}"
                if key not in q_map:
                    q_map[key] = {"total_awarded": 0.0, "total_max": 0.0, "count": 0}
                if e.get("marksAwarded") is not None and e.get("maxMarks") is not None:
                    q_map[key]["total_awarded"] += e["marksAwarded"]
                    q_map[key]["total_max"] += e["maxMarks"]
                    q_map[key]["count"] += 1

        question_stats = []
        for label, vals in sorted(q_map.items()):
            n = vals["count"]
            if n > 0:
                avg_a = round(vals["total_awarded"] / n, 2)
                avg_m = round(vals["total_max"] / n, 2)
                avg_p = round(avg_a / avg_m * 100) if avg_m > 0 else 0
                question_stats.append(
                    {
                        "label": label,
                        "avg_awarded": avg_a,
                        "avg_max": avg_m,
                        "avg_pct": avg_p,
                    }
                )

        stats = {
            "total_students": total,
            "average_pct": avg_pct,
            "pass_rate": pass_rate,
            "human_review_count": human_review_count,
            "score_distribution": buckets,
            "question_stats": question_stats,
        }

    snapshot = db.query(ClassSnapshot).first()
    if snapshot is None:
        snapshot = ClassSnapshot()
        db.add(snapshot)
    snapshot.stats_json = json.dumps(stats)
    snapshot.updated_at = datetime.now()


def _parse_score(value: str):
    """Parse 'awarded/max' string into (awarded, max) floats or (None, None)."""
    parts = value.split("/")
    if len(parts) != 2:
        return None, None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None, None


def _record_pct(record: Dict[str, Any]) -> Optional[float]:
    entries = record.get("gradingEntries", [])
    if not entries:
        return None
    awarded = 0.0
    graded_max = 0.0
    for entry in entries:
        entry_awarded = entry.get("marksAwarded")
        entry_max = entry.get("maxMarks")
        if entry_awarded is None or entry_max is None:
            continue
        awarded += float(entry_awarded)
        graded_max += float(entry_max)

    configured_max = 0.0
    for entry in record.get("dataEntries", []):
        if not isinstance(entry, dict):
            continue
        marks = entry.get("marks")
        try:
            marks_val = float(marks)
        except (TypeError, ValueError):
            continue
        if marks_val > 0:
            configured_max += marks_val

    max_m = configured_max if configured_max > 0 else graded_max
    if max_m == 0:
        return None
    return awarded / max_m * 100


def _serialize_record(r: ExamRecord, include_images: bool = False) -> Dict[str, Any]:
    sorted_entries = sorted(r.grading_entries, key=lambda e: _question_sort_key(e.question_number))
    serialized = {
        "id": r.record_id,
        "timestamp": r.timestamp.isoformat(),
        "studentName": r.student_name or "",
        "studentId": r.student_id or "",
        "subjectId": _normalize_subject_id(r.subject_id),
        "dataEntries": json.loads(r.data_entries_json or "[]"),
        "ocrText": r.ocr_text or "",
        "llmPrompt": r.llm_prompt or "",
        "gradingEntries": [
            {
                "questionNumber": e.question_number,
                "extractedAnswer": e.extracted_answer or "",
                "feedback": e.feedback or "",
                "marksAwardedOverMax": e.marks_awarded_over_max or "",
                "marksAwarded": e.marks_awarded,
                "maxMarks": e.max_marks,
                "marksAccumulatedOverMax": e.marks_accumulated_over_max or "",
                "humanReview": bool(e.human_review),
            }
            for e in sorted_entries
        ],
    }
    if include_images:
        serialized["annotatedImage"] = r.annotated_image
        serialized["overlayImage"] = r.overlay_image
    return serialized


def _image_data_url(value: Any) -> Optional[str]:
    """Accept only base64 raster image data URLs; anything else is not stored."""
    if isinstance(value, str) and re.match(
        r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+\Z", value
    ):
        return value
    return None


def _normalize_subject_id(value: Any) -> str:
    subject_id = str(value).strip() if value is not None else ""
    return subject_id or DEFAULT_SUBJECT_ID


def _question_sort_key(question_number: Any):
    q = str(question_number or "").strip()
    if q.isdigit():
        return (0, int(q))
    return (1, q)


def _sum_scores(entries: List[GradingEntry]) -> tuple[float, float]:
    awarded = 0.0
    max_marks = 0.0
    for entry in entries:
        if entry.marks_awarded is not None:
            awarded += float(entry.marks_awarded)
        if entry.max_marks is not None:
            max_marks += float(entry.max_marks)
    return awarded, max_marks


def _format_score(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:.2f}".rstrip("0").rstrip(".")


def _recompute_cumulative_scores(record: ExamRecord) -> None:
    running_awarded = 0.0
    running_max = 0.0
    sorted_entries = sorted(record.grading_entries, key=lambda e: _question_sort_key(e.question_number))
    for entry in sorted_entries:
        if entry.marks_awarded is not None:
            running_awarded += float(entry.marks_awarded)
        if entry.max_marks is not None:
            running_max += float(entry.max_marks)
        entry.marks_accumulated_over_max = f"{_format_score(running_awarded)}/{_format_score(running_max)}"


def _merge_data_entries(existing_json: Optional[str], incoming: Any) -> List[Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}

    if existing_json:
        try:
            existing_entries = json.loads(existing_json)
        except (TypeError, json.JSONDecodeError):
            existing_entries = []
        for item in existing_entries:
            if not isinstance(item, dict):
                continue
            number = str(item.get("number", "")).strip()
            if not number:
                continue
            merged[number] = {
                "number": number,
                "question": item.get("question", ""),
                "marks": item.get("marks", ""),
                "scheme": item.get("scheme", ""),
            }

    for item in incoming or []:
        if not isinstance(item, dict):
            continue
        number = str(item.get("number", "")).strip()
        if not number:
            continue
        merged[number] = {
            "number": number,
            "question": item.get("question", ""),
            "marks": item.get("marks", ""),
            "scheme": item.get("scheme", ""),
        }

    return [merged[key] for key in sorted(merged.keys(), key=_question_sort_key)]


def _configured_total_max_from_json(data_entries_json: Optional[str]) -> float:
    if not data_entries_json:
        return 0.0
    try:
        parsed = json.loads(data_entries_json)
    except (TypeError, json.JSONDecodeError):
        return 0.0

    total = 0.0
    for entry in parsed if isinstance(parsed, list) else []:
        if not isinstance(entry, dict):
            continue
        marks = entry.get("marks")
        try:
            marks_val = float(marks)
        except (TypeError, ValueError):
            continue
        if marks_val > 0:
            total += marks_val
    return total