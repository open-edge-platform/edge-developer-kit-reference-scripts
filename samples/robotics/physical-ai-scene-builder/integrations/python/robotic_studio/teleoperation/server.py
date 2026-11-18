# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
import io
import json
import os
import threading
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from ..generation.batch import (
    BatchJob,
    BatchRunner,
    BatchWorkerContext,
    CollectionLock,
    build_batch_plan,
    cleanup_stale_staging,
    cpu_count,
    idle_batch_status as _idle_batch_status,
    run_so101_attempt,
)
from ..generation.native_env import NativeActionError
from ..generation.randomization import derive_seed
from ..zmq_transport import receive_request
from ..evaluation.server import EvaluationServer, _error as evaluation_error
from ..evaluation.session import EvaluationSession, EvaluationSessionError
from .evaluation import SharedEvaluationControl
from .session import (
    TeleoperationLeaseError,
    TeleoperationRecordingError,
    TeleoperationSession,
    TeleoperationSessionError,
    TeleoperationStateDeletionError,
    TeleoperationStateError,
)


class TeleoperationTransportError(RuntimeError):
    pass


class TeleoperationCommandRejected(TeleoperationSessionError):
    """A command that is valid but not allowed right now; carries its protocol error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


_BROWSER_STREAM_ATTACHMENT_KINDS = frozenset({"qpos", "qvel", "ctrl"})
# Commands rejected with BATCH_ACTIVE while a batch job owns the collection.
_BATCH_BLOCKED_COMMANDS = frozenset(
    {
        "acquire",
        "step",
        "reset",
        "record.start",
        "record.stop",
        "record.save",
        "record.discard",
        "episode.update",
        "episode.delete",
        "state.append",
        "states.import",
        "state.select",
        "state.delete",
    }
)
# Commands rejected with SAVE_IN_PROGRESS while record.save encodes off the event loop.
_SAVE_BLOCKED_COMMANDS = frozenset(
    {
        "record.start",
        "record.stop",
        "record.save",
        "record.discard",
        "episode.update",
        "episode.delete",
        "state.append",
        "states.import",
        "state.select",
        "state.delete",
        "batch.start",
    }
)
# Commands the Node administrator may send without a lease.
_ADMIN_COMMANDS = frozenset(
    {
        "record.start",
        "record.stop",
        "record.save",
        "record.discard",
        "episode.update",
        "episode.delete",
        "state.append",
        "states.import",
        "state.select",
        "state.delete",
        "session.shutdown",
        "batch.start",
        "batch.cancel",
        "evaluation.configure",
        "stream.stop",
    }
)
BATCH_CONTROLLERS = frozenset({"so101-pick-place"})
MAX_BATCH_EPISODES_PER_STATE = 1_000
BATCH_STATUS_PUBLISH_INTERVAL_SECONDS = 0.5
# Previews are throttled to streamHz; allow some scheduling jitter so a tick is not skipped.
PREVIEW_INTERVAL_TOLERANCE = 0.9

BatchWorkerFactory = Callable[[Path], tuple[Callable[..., Any], Mapping[str, Any]]]


def _json(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _response(
    command: Mapping[str, Any],
    result: Mapping[str, Any],
    session_id: str,
) -> dict[str, Any]:
    return {
        "protocolVersion": 1,
        "sessionId": session_id,
        "clientId": command.get("clientId"),
        "requestId": command.get("requestId"),
        "ok": True,
        "result": dict(result),
    }


def _error(
    command: Mapping[str, Any],
    code: str,
    message: str,
    session_id: str,
    details: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    value: dict[str, Any] = {
        "protocolVersion": 1,
        "sessionId": session_id,
        "clientId": command.get("clientId"),
        "requestId": command.get("requestId"),
        "ok": False,
        "error": {"code": code, "message": message},
    }
    if details:
        value["error"]["details"] = dict(details)
    return value


def _as_command(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise TeleoperationTransportError("Command must be a UTF-8 JSON object.") from error
    if not isinstance(value, dict):
        raise TeleoperationTransportError("Command must be a JSON object.")
    return value


def _finite_array(value: Any, dtype: str = "<f8") -> bytes:
    array = np.asarray(value, dtype=np.dtype(dtype))
    if not np.all(np.isfinite(array)):
        raise TeleoperationTransportError("Stream arrays must contain finite values.")
    return np.ascontiguousarray(array).tobytes()


def _jpeg(value: Any) -> bytes:
    try:
        from PIL import Image
    except ImportError as error:
        raise TeleoperationTransportError("RGB streaming requires Pillow.") from error
    array = np.asarray(value, dtype=np.uint8)
    if array.ndim != 3 or array.shape[2] != 3:
        raise TeleoperationTransportError("RGB frames must use uint8 HWC shape.")
    stream = io.BytesIO()
    with Image.fromarray(array, mode="RGB") as image:
        image.save(stream, format="JPEG", quality=85, optimize=True)
    return stream.getvalue()


def _browser_stream_parts(
    header: Mapping[str, Any], attachments: tuple[bytes, ...]
) -> tuple[dict[str, Any], tuple[bytes, ...]]:
    descriptors = header.get("attachments")
    if not isinstance(descriptors, list) or len(descriptors) != len(attachments):
        return dict(header), attachments
    selected = [
        (descriptor, attachment)
        for descriptor, attachment in zip(descriptors, attachments, strict=True)
        if isinstance(descriptor, Mapping)
        and descriptor.get("kind") in _BROWSER_STREAM_ATTACHMENT_KINDS
    ]
    return (
        {**header, "attachments": [descriptor for descriptor, _ in selected]},
        tuple(attachment for _, attachment in selected),
    )


class TeleoperationServer:
    def __init__(
        self,
        session: TeleoperationSession,
        *,
        host: str = "127.0.0.1",
        control_port: int = 0,
        publisher_port: int = 0,
        stream_port: int = 0,
        collection_lock: Any | None = None,
        batch_worker_factory: BatchWorkerFactory | None = None,
    ) -> None:
        """Create the worker transport.

        ``collection_lock`` is the owner's already-held collection lock (the worker CLI takes it
        at startup); without it, ``batch.start`` takes the lock for the duration of the job.
        ``batch_worker_factory(job_staging_root)`` returns the picklable attempt function and its
        keyword arguments (default: the SO-101 pick-and-place attempt on the session's scene).
        """
        if host not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("Teleoperation transport must bind to loopback.")
        self.session = session
        self.host = host
        self.control_port = control_port
        self.publisher_port = publisher_port
        self.stream_port = stream_port
        self._context: Any = None
        self._router: Any = None
        self._publisher: Any = None
        self._websocket_server: Any = None
        self._websockets: set[Any] = set()
        self._stop_event: asyncio.Event | None = None
        # stop() may arrive before run() has created its event (for example during startup).
        self._stop_requested = False
        self._publish_lock: asyncio.Lock | None = None
        self._broadcast_queue: asyncio.Queue[tuple[dict[str, Any], tuple[bytes, ...]]] | None = None
        self._sequence = 0
        self._dropped_messages = 0
        self._last_preview_render_at: float | None = None
        # Lease whose holder asked for camera previews on the PUB stream (acquire includeImages).
        self._preview_lease_id: str | None = None
        self._last_request_ids: dict[str, int] = {}
        self._identity_clients: dict[bytes, str] = {}
        self._background_requests: set[asyncio.Task[None]] = set()
        self._save_in_progress = False
        self._collection_lock = collection_lock
        self._batch_worker_factory = batch_worker_factory
        self._batch_task: asyncio.Task[None] | None = None
        self._batch_cancel_event = threading.Event()
        self._batch_job: Any = None
        self._batch_status: dict[str, Any] = _idle_batch_status()
        self._batch_status_published_at = 0.0
        self._latest_stream: tuple[dict[str, Any], tuple[bytes, ...]] | None = None
        self.endpoints: dict[str, str] = {}
        self._evaluation_server: EvaluationServer | None = None
        self._evaluation_profile = {
            **session.profile,
            "baseline": {"kind": "model-default"},
            "randomization": [],
            "actionRangePolicy": "clip",
        }

    def _evaluation(self) -> EvaluationServer:
        if self._evaluation_server is None:
            self._evaluation_server = EvaluationServer(
                EvaluationSession(
                    self.session.environment,
                    self._evaluation_profile,
                    session_id=self.session.session_id,
                    scene_id=self.session.collection.scene_id,
                    scene_fingerprint=self.session.collection.scene_fingerprint,
                    profile_id="runtime-policy",
                    control=SharedEvaluationControl(self.session),
                )
            )
        return self._evaluation_server

    @property
    def batch_active(self) -> bool:
        return self._batch_task is not None and not self._batch_task.done()

    @property
    def batch_status(self) -> dict[str, Any]:
        status = self._batch_job.status if self._batch_job is not None else self._batch_status
        return json.loads(json.dumps(status))

    @property
    def dropped_messages(self) -> int:
        return self._dropped_messages

    async def run(self) -> None:
        try:
            import zmq
            import zmq.asyncio
        except ImportError as error:
            raise TeleoperationTransportError(
                "Teleoperation requires pyzmq. Install the 'teleoperation' Python extra."
            ) from error

        self._context = zmq.asyncio.Context()
        self._router = self._context.socket(zmq.ROUTER)
        self._publisher = self._context.socket(zmq.PUB)
        for socket in (self._router, self._publisher):
            socket.setsockopt(zmq.LINGER, 0)
        self._router.setsockopt(zmq.RCVHWM, 100)
        self._router.setsockopt(zmq.SNDHWM, 100)
        self._publisher.setsockopt(zmq.SNDHWM, 2)
        self._router.bind(f"tcp://{self.host}:{self.control_port}")
        self._publisher.bind(f"tcp://{self.host}:{self.publisher_port}")
        self.endpoints["control"] = self._router.getsockopt_string(zmq.LAST_ENDPOINT)
        self.endpoints["publisher"] = self._publisher.getsockopt_string(zmq.LAST_ENDPOINT)
        try:
            from websockets.asyncio.server import serve
        except ModuleNotFoundError as error:
            raise TeleoperationTransportError(
                "Teleoperation requires the websockets Python dependency."
            ) from error
        self._websocket_server = await serve(
            self._accept_websocket,
            self.host,
            self.stream_port,
            max_size=16 * 1024 * 1024,
        )
        websocket_socket = self._websocket_server.sockets[0]
        websocket_port = int(websocket_socket.getsockname()[1])
        self.endpoints["stream"] = f"ws://{self.host}:{websocket_port}"
        self._stop_event = asyncio.Event()
        if self._stop_requested:
            self._stop_event.set()
        self._publish_lock = asyncio.Lock()
        self._broadcast_queue = asyncio.Queue(maxsize=1)
        await self.publish_snapshot()
        self._emit_ready()
        stream_task = asyncio.create_task(self._stream_loop())
        broadcast_task = asyncio.create_task(self._broadcast_loop())
        try:
            while not self._stop_event.is_set():
                frames = await receive_request(self._router, timeout_ms=100)
                if frames is None:
                    continue
                if len(frames) < 2:
                    continue
                identity = frames[0]
                payload = frames[-1]
                try:
                    evaluation_command = _as_command(payload)
                except TeleoperationTransportError:
                    evaluation_command = {}
                if evaluation_command and "clientId" not in evaluation_command:
                    if self.batch_active or self._save_in_progress:
                        code = "BATCH_ACTIVE" if self.batch_active else "SAVE_IN_PROGRESS"
                        response, attachments = evaluation_error(
                            evaluation_command, code, "The collection is busy."
                        ), []
                    else:
                        try:
                            evaluator = self._evaluation()
                            evaluator.session.expire_stale_lease()
                            response, attachments = await evaluator._handle(identity, payload)
                        except EvaluationSessionError as error:
                            response, attachments = evaluation_error(
                                evaluation_command, error.code, str(error)
                            ), []
                    await self._router.send_multipart([identity, _json(response)])
                    for attachment in attachments:
                        await self._router.send_multipart([identity, attachment])
                    await self.publish_snapshot()
                    continue
                try:
                    background_save = _as_command(payload).get("command") == "record.save"
                except TeleoperationTransportError:
                    background_save = False
                if background_save and not self._save_in_progress and not self.batch_active:
                    # Claim the save before yielding so no other collection command interleaves
                    # with the encode thread; _handle_save releases the claim.
                    self._save_in_progress = True
                    task = asyncio.create_task(self._handle_save(identity, payload))
                    self._background_requests.add(task)
                    task.add_done_callback(self._background_requests.discard)
                    continue
                response = await self._handle(identity, payload)
                await self._router.send_multipart([identity, _json(response)])
        finally:
            if self._background_requests:
                await asyncio.gather(*self._background_requests, return_exceptions=True)
            await self._stop_batch()
            stream_task.cancel()
            broadcast_task.cancel()
            await asyncio.gather(stream_task, broadcast_task, return_exceptions=True)
            await self._close_websockets()
            self._websocket_server.close()
            await self._websocket_server.wait_closed()
            self._router.close(0)
            self._publisher.close(0)
            self._context.term()

    async def _handle_save(self, identity: bytes, payload: bytes) -> None:
        try:
            response = await self._handle(identity, payload, save_claimed=True)
        finally:
            self._save_in_progress = False
        if self._router is not None:
            await self._router.send_multipart([identity, _json(response)])

    def stop(self) -> None:
        self._stop_requested = True
        if self._stop_event is not None:
            self._stop_event.set()

    def _emit_ready(self) -> None:
        print(
            json.dumps(
                {
                    "event": "ready",
                    "sessionId": self.session.session_id,
                    "collectionId": self.session.collection_id,
                    "endpoints": self.endpoints,
                    "pid": os.getpid(),
                },
                separators=(",", ":"),
            ),
            flush=True,
        )

    async def _stream_loop(self) -> None:
        configured_hz = self.session.profile.get("streamHz", 30)
        try:
            stream_hz = min(120.0, max(1.0, float(configured_hz)))
        except (TypeError, ValueError):
            stream_hz = 30.0
        interval = 1.0 / stream_hz
        while True:
            started = time.monotonic()
            if not self._save_in_progress:
                # A long record.save blocks the client's heartbeat behind its own request.
                self.session.expire_stale_lease()
            await self.publish_snapshot(preview=True)
            remaining = interval - (time.monotonic() - started)
            await asyncio.sleep(max(0.0, remaining))

    async def publish_snapshot(self, *, preview: bool = False) -> None:
        if self._publisher is None:
            return
        if self._publish_lock is None:
            await self._publish_snapshot(preview=preview)
            return
        async with self._publish_lock:
            await self._publish_snapshot(preview=preview)

    def _previews_requested(self) -> bool:
        """True while the current lease holder opted in to camera previews (acquire includeImages)."""
        if self._preview_lease_id is None:
            return False
        if self._preview_lease_id != self.session.active_lease_id:
            self._preview_lease_id = None
            return False
        return True

    async def _publish_snapshot(self, *, preview: bool = False) -> None:
        include_preview = False
        if (
            preview
            and bool(self.session.profile.get("captureRgb", False))
            and self._previews_requested()
            and not self.batch_active
        ):
            configured_hz = self.session.profile.get("streamHz", 30)
            try:
                stream_hz = min(120.0, max(1.0, float(configured_hz)))
            except (TypeError, ValueError):
                stream_hz = 30.0
            now = time.monotonic()
            last = self._last_preview_render_at
            if last is None or now - last >= PREVIEW_INTERVAL_TOLERANCE / stream_hz:
                self.session.render_preview()
                self._last_preview_render_at = now
                include_preview = True
        snapshot = self.session.snapshot()
        episode = (
            self._evaluation_server.session.episode_summary()
            if self._evaluation_server is not None
            else None
        )
        self._sequence += 1
        attachments: list[bytes] = []
        descriptors: list[dict[str, Any]] = []

        def add_array(name: str, kind: str, value: Any, shape: list[int] | None = None) -> None:
            payload = _finite_array(value)
            array = np.asarray(value)
            descriptors.append(
                {
                    "name": name,
                    "kind": kind,
                    "dtype": "float64",
                    "shape": shape or [int(size) for size in array.shape],
                    "byteLength": len(payload),
                    "encoding": "raw-le",
                }
            )
            attachments.append(payload)

        add_array("qpos", "qpos", snapshot["qpos"])
        add_array("qvel", "qvel", snapshot["qvel"])
        add_array("ctrl", "ctrl", snapshot["ctrl"])
        body_names = sorted(snapshot["bodyPositions"])
        add_array(
            "body-position",
            "body-position",
            [snapshot["bodyPositions"][name] for name in body_names],
            [len(body_names), 3],
        )
        add_array(
            "body-quaternion",
            "body-quaternion",
            [snapshot["bodyQuaternions"][name] for name in body_names],
            [len(body_names), 4],
        )
        if include_preview:
            for name in sorted(snapshot["images"]):
                image = snapshot["images"][name]
                payload = _jpeg(image)
                descriptors.append(
                    {
                        "name": name,
                        "kind": "camera",
                        "dtype": "uint8",
                        "shape": [int(size) for size in np.asarray(image).shape],
                        "byteLength": len(payload),
                        "encoding": "jpeg",
                    }
                )
                attachments.append(payload)

        header: dict[str, Any] = {
            "protocolVersion": 1,
            "messageType": "state",
            "sessionId": self.session.session_id,
            "collectionId": self.session.collection_id,
            "sceneId": self.session.collection.scene_id,
            "sceneFingerprint": self.session.collection.scene_fingerprint,
            "sequence": self._sequence,
            "stepId": snapshot["stepId"],
            "stateRevision": snapshot["stateRevision"],
            "stateId": snapshot["stateId"],
            "recording": "recording" if snapshot["recording"] else "idle",
            "wallTime": datetime.now(timezone.utc).isoformat(),
            "simulationTime": snapshot["simulationTime"],
            "dimensions": {
                "nq": len(snapshot["qpos"]),
                "nv": len(snapshot["qvel"]),
                "nu": len(snapshot["ctrl"]),
                "nbody": len(body_names),
            },
            "bodyNames": body_names,
            "state": snapshot["state"],
            "action": snapshot["action"],
            "attachments": descriptors,
            "droppedMessages": self._dropped_messages,
        }
        if snapshot["episodeId"] is not None:
            header["episodeId"] = snapshot["episodeId"]
        if episode is not None:
            header["episode"] = episode
        backdrop_status = self.session.backdrop_render_status
        if backdrop_status != "inactive":
            header["backdropRenderStatus"] = backdrop_status
            header["backdropDeferredFrames"] = self.session.backdrop_deferred_frames
        self._latest_stream = header, tuple(attachments)
        topic = f"teleop.state.v1.{self.session.session_id}".encode("utf-8")
        try:
            import zmq

            await self._publisher.send_multipart([topic, _json(header), *attachments], flags=zmq.NOBLOCK)
        except Exception as error:
            try:
                import zmq

                if isinstance(error, zmq.Again):
                    self._dropped_messages += 1
                    return
            except ImportError:
                pass
            raise
        if self._broadcast_queue is not None:
            if self._broadcast_queue.full():
                try:
                    self._broadcast_queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                self._broadcast_queue.put_nowait((header, tuple(attachments)))
            except asyncio.QueueFull:
                self._dropped_messages += 1

    async def _broadcast_loop(self) -> None:
        if self._broadcast_queue is None:
            return
        while True:
            header, attachments = await self._broadcast_queue.get()
            try:
                await self._broadcast(header, attachments)
            finally:
                self._broadcast_queue.task_done()

    async def _accept_websocket(self, websocket: Any) -> None:
        try:
            if self._latest_stream is not None:
                await self._send_websocket(websocket, *self._latest_stream)
            self._websockets.add(websocket)
            await websocket.wait_closed()
        finally:
            self._websockets.discard(websocket)

    async def _send_websocket(
        self,
        websocket: Any,
        header: Mapping[str, Any],
        attachments: tuple[bytes, ...],
    ) -> None:
        browser_header, browser_attachments = _browser_stream_parts(header, attachments)
        await asyncio.wait_for(websocket.send(_json(browser_header).decode("utf-8")), timeout=0.05)
        for attachment in browser_attachments:
            await asyncio.wait_for(websocket.send(attachment), timeout=0.05)

    async def _broadcast(self, header: Mapping[str, Any], attachments: tuple[bytes, ...]) -> None:
        stale: list[Any] = []
        for websocket in tuple(self._websockets):
            try:
                await self._send_websocket(websocket, header, attachments)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            self._websockets.discard(websocket)
            try:
                await asyncio.wait_for(websocket.close(), timeout=0.1)
            except Exception:
                pass

    async def _close_websockets(self) -> None:
        for websocket in tuple(self._websockets):
            try:
                await asyncio.wait_for(websocket.close(), timeout=0.1)
            except Exception:
                pass
        self._websockets.clear()

    async def _handle(self, identity: bytes, raw: bytes, *, save_claimed: bool = False) -> dict[str, Any]:
        try:
            command = _as_command(raw)
        except TeleoperationTransportError as error:
            return _error({}, "MALFORMED_COMMAND", str(error), self.session.session_id)
        try:
            self._validate_command(identity, command)
            result = await self._dispatch(identity, command, save_claimed=save_claimed)
            return _response(command, result, self.session.session_id)
        except TeleoperationTransportError as error:
            return _error(command, "MALFORMED_COMMAND", str(error), self.session.session_id)
        except TeleoperationCommandRejected as error:
            return _error(command, error.code, str(error), self.session.session_id)
        except TeleoperationLeaseError as error:
            code = "LEASE_REQUIRED" if not command.get("leaseId") else "LEASE_INVALID"
            return _error(command, code, str(error), self.session.session_id)
        except TeleoperationStateDeletionError as error:
            return _error(command, "STATE_DELETE_FORBIDDEN", str(error), self.session.session_id)
        except TeleoperationStateError as error:
            message = str(error)
            code = "STATE_REVISION_STALE" if "revision" in message else "STATE_NOT_FOUND"
            if "cannot" in message:
                code = "STATE_CHANGE_DURING_RECORDING"
            return _error(command, code, message, self.session.session_id)
        except TeleoperationRecordingError as error:
            message = str(error)
            code = "RECORDING_ALREADY_ACTIVE" if "already" in message else "RECORDING_NOT_ACTIVE"
            return _error(command, code, message, self.session.session_id)
        except NativeActionError as error:
            message = str(error)
            code = "TARGET_NON_FINITE" if "finite" in message else "TARGET_OUT_OF_RANGE"
            if "unknown" in message or "match" in message:
                code = "TARGET_INCOMPLETE"
            return _error(command, code, message, self.session.session_id)
        except TeleoperationSessionError as error:
            return _error(command, "TRANSPORT_ERROR", str(error), self.session.session_id)
        except Exception as error:  # noqa: BLE001 - transport must return structured failures.
            return _error(
                command,
                "TRANSPORT_ERROR",
                f"{type(error).__name__}: {error}",
                self.session.session_id,
            )

    def _validate_command(self, identity: bytes, command: Mapping[str, Any]) -> None:
        if command.get("protocolVersion") != 1:
            raise TeleoperationTransportError("protocolVersion must be 1.")
        client_id = command.get("clientId")
        if not isinstance(client_id, str) or not client_id:
            raise TeleoperationTransportError("clientId must be a non-empty string.")
        request_id = command.get("requestId")
        if not isinstance(request_id, int) or isinstance(request_id, bool) or request_id < 1:
            raise TeleoperationTransportError("requestId must be a positive integer.")
        known_client = self._identity_clients.get(identity)
        if known_client is not None and known_client != client_id:
            raise TeleoperationTransportError("The socket identity is already bound to another client.")
        self._identity_clients[identity] = client_id
        previous_request_id = self._last_request_ids.get(client_id, 0)
        if request_id <= previous_request_id:
            raise TeleoperationTransportError("requestId must increase for each client.")
        self._last_request_ids[client_id] = request_id
        if not isinstance(command.get("command"), str) or not command["command"]:
            raise TeleoperationTransportError("command is required.")

    async def _dispatch(
        self,
        identity: bytes,
        command: Mapping[str, Any],
        *,
        save_claimed: bool = False,
    ) -> dict[str, Any]:
        del identity
        client_id = str(command["clientId"])
        kind = command["command"]
        if kind == "hello":
            versions = command.get("supportedVersions")
            if not isinstance(versions, list) or 1 not in versions:
                raise TeleoperationTransportError("supportedVersions must include version 1.")
            return {"kind": "hello", "supportedVersions": [1]}
        if kind == "describe":
            return {
                "kind": "describe",
                **self.session.describe(),
                "streamClients": len(self._websockets),
                "cpuCount": cpu_count(),
                "batch": self.batch_status,
                "evaluationProfile": self._evaluation_profile,
            }
        if kind in {"evaluation.configure", "stream.stop"}:
            if client_id != "node-admin":
                raise TeleoperationCommandRejected("LEASE_REQUIRED", "Administrator access is required.")
            if self.batch_active or self._save_in_progress:
                raise TeleoperationCommandRejected("BATCH_ACTIVE", "The collection is busy.")
            if kind == "stream.stop":
                if self.session.recording:
                    self.session.stop_recording("node-admin", admin=True)
                self.session.revoke_control()
                if self._evaluation_server is not None:
                    self._evaluation_server.session.invalidate()
                    self._evaluation_server = None
                return {"kind": kind, "stopped": True}
            profile = command.get("profile")
            if not isinstance(profile, Mapping):
                raise TeleoperationTransportError("An evaluation profile is required.")
            profile = {
                **self.session.profile,
                "baseline": {"kind": "model-default"},
                "randomization": [],
                "actionRangePolicy": "clip",
                **profile,
            }
            if profile == self._evaluation_profile:
                return {"kind": kind, "profile": self._evaluation_profile}
            if self.session.active_lease_id is not None or self.session.recording:
                raise TeleoperationCommandRejected(
                    "ALREADY_ACQUIRED", "Stop external control before changing the evaluation task."
                )
            evaluator = EvaluationSession(
                self.session.environment, profile,
                session_id=self.session.session_id,
                scene_id=self.session.collection.scene_id,
                scene_fingerprint=self.session.collection.scene_fingerprint,
                profile_id="runtime-policy", control=SharedEvaluationControl(self.session),
            )
            self._evaluation_profile = profile
            self._evaluation_server = EvaluationServer(evaluator)
            return {"kind": kind, "profile": profile}
        if kind == "batch.status":
            return {"kind": "batch.status", "batch": self.batch_status}
        if kind in _BATCH_BLOCKED_COMMANDS and self.batch_active:
            raise TeleoperationCommandRejected(
                "BATCH_ACTIVE", "Batch generation is running; wait for it to finish or cancel it."
            )
        if (
            kind in _SAVE_BLOCKED_COMMANDS
            and self._save_in_progress
            and not (kind == "record.save" and save_claimed)
        ):
            raise TeleoperationCommandRejected(
                "SAVE_IN_PROGRESS", "A recording is being saved; retry when the save finishes."
            )
        if kind == "acquire":
            if command.get("sceneFingerprint") != self.session.collection.scene_fingerprint:
                raise TeleoperationTransportError("sceneFingerprint does not match the session.")
            include_images = command.get("includeImages", False)
            if not isinstance(include_images, bool):
                raise TeleoperationTransportError("includeImages must be a boolean.")
            lease_id = self.session.acquire(client_id)
            # Camera previews go only to SDK clients that ask for them; the browser stream never
            # carries camera attachments, so nothing is rendered for it.
            self._preview_lease_id = lease_id if include_images else None
            return {
                "kind": "acquire",
                "leaseId": lease_id,
                "stateRevision": self.session.state_revision,
                "includeImages": include_images,
            }
        lease_id = command.get("leaseId")
        admin = client_id == "node-admin" and lease_id is None
        if kind not in _ADMIN_COMMANDS and (not isinstance(lease_id, str) or not lease_id):
            raise TeleoperationLeaseError("A leaseId is required for this command.")
        expected_revision = command.get("expectedStateRevision")
        if expected_revision is not None and (
            not isinstance(expected_revision, int) or isinstance(expected_revision, bool)
        ):
            raise TeleoperationTransportError("expectedStateRevision must be an integer.")
        if kind == "step":
            targets = command.get("targets")
            if not isinstance(targets, dict):
                raise TeleoperationTransportError("targets must be an object.")
            result = self.session.step(
                client_id,
                lease_id,
                targets,
                physics_steps=command.get("physicsSteps"),
                expected_state_revision=expected_revision,
                kinematic_state=command.get("kinematicState"),
            )
            # Step replies are state-only; camera previews follow on the throttled stream.
            await self.publish_snapshot()
            return {"kind": "step", **result}
        if kind == "reset":
            result = self.session.reset(client_id, lease_id, state_id=command.get("stateId"))
            await self.publish_snapshot()
            return {"kind": "reset", **result}
        if kind == "release":
            self.session.release(client_id, lease_id)
            if self._preview_lease_id == lease_id:
                self._preview_lease_id = None
            return {"kind": "release", "released": True}
        if kind == "ping":
            if not isinstance(lease_id, str) or not lease_id:
                raise TeleoperationLeaseError("A leaseId is required for heartbeat.")
            self.session.ping(client_id, lease_id)
            return {"kind": "ping", "serverTime": time.time()}
        if kind == "record.start":
            episode_id = self.session.start_recording(client_id, lease_id, admin=admin)
            await self.publish_snapshot()
            return {"kind": "record.start", "episodeId": episode_id, **(self.session.recording_attempt or {})}
        if kind == "record.stop":
            result = self.session.stop_recording(client_id, lease_id, admin=admin)
            await self.publish_snapshot()
            return {"kind": "record.stop", **result}
        if kind == "record.save":
            metadata = command.get("metadata")
            if metadata is not None and not isinstance(metadata, Mapping):
                raise TeleoperationTransportError("metadata must be an object.")
            claimed_here = not save_claimed
            if claimed_here:
                self._save_in_progress = True
            try:
                # Deferred backdrop frames render here, on the thread that owns the renderers' GL
                # contexts, one frame at a time so the stream (with 'rendering' progress) and
                # heartbeats keep flowing. The encode below then finds nothing left to render.
                while self.session.backdrop_deferred_frames:
                    self.session.render_deferred_frames(client_id, lease_id, admin=admin, limit=1)
                    await asyncio.sleep(0)
                episode = await asyncio.to_thread(
                    self.session.save_recording,
                    client_id,
                    lease_id,
                    admin=admin,
                    metadata=metadata,
                )
            finally:
                if claimed_here:
                    self._save_in_progress = False
            await self.publish_snapshot()
            return {"kind": "record.save", "episode": episode}
        if kind == "record.discard":
            episode_id = self.session.discard_recording(client_id, lease_id, admin=admin)
            await self.publish_snapshot()
            return {"kind": "record.discard", "episodeId": episode_id, "discarded": True}
        if kind in {"batch.start", "batch.cancel"} and not admin:
            # The lease holder may control batches too; validate (and refresh) its lease.
            self.session.ping(client_id, lease_id)  # type: ignore[arg-type]
        if kind == "batch.start":
            return {"kind": "batch.start", "batch": self._start_batch(command)}
        if kind == "batch.cancel":
            if self.batch_active:
                self._batch_cancel_event.set()
                if self._batch_job is not None:
                    self._batch_job.request_cancel()
            return {"kind": "batch.cancel", "batch": self.batch_status}
        if kind == "episode.update":
            episode_id = command.get("episodeId")
            if not isinstance(episode_id, str) or not episode_id:
                raise TeleoperationTransportError("episodeId must be a non-empty string.")
            updates = {
                key: command[key]
                for key in ("name", "notes")
                if key in command
            }
            episode = self.session.update_episode(
                client_id,
                lease_id,
                episode_id,
                updates,
                admin=admin,
            )
            return {"kind": "episode.update", "episode": episode}
        if kind == "episode.delete":
            episode_id = command.get("episodeId")
            if not isinstance(episode_id, str) or not episode_id:
                raise TeleoperationTransportError("episodeId must be a non-empty string.")
            episode = self.session.delete_episode(client_id, lease_id, episode_id, admin=admin)
            await self.publish_snapshot()
            return {"kind": "episode.delete", "episode": episode, "deleted": True}
        if kind == "state.append":
            seed = command.get("seed")
            if not isinstance(seed, int) or isinstance(seed, bool):
                raise TeleoperationTransportError("seed must be an integer.")
            configuration = command.get("sourceRandomization")
            if not isinstance(configuration, Mapping):
                raise TeleoperationTransportError("sourceRandomization must be an object.")
            model_rules = command.get("modelRandomization")
            if model_rules is not None and not isinstance(model_rules, list):
                raise TeleoperationTransportError("modelRandomization must be a list.")
            robot_randomization = command.get("robotRandomization")
            if robot_randomization is not None and not isinstance(robot_randomization, Mapping):
                raise TeleoperationTransportError("robotRandomization must be an object.")
            state = self.session.append_randomized_state(
                client_id,
                lease_id,
                seed,
                source_randomization=configuration,
                model_randomization=model_rules,
                robot_randomization=robot_randomization,
                admin=admin,
            )
            await self.publish_snapshot()
            return {"kind": "state.append", "state": state}
        if kind == "states.import":
            states = command.get("states")
            if not isinstance(states, list):
                raise TeleoperationTransportError("states must be a list.")
            origin = command.get("originCollectionId")
            if not isinstance(origin, str) or not origin:
                raise TeleoperationTransportError("originCollectionId must be a non-empty string.")
            result = self.session.import_states(
                client_id, lease_id, states, origin_collection_id=origin, admin=admin
            )
            await self.publish_snapshot()
            return {"kind": "states.import", **result}
        if kind == "state.select":
            state_id = command.get("stateId")
            if not isinstance(state_id, str) or not state_id:
                raise TeleoperationTransportError("stateId must be a non-empty string.")
            result = self.session.select_state(client_id, lease_id, state_id, admin=admin)
            await self.publish_snapshot()
            return {"kind": "state.select", **result}
        if kind == "state.delete":
            state_id = command.get("stateId")
            if not isinstance(state_id, str) or not state_id:
                raise TeleoperationTransportError("stateId must be a non-empty string.")
            result = self.session.delete_state(client_id, lease_id, state_id, admin=admin)
            await self.publish_snapshot()
            return {"kind": "state.delete", **result}
        if kind == "session.shutdown":
            if not admin:
                raise TeleoperationLeaseError("Only the node administrator may shut down a session.")
            if self.batch_active:
                self._batch_cancel_event.set()
            self.session.interrupt_recording()
            self.stop()
            return {"kind": "session.shutdown", "stopped": True}
        raise TeleoperationTransportError(f"Unsupported command '{kind}'.")

    # --- batch generation -------------------------------------------------------------------

    def _parse_batch_request(self, command: Mapping[str, Any]) -> tuple[list[str], int, int, tuple[int, ...]]:
        state_ids = command.get("stateIds", "all")
        episodes_per_state = command.get("episodesPerState", 1)
        workers = command.get("workers", 1)
        egl_devices = command.get("eglDevices")
        if state_ids != "all" and (
            not isinstance(state_ids, list)
            or not state_ids
            or not all(isinstance(item, str) and item for item in state_ids)
        ):
            raise TeleoperationTransportError("stateIds must be 'all' or a non-empty array of state IDs.")
        if (
            not isinstance(episodes_per_state, int)
            or isinstance(episodes_per_state, bool)
            or not 1 <= episodes_per_state <= MAX_BATCH_EPISODES_PER_STATE
        ):
            raise TeleoperationTransportError(
                f"episodesPerState must be an integer between 1 and {MAX_BATCH_EPISODES_PER_STATE}."
            )
        if not isinstance(workers, int) or isinstance(workers, bool) or workers < 1:
            raise TeleoperationTransportError("workers must be a positive integer.")
        if command.get("controller", "so101-pick-place") not in BATCH_CONTROLLERS:
            raise TeleoperationTransportError("Unsupported batch controller.")
        if egl_devices is not None and (
            not isinstance(egl_devices, list)
            or not all(isinstance(item, int) and not isinstance(item, bool) and item >= 0 for item in egl_devices)
        ):
            raise TeleoperationTransportError("eglDevices must be an array of non-negative integers.")
        collection = self.session.collection
        known = {state.state_id for state in collection.states}
        selected = sorted(known, key=lambda state_id: collection.state(state_id).index) if state_ids == "all" else list(state_ids)
        missing = [state_id for state_id in selected if state_id not in known]
        if missing:
            raise TeleoperationStateError(f"Randomized state '{missing[0]}' was not found.")
        # One process per CPU at most; the pool never exceeds the number of attempts.
        workers = min(workers, cpu_count())
        return selected, episodes_per_state, workers, tuple(egl_devices or ())

    def _default_batch_worker(self, staging_root: Path) -> tuple[Callable[..., Any], Mapping[str, Any]]:
        scene = getattr(self.session.environment, "scene", None)
        if getattr(scene, "bundle", None) is None:
            raise TeleoperationSessionError("Batch generation needs a session built from a scene bundle.")
        context = BatchWorkerContext.for_scene(
            scene,
            self.session.profile,
            collection_dir=self.session.collection.root,
            collection_id=self.session.collection_id,
            staging_root=staging_root,
        )
        return run_so101_attempt, {"context": context}

    def _start_batch(self, command: Mapping[str, Any]) -> dict[str, Any]:
        if self.batch_active:
            raise TeleoperationCommandRejected("BATCH_ACTIVE", "A batch is already running.")
        if self.session.recording or self.session.save_pending or self._save_in_progress:
            raise TeleoperationCommandRejected(
                "RECORDING_ALREADY_ACTIVE",
                "Stop the current recording and save or discard it before starting a batch.",
            )
        state_ids, episodes_per_state, workers, egl_devices = self._parse_batch_request(command)
        temporary_lock: CollectionLock | None = None
        if self._collection_lock is None:
            temporary_lock = CollectionLock(self.session.collection.root)
            try:
                temporary_lock.acquire()
            except RuntimeError as error:
                raise TeleoperationCommandRejected("COLLECTION_LOCKED", str(error)) from error
        try:
            collection = self.session.collection
            dataset_root = collection.root / "dataset"
            cleanup_stale_staging(dataset_root)
            seeds = {state.state_id: state.seed for state in collection.states}
            plan = build_batch_plan(
                state_ids,
                episodes_per_state,
                collection.reserve_recording_indices(len(state_ids) * episodes_per_state),
                lambda state_id, recording_index: derive_seed(seeds[state_id], recording_index),
            )
            workers = min(workers, len(plan))
            job = BatchJob(collection=collection, plan=plan, dataset_root=dataset_root, workers=workers)
            runner = BatchRunner(workers=workers, staging_root=dataset_root / "staging", job_id=job.job_id)
            factory = self._batch_worker_factory or self._default_batch_worker
            worker, arguments = factory(runner.staging_root)
            self._batch_cancel_event = threading.Event()
            self._batch_job = job
            self._batch_task = asyncio.create_task(
                self._execute_batch(job, runner, worker, arguments, egl_devices, temporary_lock)
            )
        except BaseException:
            if temporary_lock is not None:
                temporary_lock.release()
            raise
        return self.batch_status

    async def _execute_batch(
        self,
        job: BatchJob,
        runner: BatchRunner,
        worker: Callable[..., Any],
        arguments: Mapping[str, Any],
        egl_devices: tuple[int, ...],
        temporary_lock: CollectionLock | None,
    ) -> None:
        """Run the pool on a thread and commit outcomes on the event loop, in plan order."""
        loop = asyncio.get_running_loop()
        events: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
        cancel_event = self._batch_cancel_event
        error: str | None = None
        result = None

        def post(kind: str, value: Any) -> None:
            loop.call_soon_threadsafe(events.put_nowait, (kind, value))

        def handle(kind: str, value: Any) -> None:
            nonlocal error
            if kind == "progress":
                job.progress(value)
                return
            try:
                committed = job.resolve(value)
            except Exception as failure:  # noqa: BLE001 - a commit failure stops the job.
                error = f"Commit failed: {type(failure).__name__}: {failure}"
                cancel_event.set()
                return
            if committed:
                self._batch_status_published_at = 0.0

        runner_future = asyncio.ensure_future(
            asyncio.to_thread(
                runner.run,
                job.plan,
                worker,
                worker_arguments=arguments,
                cancel_event=cancel_event,
                on_progress=lambda value: post("progress", value),
                on_outcome=lambda value: post("outcome", value),
                egl_devices=egl_devices,
            )
        )
        try:
            try:
                while True:
                    while not events.empty():
                        handle(*events.get_nowait())
                    if runner_future.done():
                        break
                    await self._publish_batch_status()
                    await asyncio.wait({runner_future}, timeout=0.1)
                result = runner_future.result()
            except asyncio.CancelledError:
                cancel_event.set()
                await asyncio.wait({runner_future})
                raise
            except Exception as failure:  # noqa: BLE001 - reported in the batch status.
                error = error or f"{type(failure).__name__}: {failure}"
        finally:
            # Outcomes resolved before the runner returned are already queued.
            while not events.empty():
                handle(*events.get_nowait())
            self._batch_status = job.finish(result, error=error)
            self._batch_job = None
            if temporary_lock is not None:
                temporary_lock.release()
            self._batch_status_published_at = 0.0
            try:
                await self._publish_batch_status()
                await self.publish_snapshot()
            except Exception:  # noqa: BLE001 - the transport may already be closing.
                pass

    async def _publish_batch_status(self) -> None:
        """Publish batch progress on ``teleop.batch.v1.<sessionId>`` at most twice a second."""
        if self._publisher is None:
            return
        now = time.monotonic()
        if now - self._batch_status_published_at < BATCH_STATUS_PUBLISH_INTERVAL_SECONDS:
            return
        self._batch_status_published_at = now
        topic = f"teleop.batch.v1.{self.session.session_id}".encode("utf-8")
        header = {
            "protocolVersion": 1,
            "messageType": "batch",
            "sessionId": self.session.session_id,
            "batch": self.batch_status,
        }
        try:
            import zmq

            await self._publisher.send_multipart([topic, _json(header)], flags=zmq.NOBLOCK)
        except Exception:  # noqa: BLE001 - progress messages are best effort.
            self._dropped_messages += 1

    async def _stop_batch(self) -> None:
        """Cancel a running batch on shutdown and wait until it has committed and cleaned up."""
        task = self._batch_task
        if task is None or task.done():
            return
        self._batch_cancel_event.set()
        if self._batch_job is not None:
            self._batch_job.request_cancel()
        try:
            await task
        except asyncio.CancelledError:
            if not task.cancelled():
                raise
        except Exception:  # noqa: BLE001 - shutdown continues; the status records the failure.
            pass
