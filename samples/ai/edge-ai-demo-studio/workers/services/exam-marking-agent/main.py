# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Exam Marking Agent — HTTP server
=================================
Wraps the ReAct analysis agent from result_analysis_agent.py and exposes it as
an OpenAI-compatible streaming /v1/chat/completions endpoint so the frontend
can drive it via the same @ai-sdk/react infrastructure used by text-generation.
"""

import argparse
import ast
import asyncio
import base64
import json
import logging
import os
import re
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
import requests
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from llama_index.core.agent.workflow import AgentStream, ReActAgent, ToolCallResult
from llama_index.core.workflow import Context
from llama_index.llms.openai_like import OpenAILike
# Re-use the tools and system prompt from the CLI script (unchanged analysis path)
from result_analysis_agent import SYSTEM_PROMPT as ANALYSIS_SYSTEM_PROMPT
from result_analysis_agent import TOOLS as ANALYSIS_TOOLS
from marking_agent import run_upload_loop
# Result dispatch agent integration
import result_dispatch_agent as dispatch_agent
from result_dispatch_agent import SYSTEM_PROMPT as DISPATCH_SYSTEM_PROMPT
from result_dispatch_agent import TOOLS as DISPATCH_TOOLS
from react_format import guarded_tools, react_agent_kwargs
from agent_paths import APP_BASE_DIR
from dotenv import load_dotenv
import worker_common
from worker_common import service_base_url

load_dotenv()  # Load .env file if it exists

_APP_BASE_DIR = APP_BASE_DIR
DISPATCH_EFFECTIVE_SYSTEM_PROMPT = DISPATCH_SYSTEM_PROMPT

# ---------------------------------------------------------------------------
# Runtime config — set by parse_args() before the server starts
# ---------------------------------------------------------------------------

_CONFIG = {
    # Empty: the running Text Generation instance, looked up through the app (see _llm_api_base).
    "api_base": "",
    "model": "dummy",
    "api_key": os.getenv("LLM_API_KEY", ""),
    "dispatch_api_base": "",
    "dispatch_model": "",
    "dispatch_api_key": "",
}

logger = logging.getLogger(__name__)
_background_tasks: list[asyncio.Task] = []
_inflight_files: dict[str, float] = {}
_inflight_lock = threading.Lock()
_INFLIGHT_TTL_SECONDS = 15 * 60
_SUPPORTED_EXTENSIONS = (
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".jfif",
    ".webp",
    ".tiff",
    ".bmp",
)


def _is_task_running(task: asyncio.Task | None) -> bool:
    return task is not None and not task.done()


async def _stop_agent_after_tool(handler: Any) -> None:
    """Stop an agent after its authoritative tool result is already available."""
    try:
        cancel_run = getattr(handler, "cancel_run", None)
        if callable(cancel_run):
            result = cancel_run()
            if hasattr(result, "__await__"):
                await result
        elif hasattr(handler, "cancel"):
            handler.cancel()
        await handler
    except asyncio.CancelledError:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("[dispatch] agent cleanup failed after tool completion")


def _track_background_task(task: asyncio.Task) -> None:
    _background_tasks.append(task)

    def remove_completed(completed: asyncio.Task) -> None:
        if completed in _background_tasks:
            _background_tasks.remove(completed)

    task.add_done_callback(remove_completed)


def _purge_stale_inflight() -> None:
    now = time.time()
    stale: list[str] = []

    with _inflight_lock:
        for name, marked_at in _inflight_files.items():
            if now - marked_at > _INFLIGHT_TTL_SECONDS:
                stale.append(name)

        for name in stale:
            _inflight_files.pop(name, None)


def _mark_inflight(filename: str) -> None:
    with _inflight_lock:
        _inflight_files[filename] = time.time()


def _clear_inflight(filename: str) -> None:
    with _inflight_lock:
        _inflight_files.pop(filename, None)


def _is_inflight(filename: str) -> bool:
    _purge_stale_inflight()
    with _inflight_lock:
        return filename in _inflight_files


@asynccontextmanager
async def lifespan(app: FastAPI):
    upload_task = asyncio.create_task(run_upload_loop(poll_seconds=5))

    _background_tasks.append(upload_task)
    logger.info("[startup] marking upload loop started")

    yield

    for task in _background_tasks:
        task.cancel()
    _background_tasks.clear()


# Multiserve /v1/status backend keys mapped to the provider prefix expected by
# the multiserve OpenAI proxy ("<provider>:<model_id>").
_STATUS_BACKEND_PROVIDERS = (("llama.cpp", "llamacpp"), ("ovms", "openvino"))
_CHAT_TASKS = ("text_generation", "multimodal")


def _extract_active_model_from_status(payload: dict[str, Any]) -> str | None:
    status = payload.get("status")
    if not isinstance(status, dict):
        return None

    for backend_key, provider in _STATUS_BACKEND_PROVIDERS:
        servers = status.get(backend_key)
        if not isinstance(servers, list):
            continue
        for server in servers:
            if not isinstance(server, dict):
                continue
            if server.get("task") not in _CHAT_TASKS:
                continue
            repo_id = server.get("repo_id")
            if isinstance(repo_id, str) and repo_id.strip():
                return f"{provider}:{repo_id.strip()}"

    return None


def _auto_resolve_model(api_base: str) -> str | None:
    base = api_base.rstrip("/")
    try:
        from urllib.parse import urlparse
        parsed = urlparse(base)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"Unsupported scheme: {parsed.scheme}")
        response = requests.get(f"{base}/status", timeout=5)
        response.raise_for_status()
        return _extract_active_model_from_status(response.json())
    except (requests.RequestException, TimeoutError, ValueError, json.JSONDecodeError):
        return None


def _llm_api_base(configured: str) -> str:
    """``configured``, else the running Text Generation instance's /v1 URL through the app.

    Looked up on every agent build: which instance runs, and on which port, can change.
    """
    return configured or service_base_url("text-generation", suffix="/v1")


def _resolve_model(api_base: str, configured_model: str) -> str:
    """Return the configured model, or the model currently served by multiserve.

    When no explicit model is configured, resolve on every call so switching the
    Text Generation backend/model (llama.cpp <-> OpenVINO) is picked up without
    restarting this worker.
    """
    if configured_model and configured_model != "dummy":
        return configured_model

    auto_model = _auto_resolve_model(api_base)
    if not auto_model:
        raise RuntimeError(
            f"No text-generation model is running on {api_base}. "
            "Start the Text Generation service and wait for its model to load."
        )
    return auto_model


def _extract_agent_response_text(response: Any) -> str:
    """Best-effort extraction of final assistant text from workflow response."""
    if response is None:
        return ""

    if isinstance(response, str):
        return response.strip()

    if isinstance(response, dict):
        for key in ("response", "message", "content", "text"):
            value = response.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    for attr in ("response", "message", "content", "text"):
        value = getattr(response, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()

    fallback = str(response).strip()
    if fallback and fallback.lower() != "none":
        return fallback
    return ""


def _coerce_tool_output_payload(tool_output: Any) -> dict[str, Any] | None:
    """Extract a dictionary payload from tool output event objects."""
    if tool_output is None:
        return None

    if isinstance(tool_output, dict):
        return tool_output

    if isinstance(tool_output, list):
        for item in tool_output:
            payload = _coerce_tool_output_payload(item)
            if payload:
                return payload
        return None

    if isinstance(tool_output, str):
        text = tool_output.strip()

        # Case 1: strict JSON object string
        if text.startswith("{") and text.endswith("}"):
            try:
                payload = json.loads(text)
                if isinstance(payload, dict):
                    return payload
            except json.JSONDecodeError:
                pass

            # Case 2: Python dict repr string
            try:
                payload = ast.literal_eval(text)
                if isinstance(payload, dict):
                    return payload
            except (SyntaxError, ValueError):
                pass

        # Case 3: wrapped output like "Observation: {...}" or multiline blocks.
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            snippet = text[start : end + 1]
            payload = _coerce_tool_output_payload(snippet)
            if payload:
                return payload

        return None

    for attr in (
        "raw_output",
        "content",
        "output",
        "result",
        "tool_output",
        "response",
    ):
        value = getattr(tool_output, attr, None)
        payload = _coerce_tool_output_payload(value)
        if payload:
            return payload

    if hasattr(tool_output, "dict"):
        try:
            payload = tool_output.dict()
            if isinstance(payload, dict):
                return payload
        except Exception:  # noqa: BLE001
            pass

    return None


def _format_dispatch_tool_payload(tool_output: Any) -> str:
    """Render dispatch tool payload into user-visible final chat text."""
    payload = _coerce_tool_output_payload(tool_output)
    if not payload:
        return ""

    if payload.get("success") is False:
        error_text = str(
            payload.get("error") or payload.get("message") or "Unknown error"
        )
        return f"❌ Error: {error_text}"

    platform = str(payload.get("platform", "")).strip().lower() or "email"
    summary = str(payload.get("summary", "")).strip()

    if "students_processed" in payload:
        students_processed = int(payload.get("students_processed", 0) or 0)
        total_sent = int(payload.get("total_sent", 0) or 0)
        total_failed = int(payload.get("total_failed", 0) or 0)
        heading = "DRAFTED" if payload.get("dry_run") is True else "SENT"
        lines = [
            f"✅ {heading} via {platform}",
            f"Students processed: {students_processed}",
            f"Deliveries: {total_sent} succeeded, {total_failed} failed",
        ]
        if summary:
            lines.append(summary)
        return "\n".join(lines)

    if "sent" in payload and "failed" in payload and "results" in payload:
        student_name = str(payload.get("student_name", "")).strip()
        student_id = str(payload.get("student_id", "")).strip()
        sent = int(payload.get("sent", 0) or 0)
        failed = int(payload.get("failed", 0) or 0)
        heading = "DRAFTED" if payload.get("dry_run") is True else "SENT"
        lines = [
            f"✅ {heading} via {platform}",
            f"Student: {student_name} (ID: {student_id})",
            f"Recipients: {sent} succeeded, {failed} failed",
        ]
        for result in payload.get("results", []):
            if not isinstance(result, dict):
                continue
            role = str(result.get("recipient", "recipient")).strip()
            if result.get("success") is True:
                lines.append(f"To: {role} — {str(result.get('to', '')).strip()}")
            else:
                error = str(result.get("error") or "Unknown error").strip()
                lines.append(f"Failed: {role} — {error}")
        return "\n".join(lines)

    student_name = str(payload.get("student_name", "")).strip()
    student_id = str(payload.get("student_id", "")).strip()
    recipient = str(payload.get("recipient", "")).strip()
    to_value = str(payload.get("to", "")).strip()
    attachment = str(payload.get("attachment", "")).strip()
    attachment_name = os.path.basename(attachment) if attachment else ""

    if payload.get("dry_run") is True:
        if platform == "telegram":
            message = str(payload.get("message", "")).strip()
            lines = [
                "📱 DRAFT TELEGRAM PREVIEW",
                f"Student: {student_name} - ID: {student_id}",
                f"To: {to_value} ({recipient})",
                message,
            ]
            if attachment_name:
                lines.append(f"📎 Attachment: {attachment_name}")
            return "\n".join(lines).strip()

        subject = str(payload.get("subject", "")).strip()
        body = str(payload.get("body", "")).strip()
        lines = [
            "📋 DRAFT EMAIL PREVIEW",
            f"Student: {student_name} - ID: {student_id}",
            "",
            f"To: {to_value}",
            f"Subject: {subject}",
            "",
            body,
        ]
        if attachment_name:
            lines.extend(["", f"📎 Attachment: {attachment_name}"])
        return "\n".join(lines).strip()

    if payload.get("success") is True:
        return (
            f"✅ SENT via {platform}\n"
            f"Student: {student_name} (ID: {student_id})\n"
            f"To: {recipient} — {to_value}"
        )

    return ""


def _build_analysis_agent() -> ReActAgent:
    api_base = _llm_api_base(_CONFIG["api_base"])
    llm = OpenAILike(
        model=_resolve_model(api_base, _CONFIG["model"]),
        api_base=api_base,
        api_key=_CONFIG["api_key"],
        is_chat_model=True,
        is_function_calling_model=True,
    )
    return ReActAgent(
        tools=guarded_tools(ANALYSIS_TOOLS),
        llm=llm,
        **react_agent_kwargs(ANALYSIS_SYSTEM_PROMPT),
        max_iterations=8,
        early_stopping_method="generate",
    )


def _build_dispatch_agent() -> ReActAgent:
    api_base = _llm_api_base(_CONFIG["dispatch_api_base"] or _CONFIG["api_base"])
    model = _CONFIG["dispatch_model"] or _CONFIG["model"]
    api_key = _CONFIG["dispatch_api_key"] or _CONFIG["api_key"]
    model = _resolve_model(api_base, model)

    llm = OpenAILike(
        model=model,
        api_base=api_base,
        api_key=api_key,
        is_chat_model=True,
        is_function_calling_model=True,
    )
    if hasattr(dispatch_agent, "set_shared_llm"):
        dispatch_agent.set_shared_llm(llm)

    return ReActAgent(
        tools=DISPATCH_TOOLS,
        llm=llm,
        **react_agent_kwargs(DISPATCH_EFFECTIVE_SYSTEM_PROMPT),
        max_iterations=4,
        early_stopping_method="generate",
    )


def _should_route_to_dispatch_tools(query: str) -> bool:
    lowered = query.lower()

    if any(token in lowered for token in ("printer", "print")):
        return True

    action_tokens = (
        "send",
        "draft",
        "darft",
        "preview",
        "email",
        "telegram",
        "whatsapp",
        "message",
        "notify",
        "dispatch",
        "deliver",
        "forward",
    )

    recipient_tokens = ("parent", "teacher", "student", "guardian")

    # Classic result-delivery phrasing.
    if any(token in lowered for token in action_tokens) and "result" in lowered:
        return True

    # Channel-based delivery requests should route to dispatch even without the word "result".
    if any(token in lowered for token in ("email", "telegram", "whatsapp")):
        if any(token in lowered for token in recipient_tokens):
            return True
        # e.g. "draft email to Ivy"
        if (
            "draft" in lowered
            or "darft" in lowered
            or "send" in lowered
            or "preview" in lowered
        ):
            return True

    # e.g. "draft/send to Ivy parent" (recipient role present, result omitted)
    if any(
        token in lowered
        for token in ("send", "draft", "darft", "preview", "dispatch", "deliver")
    ) and any(token in lowered for token in recipient_tokens):
        return True

    # e.g. "result to Ivy's parent". "for student ..." only names whose result
    # is wanted (e.g. "show result for student 12345"), so it is not delivery.
    if re.search(r"\bto\s+(parent|teacher|student|guardian)\b", lowered):
        return True
    if re.search(r"\bfor\s+(?:the\s+)?(parent|guardian)\b", lowered):
        return True

    return False


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = worker_common.create_app(
    "Exam Marking Agent", version="1.0.0", lifespan=lifespan
)


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket, path: str | None = Query(default=None)
):
    from marking_agent import _get_prior_mark_path

    await websocket.accept()
    raw_dir = path or _get_prior_mark_path()
    resolved_dir = Path(raw_dir).resolve()
    if not resolved_dir.is_relative_to(_APP_BASE_DIR):
        resolved_dir = Path(_get_prior_mark_path())
    watch_dir = str(resolved_dir)
    os.makedirs(watch_dir, exist_ok=True)
    # Track last sent file signature per filename so the same filename can be
    # processed again if a new file with that name appears.
    sent_files: dict[str, tuple[int, int]] = {}

    try:
        while True:
            try:
                names = sorted(os.listdir(watch_dir))
            except FileNotFoundError:
                names = []

            current_files: set[str] = set()

            for filename in names:
                file_path = os.path.join(watch_dir, filename)
                if not os.path.isfile(file_path):
                    continue
                if not filename.lower().endswith(_SUPPORTED_EXTENSIONS):
                    continue

                current_files.add(filename)

                try:
                    stat = os.stat(file_path)
                except OSError:
                    continue

                signature = (int(stat.st_mtime_ns), int(stat.st_size))
                if sent_files.get(filename) == signature or _is_inflight(filename):
                    continue

                with open(file_path, "rb") as f:
                    encoded = base64.b64encode(f.read()).decode("utf-8")

                _mark_inflight(filename)
                sent_files[filename] = signature
                await websocket.send_json({"filename": filename, "base64": encoded})

            # Drop entries for files that no longer exist in the watched folder.
            stale = [name for name in sent_files if name not in current_files]
            for name in stale:
                sent_files.pop(name, None)

            await asyncio.sleep(1)
    except WebSocketDisconnect:
        return


class MoveFileRequest(BaseModel):
    filename: str
    annotatedImage: str | None = None
    annotatedFilename: str | None = None
    studentId: str | None = None
    subject: str | None = None


class StoreAnnotatedResultRequest(BaseModel):
    originalFilename: str
    annotatedImage: str
    annotatedFilename: str | None = None
    studentId: str | None = None
    subject: str | None = None


class ReleaseInflightRequest(BaseModel):
    filename: str


class DispatchSelection(BaseModel):
    studentId: str
    subject: str


class DispatchSendResultsRequest(BaseModel):
    recipientRole: str
    subjectFilter: str | None = None
    platform: str = "email"
    dryRun: bool = False
    manualTarget: str | None = None
    selections: list[DispatchSelection] | None = None


@app.post("/v1/move-to-marked")
def move_to_marked(req: MoveFileRequest):
    from marking_agent import _get_marked_path, _get_prior_mark_path, _move_file
    from result_dispatch_agent import store_annotated_result

    logger.info("[move] calling")
    prior_mark_dir = _get_prior_mark_path()
    marked_dir = _get_marked_path()
    safe_filename = os.path.basename(req.filename)
    filepath = os.path.realpath(os.path.join(prior_mark_dir, safe_filename))
    if not filepath.startswith(prior_mark_dir + os.sep):
        _clear_inflight(req.filename)
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not os.path.isfile(filepath):
        _clear_inflight(req.filename)
        raise HTTPException(
            status_code=404, detail=f"{req.filename!r} not found in prior_mark"
        )

    dst = _move_file(filepath, marked_dir)
    annotated_destination = None
    if req.annotatedImage:
        logger.info("[move] annotated image is exists")
        try:
            annotated_destination = store_annotated_result(
                original_filename=req.filename,
                annotated_image=req.annotatedImage,
                requested_name=req.annotatedFilename,
                student_id=req.studentId,
                subject=req.subject,
            )
            logger.info(
                "[move] moved %s to %s", req.annotatedFilename, annotated_destination
            )
            logger.info("[move] to %s", annotated_destination)
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "[move] failed to store annotated result for %s: %s", req.filename, exc
            )

    _clear_inflight(req.filename)
    return {
        "success": True,
        "file": req.filename,
        "destination": dst,
        "annotatedDestination": annotated_destination,
    }


@app.post("/v1/store-annotated-result")
def store_annotated_result_endpoint(req: StoreAnnotatedResultRequest):
    from result_dispatch_agent import store_annotated_result

    try:
        annotated_destination = store_annotated_result(
            original_filename=req.originalFilename,
            annotated_image=req.annotatedImage,
            requested_name=req.annotatedFilename,
            student_id=req.studentId,
            subject=req.subject,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("[store] failed to store annotated result for %s: %s", req.originalFilename, exc)
        raise HTTPException(status_code=500, detail="Failed to store annotated result")

    return {
        "success": True,
        "originalFilename": req.originalFilename,
        "annotatedDestination": annotated_destination,
    }


@app.post("/v1/release-inflight")
def release_inflight(req: ReleaseInflightRequest):
    filename = (req.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="filename is required")

    _clear_inflight(filename)
    return {"success": True, "filename": filename}


@app.post("/v1/dispatch/send-results")
def dispatch_send_results(req: DispatchSendResultsRequest):
    recipient_role = (req.recipientRole or "").strip().lower()
    platform = (req.platform or "email").strip().lower()
    subject_filter = (req.subjectFilter or "").strip()
    manual_target = (req.manualTarget or "").strip() or None

    if recipient_role not in {"parent", "teacher", "student"}:
        raise HTTPException(status_code=400, detail="Invalid recipientRole")

    if platform not in {"email", "telegram"}:
        raise HTTPException(status_code=400, detail="Invalid platform")

    subject = None if subject_filter.lower() == "all" else subject_filter or None

    subject_selections = None
    if req.selections:
        subject_selections = [
            {
                "student_id": str(item.studentId).strip(),
                "subject": str(item.subject).strip(),
            }
            for item in req.selections
            if str(item.studentId).strip() and str(item.subject).strip()
        ]

    kwargs: dict[str, Any] = {
        "recipient_roles": [recipient_role],
        "platform": platform,
        "dry_run": bool(req.dryRun),
        "subject": subject,
        "subject_selections": subject_selections,
    }

    if platform == "email" and manual_target:
        kwargs["to_email"] = manual_target
    if platform == "telegram" and manual_target:
        kwargs["to_telegram_id"] = manual_target

    try:
        result = dispatch_agent.send_bulk_results(**kwargs)
    except Exception as exc:  # noqa: BLE001
        logger.exception("[dispatch] send-results endpoint failed")
        raise HTTPException(status_code=500, detail=f"Dispatch failed: {exc}")

    return result


# ---------------------------------------------------------------------------
# /v1/chat/completions — OpenAI-compatible streaming endpoint
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: str = "dummy"
    stream: bool = True


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatRequest):
    # Extract the last user turn as the agent query
    user_messages = [m for m in req.messages if m.role == "user"]
    if not user_messages:
        raise HTTPException(status_code=400, detail="No user message provided.")

    query = user_messages[-1].content.strip()
    if not query:
        raise HTTPException(status_code=400, detail="User message is empty.")

    completion_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"
    created = int(time.time())

    async def generate():
        is_dispatch_route = _should_route_to_dispatch_tools(query)

        # Tool names that produce the final authoritative result payload.
        # Only their output should overwrite last_tool_output — helper/lookup
        # tools called before OR after the primary action must not clobber it.
        _PRIMARY_ACTION_TOOLS = {
            "send_student_result_via_platform",
            "send_student_result_to_multiple_recipients",
            "send_bulk_results",
            "print_student_result",
        }

        emitted_assistant_role = False
        try:
            agent = (
                _build_dispatch_agent()
                if is_dispatch_route
                else _build_analysis_agent()
            )
            ctx = Context(agent)
            handler = agent.run(query, ctx=ctx)

            streamed_content = False
            last_tool_output: Any = None
            saw_dispatch_tool_event = False
            async for ev in handler.stream_events():
                event_tool_name = getattr(ev, "tool_name", None)
                if is_dispatch_route and event_tool_name:
                    saw_dispatch_tool_event = True

                tool_output = getattr(ev, "tool_output", None)
                if tool_output is not None:
                    # For the dispatch route, only capture output from the primary
                    # action tools (send/print).  Lookup/helper tools called before
                    # or after the real action must not overwrite last_tool_output,
                    # otherwise _format_dispatch_tool_payload returns "" and the
                    # success/fail message is never appended to the chat.
                    if (
                        not is_dispatch_route
                        or not event_tool_name
                        or event_tool_name in _PRIMARY_ACTION_TOOLS
                    ):
                        last_tool_output = tool_output
                    if is_dispatch_route:
                        saw_dispatch_tool_event = True

                if (
                    is_dispatch_route
                    and isinstance(ev, ToolCallResult)
                    and event_tool_name in _PRIMARY_ACTION_TOOLS
                ):
                    final_text = _format_dispatch_tool_payload(tool_output)
                    if not final_text:
                        final_text = (
                            "❌ Error: The send operation returned an invalid "
                            "response. Please retry."
                        )
                    if not final_text.lstrip().startswith("Answer:"):
                        final_text = f"Answer: {final_text}"
                    if streamed_content:
                        final_text = f"\n\n{final_text}"
                    _track_background_task(
                        asyncio.create_task(_stop_agent_after_tool(handler))
                    )
                    chunk = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": _CONFIG["model"],
                        "choices": [
                            {
                                "index": 0,
                                "delta": (
                                    {"role": "assistant", "content": final_text}
                                    if not emitted_assistant_role
                                    else {"content": final_text}
                                ),
                                "finish_reason": None,
                            }
                        ],
                    }
                    yield f"data: {json.dumps(chunk)}\n\n"
                    stop_chunk = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": _CONFIG["model"],
                        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                    }
                    yield f"data: {json.dumps(stop_chunk)}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                if isinstance(ev, AgentStream) and ev.delta:
                    # Keep initial reasoning, but once a dispatch tool has returned,
                    # stop forwarding model text and switch to tool-authoritative output.
                    if is_dispatch_route and saw_dispatch_tool_event:
                        continue
                    streamed_content = True
                    chunk = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": _CONFIG["model"],
                        "choices": [
                            {
                                "index": 0,
                                "delta": (
                                    {"role": "assistant", "content": ev.delta}
                                    if not emitted_assistant_role
                                    else {"content": ev.delta}
                                ),
                                "finish_reason": None,
                            }
                        ],
                    }
                    emitted_assistant_role = True
                    yield f"data: {json.dumps(chunk)}\n\n"

            final_response = await handler  # finalise so the context is released
            final_text = _extract_agent_response_text(final_response)

            # dispatch route must be tool-authoritative for final status.
            if is_dispatch_route:
                final_text = _format_dispatch_tool_payload(last_tool_output)
                if not final_text:
                    final_text = _extract_agent_response_text(final_response)

                if final_text and not final_text.lstrip().startswith("Answer:"):
                    final_text = f"Answer: {final_text}"

            # Always append final factual status for dispatch route; for analysis,
            # append only when nothing was streamed.
            if is_dispatch_route or not streamed_content:
                if not final_text:
                    final_text = (
                        "I could not generate a response. Please retry your request."
                    )
                chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": _CONFIG["model"],
                    "choices": [
                        {
                            "index": 0,
                            "delta": (
                                {"role": "assistant", "content": final_text}
                                if not emitted_assistant_role
                                else {"content": final_text}
                            ),
                            "finish_reason": None,
                        }
                    ],
                }
                emitted_assistant_role = True
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as exc:  # noqa: BLE001
            error_chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": _CONFIG["model"],
                "choices": [
                    {
                        "index": 0,
                        "delta": (
                            {
                                "role": "assistant",
                                "content": f"\n\n[Agent error: {exc}]",
                            }
                            if not emitted_assistant_role
                            else {"content": f"\n\n[Agent error: {exc}]"}
                        ),
                        "finish_reason": "stop",
                    }
                ],
            }
            yield f"data: {json.dumps(error_chunk)}\n\n"
            yield "data: [DONE]\n\n"
            return

        # Final stop chunk
        stop_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": _CONFIG["model"],
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(stop_chunk)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = worker_common.base_parser(
        "Exam Marking Agent HTTP server",
        default_port=int(os.environ.get("PORT", 8034)),
        device=False,
        host=True,
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("LLM_API_BASE", ""),
        help="OpenAI-compatible LLM API base URL (default: the running Text Generation instance)",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("LLM_MODEL", "dummy"),
        help="Model name forwarded to the LLM backend",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("LLM_API_KEY", "dummy"),
        help="API key for the LLM backend (use 'dummy' for local servers)",
    )
    parser.add_argument(
        "--dispatch-api-base",
        default=os.environ.get("DISPATCH_LLM_API_BASE", ""),
        help="Optional separate API base for dispatch/messaging agent",
    )
    parser.add_argument(
        "--dispatch-model",
        default=os.environ.get("DISPATCH_LLM_MODEL", ""),
        help="Optional separate model for dispatch/messaging agent",
    )
    parser.add_argument(
        "--dispatch-api-key",
        default=os.environ.get("DISPATCH_LLM_API_KEY", ""),
        help="Optional separate API key for dispatch/messaging agent",
    )
    parser.add_argument(
        "--db-path",
        default=None,
        help="Path to exam_marking.db (overrides default resolution)",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()

    if args.db_path:
        os.environ["EXAM_DB_PATH"] = os.path.abspath(args.db_path)

    _CONFIG["api_base"] = args.api_base
    _CONFIG["model"] = args.model
    _CONFIG["api_key"] = args.api_key
    _CONFIG["dispatch_api_base"] = args.dispatch_api_base
    _CONFIG["dispatch_model"] = args.dispatch_model
    _CONFIG["dispatch_api_key"] = args.dispatch_api_key

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
        datefmt="%H:%M:%S",
    )

    worker_common.serve(app, args)