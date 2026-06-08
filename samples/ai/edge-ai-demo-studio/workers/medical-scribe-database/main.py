# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Dict, Any
import argparse
import json
import os
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from utils.database import MedicalScribeDatabase
from utils.models import DoctorProfile, Session
from utils.schemas import (
    DoctorProfileCreateRequest,
    DoctorProfileEmbeddingRequest,
    SessionCreateRequest,
    SessionUpdateRequest,
)
from utils.session import build_session_response


def create_app(database: MedicalScribeDatabase) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        database.close()

    app = FastAPI(
        title="Medical Scribe Database Worker",
        version="1.0.0",
        lifespan=lifespan,
    )

    allowed_cors = json.loads(os.getenv("ALLOWED_CORS", '["http://localhost"]'))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_cors,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthcheck", status_code=200)
    def healthcheck() -> str:
        return "OK"

    @app.get("/v1/doctor-profiles")
    def list_doctor_profiles() -> List[Dict[str, Any]]:
        profiles = database.list_doctor_profiles()
        return [
            {
                "id": p["profile_id"],
                "name": p["name"],
                "embedding": p.get("embeddings"),
            }
            for p in profiles
        ]

    @app.post("/v1/doctor-profiles")
    def create_doctor_profile(payload: DoctorProfileCreateRequest) -> Dict[str, Any]:
        profile_id = payload.id or database.create_doctor_profile(payload.name)
        if payload.id:
            with database._get_session() as db_session:
                profile = (
                    db_session.query(DoctorProfile)
                    .filter_by(profile_id=payload.id)
                    .first()
                )
                if not profile:
                    profile = DoctorProfile(profile_id=payload.id, name=payload.name)
                    db_session.add(profile)
                else:
                    profile.name = payload.name

        profile = database.get_doctor_profile(profile_id)
        if not profile:
            raise HTTPException(
                status_code=500, detail="Failed to create doctor profile"
            )

        return {
            "id": profile["profile_id"],
            "name": profile["name"],
            "embedding": profile.get("embeddings"),
        }

    @app.patch("/v1/doctor-profiles/{profile_id}")
    def update_doctor_profile(
        profile_id: str, payload: DoctorProfileEmbeddingRequest
    ) -> Dict[str, Any]:
        ok = database.update_doctor_profile_data(
            profile_id, embeddings=payload.embedding
        )
        if not ok:
            raise HTTPException(status_code=404, detail="Doctor profile not found")

        profile = database.get_doctor_profile(profile_id)
        if not profile:
            raise HTTPException(status_code=404, detail="Doctor profile not found")

        return {
            "id": profile["profile_id"],
            "name": profile["name"],
            "embedding": profile.get("embeddings"),
        }

    @app.delete("/v1/doctor-profiles/{profile_id}", status_code=204)
    def delete_doctor_profile(profile_id: str) -> None:
        ok = database.delete_doctor_profile(profile_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Doctor profile not found")

    @app.get("/v1/sessions")
    def list_sessions() -> List[Dict[str, Any]]:
        sessions = database.list_sessions()
        result: List[Dict[str, Any]] = []
        for item in sessions:
            session = build_session_response(database, item["session_id"])
            if session:
                result.append(session)
        return result

    @app.post("/v1/sessions")
    def create_session(payload: SessionCreateRequest) -> Dict[str, Any]:
        if payload.id:
            with database._get_session() as db_session:
                existing = (
                    db_session.query(Session).filter_by(session_id=payload.id).first()
                )
                if existing is None:
                    row = Session(
                        session_id=payload.id,
                        doctor_profile_id=payload.doctorProfileId or "",
                        session_name=payload.name,
                        created_at=datetime.now(),
                        start_time=None,
                        status="idle",
                    )
                    db_session.add(row)
            session_id = payload.id
        else:
            created = database.create_session(
                doctor_profile_id=payload.doctorProfileId or "",
                session_name=payload.name,
            )
            session_id = created["session_id"]

        doctorProfileName = None
        if payload.doctorProfileId:
            profile = database.get_doctor_profile(payload.doctorProfileId)
            doctorProfileName = profile.get("name") if profile else None

        database.store_session_state(
            session_id,
            {
                "name": payload.name,
                "doctorProfileId": payload.doctorProfileId,
                "doctorProfileName": doctorProfileName,
                "language": payload.language,
                "sessionCreatedAt": payload.sessionCreatedAt,
                "status": "idle",
                "transcripts": [],
                "dialogueCreatedAt": None,
                "reportCreatedAt": None,
                "soapReport": None,
                "errorMessage": None,
            },
        )

        session = build_session_response(database, session_id)
        if not session:
            raise HTTPException(status_code=500, detail="Failed to create session")
        return session

    @app.patch("/v1/sessions/{session_id}")
    def update_session(
        session_id: str, payload: SessionUpdateRequest
    ) -> Dict[str, Any]:
        current = build_session_response(database, session_id)
        if not current:
            raise HTTPException(status_code=404, detail="Session not found")

        payload_data = (
            payload.model_dump(exclude_none=True)
            if hasattr(payload, "model_dump")
            else payload.dict(exclude_none=True)
        )

        if "doctorProfileId" in payload_data:
            doctorProfileId = payload_data["doctorProfileId"]
            if doctorProfileId:
                profile = database.get_doctor_profile(doctorProfileId)
                payload_data["doctorProfileName"] = (
                    profile.get("name") if profile else None
                )
            else:
                payload_data["doctorProfileName"] = None

        next_state = {**current, **payload_data}
        next_state.pop("id", None)
        next_state.pop("audioBlob", None)

        database.update_session_data(
            session_id=session_id,
            session_name=payload.name,
            doctor_profile_id=(
                payload.doctorProfileId if payload.doctorProfileId is not None else None
            ),
            status=payload.status,
        )
        database.store_session_state(session_id=session_id, state=next_state)

        if payload.soapReport is not None:
            database.store_report(
                session_id=session_id, content=payload.soapReport, format="markdown"
            )

        session = build_session_response(database, session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return session

    @app.delete("/v1/sessions/{session_id}", status_code=204)
    def delete_session(session_id: str) -> None:
        ok = database.delete_session(session_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Session not found")

    return app


def parse_args():
    db_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "medical_scribe.db"
    )
    parser = argparse.ArgumentParser(description="Medical Scribe Database Worker")
    parser.add_argument("--port", type=int, default=8027, help="Port to listen on")
    parser.add_argument(
        "--host", type=str, default="127.0.0.1", help="Host to listen on"
    )
    parser.add_argument(
        "--db-path", type=str, default=db_path, help="Path to SQLite database file"
    )
    parser.add_argument(
        "--echo-sql", action="store_true", help="Enable SQL query logging"
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    db = MedicalScribeDatabase(db_path=args.db_path, echo_sql=args.echo_sql)
    app = create_app(db)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
