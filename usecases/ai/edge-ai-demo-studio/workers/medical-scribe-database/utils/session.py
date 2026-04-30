# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from typing import Optional, Dict, Any
from utils.database import MedicalScribeDatabase


def build_session_response(
    database: MedicalScribeDatabase, session_id: str
) -> Optional[Dict[str, Any]]:
    session = database.get_session(session_id)
    if not session:
        return None

    state = database.get_session_state(session_id) or {}
    report = database.get_report(session_id)
    report_content = report["content"] if report else None

    return {
        "id": session["session_id"],
        "name": state.get("name", session.get("session_name") or "Untitled Session"),
        "doctorProfileId": state.get(
            "doctorProfileId",
            (
                session.get("doctor_profile_id")
                if session.get("doctor_profile_id")
                else None
            ),
        ),
        "language": state.get("language", "en"),
        "status": state.get("status", session.get("status") or "idle"),
        "transcripts": state.get("transcripts", []),
        "soapReport": state.get("soapReport", report_content),
        "audioBlob": None,
        "errorMessage": state.get("errorMessage"),
    }
