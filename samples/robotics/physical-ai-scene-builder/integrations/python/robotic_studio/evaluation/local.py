# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""In-process PolicyEnvironment backed by the same evaluation session logic as the worker."""

from __future__ import annotations

import json
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np

from ..environment import (
    DEFAULT_STUDIO_URL,
    DEFAULT_TIMEOUT_S,
    EnvironmentError,
    ProtocolError,
    RemoteEvaluationError,
    _decode_observation,
)
from ..generation.native_env import NativeEnvironment
from ..generation.scene_bundle import MAX_ARCHIVE_BYTES
from ..http_transport import open_http
from ..policy_environment import Observation, ResetInfo
from .session import EvaluationSession, EvaluationSessionError

EVALUATION_PROFILE_HEADER = "X-Evaluation-Profile"
_DOWNLOAD_CHUNK_BYTES = 1024 * 1024


@contextmanager
def _remote_errors() -> Iterator[None]:
    """Raise session rejections as the public ``RemoteEvaluationError`` the worker client raises."""
    try:
        yield
    except EvaluationSessionError as error:
        raise RemoteEvaluationError(error.code, str(error), error.details) from error


def _transport_copy(value: Mapping[str, Any]) -> dict[str, Any]:
    """Round-trip a result through JSON like the worker transport does, so values match exactly."""
    return json.loads(json.dumps(value, separators=(",", ":"), ensure_ascii=True))


class LocalEvaluationEnvironment:
    """Run Studio evaluation semantics locally without opening ZeroMQ sockets.

    Errors the session rejects (``EPISODE_TERMINATED``, ``ACTION_LENGTH_MISMATCH``, ...) raise
    :class:`~robotic_studio.environment.RemoteEvaluationError` with the same code and message as
    :class:`~robotic_studio.environment.StudioEnvironment`.
    """

    backend = "native-local"

    def __init__(
        self,
        environment: NativeEnvironment,
        profile: Mapping[str, Any],
        *,
        scene_id: str = "",
        scene_fingerprint: str = "",
        profile_id: str = "runtime-policy",
        session_id: str | None = None,
    ) -> None:
        self.environment = environment
        self.profile = dict(profile)
        self.session = EvaluationSession(
            environment,
            self.profile,
            session_id=session_id or f"local-{uuid.uuid4()}",
            scene_id=scene_id or str(profile.get("sceneId", "")),
            scene_fingerprint=scene_fingerprint or str(profile.get("sceneFingerprint", "")),
            profile_id=profile_id,
        )
        self._identity = f"local-evaluation-{uuid.uuid4()}".encode()
        self._episode_id: str | None = None
        self._lease_acquired = False
        self._closed = False
        self._owned_bundle: Any | None = None
        self._last_reset_info = ResetInfo(seed=None, samples=())
        self._last_observation: Observation | None = None

    @classmethod
    def from_files(
        cls,
        scene_bundle: str | Path,
        profile: str | Path | Mapping[str, Any],
    ) -> LocalEvaluationEnvironment:
        """Open a scene bundle and evaluation profile exactly as the Evaluate worker does.

        ``profile`` is a JSON file path or an already-loaded mapping. The returned environment owns
        the loaded bundle and closes it in :meth:`close`.
        """
        from ..runtime import evaluation_environment, load_profile, load_scene

        values = dict(profile) if isinstance(profile, Mapping) else load_profile(profile)
        scene = load_scene(scene_bundle)
        environment: NativeEnvironment | None = None
        try:
            environment = evaluation_environment(scene, values)
            local = cls(
                environment,
                values,
                scene_id=str(values.get("sceneId", "")),
                scene_fingerprint=str(values.get("sceneFingerprint", "")),
                profile_id=str(values.get("profileId", "runtime-policy")),
            )
        except Exception:
            if environment is not None:
                environment.close()
            scene.bundle.close()
            raise
        local._owned_bundle = scene.bundle
        return local

    def __enter__(self) -> LocalEvaluationEnvironment:
        return self

    def __exit__(self, _exception_type: Any, _exception: Any, _traceback: Any) -> None:
        self.close()

    def describe(self) -> Mapping[str, Any]:
        return {**_transport_copy(self.session.describe()), "backend": self.backend}

    def acquire(self) -> None:
        if not self._lease_acquired:
            with _remote_errors():
                self.session.acquire(self._identity)
            self._lease_acquired = True

    def _observation(self, result: Mapping[str, Any], attachments: Sequence[bytes]) -> Observation:
        header = result.get("observation")
        if not isinstance(header, Mapping):
            raise ProtocolError("Evaluation session returned an invalid observation header.")
        return _decode_observation(header, attachments, result.get("task"))

    def reset(self, seed: int | None = None) -> tuple[Observation, ResetInfo]:
        if not self._lease_acquired:
            self.acquire()
        with _remote_errors():
            raw, attachments = self.session.reset(self._identity, None if seed is None else int(seed))
        result = _transport_copy(raw)
        observation = self._observation(result, attachments)
        self._episode_id = observation.episode_id
        reset_info = result.get("resetInfo", {})
        self._last_reset_info = ResetInfo(
            seed=reset_info.get("seed"),
            samples=tuple(reset_info.get("samples", [])),
        )
        self._last_observation = observation
        return observation, self._last_reset_info

    def step(
        self,
        action: Sequence[float] | np.ndarray,
        physics_steps: int | None = None,
    ) -> Observation:
        """Apply one action like ``StudioEnvironment.step`` (float32 action, optional physics steps)."""
        if self._episode_id is None:
            raise EnvironmentError("reset() must be called before step().")
        values = np.asarray(action, dtype=np.float32)
        if values.ndim != 1:
            raise ValueError("Actions must be one-dimensional.")
        with _remote_errors():
            raw, attachments = self.session.step(
                self._identity,
                self._episode_id,
                [float(value) for value in values],
                None if physics_steps is None else int(physics_steps),
            )
        observation = self._observation(_transport_copy(raw), attachments)
        self._episode_id = observation.episode_id
        self._last_observation = observation
        return observation

    def observation(self) -> Observation:
        """The last observation, with camera images re-rendered from the current state."""
        if self._last_observation is None:
            raise EnvironmentError("reset() must be called before reading an observation.")
        if not self.profile.get("cameras"):
            return self._last_observation
        native = self.environment.observe(images=True)
        last = self._last_observation
        refreshed = Observation(
            state=last.state,
            images=native.images,
            episode_id=last.episode_id,
            step_id=last.step_id,
            simulation_time=last.simulation_time,
            physics_steps=last.physics_steps,
            scene_fingerprint=last.scene_fingerprint,
            task=last.task,
        )
        self._last_observation = refreshed
        return refreshed

    @property
    def last_reset_info(self) -> ResetInfo:
        return self._last_reset_info

    def stop(self) -> None:
        if self._lease_acquired and self._episode_id is not None:
            with _remote_errors():
                self.session.stop(self._identity)
        self._episode_id = None

    def release(self) -> None:
        if self._lease_acquired:
            with _remote_errors():
                self.session.release(self._identity)
            self._lease_acquired = False
        self._episode_id = None

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self._lease_acquired:
                self.release()
        finally:
            self.session.invalidate()
            self.environment.close()
            if self._owned_bundle is not None:
                self._owned_bundle.close()
                self._owned_bundle = None


