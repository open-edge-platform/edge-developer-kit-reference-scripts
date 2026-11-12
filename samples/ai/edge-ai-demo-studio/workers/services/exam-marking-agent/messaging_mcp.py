# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Unified Communication Messaging MCP Server
==========================================

Supports:
    - Plain email
    - Email with one attachment
    - Email with multiple attachments
    - Plain Telegram message
    - Telegram with one document
    - Telegram with multiple documents

IMPORTANT:
    The Dispatch Agent is responsible for:
        1. Finding the student/subject folder.
        2. Collecting all files.
        3. Creating a ZIP when required.

    This MCP server does NOT understand student/subject folders.
    It only sends the files provided by the Dispatch Agent.

Environment Variables:
    Email:
        SMTP_SERVER / SMTP_HOST
        SMTP_PORT
        SMTP_USER
        SENDER_EMAIL
        SMTP_PASSWORD

    Telegram:
        TELEGRAM_BOT_TOKEN

Run standalone:
    python messaging_mcp.py
"""

import os
import re
import smtplib
import socket
import ssl
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Optional
from urllib.parse import urlparse

import requests
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Unified Communication Messaging Server")


# ============================================================================
# HELPERS
# ============================================================================

def _smtp_config() -> dict:
    return {
        "host": (
            os.getenv("SMTP_HOST")
            or os.getenv(
                "SMTP_SERVER",
                "smtp.gmail.com",
            )
        ),
        "port": int(
            os.getenv(
                "SMTP_PORT",
                587,
            )
        ),
        "user": os.getenv("SMTP_USER") or os.getenv("SENDER_EMAIL"),
        "password": os.getenv(
            "SMTP_PASSWORD",
            "",
        ).strip(),
        "from_addr": os.getenv(
            "SENDER_EMAIL"
        ),
        "use_tls": os.getenv(
            "SMTP_USE_TLS",
            "true",
        ).lower()
        in {"1", "true", "yes"},
    }

_NETWORK_ERROR_MESSAGE = (
    "Failed due to network issue: could not reach the "
    "mail/Telegram server. Check your internet connection "
    "or try connecting from a different network."
)

def _is_network_error(exc: Exception) -> bool:
    """Return True for connection-level failures."""

    if isinstance(
        exc,
        (
            socket.timeout,
            socket.gaierror,
            TimeoutError,
            ConnectionError,
        ),
    ):
        return True

    if isinstance(exc, OSError) and getattr(
        exc,
        "winerror",
        None,
    ) in {
        10060,
        10061,
        10064,
        10065,
        10051,
    }:
        return True

    if isinstance(
        exc,
        smtplib.SMTPConnectError,
    ):
        return True

    if isinstance(
        exc,
        (
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
        ),
    ):
        return True

    return False

def _format_smtp_exception(
    exc: Exception,
) -> str:
    """Return precise SMTP error details."""

    if _is_network_error(exc):
        return _NETWORK_ERROR_MESSAGE

    if isinstance(
        exc,
        smtplib.SMTPResponseException,
    ):
        code = getattr(
            exc,
            "smtp_code",
            "",
        )

        err = getattr(
            exc,
            "smtp_error",
            b"",
        )

        if isinstance(err, bytes):
            err = err.decode(
                "utf-8",
                errors="replace",
            )

        return (
            f"{type(exc).__name__}"
            f"({code}): {err}"
        )

    return f"{type(exc).__name__}: {exc}"


def _format_request_exception(
    exc: Exception,
) -> str:
    """Return concise Telegram HTTP diagnostics."""

    if _is_network_error(exc):
        return _NETWORK_ERROR_MESSAGE

    return f"{type(exc).__name__}: {exc}"


def _clean_file_paths(
    file_paths: List[str],
) -> List[str]:
    """
    Clean file paths and remove empty entries.
    """

    return [
        str(path).strip()
        for path in (file_paths or [])
        if str(path).strip()
    ]


def _validate_files(
    file_paths: List[str],
) -> List[str]:
    """
    Return files that do not exist or are not regular files.
    """

    return [
        path
        for path in file_paths
        if not os.path.isfile(path)
    ]


# ============================================================================
# EMAIL
# ============================================================================

@mcp.tool()
def send_email(
    to_email: str,
    subject: str,
    body: str,
) -> str:
    """
    Send a plain-text email via SMTP.
    """

    cfg = _smtp_config()

    if not cfg["from_addr"]:
        return (
            "Failed to send email: "
            "SENDER_EMAIL environment variable "
            "is not configured."
        )

    msg = MIMEText(
        body,
        "plain",
        "utf-8",
    )

    msg["Subject"] = subject
    msg["From"] = cfg["from_addr"]
    msg["To"] = to_email

    server = None

    try:
        server = smtplib.SMTP(
            cfg["host"],
            cfg["port"],
            timeout=60,
        )

        server.ehlo()

        if cfg["use_tls"]:
            server.starttls(context=ssl.create_default_context())
            server.ehlo()

        server.login(
            cfg["user"],
            cfg["password"],
        )

        server.send_message(msg)

        return (
            f"Email successfully sent to "
            f"{to_email}"
        )

    except Exception as exc:

        return (
            "Failed to send email: "
            f"{_format_smtp_exception(exc)}"
        )

    finally:

        if server is not None:
            try:
                server.quit()
            except Exception:
                pass


# ============================================================================
# EMAIL - ONE ATTACHMENT
# ============================================================================

@mcp.tool()
def send_email_with_file(
    to_email: str,
    subject: str,
    body: str,
    attachment_paths: str,
) -> str:
    """
    Send an email with one file attachment.

    The Dispatch Agent can provide a ZIP file here.

    Example:
        /tmp/ST001_Math.zip
    """

    return send_email_with_files(
        to_email=to_email,
        subject=subject,
        body=body,
        attachment_pathss=[
            attachment_paths
        ],
    )


# ============================================================================
# EMAIL - MULTIPLE ATTACHMENTS
# ============================================================================

@mcp.tool()
def send_email_with_files(
    to_email: str,
    subject: str,
    body: str,
    attachment_pathss: List[str],
) -> str:
    """
    Send an email with multiple file attachments.

    The Dispatch Agent is responsible for deciding
    which files should be sent.

    Args:
        to_email:
            Recipient email address.

        subject:
            Email subject.

        body:
            Plain text email body.

        attachment_pathss:
            List of absolute file paths.
    """

    cfg = _smtp_config()

    if not cfg["from_addr"]:
        return (
            "Failed to send email: "
            "SENDER_EMAIL environment variable "
            "is not configured."
        )

    # ------------------------------------------------------------------------
    # Clean paths
    # ------------------------------------------------------------------------

    attachment_pathss = _clean_file_paths(
        attachment_pathss
    )

    if not attachment_pathss:
        return (
            "Failed to send email: "
            "no attachment files were provided."
        )

    # ------------------------------------------------------------------------
    # Verify every attachment before connecting
    # ------------------------------------------------------------------------

    missing_files = _validate_files(
        attachment_pathss
    )

    if missing_files:
        return (
            "Failed to send email: "
            "attachment file(s) not found: "
            + ", ".join(missing_files)
        )

    # ------------------------------------------------------------------------
    # Build email
    # ------------------------------------------------------------------------

    msg = MIMEMultipart()

    msg["From"] = cfg["from_addr"]
    msg["To"] = to_email
    msg["Subject"] = subject

    msg.attach(
        MIMEText(
            body,
            "plain",
            "utf-8",
        )
    )

    # ------------------------------------------------------------------------
    # Attach ALL files
    # ------------------------------------------------------------------------

    for attachment_path in attachment_pathss:

        filename = os.path.basename(
            attachment_path
        )

        try:

            with open(
                attachment_path,
                "rb",
            ) as f:

                part = MIMEApplication(
                    f.read(),
                    Name=filename,
                )

            part.add_header(
                "Content-Disposition",
                "attachment",
                filename=filename,
            )

            msg.attach(part)

        except Exception as exc:

            return (
                "Failed to prepare email attachment "
                f"'{attachment_path}': {exc}"
            )

    # ------------------------------------------------------------------------
    # Send email
    # ------------------------------------------------------------------------

    server = None

    try:

        server = smtplib.SMTP(
            cfg["host"],
            cfg["port"],
            timeout=60,
        )

        server.ehlo()

        if cfg["use_tls"]:
            server.starttls(context=ssl.create_default_context())
            server.ehlo()

        server.login(
            cfg["user"],
            cfg["password"],
        )

        server.sendmail(
            cfg["from_addr"],
            [to_email],
            msg.as_string(),
        )

        return (
            f"Email successfully sent to "
            f"{to_email} with "
            f"{len(attachment_pathss)} attachment(s): "
            f"{', '.join(os.path.basename(p) for p in attachment_pathss)}"
        )

    except Exception as exc:

        return (
            "Failed to send email: "
            f"{_format_smtp_exception(exc)}"
        )

    finally:

        if server is not None:
            try:
                server.quit()
            except Exception:
                pass


# ============================================================================
# TELEGRAM - PLAIN MESSAGE
# ============================================================================

@mcp.tool()
def send_telegram_message(
    chat_id: str,
    message: str,
) -> str:
    """
    Send a plain text message to a Telegram chat.
    """

    bot_token = os.getenv(
        "TELEGRAM_BOT_TOKEN",
        "",
    )

    if not bot_token:
        return (
            "Failed to send Telegram message: "
            "TELEGRAM_BOT_TOKEN is not configured."
        )

    if not re.fullmatch(r"[0-9]+:[A-Za-z0-9_\-]+", bot_token):
        return (
            "Failed to send Telegram message: "
            "TELEGRAM_BOT_TOKEN has an invalid format."
        )

    url = urlparse(f"https://api.telegram.org/bot{bot_token}/sendMessage").geturl()

    try:

        response = requests.post(
            url,
            json={
                "chat_id": chat_id,
                "text": message,
            },
            timeout=10,
        )

    except requests.exceptions.RequestException as exc:

        return (
            "Failed to send Telegram message: "
            f"{_format_request_exception(exc)}"
        )

    if response.status_code == 200:
        return (
            f"Telegram message sent to "
            f"{chat_id}"
        )

    return (
        "Failed to send Telegram message: "
        f"{response.text}"
    )


# ============================================================================
# TELEGRAM - ONE DOCUMENT
# ============================================================================

@mcp.tool()
def send_telegram_document(
    chat_id: str,
    file_path: str,
    caption: Optional[str] = None,
) -> str:
    """
    Send one document to Telegram.

    The Dispatch Agent can provide a ZIP file here.

    Example:
        /tmp/ST001_Math.zip
    """

    return send_telegram_documents(
        chat_id=chat_id,
        file_paths=[
            file_path
        ],
        caption=caption,
    )


# ============================================================================
# TELEGRAM - MULTIPLE DOCUMENTS
# ============================================================================

@mcp.tool()
def send_telegram_documents(
    chat_id: str,
    file_paths: List[str],
    caption: Optional[str] = None,
) -> str:
    """
    Send multiple documents to a Telegram chat.

    The Dispatch Agent is responsible for deciding
    which files should be sent.

    Telegram's sendDocument endpoint sends one document
    per request, so each file is sent separately.
    """

    bot_token = os.getenv(
        "TELEGRAM_BOT_TOKEN",
        "",
    )

    if not bot_token:
        return (
            "Failed to send Telegram documents: "
            "TELEGRAM_BOT_TOKEN is not configured."
        )

    if not re.fullmatch(r"[0-9]+:[A-Za-z0-9_\-]+", bot_token):
        return (
            "Failed to send Telegram documents: "
            "TELEGRAM_BOT_TOKEN has an invalid format."
        )

    # ------------------------------------------------------------------------
    # Clean paths
    # ------------------------------------------------------------------------

    file_paths = _clean_file_paths(
        file_paths
    )

    if not file_paths:
        return (
            "Failed to send Telegram documents: "
            "no files were provided."
        )

    # ------------------------------------------------------------------------
    # Verify all files first
    # ------------------------------------------------------------------------

    missing_files = _validate_files(
        file_paths
    )

    if missing_files:
        return (
            "Failed to send Telegram documents: "
            "file(s) not found: "
            + ", ".join(missing_files)
        )

    url = urlparse(f"https://api.telegram.org/bot{bot_token}/sendDocument").geturl()

    sent_files = []

    # ------------------------------------------------------------------------
    # Send every file
    # ------------------------------------------------------------------------

    for index, file_path in enumerate(
        file_paths
    ):

        filename = os.path.basename(
            file_path
        )

        current_caption = (
            caption
            if index == 0
            else None
        )

        try:
            with open(file_path,"rb") as f:
                response = requests.post(
                    url,
                    data={
                        "chat_id": chat_id,
                        "caption": current_caption,
                    },
                    files={
                        "document": f
                    },
                    timeout=(10, 120),
                )

        except requests.exceptions.RequestException as exc:

            return (
                "Failed to send Telegram documents: "
                f"{_format_request_exception(exc)}"
            )

        if response.status_code != 200:

            return (
                "Failed to send Telegram document "
                f"'{filename}': "
                f"{response.text}"
            )

        sent_files.append(
            filename
        )

    # ------------------------------------------------------------------------
    # Everything succeeded
    # ------------------------------------------------------------------------

    return (
        f"Telegram successfully sent "
        f"{len(sent_files)} document(s) to "
        f"{chat_id}: "
        f"{', '.join(sent_files)}"
    )


# ============================================================================
# RUN MCP SERVER
# ============================================================================

if __name__ == "__main__":
    mcp.run()