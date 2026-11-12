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

from llama_index.core.agent.workflow import AgentStream, ReActAgent
from llama_index.core.workflow import Context
from llama_index.llms.openai_like import OpenAILike

from agent_paths import REPORTS_DIR, db_path

# ---------------------------------------------------------------------------
# Database path resolution
# ---------------------------------------------------------------------------

_REPORTS_DIR = str(REPORTS_DIR)


def _db_path() -> str:
    """Return the database path; EXAM_DB_PATH may override it within the database folders."""
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
# Tool 1 — query_all_students
# ---------------------------------------------------------------------------


def query_all_students() -> list:
    """Return the student roster: one row per unique student with their id,
    number of graded records, and the timestamp of their latest submission.
    Use only when the user asks who is in the database or for a roster/list
    of students — not for individual or class-wide result questions.
    Returns columns: student_id, record_count, latest_graded_at.
    """
    with _connect() as conn:
        rows = conn.execute("""
            SELECT student_id,
                   COUNT(*)           AS record_count,
                   MAX(graded_at)     AS latest_graded_at
            FROM   agent_exam_summaries
            GROUP  BY student_id
            ORDER  BY latest_graded_at DESC
        """).fetchall()

    if not rows:
        return []
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Tool 2 — query_student_result
# ---------------------------------------------------------------------------


def _configured_total_max(data_entries_json) -> float:
    """Sum the marking-scheme's configured max marks (the FULL subject total,
    counted once) from one exam record's stored data_entries_json snapshot.
    """
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
        try:
            marks_val = float(entry.get("marks"))
        except (TypeError, ValueError):
            continue
        if marks_val > 0:
            total += marks_val
    return total


def _combine_papers(rows) -> dict:
    """Combine raw exam_records x grading_entries rows into one cumulative row
    per (student_id, subject_id).

    A student can have multiple graded papers/attempts for the same subject.
    Grading entries are de-duplicated by question_number across those papers
    (the most recently graded paper wins per question, so distinct questions
    from different papers all count once instead of being double-counted),
    and the full marking-scheme total is taken once (from the latest paper),
    not once per paper — otherwise combining papers dilutes the percentage.
    """
    groups: dict = {}
    for r in rows:
        key = (r["student_id"], r["subject_id"])
        g = groups.get(key)
        if g is None:
            g = {
                "student_id": r["student_id"],
                "student_name": r["student_name"] or "",
                "subject_id": r["subject_id"],
                "record_ids": set(),
                "latest_timestamp": r["timestamp"],
                "latest_data_entries_json": r["data_entries_json"],
                "questions": {},
            }
            groups[key] = g

        g["record_ids"].add(r["record_id"])
        if r["student_name"]:
            g["student_name"] = r["student_name"]
        if r["timestamp"] >= g["latest_timestamp"]:
            g["latest_timestamp"] = r["timestamp"]
            g["latest_data_entries_json"] = r["data_entries_json"]

        question_number = r["question_number"]
        if question_number is None:
            continue
        existing = g["questions"].get(question_number)
        if existing is None or r["timestamp"] >= existing["timestamp"]:
            g["questions"][question_number] = {
                "marks_awarded": r["marks_awarded"],
                "max_marks": r["max_marks"],
                "human_review": bool(r["human_review"]),
                "timestamp": r["timestamp"],
            }

    combined = {}
    for key, g in groups.items():
        entries = list(g["questions"].values())
        awarded_sum = sum(e["marks_awarded"] or 0 for e in entries)
        graded_max_sum = sum(e["max_marks"] or 0 for e in entries)
        configured_max = _configured_total_max(g["latest_data_entries_json"])
        total_max = configured_max if configured_max > 0 else graded_max_sum

        score_pct = round(awarded_sum * 100 / total_max, 1) if total_max > 0 else None
        passed = score_pct is not None and score_pct >= 50

        combined[key] = {
            "student_id": g["student_id"],
            "student_name": g["student_name"],
            "subject_id": g["subject_id"],
            "graded_at": g["latest_timestamp"],
            "total_awarded": awarded_sum,
            "total_max": total_max,
            "score_pct": score_pct,
            "passed": passed,
            "human_review_count": sum(1 for e in entries if e["human_review"]),
            "attempts": len(g["record_ids"]),
            "questions": [
                {
                    "questionNumber": qn,
                    "marksAwarded": e["marks_awarded"],
                    "maxMarks": e["max_marks"],
                    "humanReview": e["human_review"],
                }
                for qn, e in sorted(g["questions"].items())
            ],
        }
    return combined