def _http_error_message(error: urllib.error.HTTPError) -> str:
    try:
        value = json.loads(error.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 - the body is optional context only.
        return f"HTTP {error.code}"
    message = value.get("error") if isinstance(value, dict) else None
    return f"HTTP {error.code}: {message}" if isinstance(message, str) and message else f"HTTP {error.code}"


def _discover_evaluation_session_id(base_url: str, timeout_s: float) -> str:
    request = urllib.request.Request(f"{base_url}/api/evaluation/sessions", headers={"Accept": "application/json"})
    try:
        with open_http(request, timeout_s) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        raise EnvironmentError(
            f"No active Evaluate session was found at {base_url} ({_http_error_message(error)}). Open the "
            "scene in Physical AI Scene Builder and click Start streaming in the Evaluate tab, then run this script."
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
    if status is not None and status not in {"starting", "ready"}:
        raise EnvironmentError(f"The Evaluate session at {base_url} is {status}.")
    session_id = value.get("sessionId")
    if not isinstance(session_id, str) or not session_id:
        raise ProtocolError("The Evaluate session response is missing sessionId.")
    return session_id


def download_evaluation_scene(
    studio_url: str = DEFAULT_STUDIO_URL,
    session_id: str | None = None,
    *,
    destination: str | Path | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> tuple[Path, dict[str, Any]]:
    """Download the active Evaluate scene bundle and profile from Physical AI Scene Builder.

    Discovers the active session from ``GET /api/evaluation/sessions`` unless ``session_id`` is
    given, then fetches ``GET /api/evaluation/sessions/<id>/scene``. The archive is written to
    ``destination`` (a new temporary directory when omitted; the caller removes it) as
    ``scene.mujoco-scene`` and the profile is decoded from the ``X-Evaluation-Profile`` header.
    Returns ``(scene_bundle_path, profile)`` for :meth:`LocalEvaluationEnvironment.from_files`.
    """
    base_url = studio_url.rstrip("/")
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("studio_url must be an http(s) URL.")
    if timeout_s <= 0:
        raise ValueError("timeout_s must be positive.")
    if session_id is None:
        session_id = _discover_evaluation_session_id(base_url, timeout_s)
    elif not isinstance(session_id, str) or not session_id:
        raise ValueError("session_id must be a non-empty string.")

    created = destination is None
    root = Path(tempfile.mkdtemp(prefix="robotic-studio-evaluation-scene-") if destination is None else destination)
    try:
        root.mkdir(parents=True, exist_ok=True)
        scene_path = root / "scene.mujoco-scene"
        url = f"{base_url}/api/evaluation/sessions/{urllib.parse.quote(session_id, safe='')}/scene"
        request = urllib.request.Request(url, headers={"Accept": "application/octet-stream"})
        try:
            with open_http(request, timeout_s) as response:
                header = response.headers.get(EVALUATION_PROFILE_HEADER)
                if not header:
                    raise ProtocolError(f"The Evaluate scene response is missing {EVALUATION_PROFILE_HEADER}.")
                try:
                    profile = json.loads(urllib.parse.unquote(header))
                except json.JSONDecodeError as error:
                    raise ProtocolError("The Evaluate scene profile header is not valid JSON.") from error
                if not isinstance(profile, dict):
                    raise ProtocolError("The Evaluate scene profile must be a JSON object.")
                written = 0
                with scene_path.open("wb") as stream:
                    while chunk := response.read(_DOWNLOAD_CHUNK_BYTES):
                        written += len(chunk)
                        if written > MAX_ARCHIVE_BYTES:
                            raise ProtocolError("The Evaluate scene bundle exceeds the size limit.")
                        stream.write(chunk)
        except urllib.error.HTTPError as error:
            raise EnvironmentError(
                f"The Evaluate scene for session '{session_id}' is unavailable ({_http_error_message(error)})."
            ) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise EnvironmentError(f"Could not download the Evaluate scene from {base_url}.") from error
        if written == 0:
            raise ProtocolError("The Evaluate scene bundle is empty.")
        return scene_path, profile
    except BaseException:
        if created:
            shutil.rmtree(root, ignore_errors=True)
        raise
