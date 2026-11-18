# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import time
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Mapping, Sequence

import numpy as np
import zmq

from .policy_environment import Observation, ResetInfo, TaskStatus
from .http_transport import HttpCommandSocket, open_http


PROTOCOL_VERSION = 1
DEFAULT_STUDIO_URL = "http://127.0.0.1:3000"
DEFAULT_TIMEOUT_S = 10.0
MAX_BUNDLE_BYTES = 64 * 1024 * 1024
# A live worker answers 'hello' in milliseconds. A silent one is usually being stopped or replaced
# (Stop/Start streaming, scene change), so give up on that endpoint quickly and re-discover.
HELLO_ATTEMPT_TIMEOUT_S = 2.0
DISCOVERY_POLL_INTERVAL_S = 0.5


class EnvironmentError(RuntimeError):
    """Base class for errors raised by the Physical AI Scene Builder SDK."""


class ConnectionTimeoutError(EnvironmentError):
    """No Evaluate session was found, or a command did not respond, before the timeout."""


class ProtocolError(EnvironmentError):
    """The evaluation worker sent a malformed or incompatible protocol message."""


class _RelayFailed(EnvironmentError):
    """The app's command relay rejected or dropped a command (for example, a replaced session)."""


class _SessionNotReady(EnvironmentError):
    """An Evaluate session exists but is still starting or already stopping; poll again."""


