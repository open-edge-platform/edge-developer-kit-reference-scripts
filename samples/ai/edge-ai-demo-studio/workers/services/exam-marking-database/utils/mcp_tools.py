# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""MCP tools for querying exam marking insights."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from utils.database import ExamMarkingDatabase


def register_mcp_tools(mcp, db_getter):
    """Register MCP tools on the FastMCP instance.

    Args:
        mcp: FastMCP instance.
        db_getter: Zero-argument callable that returns the ExamMarkingDatabase.
    """

    @mcp.tool(
        description="Return aggregated statistics for all graded exam papers including total students, average score, pass rate, score distribution and per-question averages."
    )
    def get_exam_stats() -> dict:
        return db_getter().get_stats()

    @mcp.tool(
        description="Look up all graded results for a specific student. Provide either student_name (partial match) or student_id (exact match)."
    )
    def get_student_results(student_name: str = "", student_id: str = "") -> list:
        return db_getter().get_student_results(
            student_name=student_name, student_id=student_id
        )

    @mcp.tool(
        description="List all graded student records with their precomputed performance summary (score, %, pass/fail, per-question breakdown), newest first."
    )
    def list_exam_records() -> list:
        return db_getter().list_student_performances()

    @mcp.tool(
        description="Get the full graded record for a single student paper by its record ID."
    )
    def get_exam_record(record_id: str) -> dict:
        record = db_getter().get_record(record_id)
        if not record:
            return {"error": f"Record '{record_id}' not found"}
        return record

    @mcp.tool(
        description="Generate a human-readable insights report covering class performance, score distribution, per-question analysis, and students flagged for human review."
    )
    def generate_insights_report() -> str:
        stats = db_getter().get_stats()
        if stats.get("total_students", 0) == 0:
            return "No exam records found. Grade some student papers first."

        lines = [
            "# Exam Insights Report",
            "",
            "## Class Overview",
            f"- Total students graded: {stats['total_students']}",
            (
                f"- Class average score: {stats['average_pct']}%"
                if stats.get("average_pct") is not None
                else "- Class average score: N/A"
            ),
            (
                f"- Pass rate (≥50%): {stats['pass_rate']}%"
                if stats.get("pass_rate") is not None
                else "- Pass rate: N/A"
            ),
            f"- Items flagged for human review: {stats.get('human_review_count', 0)}",
            "",
            "## Score Distribution",
        ]
        for bucket in stats.get("score_distribution", []):
            bar = "█" * bucket["count"]
            lines.append(f"  {bucket['label']:10} | {bar} ({bucket['count']})")

        q_stats = stats.get("question_stats", [])
        if q_stats:
            lines += [
                "",
                "## Per-Question Performance",
                f"{'Question':<12} {'Avg Score':<15} {'Avg %':<10}",
                "-" * 40,
            ]
            for q in q_stats:
                lines.append(
                    f"{q['label']:<12} {q['avg_awarded']}/{q['avg_max']:<10}  {q['avg_pct']}%"
                )

        performances = db_getter().list_student_performances()
        flagged = [p for p in performances if p.get("humanReviewCount", 0) > 0]
        if flagged:
            lines += [
                "",
                "## Students Flagged for Human Review",
            ]
            for p in flagged:
                name = p.get("studentName") or p.get("studentId") or p["recordId"]
                q_nums = [
                    str(q["questionNumber"])
                    for q in p.get("questionBreakdown", [])
                    if q.get("humanReview")
                ]
                suffix = f": Q{', Q'.join(q_nums)}" if q_nums else ""
                lines.append(f"  - {name}{suffix}")

        return "\n".join(lines)