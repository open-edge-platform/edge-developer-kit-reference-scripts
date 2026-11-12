# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Result Analysis Agent for Exam Marking
=======================================
Queries exam_marking.db and generates AI-powered reports for individual
students or the whole class, including feedback, insights, and recommendations.

Usage:
    python result_analysis_agent.py
    python result_analysis_agent.py --db-path /path/to/exam_marking.db
    python result_analysis_agent.py --api-base http://localhost:8081/v1
    python result_analysis_agent.py --model my-model
"""

import argparse
import asyncio
import json
import os
import re
import sqlite3
from datetime import datetime
from typing import Optional
from llama_index.core.agent.workflow import AgentStream, ReActAgent
from llama_index.core.workflow import Context
from llama_index.llms.openai_like import OpenAILike

from agent_paths import REPORTS_DIR, db_path

# Module-level LLM reference — set by build_agent() so tools can call it directly
_llm: Optional[OpenAILike] = None

# Directory where exported reports are saved
_REPORTS_DIR = str(REPORTS_DIR)


# ---------------------------------------------------------------------------
# Database path resolution
# ---------------------------------------------------------------------------


def _db_path() -> str:
    """Return the active, canonicalized database path (env var overrides default)."""
    return db_path()


def _connect() -> sqlite3.Connection:
    """Open a read-only SQLite connection (creates DB file only if already exists)."""
    path = _db_path()
    if not os.path.isfile(path):
        raise FileNotFoundError(
            f"Database not found at '{path}'. "
            "Set EXAM_DB_PATH or pass --db-path to point to exam_marking.db."
        )
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# Tool 1 — list_all_students
# ---------------------------------------------------------------------------


def list_all_students() -> list:
    """List every graded student with their name, ID, score percentage, pass/fail
    status, number of questions flagged for human review, and exam date.
    Use this to discover which students are in the database before drilling down."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT student_name, student_id, record_id,
                   score_pct, passed, human_review_count,
                   total_awarded, total_max, graded_at
            FROM   student_performances
            ORDER  BY graded_at DESC
            """
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Tool 2 — get_student_report
# ---------------------------------------------------------------------------


def get_student_report(student_name: str = "", student_id: str = "") -> str:
    """Generate a detailed performance report for a single student.

    The report includes:
    - Overall score, percentage, and pass/fail result
    - Per-question breakdown: marks awarded, percentage, the student's extracted
      answer, the AI feedback, and the original marking scheme
    - A summary of strengths (questions scoring ≥70 %) and weaknesses (<50 %)
    - Any questions flagged for human review

    Provide *either* student_name (partial/case-insensitive match) or
    student_id (exact match). If multiple records match, all are returned.
    """
    if not student_name and not student_id:
        return "Error: supply at least one of student_name or student_id."

    with _connect() as conn:
        if student_id:
            records = conn.execute(
                """
                SELECT er.record_id, er.student_name, er.student_id,
                       er.timestamp, er.data_entries_json,
                       sp.score_pct, sp.passed, sp.total_awarded,
                       sp.total_max, sp.human_review_count
                FROM   exam_records er
                LEFT JOIN student_performances sp
                       ON sp.exam_record_id = er.id
                WHERE  er.student_id = ?
                ORDER  BY er.timestamp DESC
                """,
                (student_id,),
            ).fetchall()
        else:
            records = conn.execute(
                """
                SELECT er.record_id, er.student_name, er.student_id,
                       er.timestamp, er.data_entries_json,
                       sp.score_pct, sp.passed, sp.total_awarded,
                       sp.total_max, sp.human_review_count
                FROM   exam_records er
                LEFT JOIN student_performances sp
                       ON sp.exam_record_id = er.id
                WHERE  er.student_name LIKE ?
                ORDER  BY er.timestamp DESC
                """,
                (f"%{student_name}%",),
            ).fetchall()

        if not records:
            term = student_id or student_name
            return f"No exam records found for '{term}'."

        reports = []
        for rec in records:
            r = dict(rec)
            entries = conn.execute(
                """
                SELECT ge.question_number, ge.extracted_answer,
                       ge.feedback, ge.marks_awarded_over_max,
                       ge.marks_awarded, ge.max_marks,
                       ge.marks_accumulated_over_max, ge.human_review
                FROM   grading_entries ge
                JOIN   exam_records er ON er.id = ge.exam_record_id
                WHERE  er.record_id = ?
                ORDER  BY CAST(ge.question_number AS INTEGER)
                """,
                (r["record_id"],),
            ).fetchall()

            try:
                data_entries = json.loads(r.get("data_entries_json") or "[]")
            except (json.JSONDecodeError, TypeError):
                data_entries = []
            q_map = {str(de.get("number", "")): de for de in data_entries}

            name = r.get("student_name") or r.get("student_id") or "Unknown"
            sid = r.get("student_id") or "N/A"
            score_pct = r.get("score_pct")
            passed = r.get("passed")
            total_awarded = r.get("total_awarded")
            total_max = r.get("total_max")
            hr_count = r.get("human_review_count", 0)
            timestamp = (r.get("timestamp") or "")[:19]

            lines = [
                f"# Student Report: {name}",
                f"Student ID : {sid}",
                f"Exam Date  : {timestamp}",
                "",
                "## Overall Performance",
            ]
            if total_awarded is not None and total_max:
                lines.append(f"- Total Score   : {total_awarded}/{total_max}")
            if score_pct is not None:
                lines.append(f"- Percentage    : {score_pct:.1f}%")
            if passed is not None:
                lines.append(f"- Result        : {'✓ PASS' if passed else '✗ FAIL'}")
            lines.append(f"- Human Reviews : {hr_count} question(s) flagged")

            strengths, weaknesses = [], []
            lines += ["", "## Question-by-Question Breakdown"]

            for entry in entries:
                e = dict(entry)
                q_num = e.get("question_number", "?")
                q_info = q_map.get(str(q_num), {})

                awarded = e.get("marks_awarded")
                max_m = e.get("max_marks")
                pct = (
                    round(awarded / max_m * 100)
                    if awarded is not None and max_m and max_m > 0
                    else None
                )
                feedback = (e.get("feedback") or "").strip()
                hr = bool(e.get("human_review"))
                extracted = (e.get("extracted_answer") or "").strip()
                score_str = e.get("marks_awarded_over_max") or "N/A"

                lines.append(f"\n### Question {q_num}  [{score_str}]")
                q_text = q_info.get("question", "")
                if q_text:
                    lines.append(f"**Question:** {q_text}")
                if extracted:
                    lines.append(f"**Student Answer:** {extracted}")
                scheme = q_info.get("scheme", "")
                if scheme:
                    lines.append(f"**Marking Scheme:** {scheme}")
                if pct is not None:
                    lines.append(f"**Score:** {awarded}/{max_m} ({pct}%)")
                if feedback:
                    lines.append(f"**Feedback:** {feedback}")
                if hr:
                    lines.append("⚠️ **Flagged for Human Review**")

                # Track strengths / weaknesses
                if pct is not None:
                    (strengths if pct >= 70 else (weaknesses if pct < 50 else [])).append(
                        f"Q{q_num} ({pct}%)"
                    )

            lines += ["", "## Summary"]
            if strengths:
                lines.append(f"**Strengths :** {', '.join(strengths)}")
            if weaknesses:
                lines.append(f"**Weaknesses:** {', '.join(weaknesses)}")
            if not strengths and not weaknesses:
                lines.append("All questions scored between 50–69 %.")

            reports.append("\n".join(lines))

        return "\n\n" + ("—" * 60) + "\n\n".join(reports)


# ---------------------------------------------------------------------------
# Tool 3 — get_class_report
# ---------------------------------------------------------------------------


def get_class_report() -> str:
    """Generate a comprehensive class-wide performance report including:
    - Class overview (average score, pass rate, human review flags)
    - Score distribution across five grade bands
    - Per-question performance table with a strength/weak label
    - Top 5 performers and bottom 5 performers
    - Students flagged for human review
    Use this for an overall class summary or when a full class analysis is requested."""
    with _connect() as conn:
        snap = conn.execute(
            "SELECT stats_json FROM class_snapshots LIMIT 1"
        ).fetchone()
        if not snap:
            return "No exam records found. Grade some student papers first."

        stats = json.loads(snap["stats_json"])
        if stats.get("total_students", 0) == 0:
            return "No exam records found. Grade some student papers first."

        perfs = conn.execute(
            """
            SELECT student_name, student_id, record_id,
                   score_pct, passed, human_review_count,
                   question_breakdown_json, graded_at
            FROM   student_performances
            ORDER  BY score_pct DESC NULLS LAST
            """
        ).fetchall()
        perfs = [dict(p) for p in perfs]

    lines = [
        "# Class Performance Report",
        "",
        "## Class Overview",
        f"- Total Students Graded : {stats['total_students']}",
    ]
    if stats.get("average_pct") is not None:
        lines.append(f"- Class Average Score   : {stats['average_pct']}%")
    if stats.get("pass_rate") is not None:
        lines.append(f"- Pass Rate (≥50%)      : {stats['pass_rate']}%")
    lines.append(f"- Human Review Flags    : {stats.get('human_review_count', 0)}")

    # Score distribution
    lines += ["", "## Score Distribution"]
    for bucket in stats.get("score_distribution", []):
        bar = "█" * bucket["count"]
        empty = "░" * max(0, 10 - bucket["count"])
        lines.append(
            f"  {bucket['label']:12} |{bar}{empty}| {bucket['count']} student(s)"
        )

    # Per-question table
    q_stats = stats.get("question_stats", [])
    if q_stats:
        lines += [
            "",
            "## Per-Question Performance",
            f"{'Question':<12} {'Avg Score':<14} {'Avg %':<8} Status",
            "─" * 50,
        ]
        for q in q_stats:
            if q["avg_pct"] >= 70:
                status = "✓ Strong"
            elif q["avg_pct"] >= 50:
                status = "~ Moderate"
            else:
                status = "✗ Weak"
            lines.append(
                f"{q['label']:<12} {q['avg_awarded']}/{q['avg_max']:<9}  "
                f"{q['avg_pct']}%    {status}"
            )

    # Top performers
    scored = [p for p in perfs if p.get("score_pct") is not None]
    if scored:
        lines += ["", "## Top 5 Performers"]
        for i, p in enumerate(scored[:5], 1):
            name = p.get("student_name") or p.get("student_id") or "Unknown"
            lines.append(
                f"  {i}. {name} — {p['score_pct']:.1f}% "
                f"({'PASS' if p['passed'] else 'FAIL'})"
            )

    # Bottom performers
    if len(scored) > 1:
        bottom = list(reversed(scored))[:5]
        lines += ["", "## Students Needing Support (Bottom 5)"]
        for p in bottom:
            name = p.get("student_name") or p.get("student_id") or "Unknown"
            lines.append(
                f"  - {name} — {p['score_pct']:.1f}% "
                f"({'PASS' if p['passed'] else 'FAIL'})"
            )

    # Flagged students
    flagged = [p for p in perfs if p.get("human_review_count", 0) > 0]
    if flagged:
        lines += ["", "## Students Flagged for Human Review"]
        for p in flagged:
            name = p.get("student_name") or p.get("student_id") or "Unknown"
            breakdown = json.loads(p.get("question_breakdown_json") or "[]")
            qs = [str(q["questionNumber"]) for q in breakdown if q.get("humanReview")]
            qs_str = f" — Q{', Q'.join(qs)}" if qs else ""
            lines.append(
                f"  - {name}: {p['human_review_count']} flag(s){qs_str}"
            )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool 4 — get_weak_areas_analysis
# ---------------------------------------------------------------------------


def get_weak_areas_analysis() -> str:
    """Identify questions where the class performed poorly (below 50 % average),
    flag moderate areas (50–69 %), and highlight strong areas (≥70 %).
    Returns actionable insights and teaching recommendations per category.
    Use this when asked about curriculum gaps or topics needing re-teaching."""
    with _connect() as conn:
        snap = conn.execute(
            "SELECT stats_json FROM class_snapshots LIMIT 1"
        ).fetchone()
        if not snap:
            return "No exam data available."
        stats = json.loads(snap["stats_json"])

    q_stats = stats.get("question_stats", [])
    if not q_stats:
        return "No per-question data available."

    weak = [q for q in q_stats if q.get("avg_pct", 100) < 50]
    moderate = [q for q in q_stats if 50 <= q.get("avg_pct", 100) < 70]
    strong = [q for q in q_stats if q.get("avg_pct", 0) >= 70]

    lines = ["# Weak Areas Analysis", ""]

    if weak:
        lines += [
            f"## ✗ Critical Weak Areas — {len(weak)} question(s) below 50 %",
            "These topics require immediate re-teaching or revision sessions.",
        ]
        for q in sorted(weak, key=lambda x: x["avg_pct"]):
            lines.append(
                f"  - {q['label']}: class average {q['avg_pct']}% "
                f"({q['avg_awarded']}/{q['avg_max']} avg)"
            )
    else:
        lines.append("## ✓ No critical weak areas — all questions averaged ≥50 %")

    if moderate:
        lines += [
            "",
            f"## ~ Areas for Improvement — {len(moderate)} question(s) at 50–69 %",
            "Consider targeted practice exercises for these topics.",
        ]
        for q in sorted(moderate, key=lambda x: x["avg_pct"]):
            lines.append(f"  - {q['label']}: class average {q['avg_pct']}%")

    if strong:
        lines += [
            "",
            f"## ✓ Strong Areas — {len(strong)} question(s) ≥70 %",
        ]
        for q in sorted(strong, key=lambda x: -x["avg_pct"]):
            lines.append(f"  - {q['label']}: class average {q['avg_pct']}%")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool 5 — get_students_needing_review
# ---------------------------------------------------------------------------


def get_students_needing_review() -> str:
    """Return all students who have at least one question flagged for human review,
    along with which questions were flagged, the AI feedback for those questions,
    and the student's overall score.
    Use this to produce a manual review queue for teachers."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT sp.student_name, sp.student_id, sp.record_id,
                   sp.score_pct, sp.passed, sp.human_review_count,
                   sp.question_breakdown_json
            FROM   student_performances sp
            WHERE  sp.human_review_count > 0
            ORDER  BY sp.human_review_count DESC, sp.score_pct ASC
            """
        ).fetchall()

        if not rows:
            return "No students are currently flagged for human review."

        lines = ["# Human Review Queue", ""]
        for row in rows:
            r = dict(row)
            name = r.get("student_name") or r.get("student_id") or "Unknown"
            breakdown = json.loads(r.get("question_breakdown_json") or "[]")
            flagged_qs = [q for q in breakdown if q.get("humanReview")]

            # Fetch AI feedback for flagged questions
            feedbacks = conn.execute(
                """
                SELECT ge.question_number, ge.feedback, ge.marks_awarded_over_max
                FROM   grading_entries ge
                JOIN   exam_records er ON er.id = ge.exam_record_id
                WHERE  er.record_id = ? AND ge.human_review = 1
                ORDER  BY CAST(ge.question_number AS INTEGER)
                """,
                (r["record_id"],),
            ).fetchall()

            lines += [
                f"## {name}",
                 (
                     f"- Overall Score : {r['score_pct']:.1f}% "
                     f"({'PASS' if r['passed'] else 'FAIL'}) — "
                     if r["score_pct"] is not None
                     else "- Overall Score : N/A — "
                 )
                 + f"{r['human_review_count']} question(s) flagged",
            ]
            for fb in feedbacks:
                f_dict = dict(fb)
                lines.append(
                    f"  - Q{f_dict['question_number']} [{f_dict['marks_awarded_over_max']}]: "
                    f"{(f_dict['feedback'] or 'No AI feedback').strip()}"
                )
            lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool 6 — compare_students
# ---------------------------------------------------------------------------


def compare_students(student_names: str) -> str:
    """Compare performance of multiple students side by side.
    Pass a comma-separated list of student names (e.g. "Alice, Bob, Charlie").
    Returns a comparison table with overall scores and per-question breakdown."""
    names = [n.strip() for n in student_names.split(",") if n.strip()]
    if len(names) < 2:
        return "Error: provide at least two comma-separated student names."

    with _connect() as conn:
        results = {}
        for name in names:
            rows = conn.execute(
                """
                SELECT sp.student_name, sp.student_id, sp.score_pct, sp.passed,
                       sp.total_awarded, sp.total_max, sp.question_breakdown_json
                FROM   student_performances sp
                JOIN   exam_records er ON er.record_id = sp.record_id
                WHERE  er.student_name LIKE ?
                ORDER  BY sp.graded_at DESC
                LIMIT  1
                """,
                (f"%{name}%",),
            ).fetchone()
            results[name] = dict(rows) if rows else None

    found = {k: v for k, v in results.items() if v}
    not_found = [k for k, v in results.items() if v is None]

    lines = ["# Student Comparison", ""]

    if not_found:
        lines.append(f"Not found in database: {', '.join(not_found)}\n")

    if not found:
        return "None of the specified students were found."

    # Header row
    col_w = 18
    header = f"{'Metric':<22}" + "".join(
        f"{name[:col_w]:<{col_w}}" for name in found
    )
    lines += [header, "─" * (22 + col_w * len(found))]

    def _row(label: str, values: list) -> str:
        return f"{label:<22}" + "".join(f"{str(v):<{col_w}}" for v in values)

    students = list(found.values())
    student_keys = list(found.keys())

    lines.append(_row("Total Score", [
        f"{s['total_awarded']}/{s['total_max']}" if s.get("total_awarded") is not None else "N/A"
        for s in students
    ]))
    lines.append(_row("Percentage", [
        f"{s['score_pct']:.1f}%" if s.get("score_pct") is not None else "N/A"
        for s in students
    ]))
    lines.append(_row("Result", [
        "PASS" if s.get("passed") else "FAIL" for s in students
    ]))

    # Per-question comparison
    all_questions: dict = {}
    for s in students:
        for q in json.loads(s.get("question_breakdown_json") or "[]"):
            all_questions[str(q["questionNumber"])] = True

    if all_questions:
        lines.append("")
        lines.append("Per-Question Scores:")
        for q_num in sorted(all_questions.keys(), key=lambda x: int(x) if x.isdigit() else 0):
            vals = []
            for s in students:
                breakdown = json.loads(s.get("question_breakdown_json") or "[]")
                q_data = next(
                    (q for q in breakdown if str(q["questionNumber"]) == q_num), None
                )
                if q_data and q_data.get("marksAwarded") is not None:
                    vals.append(
                        f"{q_data['marksAwarded']}/{q_data['maxMarks']} ({q_data.get('pct', '?')}%)"
                    )
                else:
                    vals.append("N/A")
            lines.append(_row(f"  Q{q_num}", vals))

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool 7 — refine_report
# ---------------------------------------------------------------------------

_REFINE_SYSTEM = (
    "You are a professional academic report writer working for an educational institution. "
    "Your task is to transform raw exam analysis data into a polished, formal academic "
    "performance report. Use third-person perspective, precise academic language, and a "
    "well-structured document layout."
)

_REFINE_PROMPT = """\
Transform the following raw exam analysis data into a formal academic performance report.