class RemoteEvaluationError(EnvironmentError):
    """The evaluation worker rejected a valid command with a structured evaluation error."""

    def __init__(self, code: str, message: str, details: Mapping[str, Any] | None = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.details = dict(details or {})


def _discover_control_endpoint(base_url: str, timeout_s: float) -> str:
    request = urllib.request.Request(
        f"{base_url}/api/evaluation/sessions", headers={"Accept": "application/json"}
    )
    try:
        with open_http(request, timeout_s) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        raise EnvironmentError(
            f"No active Evaluate session was found at {base_url}. Open the scene in Robotic "
            "Studio and click Start streaming, then run this script."
        ) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise EnvironmentError(f"Could not reach Physical AI Scene Builder at {base_url}.") from error
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProtocolError(f"The response from {base_url} was not valid JSON.") from error
    if not isinstance(value, dict):
        raise ProtocolError(f"The response from {base_url} must be a JSON object.")
    status = value.get("status")
    if status is not None and status != "ready":
        # 'starting' has no endpoint yet; 'stopping' still advertises one whose worker will not
        # answer. Both are transient from the SDK's point of view.
        raise _SessionNotReady(f"The Evaluate session is {status}.")
    relay = value.get("relay")
    control = relay.get("control") if isinstance(relay, dict) else None
    if not isinstance(control, str) or not control:
        raise ProtocolError("The Evaluate session response is missing relay.control.")
    return urllib.parse.urljoin(f"{base_url}/", control)


class StudioEnvironment:
    """Synchronous environment facade backed by a native Physical AI Scene Builder evaluation worker.

    Physical AI Scene Builder's Evaluate tab spawns the worker when you click Start streaming; this
    class sends commands through the app's single-port HTTP relay. The worker must already exist.
    """

    backend = "sim"

    def __init__(
        self,
        base_url: str = DEFAULT_STUDIO_URL,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self._dealer: HttpCommandSocket | None = None
        self._session_id = f"python-{uuid.uuid4()}"
        self._request_id = 0
        self._episode_id: str | None = None
        self._lease_acquired = False
        self._exchange_lock = threading.Lock()
        self._heartbeat_stop: threading.Event | None = None
        self._heartbeat_thread: threading.Thread | None = None
        self._heartbeat_error: Exception | None = None

    @classmethod
    def connect(
        cls,
        base_url: str = DEFAULT_STUDIO_URL,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> StudioEnvironment:
        return cls(base_url, timeout_s)

    def __enter__(self) -> StudioEnvironment:
        return self

    def __exit__(self, _exception_type: Any, _exception: Any, _traceback: Any) -> None:
        self.close()

    def wait_for_studio(self, timeout_s: float | None = None, acquire: bool = True) -> None:
        """Wait for a ready Evaluate session and complete the protocol handshake.

        Physical AI Scene Builder can stop or replace the worker while this waits (Stop/Start streaming, a
        scene change), so an advertised endpoint that does not answer 'hello' is dropped and the
        session is discovered again until ``timeout_s`` runs out.
        """
        if self._dealer is not None:
            return
        budget = timeout_s if timeout_s is not None else self.timeout_s
        deadline = time.monotonic() + budget
        while True:
            try:
                control_endpoint = _discover_control_endpoint(self.base_url, self.timeout_s)
            except ProtocolError:
                raise
            except EnvironmentError:
                if time.monotonic() >= deadline:
                    raise ConnectionTimeoutError(
                        "Timed out waiting for an Evaluate session. Click Start streaming in "
                        "Physical AI Scene Builder, then run this script."
                    ) from None
                time.sleep(DISCOVERY_POLL_INTERVAL_S)
                continue
            if self._handshake(control_endpoint, deadline):
                break
            if time.monotonic() >= deadline:
                raise ConnectionTimeoutError(
                    f"The evaluation worker at {control_endpoint} did not respond. In Robotic "
                    "Studio, click Stop streaming, then Start streaming, and run this script again."
                )
            time.sleep(DISCOVERY_POLL_INTERVAL_S)
        if acquire:
            self.acquire()

    def _handshake(self, control_endpoint: str, deadline: float) -> bool:
        """Send 'hello'; return False (transport closed) if the worker is silent or already gone."""
        remaining = deadline - time.monotonic()
        attempt_s = max(0.1, min(HELLO_ATTEMPT_TIMEOUT_S, self.timeout_s, remaining))
        self._dealer = HttpCommandSocket(control_endpoint, attempt_s)
        try:
            self._exchange("hello", supportedVersions=[PROTOCOL_VERSION])
        except (ConnectionTimeoutError, _RelayFailed):
            self._close_transport()
            return False
        except BaseException:
            self._close_transport()
            raise
        self._dealer.setsockopt(zmq.RCVTIMEO, max(1, int(self.timeout_s * 1000)))
        return True

    def acquire(self) -> None:
        self._exchange("acquire")
        self._lease_acquired = True
        self._start_heartbeat()

    def describe(self) -> Mapping[str, Any]:
        return self._exchange("describe")["result"]["description"]

    def reset(self, seed: int | None = None) -> tuple[Observation, ResetInfo]:
        result = self._exchange("reset", **({} if seed is None else {"seed": int(seed)}))
        payload = result["result"]
        observation = _decode_observation(payload["observation"], result["attachments"], payload.get("task"))
        self._episode_id = observation.episode_id
        reset_info = payload.get("resetInfo", {})
        return observation, ResetInfo(
            seed=reset_info.get("seed"),
            samples=tuple(reset_info.get("samples", [])),
        )

    def step(
        self,
        action: Sequence[float] | np.ndarray,
        physics_steps: int | None = None,
    ) -> Observation:
        if self._episode_id is None:
            raise EnvironmentError("reset() must be called before step().")
        values = np.asarray(action, dtype=np.float32)
        if values.ndim != 1:
            raise ValueError("Actions must be one-dimensional.")
        command: dict[str, Any] = {
            "episodeId": self._episode_id,
            "action": [float(value) for value in values],
        }
        if physics_steps is not None:
            command["physicsSteps"] = int(physics_steps)
        result = self._exchange("step", **command)
        payload = result["result"]
        observation = _decode_observation(payload["observation"], result["attachments"], payload.get("task"))
        self._episode_id = observation.episode_id
        return observation

    def render(self, cameras: Sequence[str] | None = None) -> Observation:
        """Renders the current state without stepping or needing the lease.

        ``cameras`` lists camera output names (all profile cameras when omitted). The returned
        observation carries the current state and those images, and does not change the episode.
        """
        fields: dict[str, Any] = {} if cameras is None else {"cameras": [str(name) for name in cameras]}
        result = self._exchange("render", **fields)
        return _decode_observation(result["result"]["observation"], result["attachments"])

    def stop(self) -> None:
        self._exchange("stop", **({} if self._episode_id is None else {"episodeId": self._episode_id}))
        self._episode_id = None

    def release(self) -> None:
        self._stop_heartbeat()
        self._exchange("release")
        self._lease_acquired = False
        self._episode_id = None

    def close(self) -> None:
        self._stop_heartbeat()
        if self._lease_acquired and self._dealer is not None:
            try:
                self._exchange("release")
            except Exception:
                # Worker-side lease expiry remains the recovery path if the
                # transport is already lost; closing must still release sockets.
                pass
            self._lease_acquired = False
        self._close_transport()
        self._episode_id = None

    def _start_heartbeat(self) -> None:
        if self._heartbeat_thread is not None:
            return
        stop = threading.Event()
        self._heartbeat_stop = stop
        self._heartbeat_error = None

        def maintain_lease() -> None:
            while not stop.wait(2.0):
                try:
                    self._exchange("ping", _heartbeat=True)
                except Exception as error:  # surfaced on the next user command
                    self._heartbeat_error = error
                    stop.set()

        self._heartbeat_thread = threading.Thread(
            target=maintain_lease,
            name="robotic-studio-evaluation-heartbeat",
            daemon=True,
        )
        self._heartbeat_thread.start()

    def _stop_heartbeat(self) -> None:
        stop = self._heartbeat_stop
        thread = self._heartbeat_thread
        self._heartbeat_stop = None
        self._heartbeat_thread = None
        if stop is not None:
            stop.set()
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=max(1.0, self.timeout_s))

    def _close_transport(self) -> None:
        if self._dealer is not None:
            self._dealer.close(0)
            self._dealer = None

    def _exchange(self, command: str, **fields: Any) -> dict[str, Any]:
        with self._exchange_lock:
            return self._exchange_unlocked(command, **fields)

    def _exchange_unlocked(self, command: str, **fields: Any) -> dict[str, Any]:
        if self._dealer is None:
            raise EnvironmentError("wait_for_studio() must complete before environment commands.")
        heartbeat = bool(fields.pop("_heartbeat", False))
        if self._heartbeat_error is not None and not heartbeat and command not in {"release", "stop"}:
            raise EnvironmentError(f"Evaluation lease heartbeat failed: {self._heartbeat_error}") from self._heartbeat_error
        self._request_id += 1
        envelope = {
            "protocolVersion": PROTOCOL_VERSION,
            "sessionId": self._session_id,
            "requestId": self._request_id,
            "command": command,
            **fields,
        }
        try:
            self._dealer.send_json(envelope)
            raw_response = self._dealer.recv()
        except zmq.Again as error:
            raise ConnectionTimeoutError(
                f"Timed out waiting for the evaluation worker's response to '{command}'."
            ) from error
        except (OSError, ValueError) as error:
            raise _RelayFailed(f"The evaluation command relay failed: {error}") from error
        response = _parse_response(raw_response, envelope)
        attachments: list[bytes] = []
        if response["ok"]:
            observation = response.get("result", {}).get("observation")
            descriptors = observation.get("attachments", []) if isinstance(observation, dict) else []
            if not isinstance(descriptors, list):
                raise ProtocolError("Observation attachment descriptors must be an array.")
            expected_bytes = sum(
                _positive_int(descriptor.get("byteLength"), "attachment byteLength", allow_zero=True)
                for descriptor in descriptors
            )
            if expected_bytes > MAX_BUNDLE_BYTES:
                raise ProtocolError("Observation bundle exceeds the configured limit.")
            for descriptor in descriptors:
                try:
                    raw_attachment = self._dealer.recv()
                except zmq.Again as error:
                    raise ConnectionTimeoutError(
                        "Timed out waiting for an observation attachment."
                    ) from error
                expected_length = _positive_int(
                    descriptor.get("byteLength"), "attachment byteLength", allow_zero=True
                )
                if len(raw_attachment) != expected_length:
                    raise ProtocolError("Observation attachment length does not match its descriptor.")
                attachments.append(raw_attachment)
        else:
            error = response.get("error")
            if not isinstance(error, dict):
                raise ProtocolError("Evaluation worker returned an invalid structured error.")
            raise RemoteEvaluationError(
                str(error.get("code", "TRANSPORT_ERROR")),
                str(error.get("message", "The evaluation worker rejected the command.")),
                error.get("details") if isinstance(error.get("details"), dict) else None,
            )
        response["attachments"] = attachments
        return response


def _parse_response(raw_response: bytes, envelope: Mapping[str, Any]) -> dict[str, Any]:
    try:
        response = json.loads(raw_response.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProtocolError("Evaluation worker response was not valid JSON.") from error
    if not isinstance(response, dict):
        raise ProtocolError("Evaluation worker response must be a JSON object.")
    if response.get("protocolVersion") != PROTOCOL_VERSION:
        raise ProtocolError("Evaluation worker selected an unsupported protocol version.")
    if response.get("sessionId") != envelope.get("sessionId"):
        raise ProtocolError("Evaluation worker response session does not match the command.")
    if response.get("requestId") != envelope.get("requestId"):
        raise ProtocolError("Evaluation worker response request does not match the command.")
    if not isinstance(response.get("result") if response.get("ok") else response.get("error"), dict):
        raise ProtocolError("Evaluation worker response is missing its result or error object.")
    return response


def _positive_int(value: Any, label: str, allow_zero: bool = False) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or (value < 0 if allow_zero else value < 1):
        raise ProtocolError(f"{label} must be a positive integer.")
    return value


def _decode_observation(
    header: Mapping[str, Any], attachments: Sequence[bytes], task_value: Mapping[str, Any] | None = None
) -> Observation:
    descriptors = header.get("attachments")
    if not isinstance(descriptors, list) or len(descriptors) != len(attachments):
        raise ProtocolError("Observation attachment count does not match its header.")
    state: np.ndarray | None = None
    images: dict[str, np.ndarray] = {}
    for descriptor, attachment in zip(descriptors, attachments):
        if not isinstance(descriptor, dict):
            raise ProtocolError("Observation attachment descriptor must be an object.")
        name = descriptor.get("name")
        dtype = descriptor.get("dtype")
        shape = descriptor.get("shape")
        if not isinstance(name, str) or not isinstance(shape, list) or not all(isinstance(item, int) for item in shape):
            raise ProtocolError("Observation attachment descriptor has invalid name or shape.")
        if dtype == "float32" and descriptor.get("kind") == "state":
            values = np.frombuffer(attachment, dtype="<f4").copy()
            state = values.reshape(tuple(shape))
        elif dtype == "uint8" and descriptor.get("kind") == "camera":
            images[name] = np.frombuffer(attachment, dtype=np.uint8).copy().reshape(tuple(shape))
        else:
            raise ProtocolError(f"Unsupported observation attachment dtype: {dtype!r}.")
    if state is None:
        raise ProtocolError("Observation is missing its float32 state attachment.")
    task = None
    if task_value is not None:
        if not isinstance(task_value, Mapping):
            raise ProtocolError("Observation task status must be an object.")
        if any(not isinstance(task_value.get(key), bool) for key in ("success", "terminated", "truncated")):
            raise ProtocolError("Observation task status flags must be booleans.")
        metrics = task_value.get("metrics", {})
        if not isinstance(metrics, Mapping):
            raise ProtocolError("Observation task metrics must be an object.")
        if task_value.get("reason") is not None and not isinstance(task_value.get("reason"), str):
            raise ProtocolError("Observation task reason must be a string or null.")
        try:
            metric_values = {str(key): float(value) for key, value in metrics.items()}
        except (TypeError, ValueError) as error:
            raise ProtocolError("Observation task metrics must be finite numbers.") from error
        if not all(np.isfinite(value) for value in metric_values.values()):
            raise ProtocolError("Observation task metrics must be finite numbers.")
        task = TaskStatus(
            success=task_value["success"],
            terminated=task_value["terminated"],
            truncated=task_value["truncated"],
            reason=task_value.get("reason"),
            metrics=metric_values,
        )
    return Observation(
        state=state,
        images=images,
        episode_id=str(header.get("episodeId") or ""),
        step_id=_positive_int(header.get("stepId"), "stepId", allow_zero=True),
        simulation_time=float(header.get("simulationTime", 0.0)),
        physics_steps=_positive_int(header.get("physicsSteps"), "physicsSteps", allow_zero=True),
        scene_fingerprint=str(header.get("sceneFingerprint", "")),
        task=task,
    )
