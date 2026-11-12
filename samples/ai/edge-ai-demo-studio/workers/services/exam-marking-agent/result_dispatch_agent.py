# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Result Dispatch Agent for Exam Marking
======================================

The dispatch agent finds the student's result folder, packages the complete
folder into a ZIP archive, and passes that single ZIP file to the MCP
messaging layer.

Supported:
    - Email
    - Telegram

WhatsApp is currently disabled.

Usage:
    python result_dispatch_agent.py
    python result_dispatch_agent.py --query "Email Alice's (ID 12345) result to her parent"
"""

import argparse
import asyncio
import base64
import os
import shutil
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Optional, List, Dict, Tuple
# from xml.etree import ElementTree as ET
from defusedxml import ElementTree as ET

from llama_index.core.agent.workflow import AgentStream, ReActAgent
from llama_index.core.workflow import Context
from llama_index.llms.openai_like import OpenAILike

from agent_paths import APP_BASE_DIR, PAPERS_ROOT


# ============================================================================
# MCP MESSAGING
# ============================================================================

try:
    from messaging_mcp import (
        send_email_with_file as _mcp_send_email,
        send_telegram_document as _mcp_send_telegram_doc,
        _is_network_error,
        _NETWORK_ERROR_MESSAGE,
    )

    _MCP_AVAILABLE = True

except ImportError:
    _MCP_AVAILABLE = False

    def _is_network_error(exc: Exception) -> bool:
        return False

    _NETWORK_ERROR_MESSAGE = "Network error while communicating with MCP."


# ============================================================================
# GLOBALS
# ============================================================================

_llm: Optional[OpenAILike] = None

_APP_BASE_DIR = APP_BASE_DIR
_RESULT_FOLDER = "results"
_CONTACT_XLSX = "Contact_Info.xlsx"


# ============================================================================
# RESULT PATH
# ============================================================================

def _get_result_path() -> str:
    path = (
        os.environ.get("RESULTS_PATH")
        or os.environ.get("EXAM_RESULT_PATH")
        or str(PAPERS_ROOT / _RESULT_FOLDER)
    )
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(_APP_BASE_DIR):
        raise ValueError(f"Invalid results path: {resolved}")
    return str(resolved)


def _sanitize_path_component(name: str) -> str:
    """Strip path separators and traversal sequences from a single path component."""
    return os.path.basename(os.path.normpath(name)) if name else name


# ============================================================================
# ZIP HELPERS
# ============================================================================

def zip_student_subject_folder(folder_path: str) -> str:
    """
    ZIP the COMPLETE student/subject folder.

    Example:

        results/Mathematics/12345/
            result.png
            marksheet.pdf
            feedback.txt
            subfolder/
                extra.pdf

    becomes:

        /tmp/12345.zip

    containing:

        result.png
        marksheet.pdf
        feedback.txt
        subfolder/extra.pdf

    The original folder is never modified.

    Returns:
        Absolute path to the ZIP file.
    """

    folder_path = os.path.abspath(folder_path)

    if not os.path.isdir(folder_path):
        raise ValueError(
            f"Student/subject folder not found: {folder_path}"
        )

    folder_name = os.path.basename(
        folder_path.rstrip(os.sep)
    )

    # Include subject name in the temporary ZIP name when possible.
    parent_name = os.path.basename(
        os.path.dirname(folder_path)
    )

    safe_folder_name = (
        f"{parent_name}_{folder_name}"
        .replace(" ", "_")
        .replace(os.sep, "_")
    )

    zip_path = os.path.join(
        tempfile.gettempdir(),
        f"{safe_folder_name}.zip",
    )

    # Prevent accidental reuse of an old ZIP.
    if os.path.exists(zip_path):
        try:
            os.remove(zip_path)
        except OSError:
            pass

    with zipfile.ZipFile(
        zip_path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
    ) as zip_file:

        for root, _, filenames in os.walk(folder_path):

            for filename in filenames:

                file_path = os.path.join(
                    root,
                    filename,
                )

                if not os.path.isfile(file_path):
                    continue

                # Keep the folder contents relative to the student folder.
                arcname = os.path.relpath(
                    file_path,
                    folder_path,
                )

                zip_file.write(
                    file_path,
                    arcname,
                )

    return zip_path


def _safe_remove_file(path: Optional[str]) -> None:
    """Safely remove a temporary file."""

    if not path:
        return

    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


def _safe_remove_directory(path: Optional[str]) -> None:
    """Safely remove a temporary directory."""

    if not path:
        return

    try:
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
    except OSError:
        pass


def _create_dispatch_attachment(
    folder_path: str,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Create the single attachment that will be passed to MCP.

    MCP always receives ONE file.

    Returns:
        (zip_path, error)
    """

    try:
        zip_path = zip_student_subject_folder(folder_path)

        if not os.path.isfile(zip_path):
            return None, "ZIP file was not created."

        return zip_path, None

    except Exception as exc:
        return None, f"Failed to package result folder: {exc}"


# ============================================================================
# CONTACT EXCEL
# ============================================================================