Requirements:
- Document header: Institution name placeholder, report date ({date}), academic year ({academic_year}), prepared by "AI Exam Analysis System"
- Numbered sections: 1. Executive Summary, 2. Assessment Overview, 3. Performance Analysis, 4. Detailed Findings, 5. Recommendations, 6. Conclusion
- Convert bullet lists into fluent prose paragraphs where appropriate
- Use formal academic vocabulary (cohort, assessment, attainment, proficiency, etc.)
- Keep all numerical data accurate — do not fabricate or alter any scores
- Recommendations must be specific, constructive, and tied to the data
- End with a professional sign-off line

Optional report title: {title}

Raw data to transform:
---
{raw_report}
---

Produce the formal report now:"""


def refine_report(raw_report: str, report_title: str = "") -> str:
    """Transform a raw analysis report into a polished, official academic performance report.

    The LLM rewrites the content using formal academic language, adds an Executive Summary,
    numbered sections (Overview, Analysis, Findings, Recommendations, Conclusion), and a
    professional document header with date and academic year.

    Always call this tool *before* save_report when the user wants an official-looking document.
    Pass the full raw report text returned by any get_*_report or get_weak_areas_analysis tool.
    The optional report_title is embedded in the document header.
    """
    if not raw_report or not raw_report.strip():
        return "Error: raw_report is empty. Generate a report first (e.g. get_class_report or get_student_report)."
    if _llm is None:
        return "Error: LLM not initialised — cannot refine report."

    today = datetime.now()
    date_str = today.strftime("%d %B %Y")
    year = today.year
    academic_year = f"{year - 1}/{year}"

    prompt = _REFINE_PROMPT.format(
        date=date_str,
        academic_year=academic_year,
        title=report_title or "Exam Performance Report",
        raw_report=raw_report.strip(),
    )

    from llama_index.core.llms import ChatMessage, MessageRole
    response = _llm.chat([
        ChatMessage(role=MessageRole.SYSTEM, content=_REFINE_SYSTEM),
        ChatMessage(role=MessageRole.USER, content=prompt),
    ])
    return response.message.content or "(empty response from LLM)"


# ---------------------------------------------------------------------------
# Tool 8 — save_report
# ---------------------------------------------------------------------------


def save_report(content: str, filename: str = "", format: str = "md") -> str:
    """Save a report to a file on disk and return the full file path.

    Parameters:
    - content  : The report text to save (plain text or Markdown).
    - filename : Optional base filename without extension. An auto-generated
                 timestamped name is used when omitted.
    - format   : "md" for Markdown (default) or "txt" for plain text.

    Reports are saved to a 'reports/' folder next to this script.
    Call this after refine_report to persist the polished document.
    """
    if not content or not content.strip():
        return "Error: content is empty — nothing to save."

    fmt = format.lower().strip().lstrip(".")
    if fmt not in {"md", "txt"}:
        fmt = "md"

    os.makedirs(_REPORTS_DIR, exist_ok=True)

    if filename:
        # Sanitise: keep alphanumerics, spaces, hyphens, underscores
        safe = re.sub(r"[^\w\s\-]", "", filename).strip()
        safe = re.sub(r"\s+", "_", safe)
    else:
        safe = datetime.now().strftime("report_%Y%m%d_%H%M%S")

    out_path = os.path.join(_REPORTS_DIR, f"{safe}.{fmt}")

    # Avoid silently overwriting an existing file
    counter = 1
    base = out_path
    while os.path.exists(out_path):
        name, ext = os.path.splitext(base)
        out_path = f"{name}_{counter}{ext}"
        counter += 1

    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(content)

    return f"Report saved to: {out_path}"


# ---------------------------------------------------------------------------
# Agent setup
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are an expert academic performance analyst. You help teachers and educators
understand student exam results by querying a graded exam database and generating
clear, insightful reports.

Your capabilities:
- List all graded students
- Generate individual student reports with per-question feedback and analysis
- Generate class-wide performance reports
- Identify weak areas and curriculum gaps
- Retrieve the human-review queue for teacher follow-up
- Compare multiple students side by side
- Refine/enhance any raw report into a polished official academic document
- Save/export any report to a file on disk

When generating reports always include:
1. A concise executive summary
2. Specific strengths and weaknesses (backed by the data)
3. Actionable recommendations for students or teachers
4. Any questions or students flagged for human review

When the user asks for an "official", "formal", or "exported" report:
1. First call the appropriate get_*_report tool to retrieve the raw data
2. Then call refine_report to transform it into formal academic language
3. Finally call save_report to persist it to disk and tell the user the file path

Be analytical, empathetic, and specific. Use the data to tell a clear story.
"""