def query_student_result(student_id: str = "", student_name: str = "") -> list | str:
    """Fetch the detailed result of ONE specific student that the user has named.
    Only use this when the user mentions a particular student by id or name
    (e.g. "how did John do?", "show results for 12345"). Do NOT use it for
    class-wide questions such as "who passed", "who failed", rankings or
    averages — use query_class_results for those.
    Identify the student by EITHER student_id (exact match) OR student_name
    (case-insensitive; falls back to a partial match if no exact name match).
    If both are given, a record must match both.
    Returns one row per subject_id, newest first, combining every graded
    paper/attempt into one cumulative score, with per-question scores,
    pass/fail status and human-review flags. The 'questions' field lists each
    distinct question's combined result.
    """
    sid = (student_id or "").strip()
    sname = (student_name or "").strip()
    if not sid and not sname:
        return "Error: supply a non-empty student_id or student_name."

    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT er.record_id, er.student_id, er.student_name, er.subject_id,
                   er.timestamp, er.data_entries_json,
                   ge.question_number, ge.marks_awarded, ge.max_marks, ge.human_review
            FROM   exam_records er
            LEFT JOIN grading_entries ge ON ge.exam_record_id = er.id
            WHERE  (:sid = '' OR er.student_id = :sid)
              AND  (:name = '' OR INSTR(LOWER(er.student_name), LOWER(:name)) > 0)
            ORDER  BY er.timestamp ASC
            """,
            {"sid": sid, "name": sname},
        ).fetchall()

    # Prefer exact (case-insensitive) name matches over partial ones.
    if sname:
        target = sname.lower()
        exact = [r for r in rows if (r["student_name"] or "").strip().lower() == target]
        rows = exact or rows

    if not rows:
        criteria = " and ".join(
            f"{label} '{value}'"
            for label, value in (("student_id", sid), ("student_name", sname))
            if value
        )
        return f"No records found for {criteria}."

    combined = _combine_papers(rows)
    return sorted(combined.values(), key=lambda r: r["graded_at"], reverse=True)


# ---------------------------------------------------------------------------
# Tool 3 — query_class_results
# ---------------------------------------------------------------------------


def query_class_results() -> dict:
    """Return a full class overview — every student's result with pass/fail.
    Use this for any question about multiple or unnamed students, e.g.
    "who passed?", "who failed?", "top/bottom students", rankings, class
    average or overall performance. Takes no arguments.
    Each row already combines every graded paper/attempt into one cumulative
    score per (student, subject) — never a single paper in isolation.
    Produces two sections:
      - 'class_summary': aggregate statistics (total student-subject entries, class
        average, min/max scores, pass count, fail count, total flagged questions).
      - 'students': one combined row per (student_id, subject_id) with score summary
        columns only (no per-question detail), ordered by score descending.
    Use this for ranking reports, pass/fail breakdowns, or class-wide insights.
    For per-question detail on a specific student use query_student_result instead.
    """
    with _connect() as conn:
        rows = conn.execute("""
            SELECT er.record_id, er.student_id, er.student_name, er.subject_id,
                   er.timestamp, er.data_entries_json,
                   ge.question_number, ge.marks_awarded, ge.max_marks, ge.human_review
            FROM   exam_records er
            LEFT JOIN grading_entries ge ON ge.exam_record_id = er.id
            ORDER  BY er.timestamp ASC
        """).fetchall()

    combined = _combine_papers(rows)
    students = sorted(
        combined.values(),
        key=lambda r: (r["score_pct"] is None, -(r["score_pct"] or 0)),
    )

    scored = [s["score_pct"] for s in students if s["score_pct"] is not None]
    class_summary = {
        "total_students": len(students),
        "class_average_pct": round(sum(scored) / len(scored), 1) if scored else None,
        "min_score_pct": round(min(scored), 1) if scored else None,
        "max_score_pct": round(max(scored), 1) if scored else None,
        "passed_count": sum(1 for s in students if s["passed"]),
        "failed_count": sum(
            1 for s in students if s["score_pct"] is not None and not s["passed"]
        ),
        "total_flagged_questions": sum(s["human_review_count"] for s in students),
    }

    return {
        "class_summary": class_summary,
        "students": [
            {k: v for k, v in s.items() if k != "questions"} for s in students
        ],
    }


# ---------------------------------------------------------------------------
# Tool 4 — execute_custom_query
# ---------------------------------------------------------------------------

_MAX_ROWS = 500


def execute_custom_query(sql: str = "") -> list | str:
    """Execute a custom read-only SQL SELECT query against the exam database.
    Use this when the built-in query tools cannot satisfy the user's request,
    for example: date-range filters, custom aggregations, column subsets, or
    any question that requires a hand-crafted WHERE / GROUP BY / ORDER BY clause.

    Only SELECT statements are permitted — any other statement type is rejected.
    Results are capped at 500 rows.

    Schema — table 'agent_exam_summaries':
      record_id          TEXT     unique record identifier
      student_id         TEXT     student identifier
      student_name       TEXT     student display name (may be NULL)
      subject_id         TEXT     subject identifier
      graded_at          TEXT     ISO-8601 timestamp of when the exam was graded
      total_awarded      REAL     total marks awarded
      total_max          REAL     maximum possible marks
      score_pct          REAL     percentage score (0-100)
      passed             INTEGER  1 if passed, 0 if failed
      human_review_count INTEGER  number of questions flagged for human review
      questions_json     TEXT     JSON array of per-question details

    Example queries:
      SELECT student_id, score_pct FROM agent_exam_summaries WHERE score_pct < 50
      SELECT AVG(score_pct) AS avg_score FROM agent_exam_summaries
      SELECT student_id, graded_at FROM agent_exam_summaries ORDER BY graded_at DESC LIMIT 10
    """
    if not sql or not sql.strip():
        return "Error: supply a SQL SELECT query."

    clean = sql.strip().rstrip(";")

    # Reject anything that is not a SELECT statement.
    if not re.match(r"^\s*SELECT\b", clean, re.IGNORECASE):
        return "Error: only SELECT statements are permitted."

    try:
        with _connect() as conn:
            rows = conn.execute(clean).fetchmany(_MAX_ROWS)
        if not rows:
            return "Query executed successfully but returned no rows."
        result = [dict(r) for r in rows]
        if len(result) == _MAX_ROWS:
            result.append(
                {
                    "_note": f"Result capped at {_MAX_ROWS} rows. Refine the query with a WHERE or LIMIT clause to see more specific data."
                }
            )
        return result
    except sqlite3.Error as exc:
        return f"SQL error: {exc}"


# ---------------------------------------------------------------------------
# Agent setup
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a result analysis agent. You help teachers and educators
understand student exam results by querying a graded exam database and generating
clear, insightful reports.

Be analytical, empathetic, and specific. Use the data to tell a clear story.

IMPORTANT — tool usage rules:
- Only call a tool when the user's message explicitly asks for student data,
  exam results, scores, statistics, or reports.
- For greetings, small talk, clarification questions, or any message that does
  NOT require database data, respond directly in plain text WITHOUT calling any tool.
- Never call a tool just to acknowledge or respond to a greeting such as
  "hello", "hi", "how are you", "thanks", or similar.
- Example: user says "hello" -> reply with a plain greeting and call no tool.

Choosing a tool:
- Questions about the whole class or unnamed students ("who passed?",
  "who failed?", "top students", "class average") -> query_class_results.
- Questions about one named student (by name or id) -> query_student_result.
- Never ask the user for a student id or name when the question is about the
  class; just call query_class_results.
- If you truly need more information from the user, ask for it in an
  "Answer:" line — never end a response with only a Thought.
"""

TOOLS = [
    query_all_students,
    query_student_result,
    query_class_results,
    execute_custom_query,
]


def build_agent(api_base: str, model: str, api_key: str) -> ReActAgent:
    llm = OpenAILike(
        model=model,
        api_base=api_base,
        api_key=api_key,
        is_chat_model=True,
        is_function_calling_model=True,
    )
    return ReActAgent(
        tools=TOOLS,
        llm=llm,
        system_prompt=SYSTEM_PROMPT,
    )


# ---------------------------------------------------------------------------
# Interactive REPL
# ---------------------------------------------------------------------------


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
    print('\nType "exit" or "quit" to stop.')
    print(f"Reports will be saved to: {_REPORTS_DIR}\n")

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