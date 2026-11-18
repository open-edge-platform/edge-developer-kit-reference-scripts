# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import math
import os
import re
import shutil
import time
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field as dataclass_field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import numpy as np

from ..generation.dataset import (
    CollectedEpisode,
    EpisodeFrame,
    EpisodeSummary,
    EpisodeWriter,
    RGBImage,
)
from ..generation.native_env import (
    NativeActionError,
    NativeEnvironment,
    NativeEnvironmentError,
    NativeObservation,
)
from ..generation.backdrop import DEFAULT_BACKDROP_BODY
from ..generation.model_randomization import (
    BACKDROP_APPEARANCE_KIND,
    MODEL_RULE_KINDS,
)
from ..generation.randomization import XorShift32, derive_seed, sample_rules
from .collection import TeleoperationCollectionStore, TeleoperationStoredState


TELEOPERATION_LEASE_TIMEOUT_SECONDS = 10.0
# Saved-episode controller metadata is a small JSON object (for example sampled variation values).
EPISODE_METADATA_MAX_BYTES = 16 * 1024
# Robot start-pose draws that overlap the scene are redrawn from the same seeded stream.
ROBOT_POSE_MAX_DRAWS = 20
# Additional randomized objects: each pose that overlaps the scene (or an object placed before it)
# is redrawn, up to this many times per object.
OBJECT_POSE_MAX_DRAWS = 50
MAX_RANDOMIZED_OBJECTS = 16
# Additional objects draw from their own stream derived from the state seed, so adding objects
# leaves the main object pose, model samples, and robot pose of existing seeds unchanged.
OBJECT_STREAM_SALT = 0x0B1EC7


class TeleoperationSessionError(RuntimeError):
    pass


class TeleoperationLeaseError(TeleoperationSessionError):
    pass


class TeleoperationStateError(TeleoperationSessionError):
    pass


class TeleoperationStateDeletionError(TeleoperationStateError):
    pass


class TeleoperationRecordingError(TeleoperationSessionError):
    pass


BackdropRenderDecision = Literal["render", "defer", "deferred"]
# Simulation fields restored to re-render a deferred frame exactly (ctrl does not affect images).
_RENDER_STATE_ARRAYS = ("qpos", "qvel", "act", "mocap_pos", "mocap_quat")


def backdrop_render_decision(
    *,
    backdrop_enabled: bool,
    budget_enabled: bool,
    render_time_ms: float | None,
    threshold_ms: float | None,
    deferred: bool = False,
) -> BackdropRenderDecision:
    """Decide how one recorded frame's backdrop camera images are produced.

    - ``"render"``: render the frame live (also the answer for scenes without a backdrop or
      sessions without a live budget, such as offline batch generation).
    - ``"defer"``: the frame just rendered live took longer than the budget; keep its images
      and defer the rest of the recording.
    - ``"deferred"``: the recording is already deferred; store the simulation state only and
      render the images when the recording is saved.

    Call it with ``render_time_ms=None`` before rendering a frame and with the measured time after.
    """
    if not backdrop_enabled or not budget_enabled:
        return "render"
    if deferred:
        return "deferred"
    if render_time_ms is not None and threshold_ms is not None and render_time_ms > threshold_ms:
        return "defer"
    return "render"


def _backdrop_render_budget(profile: Mapping[str, Any]) -> tuple[bool, float | None]:
    value = profile.get("backdropRenderBudget")
    if value is None:
        return False, None
    if not isinstance(value, Mapping):
        raise TeleoperationSessionError("profile.backdropRenderBudget must be an object.")
    enabled = value.get("enabled", True)
    threshold = value.get("maxFrameTimeMs")
    if not isinstance(enabled, bool):
        raise TeleoperationSessionError("profile.backdropRenderBudget.enabled must be boolean.")
    if threshold is None:
        raise TeleoperationSessionError("profile.backdropRenderBudget.maxFrameTimeMs is required.")
    if (
        not isinstance(threshold, (int, float))
        or isinstance(threshold, bool)
        or not math.isfinite(float(threshold))
        or float(threshold) <= 0
    ):
        raise TeleoperationSessionError(
            "profile.backdropRenderBudget.maxFrameTimeMs must be a positive finite number."
        )
    return enabled, float(threshold)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_teleoperation_environment(scene: Any, profile: Mapping[str, Any]) -> NativeEnvironment:
    """Build the Generate worker's environment from a compiled scene and a teleoperation profile.

    The interactive worker and every batch worker use this one factory so batch recordings run on
    exactly the same environment configuration (no task randomization, profile cameras/actions).
    """
    cameras = profile.get("cameras", [])
    if not isinstance(cameras, list):
        raise ValueError("profile.cameras must be an array.")
    action_fields = profile.get("action")
    if not isinstance(action_fields, list):
        raise ValueError("profile.action must be an array.")
    return NativeEnvironment(
        scene,
        profile=profile,
        action_fields=action_fields,
        physics_steps=profile.get("physicsSteps", 1),
        cameras=cameras,
        render_rgb=bool(profile.get("captureRgb", False)),
    )


def _finite_integer(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise TeleoperationSessionError(f"{label} must be an integer.")
    return value


def _backdrop_body(profile: Mapping[str, Any]) -> str | None:
    """The body carrying the profile's splat backdrop, or None when the scene has no backdrop."""
    backdrop = profile.get("backdrop")
    if not isinstance(backdrop, Mapping):
        return None
    body = backdrop.get("body")
    return body if isinstance(body, str) and body.strip() else DEFAULT_BACKDROP_BODY


def _validate_backdrop_appearance_rule(
    rule: Mapping[str, Any], index: int, backdrop_body: str | None
) -> None:
    label = f"modelRandomization[{index}]"
    if backdrop_body is None:
        raise TeleoperationStateError(f"{label} randomizes the backdrop, but the scene has no backdrop.")
    if rule.get("target") != backdrop_body:
        raise TeleoperationStateError(f"{label} must target the backdrop body '{backdrop_body}'.")
    for key in ("hueShift", "saturationScale", "valueScale"):
        _range_value(rule.get(key), f"{label}.{key}")


def _model_rules(value: Any, *, backdrop_body: str | None = None) -> list[Mapping[str, Any]]:
    """Validate the shape of model randomization rules; names are checked when applied.

    ``backdrop-appearance`` rules are accepted only when the profile has a backdrop and must
    target its body (``profile.backdrop.body``, default ``rs_backdrop``).
    """
    if value is None:
        return []
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise TeleoperationStateError("modelRandomization must be a list of rules.")
    rules = []
    for index, rule in enumerate(value):
        if isinstance(rule, Mapping) and rule.get("kind") == BACKDROP_APPEARANCE_KIND:
            _validate_backdrop_appearance_rule(rule, index, backdrop_body)
        elif not isinstance(rule, Mapping) or rule.get("kind") not in MODEL_RULE_KINDS:
            raise TeleoperationStateError(f"modelRandomization[{index}] is not a supported model rule.")
        rules.append(rule)
    return rules


def _rule_for_sample(sample: Mapping[str, Any]) -> dict[str, Any]:
    """The model rule a stored sample came from."""
    rule = sample.get("rule")
    if not isinstance(rule, Mapping):
        raise TeleoperationStateError("Its model randomization sample has no rule. Generate the state again.")
    return dict(rule)


def _range_value(value: Any, label: str) -> tuple[float, float]:
    if (
        not isinstance(value, Sequence)
        or isinstance(value, (str, bytes))
        or len(value) != 2
        or not all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value)
        or not all(math.isfinite(float(item)) for item in value)
    ):
        raise TeleoperationStateError(f"{label} must contain two finite numbers.")
    lower, upper = float(value[0]), float(value[1])
    if lower > upper:
        raise TeleoperationStateError(f"{label} minimum must not exceed maximum.")
    return lower, upper


GRIPPER_NAME_PATTERN = re.compile(r"gripper|jaw|finger", re.IGNORECASE)


ObjectZone = tuple[str, tuple[float, float], tuple[float, float], tuple[float, float]]


def _object_randomization_config(configuration: Mapping[str, Any], source_body: str) -> list[ObjectZone]:
    """Additional objects of ``sourceRandomization.objects``: ``(body, x_cm, y_cm, yaw_degrees)``."""
    value = configuration.get("objects")
    if value is None:
        return []
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise TeleoperationStateError("sourceRandomization.objects must be a list.")
    if len(value) > MAX_RANDOMIZED_OBJECTS:
        raise TeleoperationStateError(
            f"sourceRandomization.objects can list at most {MAX_RANDOMIZED_OBJECTS} objects."
        )
    zones: list[ObjectZone] = []
    seen = {source_body}
    for index, entry in enumerate(value):
        label = f"sourceRandomization.objects[{index}]"
        if not isinstance(entry, Mapping):
            raise TeleoperationStateError(f"{label} must be an object.")
        body = entry.get("body")
        if not isinstance(body, str) or not body.strip():
            raise TeleoperationStateError(f"{label}.body is required.")
        if body in seen:
            raise TeleoperationStateError(f"Object '{body}' is randomized more than once.")
        seen.add(body)
        zones.append(
            (
                body,
                _range_value(entry.get("xCm"), f"{label}.xCm"),
                _range_value(entry.get("yCm"), f"{label}.yCm"),
                _range_value(entry.get("yawDegrees"), f"{label}.yawDegrees"),
            )
        )
    return zones