TOOLS = [
    list_all_students,
    get_student_report,
    get_class_report,
    get_weak_areas_analysis,
    get_students_needing_review,
    compare_students,
    refine_report,
    save_report,
]


def build_agent(api_base: str, model: str, api_key: str) -> ReActAgent:
    global _llm
    _llm = OpenAILike(
        model=model,
        api_base=api_base,
        api_key=api_key,
        is_chat_model=True,
        is_function_calling_model=True,
    )
    return ReActAgent(
        tools=TOOLS,
        llm=_llm,
        system_prompt=SYSTEM_PROMPT,
        max_iterations=8,
        early_stopping_method="generate",
    )


# ---------------------------------------------------------------------------
# Interactive REPL
# ---------------------------------------------------------------------------

EXAMPLE_QUERIES = [
    'Generate a report for student "Alice"',
    "Show me the class performance report",
    "Which topics did the class struggle with most?",
    "Who needs human review?",
    'Compare "Alice" and "Bob"',
    "List all students",
    "Generate an official class report and save it",
    'Generate a formal student report for "Alice" and export it as a txt file',
]


async def run_query(agent: ReActAgent, ctx: Context, query: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"Query: {query}")
    print("─" * 60)

    handler = agent.run(query, ctx=ctx)
    async for ev in handler.stream_events():
        if isinstance(ev, AgentStream):
            print(ev.delta, end="", flush=True)

    await handler  # finalise the workflow so the context is free for the next query
    print()  # newline after streamed response


