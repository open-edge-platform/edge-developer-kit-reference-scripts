# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
import json
import os
import time
from collections.abc import Mapping
from typing import Any

import numpy as np

from ..zmq_transport import receive_request
from .session import EvaluationSession, EvaluationSessionError

EVALUATION_PROTOCOL_VERSION = 1
EVALUATION_MAX_COMMAND_BYTES = 1 * 1024 * 1024


class EvaluationTransportError(RuntimeError):
    pass


def _json(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _as_command(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise EvaluationTransportError("Command must be a UTF-8 JSON object.") from error
    if not isinstance(value, dict):
        raise EvaluationTransportError("Command must be a JSON object.")
    return value


def _success(command: Mapping[str, Any], result: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "protocolVersion": EVALUATION_PROTOCOL_VERSION,
        "sessionId": command.get("sessionId"),
        "requestId": command.get("requestId"),
        "ok": True,
        "result": dict(result),
    }


def _error(command: Mapping[str, Any], code: str, message: str) -> dict[str, Any]:
    return {
        "protocolVersion": EVALUATION_PROTOCOL_VERSION,
        "sessionId": command.get("sessionId"),
        "requestId": command.get("requestId"),
        "ok": False,
        "error": {"code": code, "message": message},
    }


def _finite_array(value: Any) -> bytes:
    array = np.asarray(value, dtype=np.dtype("<f8"))
    return np.ascontiguousarray(array).tobytes()


class EvaluationServer:
    """ZMQ ROUTER + websocket-mirror transport for one native evaluation worker.

    Mirrors ``teleoperation/server.py``'s shape (ROUTER for commands, a websocket server for the
    browser viewport mirror) but implements the ``EvaluationCommandV1`` verbs
    (hello/describe/acquire/reset/step/render/stop/release/ping) instead of teleoperation's, and has no
    recording/episode/state machinery since Evaluate does not record datasets.
    """

    def __init__(
        self,
        session: EvaluationSession,
        *,
        host: str = "127.0.0.1",
        control_port: int = 0,
        stream_port: int = 0,
    ) -> None:
        if host not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("The evaluation transport must bind to loopback.")
        self.session = session
        self.host = host
        self.control_port = control_port
        self.stream_port = stream_port
        self._context: Any = None
        self._router: Any = None
        self._websocket_server: Any = None
        self._websockets: set[Any] = set()
        self._stop_event: asyncio.Event | None = None
        self._last_request_ids: dict[bytes, int] = {}
        self._stream_sequence = 0
        self.endpoints: dict[str, str] = {}

    async def run(self) -> None:
        try:
            import zmq
            import zmq.asyncio
        except ImportError as error:
            raise EvaluationTransportError(
                "Evaluate requires pyzmq. Install the 'teleoperation' Python extra."
            ) from error

        self._context = zmq.asyncio.Context()
        self._router = self._context.socket(zmq.ROUTER)
        self._router.setsockopt(zmq.LINGER, 0)
        self._router.setsockopt(zmq.RCVHWM, 100)
        self._router.setsockopt(zmq.SNDHWM, 100)
        self._router.bind(f"tcp://{self.host}:{self.control_port}")
        self.endpoints["control"] = self._router.getsockopt_string(zmq.LAST_ENDPOINT)

        try:
            from websockets.asyncio.server import serve
        except ModuleNotFoundError as error:
            raise EvaluationTransportError(
                "Evaluate requires the websockets Python dependency."
            ) from error
        self._websocket_server = await serve(
            self._accept_websocket, self.host, self.stream_port, max_size=16 * 1024 * 1024
        )
        websocket_port = int(self._websocket_server.sockets[0].getsockname()[1])
        self.endpoints["stream"] = f"ws://{self.host}:{websocket_port}"

        self._stop_event = asyncio.Event()
        self._emit_ready()
        try:
            while not self._stop_event.is_set():
                frames = await receive_request(self._router, timeout_ms=100)
                if frames is None:
                    self.session.expire_stale_lease()
                    continue
                if len(frames) < 2:
                    continue
                identity = frames[0]
                response = await self._handle(identity, frames[-1])
                await self._router.send_multipart([identity, _json(response[0])])
                for attachment in response[1]:
                    await self._router.send_multipart([identity, attachment])
                await self._broadcast_stream()
        finally:
            await self._close_websockets()
            self._websocket_server.close()
            await self._websocket_server.wait_closed()
            self._router.close(0)
            self._context.term()

    def stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()

    def _emit_ready(self) -> None:
        print(
            json.dumps(
                {
                    "event": "ready",
                    "sessionId": self.session.session_id,
                    "endpoints": self.endpoints,
                    "pid": os.getpid(),
                },
                separators=(",", ":"),
            ),
            flush=True,
        )

    async def _accept_websocket(self, websocket: Any) -> None:
        self._websockets.add(websocket)
        try:
            await websocket.wait_closed()
        finally:
            self._websockets.discard(websocket)

    async def _broadcast_stream(self) -> None:
        if not self._websockets:
            return
        try:
            environment = self.session.environment
            qpos = _finite_array(environment.data.qpos)
            qvel = _finite_array(environment.data.qvel)
            ctrl = _finite_array(environment.data.ctrl)
            model = environment.model
            episode = self.session.episode_summary()
        except Exception:
            return
        self._stream_sequence += 1
        header = _json(
            {
                "protocolVersion": EVALUATION_PROTOCOL_VERSION,
                "messageType": "snapshot",
                "sessionId": self.session.session_id,
                "sceneId": self.session.scene_id,
                "sceneFingerprint": self.session.scene_fingerprint,
                "sequence": self._stream_sequence,
                "dimensions": {"nq": model.nq, "nv": model.nv, "nu": model.nu},
                "simulationTime": float(environment.data.time),
                "attachments": [
                    {"name": "qpos", "kind": "qpos", "byteLength": len(qpos)},
                    {"name": "qvel", "kind": "qvel", "byteLength": len(qvel)},
                    {"name": "ctrl", "kind": "ctrl", "byteLength": len(ctrl)},
                ],
                **({"episode": episode} if episode is not None else {}),
            }
        ).decode("utf-8")
        stale: list[Any] = []
        for websocket in tuple(self._websockets):
            try:
                await asyncio.wait_for(websocket.send(header), timeout=0.05)
                for attachment in (qpos, qvel, ctrl):
                    await asyncio.wait_for(websocket.send(attachment), timeout=0.05)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            self._websockets.discard(websocket)

    async def _close_websockets(self) -> None:
        for websocket in tuple(self._websockets):
            try:
                await asyncio.wait_for(websocket.close(), timeout=0.1)
            except Exception:
                pass
        self._websockets.clear()

    async def _handle(self, identity: bytes, raw: bytes) -> tuple[dict[str, Any], list[bytes]]:
        if len(raw) > EVALUATION_MAX_COMMAND_BYTES:
            return _error({}, "MALFORMED_COMMAND", "Command exceeds the 1 MiB limit."), []
        try:
            command = _as_command(raw)
        except EvaluationTransportError as error:
            return _error({}, "MALFORMED_COMMAND", str(error)), []
        try:
            self._validate_command(identity, command)
            result, attachments = self._dispatch(identity, command)
            return _success(command, result), attachments
        except EvaluationTransportError as error:
            return _error(command, "MALFORMED_COMMAND", str(error)), []
        except EvaluationSessionError as error:
            return _error(command, error.code, str(error)), []
        except Exception as error:  # noqa: BLE001 - transport must return structured failures.
            return _error(command, "TRANSPORT_ERROR", f"{type(error).__name__}: {error}"), []

    def _validate_command(self, identity: bytes, command: Mapping[str, Any]) -> None:
        if command.get("protocolVersion") != EVALUATION_PROTOCOL_VERSION:
            raise EvaluationTransportError("protocolVersion must be 1.")
        request_id = command.get("requestId")
        if not isinstance(request_id, int) or isinstance(request_id, bool) or request_id < 1:
            raise EvaluationTransportError("requestId must be a positive integer.")
        previous = self._last_request_ids.get(identity, 0)
        if request_id <= previous:
            raise EvaluationTransportError("requestId must increase for each connection.")
        self._last_request_ids[identity] = request_id
        if not isinstance(command.get("command"), str) or not command["command"]:
            raise EvaluationTransportError("command is required.")

    def _dispatch(self, identity: bytes, command: Mapping[str, Any]) -> tuple[dict[str, Any], list[bytes]]:
        kind = command["command"]
        if kind == "hello":
            versions = command.get("supportedVersions")
            if not isinstance(versions, list) or EVALUATION_PROTOCOL_VERSION not in versions:
                raise EvaluationTransportError("supportedVersions must include version 1.")
            return {
                "kind": "hello",
                "backend": "native-worker",
                "supportedVersions": [EVALUATION_PROTOCOL_VERSION],
            }, []
        if kind == "describe":
            return {"kind": "describe", "description": self.session.describe()}, []
        if kind == "acquire":
            scene_fingerprint = command.get("sceneFingerprint")
            if scene_fingerprint and scene_fingerprint != self.session.scene_fingerprint:
                raise EvaluationSessionError(
                    "SCENE_CHANGED", "The connected scene fingerprint is stale."
                )
            lease_id = self.session.acquire(identity)
            return {
                "kind": "acquire",
                "leaseId": lease_id,
                "description": self.session.describe(),
            }, []
        if kind == "reset":
            seed = command.get("seed")
            result, attachments = self.session.reset(
                identity,
                seed,
                request_id=int(command["requestId"]),
            )
            return {"kind": "reset", **result}, attachments
        if kind == "step":
            episode_id = command.get("episodeId")
            action = command.get("action")
            if not isinstance(episode_id, str) or not episode_id:
                raise EvaluationTransportError("episodeId is required.")
            if not isinstance(action, list):
                raise EvaluationTransportError("action must be an array.")
            result, attachments = self.session.step(
                identity,
                episode_id,
                action,
                command.get("physicsSteps"),
                request_id=int(command["requestId"]),
            )
            return {"kind": "step", **result}, attachments
        if kind == "render":
            cameras = command.get("cameras")
            if cameras is not None and (
                not isinstance(cameras, list) or not all(isinstance(name, str) and name for name in cameras)
            ):
                raise EvaluationTransportError("cameras must be an array of camera output names.")
            result, attachments = self.session.render(cameras, request_id=int(command["requestId"]))
            return {"kind": "render", **result}, attachments
        if kind == "stop":
            self.session.stop(identity)
            return {"kind": "stop", "stopped": True}, []
        if kind == "release":
            self.session.release(identity)
            return {"kind": "release", "released": True}, []
        if kind == "ping":
            if self.session.status in {"acquired", "episode-active"}:
                self.session.ping(identity)
            return {"kind": "ping", "serverTime": time.time()}, []
        raise EvaluationTransportError(f"Unsupported command '{kind}'.")
