# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from ..generation.dataset import atomic_write_json


class TeleoperationCollectionError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _vector(value: Sequence[float], expected: int, label: str) -> list[float]:
    array = np.asarray(value, dtype=np.float64)
    if array.shape != (expected,) or not np.all(np.isfinite(array)):
        raise TeleoperationCollectionError(
            f"{label} must contain {expected} finite values."
        )
    return [float(item) for item in array]


@dataclass(frozen=True)
class TeleoperationStoredState:
    state_id: str
    label: str
    index: int
    seed: int
    created_at: str
    qpos: tuple[float, ...]
    qvel: tuple[float, ...]
    ctrl: tuple[float, ...]
    source_randomization: Mapping[str, Any] | None = None
    # Sampled appearance/physics rules and the exact MjModel rows they wrote. Selecting the state
    # restores the model baseline and replays the overrides, so recorded images match the state.
    model_randomization: tuple[Mapping[str, Any], ...] = ()
    model_overrides: tuple[Mapping[str, Any], ...] = ()
    # Sampled robot start-pose offsets (degrees per named joint); already applied to qpos/ctrl.
    robot_randomization: Mapping[str, Any] | None = None
    # Sampled poses of the additional randomized objects: ``{"target", "values": [x_cm, y_cm, yaw]}``
    # each, offsets from the authored pose like ``source_randomization``.
    object_randomization: tuple[Mapping[str, Any], ...] = ()
    # Set when the state was carried over from an earlier scene version:
    # ``{"collectionId", "stateId", "label"}`` of the state it was rebuilt from.
    origin: Mapping[str, Any] | None = None

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> TeleoperationStoredState:
        try:
            state_id = str(value["stateId"])
            label = str(value["label"])
            index = int(value["index"])
            seed = int(value["seed"])
            created_at = str(value["createdAt"])
            qpos = tuple(float(item) for item in value["qpos"])
            qvel = tuple(float(item) for item in value["qvel"])
            ctrl = tuple(float(item) for item in value["ctrl"])
        except (KeyError, TypeError, ValueError) as error:
            raise TeleoperationCollectionError("Collection contains an invalid state snapshot.") from error
        if not state_id or not label or index < 0:
            raise TeleoperationCollectionError("Collection contains an invalid state identity.")
        if any(not np.isfinite(item) for item in (*qpos, *qvel, *ctrl)):
            raise TeleoperationCollectionError(f"State '{state_id}' contains non-finite values.")
        randomization = value.get("sourceRandomization")
        if randomization is not None and not isinstance(randomization, Mapping):
            raise TeleoperationCollectionError(
                f"State '{state_id}' has invalid randomization metadata."
            )
        robot_randomization = value.get("robotRandomization")
        if robot_randomization is not None and not isinstance(robot_randomization, Mapping):
            raise TeleoperationCollectionError(
                f"State '{state_id}' has invalid robot randomization metadata."
            )
        origin = value.get("origin")
        if origin is not None and not isinstance(origin, Mapping):
            raise TeleoperationCollectionError(f"State '{state_id}' has invalid origin metadata.")
        model_randomization = value.get("modelRandomization", [])
        model_overrides = value.get("modelOverrides", [])
        object_randomization = value.get("objectRandomization", [])
        for label_name, entries in (
            ("model randomization", model_randomization),
            ("model overrides", model_overrides),
            ("object randomization", object_randomization),
        ):
            if not isinstance(entries, list) or not all(isinstance(entry, Mapping) for entry in entries):
                raise TeleoperationCollectionError(f"State '{state_id}' has invalid {label_name} metadata.")
        return cls(
            state_id,
            label,
            index,
            seed,
            created_at,
            qpos,
            qvel,
            ctrl,
            randomization,
            tuple(dict(entry) for entry in model_randomization),
            tuple(dict(entry) for entry in model_overrides),
            dict(robot_randomization) if robot_randomization is not None else None,
            tuple(dict(entry) for entry in object_randomization),
            dict(origin) if origin is not None else None,
        )

    def to_dict(self) -> dict[str, Any]:
        value: dict[str, Any] = {
            "stateId": self.state_id,
            "label": self.label,
            "index": self.index,
            "seed": self.seed,
            "createdAt": self.created_at,
            "qpos": list(self.qpos),
            "qvel": list(self.qvel),
            "ctrl": list(self.ctrl),
        }
        if self.source_randomization is not None:
            value["sourceRandomization"] = dict(self.source_randomization)
        if self.model_randomization:
            value["modelRandomization"] = [dict(entry) for entry in self.model_randomization]
        if self.model_overrides:
            value["modelOverrides"] = [dict(entry) for entry in self.model_overrides]
        if self.robot_randomization is not None:
            value["robotRandomization"] = dict(self.robot_randomization)
        if self.object_randomization:
            value["objectRandomization"] = [dict(entry) for entry in self.object_randomization]
        if self.origin is not None:
            value["origin"] = dict(self.origin)
        return value