async def interactive_loop(agent: ReActAgent) -> None:
    ctx = Context(agent)
    print("\n=== Exam Result Analysis Agent ===")
    print(f"Database : {_db_path()}")
    print("\nExample queries:")
    for q in EXAMPLE_QUERIES:
        print(f"  • {q}")
    print('\nType "exit" or "quit" to stop.')
    print(f"Reports saved to: {_REPORTS_DIR}\n")

    while True:
        try:
            query = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye.")
            break

        if not query:
            continue
        if query.lower() in {"exit", "quit", "q"}:
            print("Goodbye.")
            break

        await run_query(agent, ctx, query)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Exam Result Analysis Agent")
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to exam_marking.db (default: the Exam Marking Database instance's file)",
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("LLM_API_BASE", "http://localhost:8081/v1"),
        help="OpenAI-compatible API base URL",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("LLM_MODEL", "dummy"),
        help="Model name to use",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("LLM_API_KEY", "dummy"),
        help="API key (use 'dummy' for local servers)",
    )
    parser.add_argument(
        "--query",
        default=None,
        help="Run a single query and exit (non-interactive mode)",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()

    # Override DB path if provided
    if args.db_path:
        os.environ["EXAM_DB_PATH"] = os.path.abspath(args.db_path)

    agent = build_agent(
        api_base=args.api_base,
        model=args.model,
        api_key=args.api_key,
    )

    if args.query:
        ctx = Context(agent)
        await run_query(agent, ctx, args.query)
    else:
        await interactive_loop(agent)


if __name__ == "__main__":
    asyncio.run(main())