def _robot_randomization_config(value: Any) -> tuple[tuple[float, float], tuple[str, ...] | None] | None:
    """Validate ``{"enabled", "degrees": [min, max], "joints"?: [...]}``; None when disabled."""
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise TeleoperationStateError("robotRandomization must be an object.")
    if not value.get("enabled", False):
        return None
    degrees = _range_value(value.get("degrees"), "robotRandomization.degrees")
    joints = value.get("joints")
    if joints is None:
        return degrees, None
    if (
        not isinstance(joints, Sequence)
        or isinstance(joints, (str, bytes))
        or not all(isinstance(name, str) and name.strip() for name in joints)
    ):
        raise TeleoperationStateError("robotRandomization.joints must be a list of joint names.")
    return degrees, tuple(joints)


def _episode_metadata(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise TeleoperationRecordingError("Episode metadata must be an object.")
    try:
        encoded = json.dumps(value, allow_nan=False, sort_keys=True)
    except (TypeError, ValueError) as error:
        raise TeleoperationRecordingError("Episode metadata must be JSON with finite numbers.") from error
    if len(encoded.encode("utf-8")) > EPISODE_METADATA_MAX_BYTES:
        raise TeleoperationRecordingError(
            f"Episode metadata must be at most {EPISODE_METADATA_MAX_BYTES} bytes."
        )
    return json.loads(encoded)


def _normalize_action_for_recording(field: Mapping[str, Any], raw_value: float) -> float:
    """Convert a raw control-space value into the profile's declared input convention.

    Inverse of evaluation/session.py's _remap_action_value. Falls back to the raw value when
        the profile doesn't declare inputRange/controlRange (e.g. a scene using 'raw').
    """
    input_range = field.get("inputRange")
    control_range = field.get("controlRange")
    if input_range is None or control_range is None:
        return raw_value
    control_width = float(control_range[1]) - float(control_range[0])
    input_width = float(input_range[1]) - float(input_range[0])
    if control_width == 0:
        return float(input_range[0])
    return float(input_range[0]) + ((raw_value - float(control_range[0])) / control_width) * input_width


def _axis_quaternion(angle: float) -> np.ndarray:
    half_angle = angle / 2.0
    return np.asarray([math.cos(half_angle), 0.0, 0.0, math.sin(half_angle)], dtype=np.float64)


def _multiply_quaternion(left: Sequence[float], right: Sequence[float]) -> np.ndarray:
    left_w, left_x, left_y, left_z = left
    right_w, right_x, right_y, right_z = right
    return np.asarray(
        [
            left_w * right_w - left_x * right_x - left_y * right_y - left_z * right_z,
            left_w * right_x + left_x * right_w + left_y * right_z - left_z * right_y,
            left_w * right_y - left_x * right_z + left_y * right_w + left_z * right_x,
            left_w * right_z + left_x * right_y - left_y * right_x + left_z * right_w,
        ],
        dtype=np.float64,
    )


@dataclass
class _PendingRecording:
    episode_id: str
    state_id: str
    seed: int
    randomization: tuple[Mapping[str, Any], ...]
    frames: list[EpisodeFrame]
    started_at: str
    stopped_at: str
    simulation_start_time: float
    simulation_end_time: float
    recording_index: int
    attempt_seed: int
    # Frame index -> stored simulation state for frames whose backdrop images render at save.
    deferred_states: dict[int, dict[str, Any]] = dataclass_field(default_factory=dict)
    # Frames recorded in deferred mode (constant; ``deferred_states`` shrinks as frames render).
    deferred_frame_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "episodeId": self.episode_id,
            "stateId": self.state_id,
            "frameCount": len(self.frames),
            "startedAt": self.started_at,
            "stoppedAt": self.stopped_at,
            "simulationStartTime": self.simulation_start_time,
            "simulationEndTime": self.simulation_end_time,
        }


