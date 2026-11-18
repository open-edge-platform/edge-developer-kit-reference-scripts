# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from collections.abc import Mapping

from ..evaluation.session import EvaluationLeaseError, EvaluationSessionError
from ..generation.native_env import NativeObservation
from .session import TeleoperationSession, TeleoperationSessionError


class SharedEvaluationControl:
    """Evaluation and teleoperation clients contend for the same recording-aware lease."""

    def __init__(self, session: TeleoperationSession) -> None:
        self.session = session
        self.client_id = ""
        self.lease_id = ""

    def acquire(self, identity: bytes) -> str:
        self.client_id = f"evaluation-{identity.hex()}"
        try:
            self.lease_id = self.session.acquire(self.client_id)
        except TeleoperationSessionError as error:
            raise EvaluationSessionError("ALREADY_ACQUIRED", str(error)) from error
        return self.lease_id

    def release(self) -> None:
        self.ping()
        self.session.release(self.client_id, self.lease_id)
        self.lease_id = ""

    def ping(self) -> None:
        try:
            self.session.ping(self.client_id, self.lease_id)
        except TeleoperationSessionError as error:
            raise EvaluationLeaseError(str(error)) from error

    def revoke(self) -> None:
        if self.lease_id and self.session.active_lease_id == self.lease_id:
            self.session.revoke_control()
        self.lease_id = ""

    def reset(self, seed: int | None) -> NativeObservation:
        try:
            return self.session.reset_evaluation(self.client_id, self.lease_id, seed)
        except TeleoperationSessionError as error:
            raise EvaluationSessionError("STATE_CHANGE_DURING_RECORDING", str(error)) from error

    def step(
        self, values: Mapping[str, float], physics_steps: int, *, images: bool = True
    ) -> NativeObservation:
        self.session.step(self.client_id, self.lease_id, values, physics_steps=physics_steps)
        return self.session.environment.observe(images=images)
