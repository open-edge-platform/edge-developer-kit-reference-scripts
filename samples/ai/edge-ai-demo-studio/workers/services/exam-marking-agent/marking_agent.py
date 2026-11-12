# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Marking Agent for Exam Marking
=======================================
Scan prior_mark folder, move files to marked folder (frontend auto-grades).

Usage:
    python marking_agent.py
    python marking_agent.py --db-path /path/to/exam_marking.db
    python marking_agent.py --prior-mark-dir /path/to/prior_mark
"""

import argparse
import asyncio
import json
import logging
import os
import re
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from llama_index.core.agent.workflow import AgentStream, ReActAgent
from llama_index.core.workflow import Context
from llama_index.llms.openai_like import OpenAILike

from agent_paths import APP_BASE_DIR, PAPERS_ROOT

# Module-level LLM reference — set by build_agent() so tools can call it directly
_llm: Optional[OpenAILike] = None

logger = logging.getLogger(__name__)

_APP_BASE_DIR = APP_BASE_DIR
_SUPPORTED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tiff", ".bmp"}


def _get_prior_mark_path() -> str:
    path = os.environ.get(
        "PRIOR_MARK_PATH",
        str(PAPERS_ROOT / "prior_mark"),
    )
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(_APP_BASE_DIR):
        raise ValueError(f"Invalid PRIOR_MARK_PATH: {resolved}")
    return str(resolved)


def _get_marked_path() -> str:
    path = os.environ.get(
        "MARKED_PATH",
        str(PAPERS_ROOT / "marked"),
    )
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(_APP_BASE_DIR):
        raise ValueError(f"Invalid MARKED_PATH: {resolved}")
    return str(resolved)


def _list_image_files(folder: str) -> list[str]:
    if not os.path.exists(folder):
        return []
    return [
        f for f in os.listdir(folder)
        if os.path.isfile(os.path.join(folder, f))
        and os.path.splitext(f)[1].lower() in _SUPPORTED_EXTENSIONS
    ]


def _move_file(src: str, dst_dir: str) -> str:
    resolved_src = os.path.realpath(src)
    resolved_dst_dir = os.path.realpath(dst_dir)
    os.makedirs(resolved_dst_dir, exist_ok=True)
    dst = os.path.join(resolved_dst_dir, os.path.basename(resolved_src))
    shutil.move(resolved_src, dst)
    return dst


async def run_upload_loop(
    poll_seconds: int = 5,
    frontend_base: str = "http://127.0.0.1:3000",
) -> None:
    """Background loop: monitor prior_mark while frontend handles grading.

    Important: this loop must NOT move files. Files are moved to marked only after
    grading completes via /v1/move-to-marked in main.py.
    """
    prior_mark_dir = _get_prior_mark_path()
    marked_dir = _get_marked_path()
    logger.info("[upload-agent] started — watching: %s", prior_mark_dir)
    logger.info("[upload-agent] destination: %s", marked_dir)
    logger.info("[upload-agent] poll interval: %ds | supported: %s", poll_seconds, sorted(_SUPPORTED_EXTENSIONS))

    last_snapshot: set[str] = set()

    while True:
        try:
            all_files = [
                f for f in os.listdir(prior_mark_dir)
                if os.path.isfile(os.path.join(prior_mark_dir, f))
            ] if os.path.exists(prior_mark_dir) else []

            image_files = _list_image_files(prior_mark_dir)
            skipped = [f for f in all_files if f not in image_files]

            if skipped:
                logger.warning(
                    "[upload-agent] %d file(s) ignored (unsupported extension): %s",
                    len(skipped), skipped,
                )

            current_snapshot = set(image_files)
            if current_snapshot != last_snapshot:
                if image_files:
                    logger.info(
                        "[upload-agent] pending in prior_mark (%d): %s | waiting for grading completion before move-to-marked",
                        len(image_files),
                        sorted(image_files),
                    )
                else:
                    logger.info("[upload-agent] prior_mark is empty")
                last_snapshot = current_snapshot
        except Exception as exc:  # noqa: BLE001
            logger.error("[upload-agent] loop error: %s", exc)
        await asyncio.sleep(poll_seconds)


# ---------------------------------------------------------------------------
# Tool 1 — scan_input_folder
# ---------------------------------------------------------------------------

def scan_input_folder() -> list:
    """Scan the prior_mark folder and list all files pending grading."""
    input_path = _get_prior_mark_path()
    if not os.path.exists(input_path):
        return []
    return [f for f in os.listdir(input_path) if os.path.isfile(os.path.join(input_path, f))]

# ---------------------------------------------------------------------------
# Tool 1 — scan_output_folder
# ---------------------------------------------------------------------------

def scan_output_folder() -> list:
    """Scan the marked folder and list all files that have been graded."""
    output_path = _get_marked_path()
    if not os.path.exists(output_path):
        return []
    return [f for f in os.listdir(output_path) if os.path.isfile(os.path.join(output_path, f))]

# ---------------------------------------------------------------------------
# Tool 1 — shift_marked_paper
# ---------------------------------------------------------------------------

def shift_marked_paper(filename: str) -> None:
    """Move a graded file from the prior_mark folder to the marked folder."""
    input_path = _get_prior_mark_path()
    output_path = _get_marked_path()
    os.makedirs(output_path, exist_ok=True)

    safe_name = os.path.basename(filename)
    src = os.path.realpath(os.path.join(input_path, safe_name))
    dst = os.path.realpath(os.path.join(output_path, safe_name))
    if not src.startswith(input_path + os.sep) or not dst.startswith(output_path + os.sep):
        raise ValueError(f"Invalid filename: {filename!r}")

    if os.path.exists(src):
        os.rename(src, dst)


# ---------------------------------------------------------------------------
# Agent setup
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a marking agent. You scan the prior_mark folder then upload and queue files from it for grading. 
After finish grading a file, you will move it to the marked folder.
"""

TOOLS = [
    scan_input_folder,
    scan_output_folder,
    shift_marked_paper,
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
    "Is prior_mark folder empty?",
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
    print("\n=== Exam Marking Agent ===")
    print(f"Input path : {os.environ.get('PRIOR_MARK_PATH', '../prior_mark')}")
    print(f"Output path: {os.environ.get('MARKED_PATH', '../marked')}")
    print("\nExample queries:")
    for q in EXAMPLE_QUERIES:
        print(f"  • {q}")
    print('\nType "exit" or "quit" to stop.')

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
    parser = argparse.ArgumentParser(description="Exam Marking Agent")
    parser.add_argument(
            "--input-path",
            default=None,
            help="Path to students unmarked exam paper (default: ../prior_mark)",
    )
    parser.add_argument(
        "--output-path",
        default=None,
        help="Path to save marked exam papers (default: ../marked)",
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
    if args.input_path:
        resolved = os.path.realpath(os.path.abspath(args.input_path))
        os.environ["PRIOR_MARK_PATH"] = resolved
    if args.output_path:
        resolved = os.path.realpath(os.path.abspath(args.output_path))
        os.environ["MARKED_PATH"] = resolved

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