def _load_contacts() -> List[Dict[str, str]]:
    """Parse Contact_Info.xlsx without requiring openpyxl."""

    file_path = os.environ.get("DISPATCH_CONTACTS_FILE")

    if not (
        file_path
        and os.path.exists(file_path)
        and file_path.lower().endswith(".xlsx")
    ):
        print("Contact_Info.xlsx not found.")
        return []

    namespace = {
        "x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    }

    try:
        with zipfile.ZipFile(file_path) as workbook:

            shared_strings = []

            if "xl/sharedStrings.xml" in workbook.namelist():

                with workbook.open(
                    "xl/sharedStrings.xml"
                ) as shared_file:

                    root = ET.parse(shared_file).getroot()

                    for item in root.findall(
                        "x:si",
                        namespace,
                    ):
                        parts = [
                            node.text or ""
                            for node in item.findall(
                                ".//x:t",
                                namespace,
                            )
                        ]

                        shared_strings.append(
                            "".join(parts).strip()
                        )

            with workbook.open(
                "xl/worksheets/sheet1.xml"
            ) as sheet_file:

                root = ET.parse(sheet_file).getroot()

    except Exception:
        return []

    rows = []

    for row in root.findall(
        ".//x:sheetData/x:row",
        namespace,
    ):

        values = []

        for cell in row.findall(
            "x:c",
            namespace,
        ):

            cell_type = cell.get("t", "")

            raw_value = cell.findtext(
                "x:v",
                default="",
                namespaces=namespace,
            ).strip()

            if cell_type == "s" and raw_value.isdigit():

                idx = int(raw_value)

                val = (
                    shared_strings[idx]
                    if 0 <= idx < len(shared_strings)
                    else ""
                )

            elif cell_type == "inlineStr":

                val = "".join(
                    node.text or ""
                    for node in cell.findall(
                        ".//x:t",
                        namespace,
                    )
                ).strip()

            else:
                val = raw_value

            values.append(val)

        if any(values):
            rows.append(values)

    if not rows:
        return []

    headers = [
        h.strip()
        for h in rows[0]
    ]

    return [
        {
            h: v
            for h, v in zip(
                headers,
                row + [""] * (len(headers) - len(row)),
            )
            if h
        }
        for row in rows[1:]
    ]

def store_annotated_result(
    original_filename: str,
    annotated_image: str,
    requested_name: Optional[str] = None,
    student_id: Optional[str] = None,
    subject: Optional[str] = None,
) -> str:
    """Persist a base64/data-URL annotated image under results/<subject>/<student_id>/."""
    root = _get_result_path()
    stem, _ = os.path.splitext(os.path.basename(original_filename or "annotated"))
    student_folder = _sanitize_path_component((student_id or "").strip() or stem or "unknown")
    subject_folder = _sanitize_path_component((subject or "").strip() or "Unknown Subject")
    destination_dir = os.path.realpath(os.path.join(root, subject_folder, student_folder))
    if not destination_dir.startswith(root + os.sep):
        raise ValueError(f"Destination directory outside allowed root: {destination_dir!r}")
    os.makedirs(destination_dir, exist_ok=True)

    filename = os.path.basename(
        (requested_name or "").strip() or f"{stem}_annotated.png"
    )
    payload = (annotated_image or "").strip()
    if payload.startswith("data:") and "," in payload:
        payload = payload.split(",", 1)[1]

    destination = os.path.realpath(os.path.join(destination_dir, filename))
    if not destination.startswith(destination_dir + os.sep):
        raise ValueError(f"Destination file outside allowed directory: {destination!r}")
    with open(destination, "wb") as f:
        f.write(base64.b64decode(payload))
    return destination


def move_annotated_result() -> List[str]:
    """List annotated result files across all student result folders."""
    root = _get_result_path()
    if not os.path.exists(root):
        return []

    files: List[str] = []
    for current_root, _, names in os.walk(root):
        for name in names:
            files.append(os.path.relpath(os.path.join(current_root, name), root))
    return sorted(files)

# ============================================================================
# CONTACT LOOKUP
# ============================================================================

def lookup_student_contact(
    student_id: Optional[str] = None,
    student_name: Optional[str] = None,
) -> Dict[str, Any]:

    contacts = _load_contacts()

    sid = (
        str(student_id).strip()
        if student_id
        else None
    )

    sname = (
        str(student_name).strip().lower()
        if student_name
        else None
    )

    for contact in contacts:

        curr_id = str(
            contact.get("student_id", "")
        ).strip()

        curr_name = str(
            contact.get("student_name", "")
        ).strip().lower()

        if (
            sid
            and curr_id == sid
        ) or (
            sname
            and sname in curr_name
        ):

            return {
                "found": True,
                "student_id": curr_id,
                "student_name": contact.get(
                    "student_name",
                    "",
                ),

                "student_email": contact.get(
                    "student_email",
                    "",
                ),
                "parent_email": contact.get(
                    "parent_email",
                    "",
                ),
                "teacher_email": contact.get(
                    "teacher_email",
                    "",
                ),

                "student_phone": contact.get(
                    "student_phone",
                    "",
                ),
                "parent_phone": contact.get(
                    "parent_phone",
                    "",
                ),
                "teacher_phone": contact.get(
                    "teacher_phone",
                    "",
                ),

                "student_telegram_id": contact.get(
                    "student_telegram_id",
                    "",
                ),
                "parent_telegram_id": contact.get(
                    "parent_telegram_id",
                    "",
                ),
                "teacher_telegram_id": contact.get(
                    "teacher_telegram_id",
                    "",
                ),

                "class_id": contact.get(
                    "class_id",
                    "",
                ),
            }

    return {
        "found": False,
        "message": (
            f"No contact details found for "
            f"ID={student_id}, Name={student_name}"
        ),
    }


# ============================================================================
# RESULT LOOKUP
# ============================================================================

def _resolve_subject_folder(
    root: str,
    subject: str,
) -> Optional[str]:

    subject = (subject or "").strip()

    if not subject or not os.path.isdir(root):
        return None

    folders = [
        folder
        for folder in os.listdir(root)
        if os.path.isdir(
            os.path.join(root, folder)
        )
    ]

    subject_lower = subject.lower()

    for folder in folders:

        if folder.lower() == subject_lower:
            return folder

    for folder in folders:

        if (
            subject_lower in folder.lower()
            or folder.lower() in subject_lower
        ):
            return folder

    return None


def find_file_by_id(
    student_id: str,
    subject: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Find student result folders.

    IMPORTANT:
        The dispatch layer uses folder_path and packages the ENTIRE folder.

    Folder structure:

        results/
        ├── Mathematics/
        │   └── 12345/
        │       ├── result.pdf
        │       ├── marksheet.pdf
        │       └── feedback.txt
        │
        └── English/
            └── 12345/
                ├── result.pdf
                └── marksheet.pdf
    """

    sid = _sanitize_path_component(str(student_id or "").strip())

    root = _get_result_path()

    requested_subject = (
        subject or ""
    ).strip()

    if not sid:

        return {
            "found": False,
            "message": "Student ID is required.",
        }

    if not os.path.isdir(root):

        return {
            "found": False,
            "message": (
                f"No exam records found for "
                f"student ID {sid}."
            ),
        }

    # ------------------------------------------------------------------
    # ONE SUBJECT
    # ------------------------------------------------------------------

    if requested_subject:

        resolved_subject = _sanitize_path_component(
            _resolve_subject_folder(
                root,
                requested_subject,
            )
            or requested_subject
        )

        student_folder = os.path.join(
            root,
            resolved_subject,
            sid,
        )

        if not os.path.isdir(student_folder):

            return {
                "found": False,
                "message": (
                    f"No exam records found for "
                    f"student ID {sid} in subject "
                    f"'{requested_subject}'."
                ),
            }

        file_paths = []

        for current_root, _, filenames in os.walk(
            student_folder
        ):

            for filename in filenames:

                file_path = os.path.join(
                    current_root,
                    filename,
                )

                if os.path.isfile(file_path):
                    file_paths.append(file_path)

        file_paths.sort()

        if not file_paths:

            return {
                "found": False,
                "message": (
                    f"No exam records found for "
                    f"student ID {sid} in subject "
                    f"'{requested_subject}'."
                ),
            }

        return {
            "found": True,
            "files": [
                {
                    "subject": resolved_subject,
                    "folder_path": student_folder,
                    "file_paths": file_paths,
                    "filenames": [
                        os.path.basename(path)
                        for path in file_paths
                    ],
                    "file_count": len(file_paths),

                    # Backward compatibility.
                    "file_path": file_paths[0],
                    "filename": os.path.basename(
                        file_paths[0]
                    ),
                }
            ],
        }

    # ------------------------------------------------------------------
    # ALL SUBJECTS
    # ------------------------------------------------------------------

    matches = []

    for subject_folder in sorted(
        os.listdir(root)
    ):

        subject_path = os.path.join(
            root,
            subject_folder,
        )

        if not os.path.isdir(subject_path):
            continue

        student_folder = os.path.join(
            subject_path,
            sid,
        )

        if not os.path.isdir(student_folder):
            continue

        file_paths = []

        for current_root, _, filenames in os.walk(
            student_folder
        ):

            for filename in filenames:

                file_path = os.path.join(
                    current_root,
                    filename,
                )

                if os.path.isfile(file_path):
                    file_paths.append(file_path)

        file_paths.sort()

        if not file_paths:
            continue

        matches.append(
            {
                "subject": subject_folder,
                "folder_path": student_folder,
                "file_paths": file_paths,
                "filenames": [
                    os.path.basename(path)
                    for path in file_paths
                ],
                "file_count": len(file_paths),

                "file_path": file_paths[0],
                "filename": os.path.basename(
                    file_paths[0]
                ),
            }
        )

    if not matches:

        return {
            "found": False,
            "message": (
                f"No exam records found "
                f"for student ID {sid}."
            ),
        }

    return {
        "found": True,
        "files": matches,
    }


# ============================================================================
# MESSAGE GENERATION
# ============================================================================

def generate_email_content(
    prompt: str,
    student_name: Optional[str] = None,
    student_id: Optional[str] = None,
    recipient_role: Optional[str] = None,
    attachment_path: Optional[str] = None,
) -> Dict[str, Any]:

    role = (
        recipient_role or "student"
    ).strip().lower()

    display_name = (
        (student_name or "").strip()
        or f"ID {(student_id or '').strip()}"
    )

    resolved_id = (
        student_id or ""
    ).strip()

    greeting_map = {
        "parent": "Dear Parent/Guardian,",
        "teacher": "Dear Teacher,",
        "student": "Dear Student,",
    }

    greeting = greeting_map.get(
        role,
        "Dear Student,",
    )

    attachment_filename = (
        os.path.basename(attachment_path)
        if attachment_path
        else "[Result ZIP]"
    )

    subject = (
        f"Official Exam Results – {display_name}"
    )

    body = (
        f"{greeting}\n\n"
        f"Please find attached the official exam "
        f"result for {display_name} "
        f"(ID: {resolved_id}).\n\n"
        f"Attachment: {attachment_filename}\n\n"
        "Best regards,\n"
        "Academic Records & Student Dispatch Office"
    )

    return {
        "success": True,
        "subject": subject,
        "body": body,
    }


def generate_message_content(
    prompt: str,
    student_name: Optional[str] = None,
    student_id: Optional[str] = None,
    recipient_role: Optional[str] = None,
) -> Dict[str, Any]:

    display_name = (
        (student_name or "").strip()
        or f"ID {(student_id or '').strip()}"
    )

    resolved_id = (
        student_id or ""
    ).strip()

    message = (
        f"📲 Exam Result for "
        f"{display_name} (ID: {resolved_id})\n\n"
        "The official result package is attached. "
        "This is an automated delivery."
    )

    return {
        "success": True,
        "message": message,
    }


# ============================================================================
# DRY RUN
# ============================================================================

def _should_dry_run(
    user_input: Optional[str] = None,
) -> bool:

    if not user_input:
        return False

    text = str(user_input).lower()

    keywords = [
        "draft",
        "preview",
        "show me",
        "what would",
        "simulate",
        "don't send",
        "don't actually send",
        "don't really send",
        "just preview",
        "check",
    ]

    return any(
        keyword in text
        for keyword in keywords
    )


# ============================================================================
# SINGLE DISPATCH
# ============================================================================

def _dispatch_single_result(
    contact: Dict[str, Any],
    resolved_student_id: str,
    resolved_student_name: str,
    recipient_role: str,
    platform: str,
    user_input: Optional[str],
    dry_run: bool,
    to_email: Optional[str],
    folder_path: str,
    exam_subject: str,
    to_telegram_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Dispatch ONE student/subject result.

    IMPORTANT:
        folder_path is converted into ONE ZIP.
        MCP receives that ZIP path.
    """

    attachment_path = None

    # ------------------------------------------------------------------
    # PACKAGE COMPLETE RESULT FOLDER
    # ------------------------------------------------------------------

    attachment_path, package_error = (
        _create_dispatch_attachment(
            folder_path
        )
    )

    if package_error:

        return {
            "success": False,
            "status": "failed",
            "platform": platform,
            "exam_subject": exam_subject,
            "error": package_error,
        }

    try:

        prompt = (
            user_input or ""
        ).strip() or (
            f"Send exam result to "
            f"{recipient_role}."
        )

        # --------------------------------------------------------------
        # CONTENT
        # --------------------------------------------------------------

        if platform == "email":

            draft = generate_email_content(
                prompt=prompt,
                student_name=resolved_student_name,
                student_id=resolved_student_id,
                recipient_role=recipient_role,
                attachment_path=attachment_path,
            )

            if not draft.get("success"):

                return {
                    "success": False,
                    "status": "failed",
                    "platform": platform,
                    "exam_subject": exam_subject,
                    "error": draft.get(
                        "error",
                        "Email generation failed",
                    ),
                }

            subject = str(
                draft.get("subject", "")
            ).strip()

            message_body = str(
                draft.get("body", "")
            ).strip()

        else:

            draft = generate_message_content(
                prompt=prompt,
                student_name=resolved_student_name,
                student_id=resolved_student_id,
                recipient_role=recipient_role,
            )

            if not draft.get("success"):

                return {
                    "success": False,
                    "status": "failed",
                    "platform": platform,
                    "exam_subject": exam_subject,
                    "error": draft.get(
                        "error",
                        "Message generation failed",
                    ),
                }

            subject = None

            message_body = str(
                draft.get("message", "")
            ).strip()

        # --------------------------------------------------------------
        # MCP CHECK
        # --------------------------------------------------------------

        if not _MCP_AVAILABLE:

            return {
                "success": False,
                "status": "failed",
                "platform": platform,
                "exam_subject": exam_subject,
                "error": (
                    "messaging_mcp is not available. "
                    "Ensure messaging_mcp.py is present "
                    "and dependencies are installed."
                ),
            }

        # --------------------------------------------------------------
        # RECIPIENT
        # --------------------------------------------------------------

        recipient_address = None

        if platform == "email":

            if to_email:

                recipient_address = (
                    to_email.strip()
                )

            else:

                email_field = {
                    "parent": "parent_email",
                    "teacher": "teacher_email",
                    "student": "student_email",
                }.get(
                    recipient_role,
                    "parent_email",
                )

                recipient_address = str(
                    contact.get(
                        email_field,
                        "",
                    )
                ).strip() or None

            if not recipient_address:

                return {
                    "success": False,
                    "status": "failed",
                    "platform": platform,
                    "exam_subject": exam_subject,
                    "error": (
                        f"No email address configured "
                        f"for recipient role "
                        f"'{recipient_role}'."
                    ),
                }

        elif platform == "telegram":

            if to_telegram_id:

                recipient_address = (
                    to_telegram_id.strip()
                )

            else:

                telegram_field = {
                    "parent": "parent_telegram_id",
                    "teacher": "teacher_telegram_id",
                    "student": "student_telegram_id",
                }

                recipient_address = str(
                    contact.get(
                        telegram_field.get(
                            recipient_role,
                            "parent_telegram_id",
                        ),
                        "",
                    )
                ).strip() or None

            if (
                not recipient_address
                and not dry_run
            ):

                return {
                    "success": False,
                    "status": "failed",
                    "platform": platform,
                    "exam_subject": exam_subject,
                    "error": (
                        f"No Telegram chat ID configured "
                        f"for {recipient_role} of "
                        f"{resolved_student_name}."
                    ),
                }

        else:

            return {
                "success": False,
                "status": "failed",
                "platform": platform,
                "exam_subject": exam_subject,
                "error": (
                    f"Unsupported platform '{platform}'. "
                    "Supported: email, telegram."
                ),
            }

        # --------------------------------------------------------------
        # DRY RUN
        # --------------------------------------------------------------

        if dry_run:

            result = {
                "success": True,
                "status": "draft",
                "dry_run": True,
                "platform": platform,
                "student_id": resolved_student_id,
                "student_name": resolved_student_name,
                "exam_subject": exam_subject,
                "recipient": recipient_role,
                "to": (
                    recipient_address
                    or "[MISSING ADDRESS]"
                ),
                "attachment": attachment_path,
                "attachment_type": "zip",
            }

            if subject:
                result["subject"] = subject

            if platform == "email":
                result["body"] = message_body
            else:
                result["message"] = message_body

            return result

        # --------------------------------------------------------------
        # MCP DISPATCH
        # --------------------------------------------------------------

        if platform == "email":

            try:

                # MCP receives ONE ZIP FILE.
                result_msg = _mcp_send_email(
                    to_email=recipient_address,
                    subject=subject,
                    body=message_body,
                    attachment_paths=attachment_path,
                )

            except Exception as exc:

                return {
                    "success": False,
                    "status": "failed",
                    "platform": "email",
                    "exam_subject": exam_subject,
                    "error": (
                        _NETWORK_ERROR_MESSAGE
                        if _is_network_error(exc)
                        else f"Email delivery failed: {exc}"
                    ),
                }

            result_text = str(
                result_msg or ""
            ).strip()

            lowered = result_text.lower()

            success = (
                "successfully sent" in lowered
                and "failed" not in lowered
                and "timeout" not in lowered
                and "error" not in lowered
            )

            return {
                "success": success,
                "status": (
                    "sent"
                    if success
                    else "failed"
                ),
                "dry_run": False,
                "platform": "email",
                "student_id": resolved_student_id,
                "student_name": resolved_student_name,
                "exam_subject": exam_subject,
                "recipient": recipient_role,
                "to": recipient_address,
                "subject": subject,
                "body": message_body,
                "attachment": attachment_path,
                "attachment_type": "zip",
                "message": result_text,
                "error": (
                    None
                    if success
                    else (
                        result_text
                        or "Email delivery failed."
                    )
                ),
            }

        # --------------------------------------------------------------
        # TELEGRAM
        # --------------------------------------------------------------

        if platform == "telegram":

            caption = (
                message_body
                or f"Exam result for "
                f"{resolved_student_name}"
            )

            try:

                # Telegram receives ONE ZIP FILE.
                result_msg = _mcp_send_telegram_doc(
                    chat_id=recipient_address,
                    file_path=attachment_path,
                    caption=caption,
                )

            except Exception as exc:

                return {
                    "success": False,
                    "status": "failed",
                    "platform": "telegram",
                    "exam_subject": exam_subject,
                    "error": (
                        _NETWORK_ERROR_MESSAGE
                        if _is_network_error(exc)
                        else (
                            f"Telegram delivery failed: "
                            f"{exc}"
                        )
                    ),
                }

            result_text = str(
                result_msg or ""
            ).strip()

            lowered = result_text.lower()

            success = (
                "sent" in lowered
                and "failed" not in lowered
                and "timeout" not in lowered
                and "error" not in lowered
            )

            return {
                "success": success,
                "status": (
                    "sent"
                    if success
                    else "failed"
                ),
                "dry_run": False,
                "platform": "telegram",
                "student_id": resolved_student_id,
                "student_name": resolved_student_name,
                "exam_subject": exam_subject,
                "recipient": recipient_role,
                "to": recipient_address,
                "attachment": attachment_path,
                "attachment_type": "zip",
                "message": message_body,
                "result": result_text,
                "error": (
                    None
                    if success
                    else (
                        result_text
                        or "Telegram delivery failed."
                    )
                ),
            }

    finally:

        # The ZIP is temporary. Remove it after MCP has finished using it.
        _safe_remove_file(attachment_path)


# ============================================================================
# SINGLE STUDENT
# ============================================================================

def send_student_result_via_platform(
    student_id: Optional[str] = None,
    student_name: Optional[str] = None,
    recipient_role: str = "student",
    platform: str = "email",
    user_input: Optional[str] = None,
    dry_run: bool = False,
    to_email: Optional[str] = None,
    subject: Optional[str] = None,
    to_telegram_id: Optional[str] = None,
) -> Dict[str, Any]:

    platform = (
        platform or "email"
    ).strip().lower()

    if _should_dry_run(user_input):
        dry_run = True

    if not (
        (student_id or "").strip()
        or (student_name or "").strip()
    ):

        return send_bulk_results(
            recipient_roles=[recipient_role],
            subject=subject,
            platform=platform,
            user_input=user_input,
            dry_run=dry_run,
            to_email=to_email,
            to_telegram_id=to_telegram_id,
        )

    # Lookup contact once.
    contact = lookup_student_contact(
        student_id=student_id,
        student_name=student_name,
    )

    if not contact.get("found"):

        if to_email or to_telegram_id:

            contact = {
                "found": True,
                "student_id": str(
                    student_id or ""
                ).strip(),
                "student_name": str(
                    student_name or ""
                ).strip(),
            }

        else:

            return {
                "success": False,
                "error": contact.get(
                    "message",
                    "No contact found.",
                ),
            }

    resolved_student_id = str(
        contact.get(
            "student_id",
            "",
        )
    ).strip()

    resolved_student_name = str(
        contact.get(
            "student_name",
            "",
        )
    ).strip() or "Unknown"

    file_result = find_file_by_id(
        resolved_student_id,
        subject=subject,
    )

    if not file_result.get("found"):

        return {
            "success": False,
            "error": file_result.get(
                "message",
                "No exam records found.",
            ),
        }

    files = file_result.get(
        "files",
        [],
    )

    results = []

    for entry in files:

        result = _dispatch_single_result(
            contact=contact,
            resolved_student_id=resolved_student_id,
            resolved_student_name=resolved_student_name,
            recipient_role=recipient_role,
            platform=platform,
            user_input=user_input,
            dry_run=dry_run,
            to_email=to_email,
            to_telegram_id=to_telegram_id,
            folder_path=str(
                entry.get(
                    "folder_path",
                    "",
                )
            ).strip(),
            exam_subject=str(
                entry.get(
                    "subject",
                    "",
                )
            ).strip(),
        )

        results.append(result)

    successful = sum(
        1
        for result in results
        if result.get("success")
    )

    failed = len(results) - successful

    if len(results) == 1:
        return results[0]

    response = {
        "success": successful > 0,
        "student_id": resolved_student_id,
        "student_name": resolved_student_name,
        "platform": platform,
        "recipient": recipient_role,
        "dry_run": dry_run,
        "subjects_sent": successful,
        "subjects_failed": failed,
        "results": results,
        "summary": (
            f"Sent {successful} of "
            f"{len(results)} subject result(s) "
            f"to {recipient_role} via {platform}; "
            f"{failed} failed."
        ),
    }

    if successful == 0:

        response["error"] = "; ".join(
            str(r.get("error"))
            for r in results
            if r.get("error")
        ) or "All deliveries failed."

    return response


# ============================================================================
# MULTIPLE RECIPIENT ROLES
# ============================================================================

def send_student_result_to_multiple_recipients(
    student_id: Optional[str] = None,
    student_name: Optional[str] = None,
    recipient_roles: Optional[List[str]] = None,
    platform: str = "email",
    user_input: Optional[str] = None,
    dry_run: bool = False,
    subject: Optional[str] = None,
    to_email: Optional[str] = None,
    to_telegram_id: Optional[str] = None,
) -> Dict[str, Any]:

    if _should_dry_run(user_input):
        dry_run = True

    recipient_roles = recipient_roles or ["parent"]

    recipient_roles = [
        role.lower()
        for role in recipient_roles
        if role.lower()
        in {
            "parent",
            "teacher",
            "student",
        }
    ]

    if not recipient_roles:

        return {
            "success": False,
            "count": 0,
            "sent": 0,
            "failed": 0,
            "error": (
                "No valid recipient roles."
            ),
            "results": [],
        }

    if not (
        (student_id or "").strip()
        or (student_name or "").strip()
    ):

        return send_bulk_results(
            recipient_roles=recipient_roles,
            subject=subject,
            platform=platform,
            user_input=user_input,
            dry_run=dry_run,
            to_email=to_email,
            to_telegram_id=to_telegram_id,
        )

    if len(recipient_roles) == 1:

        return send_student_result_via_platform(
            student_id=student_id,
            student_name=student_name,
            recipient_role=recipient_roles[0],
            platform=platform,
            user_input=user_input,
            dry_run=dry_run,
            subject=subject,
            to_email=to_email,
            to_telegram_id=to_telegram_id,
        )

    results = []

    for role in recipient_roles:

        result = send_student_result_via_platform(
            student_id=student_id,
            student_name=student_name,
            recipient_role=role,
            platform=platform,
            user_input=user_input,
            dry_run=dry_run,
            subject=subject,
            to_email=to_email,
            to_telegram_id=to_telegram_id,
        )

        results.append(
            {
                "recipient": role,
                "platform": result.get(
                    "platform",
                    platform,
                ),
                "student_id": result.get(
                    "student_id"
                ),
                "student_name": result.get(
                    "student_name"
                ),
                "success": result.get(
                    "success",
                    False,
                ),
                "to": result.get(
                    "to",
                    "",
                ),
                "subject": result.get(
                    "subject",
                    "",
                ),
                "body": result.get(
                    "body",
                    "",
                ),
                "message": result.get(
                    "message",
                    "",
                ),
                "attachment": result.get(
                    "attachment",
                    "",
                ),
                "error": result.get(
                    "error"
                ),
            }
        )

    sent = sum(
        1
        for result in results
        if result["success"]
    )

    failed = len(results) - sent

    response = {
        "success": sent > 0,
        "count": len(results),
        "sent": sent,
        "failed": failed,
        "platform": platform,
        "dry_run": dry_run,
        "results": results,
        "summary": (
            f"Sent {sent} of "
            f"{len(results)} delivery(s); "
            f"{failed} failed."
        ),
    }

    if sent == 0:

        response["error"] = "; ".join(
            str(result["error"])
            for result in results
            if result.get("error")
        ) or "All deliveries failed."

    return response


# ============================================================================
# BULK STUDENT DISCOVERY
# ============================================================================

def list_all_students(
    filter_name: Optional[str] = None,
    class_filter: Optional[str] = None,
    student_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:

    contacts = _load_contacts()

    if not contacts:

        return {
            "success": False,
            "count": 0,
            "students": [],
            "error": (
                "No contacts found in Contact_Info.xlsx"
            ),
        }

    allowed_ids = (
        {
            str(sid).strip()
            for sid in student_ids
            if str(sid).strip()
        }
        if student_ids
        else None
    )

    students = []
    seen_ids = set()

    for contact in contacts:

        sid = str(
            contact.get(
                "student_id",
                "",
            )
        ).strip()

        name = str(
            contact.get(
                "student_name",
                "",
            )
        ).strip()

        class_id = str(
            contact.get(
                "class_id",
                "",
            )
        ).strip()

        if not sid or sid in seen_ids:
            continue

        if (
            allowed_ids is not None
            and sid not in allowed_ids
        ):
            continue

        if (
            filter_name
            and filter_name.lower()
            not in name.lower()
        ):
            continue

        if (
            class_filter
            and class_id.lower()
            != class_filter.strip().lower()
        ):
            continue

        students.append(
            {
                "student_id": sid,
                "student_name": name,
                "class_id": class_id or None,
                "parent_email": str(
                    contact.get(
                        "parent_email",
                        "",
                    )
                ).strip() or None,
                "teacher_email": str(
                    contact.get(
                        "teacher_email",
                        "",
                    )
                ).strip() or None,
                "student_email": str(
                    contact.get(
                        "student_email",
                        "",
                    )
                ).strip() or None,
            }
        )

        seen_ids.add(sid)

    return {
        "success": True,
        "count": len(students),
        "students": students,
    }


# ============================================================================
# BULK RESULTS
# ============================================================================

def send_bulk_results(
    recipient_roles: Optional[List[str]] = None,
    student_filter: Optional[str] = None,
    class_filter: Optional[str] = None,
    platform: str = "email",
    user_input: Optional[str] = None,
    dry_run: bool = False,
    subject: Optional[str] = None,
    to_email: Optional[str] = None,
    to_telegram_id: Optional[str] = None,
    student_ids: Optional[List[str]] = None,
    subject_selections: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:

    if _should_dry_run(user_input):
        dry_run = True

    recipient_roles = recipient_roles or ["parent"]

    platform = (
        platform or "email"
    ).strip().lower()

    contacts_by_id = {
        str(
            c.get(
                "student_id",
                "",
            )
        ).strip(): c
        for c in _load_contacts()
    }

    # --------------------------------------------------------------
    # BUILD STUDENT/SUBJECT PAIRS
    # --------------------------------------------------------------

    if subject_selections is not None:

        pairs = [
            (
                str(
                    selection.get(
                        "student_id",
                        "",
                    )
                ).strip(),

                str(
                    selection.get(
                        "subject",
                        "",
                    )
                ).strip(),
            )

            for selection in subject_selections

            if str(
                selection.get(
                    "student_id",
                    "",
                )
            ).strip()

            and str(
                selection.get(
                    "subject",
                    "",
                )
            ).strip()
        ]

    else:

        allowed_ids = (
            {
                str(sid).strip()
                for sid in student_ids
                if str(sid).strip()
            }
            if student_ids
            else None
        )

        root = _get_result_path()

        if not os.path.isdir(root):

            subject_folders = []

        elif subject:

            resolved = _resolve_subject_folder(
                root,
                subject,
            )

            subject_folders = (
                [_sanitize_path_component(resolved)]
                if resolved
                else []
            )

        else:

            subject_folders = sorted(
                folder
                for folder in os.listdir(root)
                if os.path.isdir(
                    os.path.join(
                        root,
                        folder,
                    )
                )
            )

        pairs = []

        for subject_folder in subject_folders:

            subject_dir = os.path.join(
                root,
                subject_folder,
            )

            for sid in sorted(
                os.listdir(subject_dir)
            ):

                student_dir = os.path.join(
                    subject_dir,
                    sid,
                )

                if not os.path.isdir(
                    student_dir
                ):
                    continue

                if (
                    allowed_ids is not None
                    and sid not in allowed_ids
                ):
                    continue

                has_files = any(
                    os.path.isfile(
                        os.path.join(
                            current_root,
                            filename,
                        )
                    )
                    for current_root, _, filenames
                    in os.walk(student_dir)
                    for filename in filenames
                )

                if not has_files:
                    continue

                contact = contacts_by_id.get(
                    sid
                )

                name = (
                    str(
                        contact.get(
                            "student_name",
                            "",
                        )
                    ).strip()
                    if contact
                    else ""
                )

                if class_filter:

                    class_id = (
                        str(
                            contact.get(
                                "class_id",
                                "",
                            )
                        ).strip()
                        if contact
                        else ""
                    )

                    if (
                        class_id.lower()
                        != class_filter.strip().lower()
                    ):
                        continue

                if (
                    student_filter
                    and student_filter.lower()
                    not in name.lower()
                ):
                    continue

                pairs.append(
                    (
                        sid,
                        subject_folder,
                    )
                )

    if not pairs:

        return {
            "success": False,
            "platform": platform,
            "total_sent": 0,
            "total_failed": 0,
            "students_processed": 0,
            "error": "No matching exam results found.",
            "results": [],
        }

    # --------------------------------------------------------------
    # PROCESS ONE STUDENT/SUBJECT
    # --------------------------------------------------------------

    def process_pair(
        pair: Tuple[str, str]
    ) -> Dict[str, Any]:

        sid, subj = pair

        contact = contacts_by_id.get(
            sid
        )

        name = (
            str(
                contact.get(
                    "student_name",
                    "",
                )
            ).strip()
            if contact
            else ""
        ) or "Unknown"

        recipients = []

        sent = 0
        failed = 0

        for role in recipient_roles:

            result = send_student_result_via_platform(
                student_id=sid,
                student_name=name,
                recipient_role=role,
                platform=platform,
                user_input=user_input,
                dry_run=dry_run,
                subject=subj,
                to_email=to_email,
                to_telegram_id=to_telegram_id,
            )

            if "results" in result:

                role_results = result.get(
                    "results",
                    [],
                )

                recipients.extend(
                    role_results
                )

                sent += result.get(
                    "sent",
                    0,
                )

                failed += result.get(
                    "failed",
                    0,
                )

            else:

                recipients.append(
                    {
                        "recipient": role,
                        "platform": result.get(
                            "platform",
                            platform,
                        ),
                        "student_id": result.get(
                            "student_id",
                            sid,
                        ),
                        "student_name": result.get(
                            "student_name",
                            name,
                        ),
                        "success": result.get(
                            "success",
                            False,
                        ),
                        "to": result.get(
                            "to",
                            "",
                        ),
                        "subject": result.get(
                            "subject",
                            "",
                        ),
                        "body": result.get(
                            "body",
                            "",
                        ),
                        "message": result.get(
                            "message",
                            "",
                        ),
                        "attachment": result.get(
                            "attachment",
                            "",
                        ),
                        "error": result.get(
                            "error"
                        ),
                    }
                )

                if result.get("success"):
                    sent += 1
                else:
                    failed += 1

        return {
            "student_id": sid,
            "student_name": name,
            "subject": subj,
            "success": sent > 0,
            "sent": sent,
            "failed": failed,
            "recipients": recipients,
        }

    # --------------------------------------------------------------
    # PARALLEL BULK DISPATCH
    # --------------------------------------------------------------

    with ThreadPoolExecutor(
        max_workers=min(
            8,
            len(pairs),
        )
    ) as executor:

        all_results = list(
            executor.map(
                process_pair,
                pairs,
            )
        )

    total_sent = sum(
        row.get(
            "sent",
            0,
        )
        for row in all_results
    )

    total_failed = sum(
        row.get(
            "failed",
            0,
        )
        for row in all_results
    )

    response = {
        "success": total_sent > 0,
        "platform": platform,
        "total_sent": total_sent,
        "total_failed": total_failed,
        "students_processed": len(pairs),
        "dry_run": dry_run,
        "results": all_results,
        "summary": (
            f"Processed {len(pairs)} result(s). "
            f"Sent {total_sent} {platform} delivery(s); "
            f"{total_failed} failed."
        ),
    }

    if total_sent == 0:

        errors = [
            str(
                recipient.get(
                    "error"
                )
            )
            for student in all_results
            for recipient in student.get(
                "recipients",
                [],
            )
            if recipient.get("error")
        ]

        response["error"] = (
            "; ".join(
                dict.fromkeys(errors)
            )
            or "All bulk deliveries failed."
        )

    return response


# ============================================================================
# AGENT
# ============================================================================

SYSTEM_PROMPT = """
You are a result dispatch agent.

You deliver official exam results by email or Telegram.

IMPORTANT FILE RULE:
Every result is stored inside a student/subject folder.

The dispatch tools automatically package the COMPLETE result folder into
ONE ZIP file before sending it through MCP.

You must NOT attempt to manipulate files yourself.

Never invent a student, ID, contact, address, result, filename, or delivery
status. Only report what the tools return.

Tool selection — count the students and recipient roles named in the request:
- 1 student, 1 recipient role -> send_student_result_via_platform
  e.g. "Send Ivy's math result to her teacher via telegram" -> recipient_role="teacher", subject="Mathematics", platform="telegram"
- 1 student, 2+ recipient roles in the same request -> send_student_result_to_multiple_recipients
  e.g. "Send Ivy's result to her parent and teacher" -> student_name="Ivy", recipient_roles=["parent","teacher"]
- 2+ students (named, "all"/"every", or filtered by class/subject) -> send_bulk_results
  e.g. "Send Math result to students via email" -> subject="Mathematics", recipient_roles=["student"]

A request naming only one role (parent OR teacher OR student) is always a single
recipient, even though a tool name says "multiple" — never call
send_student_result_to_multiple_recipients for just one role.

Rules:

- Pass the FULL user request as user_input.
- Pass platform to every send tool.
- Default platform is email.
- Default recipient role is student.
- Use Telegram only when explicitly requested.
- WhatsApp is disabled.
- Set dry_run=true for draft/preview requests.
- Pass subject only when the user explicitly names a subject.
- If subject is omitted for one student, the tool sends every subject found.
- Never call lookup_student_contact before a send tool.
- Never call low-level file tools before a send tool.
- Call exactly ONE high-level send tool for a request.
- After the tool returns, stop and report the exact result.
- If the request is ambiguous, ask one clarification question.
- Differentiate student id or name provided inside user prompt. 

Attachment behavior:
The high-level send tool packages the complete student/subject folder into
a ZIP and passes that ZIP directly to MCP messaging.
"""


TOOLS = [
    send_student_result_via_platform,
    send_student_result_to_multiple_recipients,
    send_bulk_results,
]


# ============================================================================
# BUILD AGENT
# ============================================================================

def build_agent(
    api_base: str,
    model: str,
    api_key: str,
) -> ReActAgent:

    global _llm

    llm = OpenAILike(
        model=model,
        api_base=api_base,
        api_key=api_key,
        is_chat_model=True,
        is_function_calling_model=True,
    )

    _llm = llm

    return ReActAgent(
        tools=TOOLS,
        llm=llm,
        system_prompt=SYSTEM_PROMPT,
        max_iterations=4,
        early_stopping_method="generate",
    )


# ============================================================================
# EXECUTION
# ============================================================================

async def run_query(
    agent: ReActAgent,
    ctx: Context,
    query: str,
) -> None:

    print(
        f"\n{'─' * 60}\n"
        f"Query: {query}\n"
        f"{'─' * 60}"
    )

    handler = agent.run(
        query,
        ctx=ctx,
    )

    async for event in handler.stream_events():

        if isinstance(
            event,
            AgentStream,
        ):

            print(
                event.delta,
                end="",
                flush=True,
            )

    await handler

    print()


async def interactive_loop(
    agent: ReActAgent,
) -> None:

    ctx = Context(agent)

    print(
        "\n=== Exam Result Dispatch Agent ==="
    )

    print("\nExample queries:")

    print(
        "  • Send Alice (ID 12345) result "
        "to her parent using email"
    )

    print(
        "  • Send Alice's Math result "
        "to her parent using Telegram"
    )

    print(
        "  • Send all students' results "
        "to their parents using email"
    )

    print(
        '\nType "exit" or "quit" to stop.'
    )

    while True:

        try:

            query = input(
                "\nYou: "
            ).strip()

        except (
            EOFError,
            KeyboardInterrupt,
        ):

            print("\nGoodbye.")
            break

        if not query:
            continue

        if query.lower() in {
            "exit",
            "quit",
            "q",
        }:

            print("Goodbye.")
            break

        await run_query(
            agent,
            ctx,
            query,
        )


# ============================================================================
# CLI
# ============================================================================

def parse_args() -> argparse.Namespace:

    parser = argparse.ArgumentParser(
        description=(
            "Agentic Exam Result Dispatch Agent"
        )
    )

    parser.add_argument(
        "--api-base",
        default=os.environ.get(
            "LLM_API_BASE",
            "http://localhost:8081/v1",
        ),
    )

    parser.add_argument(
        "--model",
        default=os.environ.get(
            "LLM_MODEL",
            "dummy",
        ),
    )

    parser.add_argument(
        "--api-key",
        default=os.environ.get(
            "LLM_API_KEY",
            "dummy",
        ),
    )

    parser.add_argument(
        "--query",
        default=None,
        help="Run a single query and exit",
    )

    parser.add_argument(
        "--result-path",
        default=None,
        help="Override results directory path",
    )

    return parser.parse_args()


# ============================================================================
# MAIN
# ============================================================================

async def main() -> None:
    args = parse_args()

    if args.result_path:
        os.environ[
            "EXAM_RESULT_PATH"
        ] = os.path.abspath(
            args.result_path
        )

    agent = build_agent(
        api_base=args.api_base,
        model=args.model,
        api_key=args.api_key,
    )

    if args.query:
        ctx = Context(agent)

        await run_query(
            agent,
            ctx,
            args.query,
        )

    else:
        await interactive_loop(
            agent
        )

if __name__ == "__main__":
    asyncio.run(main())