class TeleoperationCollectionStore:
    def __init__(
        self,
        root: str | Path,
        *,
        collection_id: str,
        scene_id: str,
        scene_fingerprint: str,
    ) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "collection.json"
        self.collection_id = collection_id
        self.scene_id = scene_id
        self.scene_fingerprint = scene_fingerprint
        self._read_only = False
        if self.path.exists():
            try:
                value = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
                raise TeleoperationCollectionError(
                    f"Collection metadata could not be read from '{self.path}'."
                ) from error
            self._value = self._validate_loaded(value)
        else:
            now = _now()
            self._value: dict[str, Any] = {
                "version": 1,
                "collectionId": collection_id,
                "sceneId": scene_id,
                "sceneFingerprint": scene_fingerprint,
                "createdAt": now,
                "updatedAt": now,
                "revision": 0,
                "nextStateIndex": 1,
                "nextEpisodeIndex": 0,
                "states": [],
                "episodes": [],
            }
            self._persist()

    def _validate_loaded(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise TeleoperationCollectionError("Collection metadata must be an object.")
        for key in (
            "collectionId",
            "sceneId",
            "sceneFingerprint",
            "createdAt",
            "updatedAt",
        ):
            if not isinstance(value.get(key), str) or not value[key]:
                raise TeleoperationCollectionError(f"Collection metadata field '{key}' is invalid.")
        if value["collectionId"] != self.collection_id:
            raise TeleoperationCollectionError("Collection identity does not match the session.")
        if value["sceneId"] != self.scene_id or value["sceneFingerprint"] != self.scene_fingerprint:
            raise TeleoperationCollectionError("Collection belongs to a different scene.")
        if value.get("version") != 1:
            raise TeleoperationCollectionError("Collection metadata version is unsupported.")
        revision = value.get("revision")
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
            raise TeleoperationCollectionError("Collection revision is invalid.")
        for key in ("states", "episodes"):
            if not isinstance(value.get(key), list):
                raise TeleoperationCollectionError(f"Collection metadata field '{key}' is invalid.")
        if not isinstance(value.get("nextStateIndex"), int) or value["nextStateIndex"] < 1:
            raise TeleoperationCollectionError("Collection nextStateIndex is invalid.")
        if not isinstance(value.get("nextEpisodeIndex"), int) or value["nextEpisodeIndex"] < 0:
            raise TeleoperationCollectionError("Collection nextEpisodeIndex is invalid.")
        for state in value["states"]:
            if not isinstance(state, Mapping):
                raise TeleoperationCollectionError("Collection contains an invalid state entry.")
            TeleoperationStoredState.from_dict(state)
        for episode in value["episodes"]:
            if not isinstance(episode, Mapping):
                raise TeleoperationCollectionError("Collection contains an invalid episode entry.")
            if not isinstance(episode.get("episodeId"), str) or not episode["episodeId"]:
                raise TeleoperationCollectionError("Collection episode identity is invalid.")
            if not isinstance(episode.get("episodeIndex"), int) or episode["episodeIndex"] < 0:
                raise TeleoperationCollectionError("Collection episode index is invalid.")
            control_mode = episode.get("controlMode")
            if control_mode is not None and control_mode not in {"physics-only", "kinematically-assisted"}:
                raise TeleoperationCollectionError("Collection episode controlMode is invalid.")
        return value

    @property
    def read_only(self) -> bool:
        return self._read_only

    def _persist(self) -> None:
        if self._read_only:
            raise TeleoperationCollectionError(
                "This collection view is read-only; only the collection owner writes collection.json."
            )
        previous_revision = self._value["revision"]
        previous_updated_at = self._value.get("updatedAt")
        self._value["revision"] = previous_revision + 1
        self._value["updatedAt"] = _now()
        try:
            atomic_write_json(self.path, self._value)
        except Exception:
            self._value["revision"] = previous_revision
            if previous_updated_at is not None:
                self._value["updatedAt"] = previous_updated_at
            raise

    @property
    def revision(self) -> int:
        return int(self._value["revision"])

    @property
    def next_state_index(self) -> int:
        return int(self._value["nextStateIndex"])

    @property
    def next_episode_index(self) -> int:
        return int(self._value["nextEpisodeIndex"])

    @property
    def next_recording_index(self) -> int:
        """Count of recordings ever started, including discarded ones; never reused."""
        value = self._value.get("nextRecordingIndex")
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
        # Collections from before the counter: start after every saved episode.
        return self.next_episode_index

    def claim_recording_index(self) -> int:
        index = self.next_recording_index
        self.reserve_recording_indices(1)
        return index

    def reserve_recording_indices(self, count: int) -> range:
        """Atomically reserve a contiguous recording-index range for a precomputed attempt plan."""
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            raise TeleoperationCollectionError("Recording index reservation count must be non-negative.")
        start = self.next_recording_index
        previous_value = self._value.get("nextRecordingIndex")
        self._value["nextRecordingIndex"] = start + count
        try:
            self._persist()
        except Exception:
            if previous_value is None:
                self._value.pop("nextRecordingIndex", None)
            else:
                self._value["nextRecordingIndex"] = previous_value
            raise
        return range(start, start + count)

    def append_staged_episode(
        self,
        summary: Mapping[str, Any],
        staged_directory: str | Path,
        *,
        dataset_root: str | Path,
    ) -> Mapping[str, Any]:
        """Commit a staged episode directory before appending its collection entry."""
        if self._read_only:
            raise TeleoperationCollectionError("A read-only collection view cannot commit episodes.")
        value = dict(summary)
        episode_index = value.get("episodeIndex")
        if episode_index != self.next_episode_index:
            raise TeleoperationCollectionError(
                f"Episode index {episode_index} does not match the next collection index "
                f"{self.next_episode_index}."
            )
        source = Path(staged_directory)
        destination = Path(dataset_root) / "episodes" / f"episode-{episode_index:06d}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise TeleoperationCollectionError(f"Episode destination already exists: {destination}")
        metadata_path = source / "episode.json"
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise TeleoperationCollectionError("Staged episode metadata could not be read.") from error
        if not isinstance(metadata, dict) or not isinstance(metadata.get("summary"), Mapping):
            raise TeleoperationCollectionError("Staged episode summary is invalid.")
        staged_summary = dict(metadata["summary"])
        staged_summary["episodeIndex"] = episode_index
        metadata["summary"] = staged_summary
        atomic_write_json(metadata_path, metadata)
        os.replace(source, destination)
        value["artifactPath"] = destination.relative_to(self.root).as_posix()
        try:
            return self.append_episode(value)
        except Exception:
            # Put the staged attempt back so the collection and the episodes directory agree.
            if destination.exists() and not source.exists():
                source.parent.mkdir(parents=True, exist_ok=True)
                os.replace(destination, source)
            raise

    @property
    def states(self) -> tuple[TeleoperationStoredState, ...]:
        return tuple(TeleoperationStoredState.from_dict(value) for value in self._value["states"])

    @property
    def episodes(self) -> tuple[Mapping[str, Any], ...]:
        return tuple(dict(value) for value in self._value["episodes"])

    def episode(self, episode_id: str) -> Mapping[str, Any]:
        for value in self._value["episodes"]:
            if value.get("episodeId") == episode_id:
                return dict(value)
        raise TeleoperationCollectionError(f"Episode '{episode_id}' was not found.")

    def initialize_base(
        self,
        qpos: Sequence[float],
        qvel: Sequence[float],
        ctrl: Sequence[float],
    ) -> TeleoperationStoredState:
        states = self.states
        if states:
            return states[0]
        state = TeleoperationStoredState(
            state_id="state-000000",
            label="Authored base state",
            index=0,
            seed=0,
            created_at=_now(),
            qpos=tuple(_vector(qpos, len(qpos), "qpos")),
            qvel=tuple(_vector(qvel, len(qvel), "qvel")),
            ctrl=tuple(_vector(ctrl, len(ctrl), "ctrl")),
        )
        self._value["states"].append(state.to_dict())
        self._persist()
        return state

    @classmethod
    def load_read_only(
        cls,
        root: str | Path,
        *,
        collection_id: str,
        scene_id: str,
        scene_fingerprint: str,
    ) -> TeleoperationCollectionStore:
        """Open an existing collection as a read-only view without creating or writing anything."""
        view = object.__new__(cls)
        view.root = Path(root)
        view.path = view.root / "collection.json"
        view.collection_id = collection_id
        view.scene_id = scene_id
        view.scene_fingerprint = scene_fingerprint
        view._read_only = True
        try:
            value = json.loads(view.path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise TeleoperationCollectionError(
                f"Collection metadata could not be read from '{view.path}'."
            ) from error
        view._value = view._validate_loaded(value)
        return view

    def open_read_only(self) -> TeleoperationCollectionStore:
        """Return a detached in-memory view for a worker that must not mutate collection.json."""
        view = object.__new__(type(self))
        view.root = self.root
        view.path = self.path
        view.collection_id = self.collection_id
        view.scene_id = self.scene_id
        view.scene_fingerprint = self.scene_fingerprint
        view._value = json.loads(json.dumps(self._value))
        view._read_only = True
        return view

    def state(self, state_id: str) -> TeleoperationStoredState:
        for state in self.states:
            if state.state_id == state_id:
                return state
        raise TeleoperationCollectionError(f"Randomized state '{state_id}' was not found.")

    def delete_state(self, state_id: str) -> TeleoperationStoredState:
        if state_id == "state-000000":
            raise TeleoperationCollectionError("The authored base state cannot be deleted.")
        for index, value in enumerate(self._value["states"]):
            if value.get("stateId") != state_id:
                continue
            deleted = TeleoperationStoredState.from_dict(self._value["states"].pop(index))
            self._persist()
            return deleted
        raise TeleoperationCollectionError(f"Randomized state '{state_id}' was not found.")

    def append_state(
        self,
        *,
        seed: int,
        qpos: Sequence[float],
        qvel: Sequence[float],
        ctrl: Sequence[float],
        source_randomization: Mapping[str, Any] | None,
        label: str | None = None,
        model_randomization: Sequence[Mapping[str, Any]] = (),
        model_overrides: Sequence[Mapping[str, Any]] = (),
        robot_randomization: Mapping[str, Any] | None = None,
        object_randomization: Sequence[Mapping[str, Any]] = (),
        origin: Mapping[str, Any] | None = None,
    ) -> TeleoperationStoredState:
        index = self.next_state_index
        state = TeleoperationStoredState(
            state_id=f"state-{index:06d}",
            label=label or f"Randomized state {index:06d}",
            index=index,
            seed=int(seed),
            created_at=_now(),
            qpos=tuple(_vector(qpos, len(qpos), "qpos")),
            qvel=tuple(_vector(qvel, len(qvel), "qvel")),
            ctrl=tuple(_vector(ctrl, len(ctrl), "ctrl")),
            source_randomization=source_randomization,
            model_randomization=tuple(dict(entry) for entry in model_randomization),
            model_overrides=tuple(dict(entry) for entry in model_overrides),
            robot_randomization=dict(robot_randomization) if robot_randomization is not None else None,
            object_randomization=tuple(dict(entry) for entry in object_randomization),
            origin=dict(origin) if origin is not None else None,
        )
        self._value["states"].append(state.to_dict())
        self._value["nextStateIndex"] = index + 1
        self._persist()
        return state

    def append_episode(self, summary: Mapping[str, Any]) -> Mapping[str, Any]:
        value = dict(summary)
        episode_index = value.get("episodeIndex")
        if episode_index != self.next_episode_index:
            raise TeleoperationCollectionError(
                f"Episode index {episode_index} does not match the next collection index "
                f"{self.next_episode_index}."
            )
        if not isinstance(value.get("episodeId"), str) or not value["episodeId"]:
            raise TeleoperationCollectionError("Episode metadata needs an episodeId.")
        self._value["episodes"].append(value)
        self._value["nextEpisodeIndex"] = self.next_episode_index + 1
        self._persist()
        return dict(value)

    def update_episode(self, episode_id: str, updates: Mapping[str, Any]) -> Mapping[str, Any]:
        allowed = {"name", "notes"}
        if not updates or any(key not in allowed for key in updates):
            raise TeleoperationCollectionError("Episode updates must contain only name or notes.")
        for value in self._value["episodes"]:
            if value.get("episodeId") != episode_id:
                continue
            for key, raw_value in updates.items():
                if not isinstance(raw_value, str):
                    raise TeleoperationCollectionError(f"Episode {key} must be a string.")
                normalized = raw_value.strip()
                if normalized:
                    value[key] = normalized
                else:
                    value.pop(key, None)
            self._persist()
            return dict(value)
        raise TeleoperationCollectionError(f"Episode '{episode_id}' was not found.")

    def delete_episode(self, episode_id: str) -> Mapping[str, Any]:
        for index, value in enumerate(self._value["episodes"]):
            if value.get("episodeId") != episode_id:
                continue
            deleted = dict(self._value["episodes"].pop(index))
            try:
                self._persist()
            except Exception:
                self._value["episodes"].insert(index, value)
                raise
            return deleted
        raise TeleoperationCollectionError(f"Episode '{episode_id}' was not found.")

    def to_dict(self) -> dict[str, Any]:
        return json.loads(json.dumps(self._value))