class TeleoperationSession:
    def __init__(
        self,
        environment: NativeEnvironment,
        profile: Mapping[str, Any],
        collection_dir: str | Path,
        *,
        session_id: str | None = None,
        collection_id: str | None = None,
        writer: EpisodeWriter | None = None,
        staging_directory: str | Path | None = None,
        staging_episode_index: int | None = None,
        collection_store: TeleoperationCollectionStore | None = None,
        read_only: bool = False,
        lease_timeout: float | None = TELEOPERATION_LEASE_TIMEOUT_SECONDS,
        live_backdrop_budget: bool | None = None,
    ) -> None:
        """Create a session.

        ``read_only`` (or a read-only ``collection_store``) is staging mode for batch workers:
        collection.json is never written, recordings need a planned attempt
        (:meth:`prepare_staging_attempt`), and saved episodes are written to ``staging_directory``
        and returned instead of being appended. ``lease_timeout=None`` disables lease expiry for
        in-process clients that have no heartbeat.

        ``live_backdrop_budget`` says whether ``profile.backdropRenderBudget`` applies. By default
        it applies only to interactive sessions (writable, unstaged, expiring leases); a recording
        that exceeds it defers its remaining backdrop frames to save time.
        """
        self.environment = environment
        self.profile = dict(profile)
        self.session_id = session_id or f"session-{uuid.uuid4()}"
        resolved_collection_id = collection_id or f"collection-{uuid.uuid4()}"
        scene_id = str(self.profile.get("sceneId", ""))
        scene_fingerprint = str(self.profile.get("sceneFingerprint", ""))
        if not scene_id or not scene_fingerprint:
            raise TeleoperationSessionError("profile.sceneId and profile.sceneFingerprint are required.")
        state_fields = self.profile.get("state")
        action_fields = self.profile.get("action")
        if not isinstance(state_fields, list) or not state_fields:
            raise TeleoperationSessionError("profile.state must contain at least one field.")
        if not isinstance(action_fields, list) or not action_fields:
            raise TeleoperationSessionError("profile.action must contain at least one field.")
        self._state_fields = state_fields
        self._action_fields = action_fields
        budget_enabled, budget_ms = _backdrop_render_budget(self.profile)
        self._backdrop_enabled = bool(
            isinstance(self.profile.get("backdrop"), Mapping)
            and self.profile.get("captureRgb", False)
            and self.profile.get("cameras")
        )
        self._read_only = bool(read_only) or bool(getattr(collection_store, "read_only", False))
        self._staging_directory = Path(staging_directory) if staging_directory is not None else None
        self._staging_episode_index = staging_episode_index
        if lease_timeout is not None and (not math.isfinite(float(lease_timeout)) or lease_timeout <= 0):
            raise TeleoperationSessionError("lease_timeout must be a positive number or None.")
        self._lease_timeout = None if lease_timeout is None else float(lease_timeout)
        if live_backdrop_budget is None:
            # Only the interactive worker (networked clients with expiring leases) records in real
            # time. Batch staging and in-process clients have no frame deadline: always render.
            live_backdrop_budget = (
                not self._read_only and self._staging_directory is None and self._lease_timeout is not None
            )
        self._backdrop_budget_enabled = self._backdrop_enabled and budget_enabled and bool(live_backdrop_budget)
        self._backdrop_budget_ms = budget_ms
        # Set when a live frame exceeded the budget; later frames of that recording are deferred.
        self._backdrop_deferred = False
        # Frame index -> stored simulation state of the active recording's deferred frames.
        self._recording_deferred_states: dict[int, dict[str, Any]] = {}
        # True while deferred frames of the stopped recording are being rendered for saving.
        self._backdrop_rendering = False
        self._backdrop_render_time_ms: float | None = None
        if self.profile.get("inputConvention") not in {"raw", "so101-normalized"}:
            raise TeleoperationSessionError(
                f"Unsupported teleoperation input convention '{self.profile.get('inputConvention')}'."
            )
        self.collection = collection_store or TeleoperationCollectionStore(
            collection_dir,
            collection_id=resolved_collection_id,
            scene_id=scene_id,
            scene_fingerprint=scene_fingerprint,
        )
        if self._read_only and not getattr(self.collection, "read_only", False):
            self.collection = self.collection.open_read_only()
        initial = self.environment.reset()
        self._base_state = self.collection.initialize_base(
            initial.qpos,
            initial.qvel,
            np.asarray(self.environment.data.ctrl, dtype=np.float64),
        )
        self._active_state = self._base_state
        self._model_overridden = False
        if self.collection.states and self.collection.states[0].state_id != self._base_state.state_id:
            raise TeleoperationSessionError("Collection base state is invalid.")
        self.environment.restore_state(
            self._active_state.qpos,
            self._active_state.qvel,
            self._active_state.ctrl,
            images=False,
        )
        self._last_observation = self.environment.observe(images=False)
        self._last_preview_images: dict[str, np.ndarray] = {}
        self._writer = writer
        if not self._read_only:
            # Only the collection owner may repair the shared dataset directory.
            self._recover_episode_deletions()
        self._lease_id: str | None = None
        self._lease_client: str | None = None
        self._lease_last_seen: float | None = None
        self._lease_expires = True
        self._state_revision = 0
        self._step_id = 0
        self._recording_episode_id: str | None = None
        self._recording_started_at: str | None = None
        self._recording_frames: list[EpisodeFrame] = []
        self._recording_attempt: dict[str, int] | None = None
        self._planned_attempt: dict[str, int] | None = None
        self._pending_recording: _PendingRecording | None = None
        self.last_staged_episode: dict[str, Any] | None = None
        self._recording_start_simulation_time = self._last_observation.simulation_time
        self._last_action: dict[str, float] = {
            str(field["name"]): 0.0 for field in self._action_fields if isinstance(field, Mapping)
        }

    def _recover_episode_deletions(self) -> None:
        episodes_directory = self.collection.root / "dataset" / "episodes"
        if not episodes_directory.exists():
            return
        referenced = {
            episode.get("episodeIndex")
            for episode in self.collection.episodes
            if isinstance(episode.get("episodeIndex"), int)
        }
        for candidate in episodes_directory.iterdir():
            if not candidate.is_dir() or ".deleting-" not in candidate.name:
                continue
            original_name, _, _token = candidate.name.partition(".deleting-")
            if not original_name.startswith("episode-"):
                continue
            try:
                index = int(original_name.removeprefix("episode-"))
            except ValueError:
                continue
            original = episodes_directory / original_name
            if index in referenced and not original.exists():
                os.replace(candidate, original)
            elif index not in referenced:
                shutil.rmtree(candidate, ignore_errors=True)

    @property
    def collection_id(self) -> str:
        return self.collection.collection_id

    @property
    def state_revision(self) -> int:
        return self._state_revision

    @property
    def read_only(self) -> bool:
        return self._read_only

    @property
    def active_lease_id(self) -> str | None:
        return self._lease_id

    @property
    def active_state_id(self) -> str:
        return self._active_state.state_id

    @property
    def recording(self) -> bool:
        return self._recording_episode_id is not None

    @property
    def pending_recording(self) -> dict[str, Any] | None:
        if self._pending_recording is None:
            return None
        value = self._pending_recording.to_dict()
        value["backdropRenderStatus"] = self.backdrop_render_status
        value["backdropDeferredFrames"] = len(self._pending_recording.deferred_states)
        return value

    @property
    def backdrop_render_status(self) -> str:
        """``inactive`` (no backdrop), ``live``, ``deferred`` (frames render at save), or
        ``rendering`` (deferred frames are rendering for a save)."""
        if not self._backdrop_enabled:
            return "inactive"
        if self._backdrop_rendering:
            return "rendering"
        if (self.recording and self._backdrop_deferred) or self.backdrop_deferred_frames:
            return "deferred"
        return "live"

    @property
    def backdrop_deferred_frames(self) -> int:
        """Frames of the active or stopped recording whose backdrop images are not rendered yet."""
        if self.recording:
            return len(self._recording_deferred_states)
        if self._pending_recording is not None:
            return len(self._pending_recording.deferred_states)
        return 0

    @property
    def recording_episode_id(self) -> str | None:
        return self._recording_episode_id

    @property
    def recorded_frame_count(self) -> int:
        """Frames recorded so far by the active recording."""
        return len(self._recording_frames)

    @property
    def save_pending(self) -> bool:
        """True while a stopped recording waits to be saved or discarded."""
        return self._pending_recording is not None

    @property
    def episode_count(self) -> int:
        return len(self.collection.episodes)

    def describe(self) -> dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "collectionId": self.collection_id,
            "sceneId": self.collection.scene_id,
            "sceneFingerprint": self.collection.scene_fingerprint,
            "profile": dict(self.profile),
            "collection": self.collection.to_dict(),
            "stateRevision": self._state_revision,
            "activeStateId": self.active_state_id,
            "recording": self.recording,
            "pendingRecording": self.pending_recording,
            "backdropRenderStatus": self.backdrop_render_status,
            "backdropDeferredFrames": self.backdrop_deferred_frames,
            "episodeCount": self.episode_count,
        }

    def acquire(self, client_id: str, *, expires: bool = True) -> str:
        """Acquire the control lease; ``expires=False`` is for in-process clients without heartbeat."""
        self.expire_stale_lease()
        if self._lease_id is not None:
            raise TeleoperationLeaseError("Another client already owns the teleoperation lease.")
        if not client_id:
            raise TeleoperationLeaseError("A client id is required to acquire teleoperation.")
        self._lease_client = client_id
        self._lease_id = f"lease-{uuid.uuid4()}"
        self._lease_last_seen = time.monotonic()
        self._lease_expires = bool(expires)
        return self._lease_id

    def release(self, client_id: str, lease_id: str) -> None:
        self._require_lease(client_id, lease_id)
        self._lease_id = None
        self._lease_client = None
        self._lease_last_seen = None

    def ping(self, client_id: str, lease_id: str) -> None:
        self._require_lease(client_id, lease_id)

    def expire_stale_lease(self, now: float | None = None) -> bool:
        if self._lease_id is None or self._lease_last_seen is None:
            return False
        if self._lease_timeout is None or not self._lease_expires:
            return False
        current_time = time.monotonic() if now is None else now
        if current_time - self._lease_last_seen < self._lease_timeout:
            return False
        self.revoke_control()
        return True

    def revoke_control(self) -> None:
        self.interrupt_recording()
        self._lease_id = None
        self._lease_client = None
        self._lease_last_seen = None

    def reset_evaluation(
        self, client_id: str, lease_id: str, seed: int | None
    ) -> NativeObservation:
        self._require_lease(client_id, lease_id)
        if self.recording or self._pending_recording is not None:
            raise TeleoperationRecordingError("Finish the recording before resetting an evaluation.")
        self._last_observation = self.environment.reset(seed=seed)
        self._step_id = 0
        return self._last_observation

    def _require_lease(self, client_id: str, lease_id: str | None) -> None:
        self.expire_stale_lease()
        if self._lease_id is None:
            raise TeleoperationLeaseError("Teleoperation has not been acquired.")
        if client_id != self._lease_client or lease_id != self._lease_id:
            raise TeleoperationLeaseError("The teleoperation lease is invalid.")
        self._lease_last_seen = time.monotonic()

    def _require_control(
        self,
        client_id: str,
        lease_id: str | None,
        *,
        allow_admin: bool = False,
    ) -> None:
        if allow_admin and client_id == "node-admin" and lease_id is None:
            return
        if not isinstance(lease_id, str) or not lease_id:
            raise TeleoperationLeaseError("A leaseId is required for this command.")
        self._require_lease(client_id, lease_id)

    def _require_revision(self, expected_state_revision: int | None) -> None:
        if expected_state_revision is not None and expected_state_revision != self._state_revision:
            raise TeleoperationStateError(
                f"State revision {expected_state_revision} is stale; current revision is "
                f"{self._state_revision}."
            )

    def _action_vector(self, values: Mapping[str, float]) -> tuple[float, ...]:
        # `values` are raw actuator control-space values (whatever the connecting teleoperation
        # script sent). Recorded frames must match the state fields' units instead: convert into
        # the profile's declared input convention (e.g. so101-normalized) via the inverse of
        # evaluation/session.py's _remap_action_value, so an evaluated policy sees the same units
        # in state and action that it saw in the recorded training data.
        return tuple(
            _normalize_action_for_recording(field, float(values[str(field["name"])]))
            for field in self._action_fields
        )

    def _resolve_kinematic_state(
        self,
        value: Mapping[str, Any] | None,
    ) -> tuple[dict[str, float], tuple[tuple[str, tuple[float, ...], tuple[float, ...] | None], ...]]:
        if value is None:
            return {}, ()
        if not isinstance(value, Mapping):
            raise TeleoperationStateError("kinematicState must be an object.")
        joint_positions_value = value.get("jointPositions", {})
        if not isinstance(joint_positions_value, Mapping):
            raise TeleoperationStateError("kinematicState.jointPositions must be an object.")
        joint_positions: dict[str, float] = {}
        for name, raw_position in joint_positions_value.items():
            if not isinstance(name, str) or not name.strip():
                raise TeleoperationStateError("Kinematic joint names must be non-empty strings.")
            if isinstance(raw_position, bool) or not isinstance(raw_position, (int, float)):
                raise TeleoperationStateError(f"Kinematic joint '{name}' must be numeric.")
            position = float(raw_position)
            if not math.isfinite(position):
                raise TeleoperationStateError(f"Kinematic joint '{name}' must be finite.")
            joint_positions[name] = position

        body_poses_value = value.get("bodyPoses", {})
        if not isinstance(body_poses_value, Mapping):
            raise TeleoperationStateError("kinematicState.bodyPoses must be an object.")
        body_poses: list[tuple[str, tuple[float, ...], tuple[float, ...] | None]] = []
        for name, raw_pose in body_poses_value.items():
            if not isinstance(name, str) or not name.strip():
                raise TeleoperationStateError("Kinematic body names must be non-empty strings.")
            if not isinstance(raw_pose, Mapping):
                raise TeleoperationStateError(f"Kinematic pose for body '{name}' must be an object.")
            raw_position = raw_pose.get("position")
            if (
                not isinstance(raw_position, Sequence)
                or isinstance(raw_position, (str, bytes))
                or len(raw_position) != 3
            ):
                raise TeleoperationStateError(f"Kinematic position for body '{name}' must have three values.")
            position = tuple(float(item) for item in raw_position)
            if not all(math.isfinite(item) for item in position):
                raise TeleoperationStateError(f"Kinematic position for body '{name}' must be finite.")
            raw_quaternion = raw_pose.get("quaternion")
            quaternion: tuple[float, ...] | None = None
            if raw_quaternion is not None:
                if (
                    not isinstance(raw_quaternion, Sequence)
                    or isinstance(raw_quaternion, (str, bytes))
                    or len(raw_quaternion) != 4
                ):
                    raise TeleoperationStateError(
                        f"Kinematic quaternion for body '{name}' must have four values."
                    )
                quaternion = tuple(float(item) for item in raw_quaternion)
                if not all(math.isfinite(item) for item in quaternion):
                    raise TeleoperationStateError(
                        f"Kinematic quaternion for body '{name}' must be finite."
                    )
            body_poses.append((name, position, quaternion))
        if not joint_positions and not body_poses:
            raise TeleoperationStateError("kinematicState must include jointPositions or bodyPoses.")
        return joint_positions, tuple(body_poses)

    def _randomization_metadata(self, *, include_overrides: bool = False) -> tuple[Mapping[str, Any], ...]:
        """Per-frame randomization metadata; episode summaries also carry the model overrides."""
        state = self._active_state
        entries: list[Mapping[str, Any]] = []
        if state.source_randomization is not None:
            entries.append(dict(state.source_randomization))
        entries.extend(dict(sample) for sample in state.object_randomization)
        # The stored rule (kept so states can be rebuilt in an edited scene) stays out of frames.
        entries.extend(
            {key: value for key, value in sample.items() if key != "rule"}
            for sample in state.model_randomization
        )
        if include_overrides and state.model_overrides:
            entries.append(
                {
                    "kind": "model-overrides",
                    "target": "model",
                    "values": [],
                    "overrides": [dict(override) for override in state.model_overrides],
                }
            )
        return tuple(entries)

    def step(
        self,
        client_id: str,
        lease_id: str,
        targets: Mapping[str, float],
        *,
        physics_steps: int | None = None,
        expected_state_revision: int | None = None,
        kinematic_state: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._require_lease(client_id, lease_id)
        self._require_revision(expected_state_revision)
        if physics_steps is not None:
            physics_steps = _finite_integer(physics_steps, "physics_steps")
            if physics_steps < 1 or physics_steps > 1_000:
                raise TeleoperationSessionError("physics_steps must be between 1 and 1000.")
        joint_positions, body_poses = self._resolve_kinematic_state(kinematic_state)
        values = self.environment.validate_action(targets)

        # State and cameras must describe the same pre-action simulation state. In
        # particular, do not pair pre-action joints with post-action rendered images.
        pre_action_observation = None
        deferred_render_state: dict[str, Any] | None = None
        if self.recording:
            # A streaming writer needs every camera in every frame, so it never defers.
            budget_enabled = self._backdrop_budget_enabled and not self._streams_frames()
            decision = backdrop_render_decision(
                backdrop_enabled=self._backdrop_enabled,
                budget_enabled=budget_enabled,
                render_time_ms=None,
                threshold_ms=self._backdrop_budget_ms,
                deferred=self._backdrop_deferred,
            )
            if decision == "deferred":
                # Store what is needed to re-render this frame exactly when the recording is saved
                # (forward kinematics as for live frames, so derived state values match too).
                pre_action_observation = self._forward_observation(images=False)
                deferred_render_state = self._capture_render_state(pre_action_observation.simulation_time)
            else:
                render_started = time.monotonic()
                # While frames may be deferred, live frames render at fresh kinematics so they
                # match frames rendered from stored states at save time.
                pre_action_observation = (
                    self._forward_observation(images=True)
                    if budget_enabled
                    else self.environment.observe(images=True)
                )
                self._backdrop_render_time_ms = (time.monotonic() - render_started) * 1000.0
                if (
                    backdrop_render_decision(
                        backdrop_enabled=self._backdrop_enabled,
                        budget_enabled=budget_enabled,
                        render_time_ms=self._backdrop_render_time_ms,
                        threshold_ms=self._backdrop_budget_ms,
                    )
                    == "defer"
                ):
                    self._backdrop_deferred = True
        pre_action_ctrl = (
            np.asarray(self.environment.data.ctrl, dtype=np.float64).copy()
            if pre_action_observation is not None
            else None
        )
        pre_action_state = (
            self.environment.state_values(self._state_fields)
            if pre_action_observation is not None
            else None
        )

        observation = self.environment.step(values, physics_steps=physics_steps, observe="state")
        if joint_positions:
            self.environment.set_joint_positions(joint_positions)
        for body_name, position, quaternion in body_poses:
            self.environment.set_body_pose(body_name, position, quaternion)
        if joint_positions or body_poses:
            observation = self.environment.observe(images=False)
        self._last_observation = observation
        self._step_id += 1
        self._last_action = dict(values)
        if self.recording:
            if pre_action_observation is None or pre_action_state is None or pre_action_ctrl is None:
                raise TeleoperationRecordingError("The pre-action observation sample is unavailable.")
            frame_index = len(self._recording_frames)
            backdrop_metadata = (
                {"backdropRender": "deferred" if deferred_render_state is not None else "live"}
                if self._backdrop_enabled
                else {}
            )
            self.write_recording_frame(
                EpisodeFrame.from_values(
                    frame_index,
                    pre_action_observation.simulation_time,
                    pre_action_state,
                    self._action_vector(values),
                    str(self.profile.get("name", "teleoperation")),
                    randomization=self._randomization_metadata(),
                    images=pre_action_observation.images if deferred_render_state is None else {},
                    metadata={
                        "stateId": self.active_state_id,
                        "stepId": self._step_id,
                        "samplePhase": "pre-action",
                        "controlMode": (
                            "kinematically-assisted" if joint_positions or body_poses else "physics-only"
                        ),
                        "nextSimulationTime": observation.simulation_time,
                        "qpos": np.asarray(pre_action_observation.qpos, dtype=np.float64).tolist(),
                        "qvel": np.asarray(pre_action_observation.qvel, dtype=np.float64).tolist(),
                        "ctrl": pre_action_ctrl.tolist(),
                        "nextQpos": np.asarray(observation.qpos, dtype=np.float64).tolist(),
                        "nextQvel": np.asarray(observation.qvel, dtype=np.float64).tolist(),
                        "nextCtrl": np.asarray(self.environment.data.ctrl, dtype=np.float64).tolist(),
                        **backdrop_metadata,
                    },
                )
            )
            if deferred_render_state is not None:
                self._recording_deferred_states[frame_index] = deferred_render_state
        return {
            "stepId": self._step_id,
            "simulationTime": observation.simulation_time,
            "stateRevision": self._state_revision,
            "state": list(self.environment.state_values(self._state_fields)),
        }

    def reset(self, client_id: str, lease_id: str, *, state_id: str | None = None) -> dict[str, Any]:
        self._require_lease(client_id, lease_id)
        if self.recording:
            raise TeleoperationRecordingError("Stop or discard the active recording before reset.")
        if state_id is not None:
            self._select_state(state_id)
        else:
            self._last_observation = self.environment.restore_state(
                self._active_state.qpos,
                self._active_state.qvel,
                self._active_state.ctrl,
                images=False,
            )
            self._step_id = 0
        return {
            "stateId": self.active_state_id,
            "stateRevision": self._state_revision,
            "stepId": self._step_id,
        }

    def prepare_staging_attempt(
        self,
        *,
        recording_index: int,
        attempt_seed: int,
        directory: str | Path | None = None,
    ) -> None:
        """Plan the next staged recording of a read-only batch worker.

        The batch owner reserves recording indices and derives attempt seeds before any worker
        starts, so the worker records with the plan's values instead of claiming a counter.
        ``directory`` (optional) replaces the staging directory for this attempt.
        """
        if not self._read_only:
            raise TeleoperationRecordingError("Planned attempts are reserved for read-only staging sessions.")
        if self.recording or self._pending_recording is not None:
            raise TeleoperationRecordingError("Finish the current staged recording first.")
        if directory is not None:
            self._staging_directory = Path(directory)
        if self._staging_directory is None:
            raise TeleoperationRecordingError("Staged recordings need a staging directory.")
        self._planned_attempt = {
            "recordingIndex": _finite_integer(recording_index, "recording_index"),
            "attemptSeed": _finite_integer(attempt_seed, "attempt_seed"),
        }
        self.last_staged_episode = None

    def _streams_frames(self) -> bool:
        """Staged recordings with an incremental writer stream images instead of keeping them."""
        return self._staging_directory is not None and callable(
            getattr(self._writer, "finalize_episode", None)
        )

    def _abort_streamed_frames(self) -> None:
        if self._streams_frames():
            abort = getattr(self._writer, "abort", None)
            if callable(abort):
                abort()

    def start_recording(self, client_id: str, lease_id: str | None = None, *, admin: bool = False) -> str:
        self._require_control(client_id, lease_id, allow_admin=admin)
        if self.recording:
            raise TeleoperationRecordingError("A recording is already active.")
        if self._pending_recording is not None:
            raise TeleoperationRecordingError("Save or discard the stopped recording first.")
        if self._read_only:
            if self._planned_attempt is None:
                raise TeleoperationRecordingError("Read-only recordings need an attempt plan.")
            attempt, self._planned_attempt = self._planned_attempt, None
            return self._start_recording_slot(attempt)
        recording_index = self.collection.claim_recording_index()
        # Every recording gets its own seed, even from the same state or after a restart, so a
        # scripted controller can vary each attempt instead of replaying an identical episode.
        return self._start_recording_slot(
            {
                "recordingIndex": recording_index,
                "attemptSeed": derive_seed(self._active_state.seed, recording_index),
            }
        )

    def _start_recording_slot(self, attempt: Mapping[str, int]) -> str:
        self._recording_episode_id = f"episode-{uuid.uuid4()}"
        self._recording_started_at = _now()
        self._recording_start_simulation_time = self._last_observation.simulation_time
        self._recording_frames = []
        self._recording_deferred_states = {}
        self._backdrop_deferred = False
        self._backdrop_render_time_ms = None
        self._recording_attempt = {
            "recordingIndex": int(attempt["recordingIndex"]),
            "attemptSeed": int(attempt["attemptSeed"]),
        }
        if self._streams_frames():
            begin = getattr(self._writer, "begin_episode", None)
            if callable(begin):
                begin(self._staging_directory)
        return self._recording_episode_id

    def _pending_from_active(self) -> _PendingRecording:
        attempt = self._recording_attempt or {"recordingIndex": 0, "attemptSeed": 0}
        return _PendingRecording(
            episode_id=self._recording_episode_id or f"episode-{uuid.uuid4()}",
            state_id=self.active_state_id,
            seed=self._active_state.seed,
            randomization=self._randomization_metadata(include_overrides=True),
            frames=list(self._recording_frames),
            started_at=self._recording_started_at or _now(),
            stopped_at=_now(),
            simulation_start_time=self._recording_start_simulation_time,
            simulation_end_time=self._last_observation.simulation_time,
            recording_index=attempt["recordingIndex"],
            attempt_seed=attempt["attemptSeed"],
            deferred_states=dict(self._recording_deferred_states),
            deferred_frame_count=len(self._recording_deferred_states),
        )

    def stop_recording_to_episode(
        self,
        client_id: str,
        lease_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Stop and save the active recording in one call (``None`` when it has no frames)."""
        self._require_control(client_id, lease_id)
        if not self.recording:
            raise TeleoperationRecordingError("No recording is active.")
        if self.stop_recording(client_id, lease_id)["pendingRecording"] is None:
            return None
        return self.save_recording(client_id, lease_id, metadata=metadata)

    @property
    def recording_attempt(self) -> dict[str, int] | None:
        """``recordingIndex`` and ``attemptSeed`` of the active recording."""
        return dict(self._recording_attempt) if self._recording_attempt is not None else None

    def stop_recording(
        self, client_id: str, lease_id: str | None = None, *, admin: bool = False
    ) -> dict[str, Any]:
        self._require_control(client_id, lease_id, allow_admin=admin)
        if not self.recording or self._recording_episode_id is None:
            raise TeleoperationRecordingError("No recording is active.")
        if not self._recording_frames:
            self._abort_streamed_frames()
            self._clear_recording()
            return {"pendingRecording": None}
        self._pending_recording = self._pending_from_active()
        self._clear_recording()
        return {"pendingRecording": self.pending_recording}

    def render_deferred_frames(
        self,
        client_id: str,
        lease_id: str | None = None,
        *,
        admin: bool = False,
        limit: int | None = None,
    ) -> int:
        """Render up to ``limit`` deferred backdrop frames of the stopped recording.

        Returns the number of frames still deferred. :meth:`save_recording` renders whatever is
        left, so callers only need this to render in slices (for example on the thread that owns
        the GL context, yielding between frames) and to report progress. The status stays
        ``rendering`` from the first slice until every frame is rendered or a render fails.
        """
        self._require_control(client_id, lease_id, allow_admin=admin)
        if self.recording:
            raise TeleoperationRecordingError("Stop the active recording before rendering it.")
        if self._pending_recording is None:
            raise TeleoperationRecordingError("No stopped recording is ready to save.")
        if limit is not None and (not isinstance(limit, int) or isinstance(limit, bool) or limit < 1):
            raise TeleoperationRecordingError("limit must be a positive integer.")
        return self._render_deferred_frames(limit)

    def _render_deferred_frames(self, limit: int | None = None) -> int:
        pending = self._pending_recording
        if pending is None or not pending.deferred_states:
            self._backdrop_rendering = False
            return 0
        indices = sorted(pending.deferred_states)
        if limit is not None:
            indices = indices[:limit]
        # Deferred frames show the recording's state (model overrides included) even when another
        # state was selected after the recording stopped.
        recorded_state = (
            self.collection.state(pending.state_id)
            if pending.state_id != self.active_state_id
            else None
        )
        self._backdrop_rendering = True
        try:
            if recorded_state is not None:
                self._restore_model(recorded_state)
            try:
                for index in indices:
                    images = self._render_stored_state(pending.deferred_states[index])
                    frame = pending.frames[index]
                    # The rendered images replace the empty placeholder; nothing is kept twice.
                    pending.frames[index] = replace(
                        frame,
                        images={name: RGBImage.from_array(image) for name, image in images.items()},
                    )
                    del pending.deferred_states[index]
            finally:
                if recorded_state is not None:
                    self._restore_model(self._active_state)
        except Exception:
            self._backdrop_rendering = False
            raise
        if not pending.deferred_states:
            self._backdrop_rendering = False
        return len(pending.deferred_states)

    def _forward_observation(self, *, images: bool) -> NativeObservation:
        """Observe after recomputing kinematics (mj_forward) at the current state.

        After ``mj_step`` the kinematics describe the state before the last substep; a stored
        state re-rendered at save time is forwarded, so recordings that may defer use this for
        live frames too. Forward kinematics do not change the physics trajectory.
        """
        data = self.environment.data
        return self.environment.restore_state(
            np.array(data.qpos, dtype=np.float64, copy=True),
            np.array(data.qvel, dtype=np.float64, copy=True),
            np.array(data.ctrl, dtype=np.float64, copy=True),
            images=images,
        )

    def _capture_render_state(self, simulation_time: float) -> dict[str, Any]:
        """Copy the simulation state that determines a camera image (memory: a few vectors)."""
        data = self.environment.data
        state: dict[str, Any] = {"time": float(getattr(data, "time", simulation_time))}
        for name in _RENDER_STATE_ARRAYS:
            value = getattr(data, name, None)
            if value is not None:
                state[name] = np.array(value, dtype=np.float64, copy=True)
        return state

    def _write_render_state(self, state: Mapping[str, Any]) -> None:
        """Write the non-qpos/qvel parts of a render state (restore_state writes those)."""
        data = self.environment.data
        for name in ("act", "mocap_pos", "mocap_quat"):
            if name in state and getattr(data, name, None) is not None:
                np.asarray(getattr(data, name))[...] = state[name]
        if "time" in state and hasattr(data, "time"):
            data.time = float(state["time"])

    def _render_stored_state(self, state: Mapping[str, Any]) -> dict[str, np.ndarray]:
        """Render camera images at a stored state, then put the live simulation state back.

        ``restore_state`` runs ``mj_forward`` (kinematics only: the live trajectory, ctrl, and
        solver warm start are untouched), so the session continues exactly where it was.
        """
        live = self._capture_render_state(self._last_observation.simulation_time)
        live_ctrl = np.array(self.environment.data.ctrl, dtype=np.float64, copy=True)
        try:
            self._write_render_state(state)
            observation = self.environment.restore_state(state["qpos"], state["qvel"], live_ctrl, images=True)
            images = {name: np.asarray(image) for name, image in observation.images.items()}
        finally:
            self._write_render_state(live)
            self.environment.restore_state(live["qpos"], live["qvel"], live_ctrl, images=False)
        if not images:
            raise TeleoperationRecordingError("The environment rendered no camera images for a deferred frame.")
        return images

    def save_recording(
        self,
        client_id: str,
        lease_id: str | None = None,
        *,
        admin: bool = False,
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._require_control(client_id, lease_id, allow_admin=admin)
        if self.recording:
            raise TeleoperationRecordingError("Stop the active recording before saving.")
        pending = self._pending_recording
        if pending is None:
            raise TeleoperationRecordingError("No stopped recording is ready to save.")
        controller_metadata = _episode_metadata(metadata)
        # Frames deferred during a slow live recording render now, so every frame has every camera.
        self._render_deferred_frames()
        staged = self._staging_directory is not None
        episode_index = (
            (self._staging_episode_index or 0) if staged else self.collection.next_episode_index
        )
        summary = EpisodeSummary(
            episode_index=episode_index,
            seed=pending.seed,
            status="recorded",
            attempts=1,
            steps=len(pending.frames),
            randomization=pending.randomization,
            control_mode=(
                "kinematically-assisted"
                if any(frame.metadata.get("controlMode") == "kinematically-assisted" for frame in pending.frames)
                else "physics-only"
            ),
        )
        episode = CollectedEpisode(summary, tuple(pending.frames))
        if staged:
            finalize = getattr(self._writer, "finalize_episode", None)
            write_at = getattr(self._writer, "write_episode_at", None)
            if callable(finalize):
                artifact_path = finalize(episode, summary=summary.to_dict())
            elif callable(write_at):
                artifact_path = write_at(episode, self._staging_directory)
            else:
                raise TeleoperationRecordingError("Staging mode requires a staging-capable writer.")
        else:
            artifact_path = self._writer.write_episode(episode) if self._writer is not None else None
        value = {
            "episodeId": pending.episode_id,
            "episodeIndex": episode_index,
            "stateId": pending.state_id,
            "status": "recorded",
            "frameCount": len(pending.frames),
            "startedAt": pending.started_at,
            "endedAt": pending.stopped_at,
            "simulationStartTime": pending.simulation_start_time,
            "simulationEndTime": pending.simulation_end_time,
            "controlMode": summary.control_mode,
            "recordingIndex": pending.recording_index,
            "attemptSeed": pending.attempt_seed,
            "backdropRenderStatus": (
                "inactive"
                if not self._backdrop_enabled
                else "deferred"
                if pending.deferred_frame_count
                else "live"
            ),
            "backdropDeferredFrames": pending.deferred_frame_count,
        }
        if controller_metadata is not None:
            value["controller"] = controller_metadata
        if artifact_path is not None:
            value["artifactPath"] = str(artifact_path)
        if staged:
            # A staged episode is committed later, in plan order, by the collection owner.
            self._pending_recording = None
            self.last_staged_episode = dict(value)
            return dict(value)
        committed = self.collection.append_episode(value)
        self._pending_recording = None
        if not admin:
            # Saving can write a large artifact synchronously. Keep the lease alive
            # through that write so the following release command remains valid.
            self._lease_last_seen = time.monotonic()
        return dict(committed)

    def _episode_directory(self, episode_index: int) -> Path:
        return self.collection.root / "dataset" / "episodes" / f"episode-{episode_index:06d}"

    def update_episode(
        self,
        client_id: str,
        lease_id: str | None,
        episode_id: str,
        updates: Mapping[str, Any],
        *,
        admin: bool = False,
    ) -> dict[str, Any]:
        self._require_control(client_id, lease_id, allow_admin=admin)
        try:
            return dict(self.collection.update_episode(episode_id, updates))
        except Exception as error:
            raise TeleoperationRecordingError(str(error)) from error

    def delete_episode(
        self,
        client_id: str,
        lease_id: str | None,
        episode_id: str,
        *,
        admin: bool = False,
    ) -> dict[str, Any]:
        self._require_control(client_id, lease_id, allow_admin=admin)
        try:
            episode = self.collection.episode(episode_id)
            episode_index = episode.get("episodeIndex")
            if not isinstance(episode_index, int):
                raise TeleoperationRecordingError("The saved episode has an invalid episode index.")
            artifact_directory = self._episode_directory(episode_index)
            if artifact_directory.exists() and (
                not artifact_directory.is_dir() or artifact_directory.is_symlink()
            ):
                raise TeleoperationRecordingError("The saved episode artifact is invalid.")
            tombstone = artifact_directory.with_name(f"{artifact_directory.name}.deleting-{uuid.uuid4().hex}")
            artifact_moved = False
            try:
                os.replace(artifact_directory, tombstone)
                artifact_moved = True
            except FileNotFoundError:
                pass
            try:
                deleted = self.collection.delete_episode(episode_id)
            except Exception:
                if artifact_moved and tombstone.exists():
                    os.replace(tombstone, artifact_directory)
                raise
            if artifact_moved:
                try:
                    shutil.rmtree(tombstone)
                except OSError:
                    # Metadata no longer references this artifact; leave the uniquely named
                    # tombstone for startup cleanup rather than making deletion non-retryable.
                    pass
            return dict(deleted)
        except TeleoperationRecordingError:
            raise
        except Exception as error:
            raise TeleoperationRecordingError(str(error)) from error

    def discard_recording(self, client_id: str, lease_id: str | None = None, *, admin: bool = False) -> str:
        self._require_control(client_id, lease_id, allow_admin=admin)
        if self.recording and self._recording_episode_id is not None:
            episode_id = self._recording_episode_id
            self._abort_streamed_frames()
            self._clear_recording()
            return episode_id
        if self._pending_recording is not None:
            episode_id = self._pending_recording.episode_id
            self._abort_streamed_frames()
            self._pending_recording = None
            self._backdrop_rendering = False
            return episode_id
        raise TeleoperationRecordingError("No recording is active.")

    def interrupt_recording(self) -> dict[str, Any] | None:
        if not self.recording or self._recording_episode_id is None:
            return None
        if self._read_only:
            self._abort_streamed_frames()
            self._clear_recording()
            return None
        value = self.collection.append_episode(
            {
                "episodeId": self._recording_episode_id,
                "episodeIndex": self.collection.next_episode_index,
                "stateId": self.active_state_id,
                "status": "interrupted",
                "frameCount": len(self._recording_frames),
                "startedAt": self._recording_started_at or _now(),
                "endedAt": _now(),
                "simulationStartTime": self._recording_start_simulation_time,
                "simulationEndTime": self._last_observation.simulation_time,
            }
        )
        self._clear_recording()
        return dict(value)

    def _clear_recording(self) -> None:
        self._recording_attempt = None
        self._recording_episode_id = None
        self._recording_started_at = None
        self._recording_frames = []
        self._recording_deferred_states = {}
        self._backdrop_deferred = False

    def append_randomized_state(
        self,
        client_id: str,
        lease_id: str | None,
        seed: int,
        *,
        source_randomization: Mapping[str, Any] | None = None,
        model_randomization: Sequence[Mapping[str, Any]] | None = None,
        robot_randomization: Mapping[str, Any] | None = None,
        admin: bool = False,
    ) -> dict[str, Any]:
        self._require_control(client_id, lease_id, allow_admin=admin)
        if self._read_only:
            raise TeleoperationStateError("This teleoperation session is read-only.")
        if self.recording:
            raise TeleoperationStateError("Randomized states cannot be added while recording.")
        robot_config = _robot_randomization_config(
            self.profile.get("robotRandomization") if robot_randomization is None else robot_randomization
        )
        model_rules = _model_rules(
            self.profile.get("modelRandomization") if model_randomization is None else model_randomization,
            backdrop_body=_backdrop_body(self.profile),
        )
        seed = _finite_integer(seed, "seed")
        base_state = self._active_state
        configuration = source_randomization or self.profile.get("sourceRandomization")
        if not isinstance(configuration, Mapping) or not configuration.get("enabled", False):
            raise TeleoperationStateError("Source randomization is not enabled in this session.")
        body = configuration.get("body")
        if not isinstance(body, str) or not body.strip():
            raise TeleoperationStateError("sourceRandomization.body is required.")
        x_range = _range_value(configuration.get("xCm"), "sourceRandomization.xCm")
        y_range = _range_value(configuration.get("yCm"), "sourceRandomization.yCm")
        yaw_range = _range_value(configuration.get("yawDegrees"), "sourceRandomization.yawDegrees")
        object_zones = _object_randomization_config(configuration, body)
        self._last_observation = self.environment.restore_state(
            self._base_state.qpos,
            self._base_state.qvel,
            self._base_state.ctrl,
            images=False,
        )
        random = XorShift32(seed)
        x_cm = random.range(list(x_range))
        y_cm = random.range(list(y_range))
        yaw_degrees = random.range(list(yaw_range))
        # Model rules continue the same seeded stream after the pose draws, so existing seeds keep
        # their object poses when appearance or physics randomization is enabled.
        model_samples: list[dict[str, Any]] = []
        model_overrides: list[dict[str, Any]] = []
        if model_rules:
            try:
                model_samples = sample_rules(model_rules, random)
                model_overrides = self.environment.apply_model_rules(model_rules, model_samples)
            except (KeyError, TypeError, ValueError, NativeEnvironmentError) as error:
                self._restore_model(self._active_state)
                raise TeleoperationStateError(f"Model randomization failed: {error}") from error
            self._model_overridden = True
        elif self._model_overridden:
            self.environment.restore_model_baseline()
            self._model_overridden = False
        base_position = self.environment.body_position(body)
        base_quaternion = self.environment.quaternion_from_rotation(self.environment.body_rotation(body))
        quaternion = _multiply_quaternion(base_quaternion, _axis_quaternion(math.radians(yaw_degrees)))
        position = base_position + np.asarray([x_cm / 100.0, y_cm / 100.0, 0.0], dtype=np.float64)
        self.environment.set_body_pose(body, position, quaternion)
        # The robot start pose continues the seeded stream after the object pose and model rules,
        # so existing seeds keep their object poses and appearance.
        try:
            object_samples = (
                self._randomize_object_poses(
                    object_zones, XorShift32(derive_seed(seed, OBJECT_STREAM_SALT))
                )
                if object_zones
                else []
            )
            robot_sample = self._randomize_robot_pose(*robot_config, random) if robot_config else None
        except TeleoperationStateError:
            # Leave the environment showing the still-active state, as other failed appends do.
            self._restore_model(base_state)
            active = base_state
            self._last_observation = self.environment.restore_state(
                active.qpos, active.qvel, active.ctrl, images=False
            )
            raise
        self._last_observation = self.environment.observe(images=False)
        state = self.collection.append_state(
            seed=seed,
            qpos=np.asarray(self.environment.data.qpos, dtype=np.float64),
            qvel=np.asarray(self.environment.data.qvel, dtype=np.float64),
            ctrl=np.asarray(self.environment.data.ctrl, dtype=np.float64),
            source_randomization={
                "target": body,
                "values": [x_cm, y_cm, yaw_degrees],
            },
            label=f"{self.profile.get('name', 'scene')} - state-{self.collection.next_state_index:06d}",
            model_randomization=[
                {"kind": rule["kind"], "ruleIndex": index, **sample, "rule": dict(rule)}
                for index, (rule, sample) in enumerate(zip(model_rules, model_samples, strict=True))
            ],
            model_overrides=model_overrides,
            robot_randomization=robot_sample,
            object_randomization=object_samples,
        )
        self._active_state = state
        self._state_revision += 1
        self._step_id = 0
        return state.to_dict()

    def import_states(
        self,
        client_id: str,
        lease_id: str | None,
        states: Sequence[Mapping[str, Any]],
        *,
        origin_collection_id: str,
        admin: bool = False,
    ) -> dict[str, Any]:
        """Rebuild generated states from an earlier scene version in this (edited) scene.

        Each state is rebuilt from its stored randomization values rather than its raw joint
        positions: the source object is offset from its authored pose in *this* scene, model samples
        are re-applied, and robot joint offsets are re-applied. States that no longer fit (removed
        object, joint, or randomization target, or a pose that now overlaps other geometry) are
        skipped with a reason. Returns ``{"imported": [...], "skipped": [...]}``.
        """
        self._require_control(client_id, lease_id, allow_admin=admin)
        if self._read_only:
            raise TeleoperationStateError("This teleoperation session is read-only.")
        if self.recording:
            raise TeleoperationStateError("States cannot be imported while recording.")
        active = self._active_state
        imported: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        try:
            for value in states:
                origin_id = str(value.get("stateId", "")) if isinstance(value, Mapping) else ""
                origin_label = str(value.get("label", origin_id)) if isinstance(value, Mapping) else ""
                try:
                    if not isinstance(value, Mapping):
                        raise TeleoperationStateError("The state is not an object.")
                    state = self._rebuild_state(
                        value,
                        origin={
                            "collectionId": origin_collection_id,
                            "stateId": origin_id,
                            "label": origin_label,
                        },
                    )
                except TeleoperationStateError as error:
                    skipped.append({"stateId": origin_id, "label": origin_label, "reason": str(error)})
                    continue
                imported.append({"fromStateId": origin_id, "state": state.to_dict()})
        finally:
            # Leave the environment showing the state that was active before the import.
            self._restore_model(active)
            self._last_observation = self.environment.restore_state(
                active.qpos, active.qvel, active.ctrl, images=False
            )
            self._active_state = active
            self._state_revision += 1
            self._step_id = 0
        return {"imported": imported, "skipped": skipped}

    def _rebuild_state(
        self, value: Mapping[str, Any], *, origin: Mapping[str, Any]
    ) -> TeleoperationStoredState:
        seed = value.get("seed", 0)
        seed = int(seed) if isinstance(seed, int) and not isinstance(seed, bool) else 0
        source = value.get("sourceRandomization")
        if not isinstance(source, Mapping):
            raise TeleoperationStateError("It has no randomized object pose.")
        body = source.get("target")
        values = source.get("values")
        if (
            not isinstance(body, str)
            or not body
            or not isinstance(values, Sequence)
            or len(values) != 3
            or not all(isinstance(item, (int, float)) and math.isfinite(float(item)) for item in values)
        ):
            raise TeleoperationStateError("Its object pose metadata is invalid.")
        x_cm, y_cm, yaw_degrees = (float(item) for item in values)

        self._last_observation = self.environment.restore_state(
            self._base_state.qpos, self._base_state.qvel, self._base_state.ctrl, images=False
        )
        samples = [dict(sample) for sample in value.get("modelRandomization") or [] if isinstance(sample, Mapping)]
        model_overrides: list[dict[str, Any]] = []
        if samples:
            rules = [_rule_for_sample(sample) for sample in samples]
            try:
                model_overrides = self.environment.apply_model_rules(
                    rules, [{"target": sample.get("target"), "values": sample.get("values")} for sample in samples]
                )
            except (KeyError, TypeError, ValueError, NativeEnvironmentError) as error:
                self.environment.restore_model_baseline()
                self._model_overridden = False
                raise TeleoperationStateError(f"Its appearance or physics randomization no longer applies: {error}") from error
            self._model_overridden = True
            # Restoring qpos after the model change keeps the authored pose for contact checks.
            self.environment.restore_state(
                self._base_state.qpos, self._base_state.qvel, self._base_state.ctrl, images=False
            )
        elif self._model_overridden:
            self.environment.restore_model_baseline()
            self._model_overridden = False
        allowed_contacts = self.environment.penetrating_contacts()

        try:
            base_position = self.environment.body_position(body)
            base_quaternion = self.environment.quaternion_from_rotation(self.environment.body_rotation(body))
            quaternion = _multiply_quaternion(base_quaternion, _axis_quaternion(math.radians(yaw_degrees)))
            position = base_position + np.asarray([x_cm / 100.0, y_cm / 100.0, 0.0], dtype=np.float64)
            self.environment.set_body_pose(body, position, quaternion)
        except (KeyError, ValueError, NativeEnvironmentError) as error:
            raise TeleoperationStateError(f"Its object '{body}' is missing or no longer movable.") from error
        object_samples = self._reapply_object_poses(value.get("objectRandomization"))

        robot = value.get("robotRandomization")
        robot_sample: dict[str, Any] | None = None
        if isinstance(robot, Mapping):
            names = robot.get("names")
            offsets = robot.get("values")
            if (
                not isinstance(names, Sequence)
                or not isinstance(offsets, Sequence)
                or len(names) != len(offsets)
                or not all(isinstance(name, str) for name in names)
            ):
                raise TeleoperationStateError("Its robot start-pose metadata is invalid.")
            missing = [name for name in names if name not in self.environment.action_targets]
            if missing:
                raise TeleoperationStateError(f"Its robot joints were removed: {', '.join(missing)}.")
            try:
                applied = self.environment.offset_joint_positions(
                    {name: math.radians(float(offset)) for name, offset in zip(names, offsets, strict=True)}
                )
            except (NativeActionError, NativeEnvironmentError, TypeError, ValueError) as error:
                raise TeleoperationStateError(f"Its robot start pose no longer applies: {error}") from error
            robot_sample = {
                "target": "robot",
                "kind": "joint-offsets",
                "names": list(names),
                "values": [math.degrees(applied[name]) for name in names],
            }

        if self.environment.penetrating_contacts() - allowed_contacts:
            raise TeleoperationStateError("It overlaps other geometry in the edited scene.")
        self._last_observation = self.environment.observe(images=False)
        return self.collection.append_state(
            seed=seed,
            qpos=np.asarray(self.environment.data.qpos, dtype=np.float64),
            qvel=np.asarray(self.environment.data.qvel, dtype=np.float64),
            ctrl=np.asarray(self.environment.data.ctrl, dtype=np.float64),
            source_randomization={"target": body, "values": [x_cm, y_cm, yaw_degrees]},
            label=f"{self.profile.get('name', 'scene')} - state-{self.collection.next_state_index:06d}",
            model_randomization=[
                {**sample, "rule": rule} for sample, rule in zip(samples, rules, strict=True)
            ]
            if samples
            else (),
            model_overrides=model_overrides,
            robot_randomization=robot_sample,
            object_randomization=object_samples,
            origin=origin,
        )

    def _place_object(self, body: str, x_cm: float, y_cm: float, yaw_degrees: float) -> None:
        """Offset ``body`` from its pose in the base state (its authored pose)."""
        try:
            base_qpos = np.asarray(self._base_state.qpos, dtype=np.float64)
            body_index = self.environment.body_id(body)
            joint_index = int(np.asarray(self.environment.model.body_jntadr)[body_index])
            address = int(np.asarray(self.environment.model.jnt_qposadr)[joint_index])
            if int(np.asarray(self.environment.model.body_jntnum)[body_index]) != 1:
                raise NativeEnvironmentError(f"Body '{body}' must have exactly one free joint.")
            base_position = base_qpos[address : address + 3]
            base_quaternion = base_qpos[address + 3 : address + 7]
            quaternion = _multiply_quaternion(base_quaternion, _axis_quaternion(math.radians(yaw_degrees)))
            position = base_position + np.asarray([x_cm / 100.0, y_cm / 100.0, 0.0], dtype=np.float64)
            self.environment.set_body_pose(body, position, quaternion)
        except (KeyError, ValueError, NativeEnvironmentError) as error:
            raise TeleoperationStateError(f"Object '{body}' is missing or not movable.") from error

    def _randomize_object_poses(
        self, zones: Sequence[ObjectZone], random: XorShift32
    ) -> list[dict[str, Any]]:
        """Place each additional object in its zone, redrawing poses that overlap anything.

        Objects are placed in order, so a later object also avoids the ones placed before it (and
        the main object). Contacts already present before placing are tolerated.
        """
        samples: list[dict[str, Any]] = []
        for body, x_range, y_range, yaw_range in zones:
            allowed_contacts = self.environment.penetrating_contacts()
            for _ in range(OBJECT_POSE_MAX_DRAWS):
                x_cm = random.range(list(x_range))
                y_cm = random.range(list(y_range))
                yaw_degrees = random.range(list(yaw_range))
                self._place_object(body, x_cm, y_cm, yaw_degrees)
                if self.environment.penetrating_contacts() <= allowed_contacts:
                    samples.append({"target": body, "values": [x_cm, y_cm, yaw_degrees]})
                    break
            else:
                raise TeleoperationStateError(
                    f"No free spot was found for '{body}' in {OBJECT_POSE_MAX_DRAWS} draws; "
                    "make its zone larger or randomize fewer objects."
                )
        return samples

    def _reapply_object_poses(self, value: Any) -> list[dict[str, Any]]:
        """Re-apply stored additional object poses when a state is rebuilt in an edited scene."""
        if value is None:
            return []
        if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
            raise TeleoperationStateError("Its object pose metadata is invalid.")
        samples: list[dict[str, Any]] = []
        for entry in value:
            body = entry.get("target") if isinstance(entry, Mapping) else None
            values = entry.get("values") if isinstance(entry, Mapping) else None
            if (
                not isinstance(body, str)
                or not body
                or not isinstance(values, Sequence)
                or len(values) != 3
                or not all(isinstance(item, (int, float)) and math.isfinite(float(item)) for item in values)
            ):
                raise TeleoperationStateError("Its object pose metadata is invalid.")
            x_cm, y_cm, yaw_degrees = (float(item) for item in values)
            try:
                self._place_object(body, x_cm, y_cm, yaw_degrees)
            except TeleoperationStateError as error:
                raise TeleoperationStateError(f"Its object '{body}' is missing or no longer movable.") from error
            samples.append({"target": body, "values": [x_cm, y_cm, yaw_degrees]})
        return samples

    def _robot_pose_joints(self, joints: Sequence[str] | None) -> list[str]:
        """Named joints to offset: the given list, else every arm hinge joint except the gripper."""
        targets = self.environment.action_targets
        if joints is not None:
            unknown = [name for name in joints if name not in targets]
            if unknown:
                raise TeleoperationStateError(
                    f"robotRandomization names unknown joints: {', '.join(unknown)}."
                )
            return sorted(set(joints))
        names = []
        for name in targets:
            if GRIPPER_NAME_PATTERN.search(name):
                continue
            try:
                self.environment.hinge_joint_for_action(name)
            except (NativeActionError, NativeEnvironmentError):
                continue
            names.append(name)
        return sorted(names)

    def _randomize_robot_pose(
        self,
        degrees: tuple[float, float],
        joints: Sequence[str] | None,
        random: XorShift32,
    ) -> dict[str, Any] | None:
        """Offset the robot's joints from the base pose, redrawing poses that overlap the scene.

        Returns None (nothing to randomize) when the profile drives no arm hinge joints.
        """
        names = self._robot_pose_joints(joints)
        if not names:
            return None
        qpos = np.asarray(self.environment.data.qpos, dtype=np.float64).copy()
        qvel = np.asarray(self.environment.data.qvel, dtype=np.float64).copy()
        ctrl = np.asarray(self.environment.data.ctrl, dtype=np.float64).copy()
        allowed_contacts = self.environment.penetrating_contacts()
        for _ in range(ROBOT_POSE_MAX_DRAWS):
            offsets = [random.range(list(degrees)) for _name in names]
            try:
                applied = self.environment.offset_joint_positions(
                    {name: math.radians(value) for name, value in zip(names, offsets, strict=True)}
                )
            except (NativeActionError, NativeEnvironmentError) as error:
                raise TeleoperationStateError(f"Robot randomization failed: {error}") from error
            if self.environment.penetrating_contacts() <= allowed_contacts:
                return {
                    "target": "robot",
                    "kind": "joint-offsets",
                    "names": names,
                    "values": [math.degrees(applied[name]) for name in names],
                }
            self.environment.restore_state(qpos, qvel, ctrl, images=False)
        raise TeleoperationStateError(
            f"No collision-free robot start pose was found in {ROBOT_POSE_MAX_DRAWS} draws; "
            "reduce the robot randomization range."
        )

    def select_state(
        self,
        client_id: str,
        lease_id: str | None,
        state_id: str,
        *,
        admin: bool = False,
    ) -> dict[str, Any]:
        self._require_control(client_id, lease_id, allow_admin=admin)
        if self.recording:
            raise TeleoperationStateError("Randomized states cannot be switched while recording.")
        self._select_state(state_id)
        return {"stateId": self.active_state_id, "stateRevision": self._state_revision}

    def delete_state(
        self,
        client_id: str,
        lease_id: str | None,
        state_id: str,
        *,
        admin: bool = False,
    ) -> dict[str, Any]:
        self._require_control(client_id, lease_id, allow_admin=admin)
        try:
            state = self.collection.state(state_id)
        except Exception as error:
            raise TeleoperationStateError(str(error)) from error
        if state.state_id == self._base_state.state_id:
            raise TeleoperationStateDeletionError("The authored base state cannot be deleted.")
        if self.recording:
            raise TeleoperationStateDeletionError(
                "Randomized states cannot be deleted while recording."
            )
        if self._pending_recording is not None and self._pending_recording.state_id == state_id:
            raise TeleoperationStateDeletionError(
                "Randomized states cannot be deleted while a stopped recording is pending."
            )
        if any(episode.get("stateId") == state_id for episode in self.collection.episodes):
            raise TeleoperationStateDeletionError(
                f"State '{state_id}' cannot be deleted while recorded episodes reference it."
            )
        try:
            deleted = self.collection.delete_state(state_id)
        except Exception as error:
            raise TeleoperationStateDeletionError(str(error)) from error
        if self.active_state_id == state_id:
            self._select_state(self._base_state.state_id)
        return {
            "stateId": deleted.state_id,
            "deleted": True,
            "activeStateId": self.active_state_id,
            "stateRevision": self._state_revision,
        }

    def _restore_model(self, state: TeleoperationStoredState) -> None:
        """Replay a state's model overrides (or restore the baseline) before restoring its qpos."""
        if state.model_overrides:
            self.environment.apply_model_overrides(state.model_overrides)
            self._model_overridden = True
        elif self._model_overridden:
            self.environment.restore_model_baseline()
            self._model_overridden = False

    def _select_state(self, state_id: str) -> None:
        try:
            state = self.collection.state(state_id)
        except Exception as error:
            raise TeleoperationStateError(str(error)) from error
        self._restore_model(state)
        self._last_observation = self.environment.restore_state(
            state.qpos, state.qvel, state.ctrl, images=False
        )
        self._active_state = state
        self._state_revision += 1
        self._step_id = 0

    def write_recording_frame(self, frame: EpisodeFrame) -> None:
        """Keep one recorded frame; streamed staging recordings encode images immediately."""
        if self._streams_frames():
            self._writer.append(frame)  # type: ignore[union-attr]
            # Only state, action, and metadata stay in memory; images live in the videos.
            frame = replace(frame, images={})
        self._recording_frames.append(frame)

    def snapshot(self) -> dict[str, Any]:
        observation: NativeObservation = self._last_observation
        return {
            "stepId": self._step_id,
            "stateRevision": self._state_revision,
            "stateId": self.active_state_id,
            "recording": self.recording,
            "episodeId": self.recording_episode_id,
            "simulationTime": observation.simulation_time,
            "state": list(self.environment.state_values(self._state_fields)),
            "action": [self._last_action[str(field["name"])] for field in self._action_fields],
            "qpos": np.asarray(observation.qpos, dtype=np.float64).copy(),
            "qvel": np.asarray(observation.qvel, dtype=np.float64).copy(),
            "ctrl": np.asarray(self.environment.data.ctrl, dtype=np.float64).copy(),
            "bodyPositions": {
                name: np.asarray(value, dtype=np.float64).copy()
                for name, value in observation.body_positions.items()
            },
            "bodyQuaternions": {
                name: np.asarray(value, dtype=np.float64).copy()
                for name, value in observation.body_quaternions.items()
            },
            "images": {
                name: np.asarray(value, dtype=np.uint8).copy()
                for name, value in self._last_preview_images.items()
            },
        }

    def render_preview(self) -> None:
        """Refresh the cached image preview at the current simulation state."""
        self._last_observation = self.environment.observe(images=True)
        self._last_preview_images = {
            name: np.asarray(value, dtype=np.uint8).copy()
            for name, value in self._last_observation.images.items()
        }
