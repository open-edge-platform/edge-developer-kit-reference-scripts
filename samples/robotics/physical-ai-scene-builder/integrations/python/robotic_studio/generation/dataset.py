# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import base64
import hashlib
import importlib.metadata
import json
import os
import re
import sys
import tempfile
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import numpy as np

SO101_JOINT_NAMES = (
    "shoulder_pan",
    "shoulder_lift",
    "elbow_flex",
    "wrist_flex",
    "wrist_roll",
    "gripper",
)
SO101_STATE_NAMES = tuple(f"{name}.pos" for name in SO101_JOINT_NAMES)
SO101_ACTION_NAMES = SO101_JOINT_NAMES
# Raw episode layout: each camera is an AV1 MP4 under videos/; frames.npz holds state/action.
EPISODE_FORMAT_VERSION = 2
# Converted LeRobot datasets use LeRobot's AV1 settings with one-second keyframes, which keeps
# files small (like lerobot-record datasets) while bounding the decode cost of random access.
LEROBOT_VIDEO_CRF = 30
LEROBOT_VIDEO_GOP_FRAMES = 30


class DatasetWriterError(RuntimeError):
    pass


class LeRobotDependencyError(ImportError):
    pass


def _jsonable(value: Any) -> Any:
    if isinstance(value, RGBImage):
        return value.to_dict()
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, bytes):
        return {"encoding": "base64", "data": base64.b64encode(value).decode("ascii")}
    return value


def atomic_write_json(path: str | Path, value: Any) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(_jsonable(value), temporary, indent=2, sort_keys=True, ensure_ascii=True)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, destination)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()
    return destination


MIN_FEATURE_STAT_STD = 1e-4


def guard_zero_variance_feature_stats(dataset_root: str | Path) -> bool:
    """Clamp near-zero feature standard deviations in meta/stats.json up to 1.0.

    A scene that intentionally holds a joint fixed for an entire task (for example, a wrist
    roll locked at -90 degrees) records that dimension with essentially zero variance. LeRobot's
    MEAN_STD normalization guards division by zero with a fixed 1e-8 epsilon, which is safe when
    a value equals its mean exactly. In practice, float32 round-tripping between the recorded
    value and the aggregated mean rarely lands on exactly zero, so dividing that residual
    machine-precision noise by 1e-8 amplifies it into an outlier of hundreds of normalized units.
    That single dimension then dominates the training loss and destabilizes gradients for the
    whole model, even though the other dimensions are fine. Replacing a near-zero std with 1.0
    keeps the feature's normalized value at (a tiny residual)/1, effectively zero, instead of
    amplifying it.

    Returns True if any stats were changed.
    """
    stats_path = Path(dataset_root) / "meta" / "stats.json"
    if not stats_path.is_file():
        return False
    stats = json.loads(stats_path.read_text(encoding="utf-8"))
    changed = False
    for feature_stats in stats.values():
        if not isinstance(feature_stats, dict):
            continue
        std = feature_stats.get("std")
        if not isinstance(std, list):
            continue
        for index, value in enumerate(std):
            if isinstance(value, (int, float)) and not isinstance(value, bool) and abs(value) < MIN_FEATURE_STAT_STD:
                std[index] = 1.0
                changed = True
    if changed:
        atomic_write_json(stats_path, stats)
    return changed


@dataclass(frozen=True)
class RGBImage:
    shape: tuple[int, ...]
    dtype: str
    data: bytes

    @classmethod
    def from_array(cls, value: Any) -> RGBImage:
        array = np.asarray(value)
        if array.ndim != 3 or not np.issubdtype(array.dtype, np.integer):
            raise ValueError("RGB image must be a three-dimensional integer array.")
        contiguous = np.ascontiguousarray(array)
        return cls(tuple(int(size) for size in contiguous.shape), str(contiguous.dtype), contiguous.tobytes())

    def numpy_dtype(self) -> np.dtype:
        """Return the pixel dtype after checking the byte length, without copying pixels."""
        try:
            dtype = np.dtype(self.dtype)
        except TypeError as error:
            raise DatasetWriterError(f"RGB image has an invalid dtype '{self.dtype}'.") from error
        expected_size = int(np.prod(self.shape, dtype=np.int64)) * dtype.itemsize
        if expected_size != len(self.data):
            raise DatasetWriterError("RGB image byte length does not match its declared shape.")
        return dtype

    def array(self) -> np.ndarray:
        dtype = self.numpy_dtype()
        return np.frombuffer(self.data, dtype=dtype).reshape(self.shape).copy()

    def to_dict(self) -> dict[str, Any]:
        return {
            "shape": list(self.shape),
            "dtype": self.dtype,
            "data": base64.b64encode(self.data).decode("ascii"),
            "encoding": "base64",
        }


def _numeric_tuple(value: Any, label: str) -> tuple[float, ...]:
    array = np.asarray(value, dtype=np.float64)
    if array.ndim != 1 or not np.all(np.isfinite(array)):
        raise ValueError(f"{label} must be a finite one-dimensional numeric vector.")
    return tuple(float(item) for item in array)


@dataclass(frozen=True)
class EpisodeFrame:
    frame_index: int
    timestamp: float
    state: tuple[float, ...]
    action: tuple[float, ...]
    task: str
    phase: str | None = None
    selected_object: str | None = None
    randomization: tuple[Mapping[str, Any], ...] = ()
    images: Mapping[str, RGBImage] = field(default_factory=dict)
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_values(
        cls,
        frame_index: int,
        timestamp: float,
        state: Any,
        action: Any,
        task: str,
        *,
        phase: str | None = None,
        selected_object: str | None = None,
        randomization: Iterable[Mapping[str, Any]] = (),
        images: Mapping[str, Any] | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> EpisodeFrame:
        if not isinstance(frame_index, int) or isinstance(frame_index, bool) or frame_index < 0:
            raise ValueError("frame_index must be a non-negative integer.")
        if not isinstance(timestamp, (int, float)) or not np.isfinite(timestamp):
            raise ValueError("timestamp must be finite.")
        if not isinstance(task, str) or not task.strip():
            raise ValueError("task must be a non-empty string.")
        image_values = {
            str(name): value if isinstance(value, RGBImage) else RGBImage.from_array(value)
            for name, value in (images or {}).items()
        }
        return cls(
            frame_index=frame_index,
            timestamp=float(timestamp),
            state=_numeric_tuple(state, "state"),
            action=_numeric_tuple(action, "action"),
            task=task,
            phase=phase,
            selected_object=selected_object,
            randomization=tuple(dict(sample) for sample in randomization),
            images=image_values,
            metadata=dict(metadata or {}),
        )

    @property
    def index(self) -> int:
        return self.frame_index

    def to_dict(self) -> dict[str, Any]:
        return {
            "frameIndex": self.frame_index,
            "timestamp": self.timestamp,
            "state": list(self.state),
            "action": list(self.action),
            "task": self.task,
            "phase": self.phase,
            "selectedObject": self.selected_object,
            "randomization": _jsonable(self.randomization),
            "images": {name: image.to_dict() for name, image in sorted(self.images.items())},
            "metadata": _jsonable(self.metadata),
        }


def _optional_string(value: str | None) -> str | None:
    return None if value is None else str(value)


@dataclass(frozen=True)
class EpisodeSummary:
    episode_index: int
    seed: int
    status: str
    attempts: int
    steps: int
    randomization: tuple[Mapping[str, Any], ...] = ()
    selected_object: str | None = None
    failure_reason: str | None = None
    failure_message: str | None = None
    phase: str | None = None
    phase_history: tuple[str, ...] = ()
    attempt: int | None = None
    artifact_path: str | None = None
    control_mode: str | None = None

    @property
    def success(self) -> bool:
        return self.status in {"success", "recorded"}

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "episodeIndex": self.episode_index,
            "seed": self.seed,
            "status": self.status,
            "attempts": self.attempts,
            "steps": self.steps,
            "selectedObject": _optional_string(self.selected_object),
            "randomization": _jsonable(self.randomization),
            "phase": _optional_string(self.phase),
            "phaseHistory": list(self.phase_history),
            "failureReason": _optional_string(self.failure_reason),
            "failureMessage": _optional_string(self.failure_message),
            "artifactPath": _optional_string(self.artifact_path),
            "controlMode": _optional_string(self.control_mode),
        }
        if self.attempt is not None:
            result["attempt"] = self.attempt
        return result


@dataclass(frozen=True)
class CollectedEpisode:
    summary: EpisodeSummary
    frames: tuple[EpisodeFrame, ...] = ()

    @property
    def episode_index(self) -> int:
        return self.summary.episode_index

    @property
    def successful(self) -> bool:
        return self.summary.success

    def to_dict(self) -> dict[str, Any]:
        return {
            "summary": self.summary.to_dict(),
            "frames": [frame.to_dict() for frame in self.frames],
        }


@dataclass(frozen=True)
class CollectionResult:
    successful_episodes: tuple[CollectedEpisode, ...]
    final_episodes: tuple[CollectedEpisode, ...]
    attempts: tuple[CollectedEpisode, ...]
    summaries: tuple[EpisodeSummary, ...]
    failed_attempts: tuple[CollectedEpisode, ...]
    cancelled: bool = False

    @property
    def episodes(self) -> tuple[CollectedEpisode, ...]:
        return self.successful_episodes

    @property
    def failures(self) -> tuple[EpisodeSummary, ...]:
        return tuple(episode.summary for episode in self.failed_attempts)

    def to_dict(self) -> dict[str, Any]:
        return {
            "successfulEpisodes": [episode.to_dict() for episode in self.successful_episodes],
            "finalEpisodes": [episode.to_dict() for episode in self.final_episodes],
            "attempts": [episode.to_dict() for episode in self.attempts],
            "summaries": [summary.to_dict() for summary in self.summaries],
            "cancelled": self.cancelled,
        }


class EpisodeWriter(Protocol):
    def write_episode(self, episode: CollectedEpisode) -> Path | None: ...

    def write_attempt(self, episode: CollectedEpisode) -> Path | None: ...

    def finalize(self, manifest: Mapping[str, Any]) -> Path: ...


class IncrementalEpisodeWriter:
    """Stream recorded camera frames into per-camera AV1 MP4s while a recording runs.

    Only the encoder state is held in memory; the caller keeps image-free frames (state, action,
    metadata) and passes them to :meth:`finalize_episode`, which writes the same raw episode layout
    as :class:`JSONNPZStagingWriter` (``episode.json``, ``frames.npz``, ``videos/``). The encoder
    settings match :func:`robotic_studio.generation.video.encode_video`.
    """

    def __init__(
        self,
        root: str | Path,
        *,
        fps: int = 30,
        crf: int | None = None,
        gop: int | None = None,
    ) -> None:
        try:
            import av
        except ModuleNotFoundError as error:
            raise DatasetWriterError(
                "Incremental AV1 recording requires PyAV (install the teleoperation extra)."
            ) from error
        from .video import RAW_VIDEO_CRF, VIDEO_GOP_FRAMES

        self.root = Path(root)
        self.fps = int(fps)
        self.crf = int(RAW_VIDEO_CRF if crf is None else crf)
        self.gop = int(VIDEO_GOP_FRAMES if gop is None else gop)
        self._av = av
        # Camera name -> (container, stream, absolute path).
        self._writers: dict[str, tuple[Any, Any, Path]] = {}
        self._camera_info: dict[str, dict[str, Any]] = {}
        self._count = 0
        self._episode_count = 0
        self._closed = True

    def begin_episode(self, root: str | Path | None = None) -> None:
        """Start a new episode, optionally in a different directory; drops unfinished output."""
        self.abort()
        if root is not None:
            self.root = Path(root)
        self._count = 0
        self._camera_info = {}
        self._closed = False

    def _open_stream(self, name: str, image: np.ndarray) -> tuple[Any, Any, Path]:
        from .video import RAW_VIDEO_PIX_FMT, SVT_AV1_PRESET, av1_encoder

        key = _safe_key(name)
        if key in {info["key"] for info in self._camera_info.values()}:
            key = f"{key}_{hashlib.sha256(name.encode()).hexdigest()[:8]}"
        relative = Path("videos") / f"{key}-{self._episode_count:06d}.mp4"
        destination = self.root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        height, width = int(image.shape[0]), int(image.shape[1])
        encoder = av1_encoder(width, height)
        container = self._av.open(str(destination), mode="w", format="mp4")
        try:
            stream = container.add_stream(encoder, rate=self.fps)
            stream.width = width
            stream.height = height
            stream.pix_fmt = RAW_VIDEO_PIX_FMT
            options = {"crf": str(self.crf), "g": str(self.gop)}
            options.update(
                {"preset": str(SVT_AV1_PRESET)} if encoder == "libsvtav1" else {"cpu-used": "8"}
            )
            stream.options = options
        except Exception:
            container.close()
            destination.unlink(missing_ok=True)
            raise
        self._camera_info[name] = {
            "key": key,
            "shape": [height, width, 3],
            "dtype": "uint8",
            "path": relative.as_posix(),
        }
        writer = (container, stream, destination)
        self._writers[name] = writer
        return writer

    def append(self, frame: EpisodeFrame) -> None:
        """Encode one recorded frame's camera images; the frame's images are not retained."""
        if self._closed:
            raise DatasetWriterError("Incremental episode writer has no open episode.")
        if self._count and set(frame.images) != set(self._camera_info):
            raise DatasetWriterError("Every recorded frame must contain the same cameras.")
        for name in sorted(frame.images):
            array = np.ascontiguousarray(frame.images[name].array()[..., :3], dtype=np.uint8)
            if array.ndim != 3 or array.shape[2] != 3:
                raise DatasetWriterError("Camera frames must use uint8 HWC shape with three channels.")
            writer = self._writers.get(name)
            if writer is None:
                if self._count:
                    raise DatasetWriterError(f"Camera '{name}' appeared after the first frame.")
                writer = self._open_stream(name, array)
            elif list(array.shape) != self._camera_info[name]["shape"]:
                raise DatasetWriterError(f"Camera '{name}' changed its frame size.")
            container, stream, _destination = writer
            for packet in stream.encode(self._av.VideoFrame.from_ndarray(array, format="rgb24")):
                container.mux(packet)
        self._count += 1

    def finish_episode(self) -> None:
        """Flush and close the camera encoders of the current episode."""
        self.close()

    def finalize_episode(
        self,
        episode: CollectedEpisode,
        *,
        summary: Mapping[str, Any] | None = None,
    ) -> Path:
        """Close the streamed videos and write the episode's metadata and state/action arrays."""
        self.close()
        if self._count != len(episode.frames):
            raise DatasetWriterError(
                f"Incremental frame count {self._count} does not match episode frame count "
                f"{len(episode.frames)}."
            )
        destination = self.root
        destination.mkdir(parents=True, exist_ok=True)
        arrays = {
            "state": np.asarray([frame.state for frame in episode.frames], dtype=np.float32),
            "action": np.asarray([frame.action for frame in episode.frames], dtype=np.float32),
        }
        with (destination / "frames.npz").open("wb") as stream:
            np.savez_compressed(stream, **arrays)
            stream.flush()
            os.fsync(stream.fileno())
        from .video import RAW_VIDEO_CODEC, RAW_VIDEO_PIX_FMT

        videos: dict[str, dict[str, Any]] = {}
        for name, info in sorted(self._camera_info.items()):
            video_path = destination / info["path"]
            if not video_path.is_file():
                raise DatasetWriterError(f"Incremental camera video is missing: {video_path}")
            videos[name] = {
                "path": info["path"],
                "codec": RAW_VIDEO_CODEC,
                "pixFmt": RAW_VIDEO_PIX_FMT,
                "crf": self.crf,
                "gop": self.gop,
                "fps": self.fps,
                "width": info["shape"][1],
                "height": info["shape"][0],
                "frameCount": self._count,
            }
        frames = []
        for index, frame in enumerate(episode.frames):
            # Images live in the streamed videos; describe them from the encoder metadata.
            frame_value = _frame_metadata(replace(frame, images={}), {}, frame_position=index)
            frame_value["images"] = {
                name: {
                    "shape": list(info["shape"]),
                    "dtype": info["dtype"],
                    "video": info["key"],
                    "videoFrame": index,
                }
                for name, info in sorted(self._camera_info.items())
            }
            frames.append(frame_value)
        atomic_write_json(
            destination / "episode.json",
            {
                "formatVersion": EPISODE_FORMAT_VERSION,
                "summary": dict(summary) if summary is not None else episode.summary.to_dict(),
                "frames": frames,
                "arrays": sorted(arrays),
                "videos": videos,
            },
        )
        self._writers = {}
        self._camera_info = {}
        self._count = 0
        self._episode_count += 1
        return destination

    def close(self) -> dict[str, Path]:
        """Flush open encoders; the written videos stay on disk."""
        paths = {name: value[2] for name, value in self._writers.items()}
        if self._closed:
            return paths
        try:
            for container, stream, _path in self._writers.values():
                try:
                    for packet in stream.encode():
                        container.mux(packet)
                finally:
                    container.close()
        finally:
            self._closed = True
        return paths

    def video_paths(self) -> dict[str, Path]:
        return {name: self.root / info["path"] for name, info in self._camera_info.items()}

    def abort(self) -> None:
        """Close the encoders and delete the partial videos of the current episode."""
        for container, _stream, path in self._writers.values():
            try:
                container.close()
            except Exception:  # noqa: BLE001 - deleting the partial output matters more.
                pass
            finally:
                path.unlink(missing_ok=True)
        videos = self.root / "videos"
        if videos.is_dir() and not any(videos.iterdir()):
            videos.rmdir()
        self._writers = {}
        self._camera_info = {}
        self._count = 0
        self._closed = True

    @property
    def frame_count(self) -> int:
        return self._count


def _safe_key(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_]+", "_", value).strip("_") or "image"
    return f"image__{normalized}"


def _frame_metadata(
    frame: EpisodeFrame,
    image_keys: Mapping[str, str],
    *,
    frame_position: int,
) -> dict[str, Any]:
    images: dict[str, dict[str, Any]] = {}
    for name in sorted(frame.images):
        descriptor: dict[str, Any] = {
            "shape": list(frame.images[name].shape),
            "dtype": frame.images[name].dtype,
        }
        descriptor["video"] = image_keys[name]
        descriptor["videoFrame"] = frame_position
        images[name] = descriptor
    return {
        "frameIndex": frame.frame_index,
        "timestamp": frame.timestamp,
        "state": list(frame.state),
        "action": list(frame.action),
        "task": frame.task,
        "phase": frame.phase,
        "selectedObject": frame.selected_object,
        "randomization": _jsonable(frame.randomization),
        "images": images,
        "metadata": _jsonable(frame.metadata),
    }


class JSONNPZStagingWriter:
    """Write each episode atomically as ``episode.json`` + ``frames.npz`` + camera videos.

    Every camera is encoded as an AV1 MP4 at ``video_fps`` (episode format 2).
    """

    def __init__(
        self,
        output_path: str | Path,
        *,
        successful_only: bool = True,
        video_fps: int = 30,
    ) -> None:
        self.root = Path(output_path)
        self.root.mkdir(parents=True, exist_ok=True)
        self.successful_only = successful_only
        self.video_fps = int(video_fps)
        self._episode_paths: list[Path] = []
        self._attempt_paths: list[Path] = []

    def _write_staged_episode(self, episode: CollectedEpisode, destination: Path) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise DatasetWriterError(f"Staging destination already exists: {destination}")
        temporary_directory = Path(
            tempfile.mkdtemp(prefix=f".{destination.name}.", dir=str(destination.parent))
        )
        try:
            arrays: dict[str, np.ndarray] = {
                "state": np.asarray([frame.state for frame in episode.frames], dtype=np.float32),
                "action": np.asarray([frame.action for frame in episode.frames], dtype=np.float32),
            }
            image_keys: dict[str, str] = {}
            videos: dict[str, dict[str, Any]] = {}
            image_names = sorted({name for frame in episode.frames for name in frame.images})
            for image_name in image_names:
                key = _safe_key(image_name)
                if key in image_keys.values():
                    key = f"{key}_{hashlib.sha256(image_name.encode()).hexdigest()[:8]}"
                image_keys[image_name] = key
                images = [frame.images.get(image_name) for frame in episode.frames]
                if any(image is None for image in images):
                    raise DatasetWriterError(
                        f"Image '{image_name}' is missing from one or more frames in episode "
                        f"{episode.episode_index}."
                    )
                from .video import encode_video

                relative_video = Path("videos") / f"{key}.mp4"
                videos[image_name] = {
                    "path": relative_video.as_posix(),
                    **encode_video(
                        temporary_directory / relative_video,
                        (image.array() for image in images if image is not None),
                        fps=self.video_fps,
                    ),
                }

            npz_path = temporary_directory / "frames.npz"
            with npz_path.open("wb") as stream:
                np.savez_compressed(stream, **arrays)
                stream.flush()
                os.fsync(stream.fileno())
            frames = [
                _frame_metadata(frame, image_keys, frame_position=frame_position)
                for frame_position, frame in enumerate(episode.frames)
            ]
            metadata: dict[str, Any] = {
                "formatVersion": EPISODE_FORMAT_VERSION,
                "summary": episode.summary.to_dict(),
                "frames": frames,
                "arrays": sorted(arrays),
                "videos": videos,
            }
            atomic_write_json(temporary_directory / "episode.json", metadata)
            os.replace(temporary_directory, destination)
        except Exception:
            if temporary_directory.exists():
                import shutil

                shutil.rmtree(temporary_directory, ignore_errors=True)
            raise
        return destination

    def write_episode(self, episode: CollectedEpisode) -> Path | None:
        if self.successful_only and not episode.successful:
            return None
        destination = self.root / "episodes" / f"episode-{episode.episode_index:06d}"
        path = self._write_staged_episode(episode, destination)
        self._episode_paths.append(path)
        return path

    def write_episode_at(self, episode: CollectedEpisode, destination: str | Path) -> Path:
        """Write an episode at an explicit attempt-staging path without assigning collection order."""
        return self._write_staged_episode(episode, Path(destination))

    def write_attempt(self, episode: CollectedEpisode) -> Path | None:
        if episode.successful:
            return None
        attempt = episode.summary.attempt if episode.summary.attempt is not None else 0
        destination = self.root / "attempts" / f"episode-{episode.episode_index:06d}-attempt-{attempt:03d}"
        path = self._write_staged_episode(episode, destination)
        self._attempt_paths.append(path)
        return path

    def write_collection(
        self,
        result: CollectionResult,
        *,
        task: Mapping[str, Any],
        profile: Mapping[str, Any],
        scene_archive: str | Path,
    ) -> Path:
        candidates = result.successful_episodes if self.successful_only else result.final_episodes
        for episode in candidates:
            self.write_episode(episode)
        for episode in result.failed_attempts:
            self.write_attempt(episode)
        manifest = build_generation_manifest(
            task,
            profile,
            scene_archive,
            result,
            output_paths={
                "root": str(self.root),
                "episodes": [str(path) for path in self._episode_paths],
                "attempts": [str(path) for path in self._attempt_paths],
            },
        )
        return self.finalize(manifest)

    def finalize(self, manifest: Mapping[str, Any]) -> Path:
        manifest_value = dict(manifest)
        output_paths = dict(manifest_value.get("outputPaths", {}))
        output_paths.setdefault("manifest", str(self.root / "generation_manifest.json"))
        manifest_value["outputPaths"] = output_paths
        atomic_write_json(self.root / "generation_manifest.json", manifest_value)
        return self.root


def _lerobot_rgb_encoder(config_type: Any, width: int, height: int) -> Any:
    from .video import av1_encoder

    codec = av1_encoder(width, height)
    return config_type(
        vcodec=codec,
        pix_fmt="yuv420p",
        crf=LEROBOT_VIDEO_CRF,
        g=LEROBOT_VIDEO_GOP_FRAMES,
        # libaom (tiny frames only) has no preset; LeRobot's SVT-AV1 default preset applies otherwise.
        **({} if codec == "libsvtav1" else {"preset": None}),
    )


def _six_values(value: Sequence[float], label: str, expected: int) -> np.ndarray:
    array = np.asarray(value, dtype=np.float32)
    if array.shape != (expected,) or not np.all(np.isfinite(array)):
        raise DatasetWriterError(f"{label} must contain {expected} finite values matching the profile.")
    return array


class LeRobotV3Writer:
    """Write the canonical LeRobot v3 dataset used by the training CLIs."""

    def __init__(
        self,
        output_path: str | Path,
        *,
        task: Mapping[str, Any] | None = None,
        profile: Mapping[str, Any] | None = None,
        repo_id: str | None = None,
        fps: int | None = None,
        successful_only: bool | None = None,
    ) -> None:
        self.root = Path(output_path)
        self.root.parent.mkdir(parents=True, exist_ok=True)
        self.dataset_root = self.root / "dataset"
        self.task = dict(task or {})
        self.profile = dict(profile or {})
        state_fields = self.profile.get("state")
        action_fields = self.profile.get("action")
        self.state_names = tuple(
            str(item.get("name")) for item in state_fields if isinstance(item, Mapping) and item.get("name")
        ) if isinstance(state_fields, list) else SO101_STATE_NAMES
        self.action_names = tuple(
            str(item.get("name")) for item in action_fields if isinstance(item, Mapping) and item.get("name")
        ) if isinstance(action_fields, list) else SO101_ACTION_NAMES
        if not self.state_names or not self.action_names:
            raise DatasetWriterError("Dataset profile must define named state and action fields.")
        self.robot_type = str(self.profile.get("robotType") or (
            "so101" if self.profile.get("inputConvention") == "so101-normalized" or not state_fields else "generic"
        ))
        self.repo_id = repo_id or "robotic-studio/generated"
        self.fps = int(fps if fps is not None else self.profile.get("fps", 12))
        export = self.profile.get("export")
        configured_successful_only = export.get("successfulOnly") if isinstance(export, Mapping) else None
        self.successful_only = (
            bool(successful_only)
            if successful_only is not None
            else bool(True if configured_successful_only is None else configured_successful_only)
        )
        self._dataset: Any | None = None
        self._image_keys: dict[str, str] = {}
        self._image_shape: tuple[int, int] | None = None

    def _task_label(self, frame: EpisodeFrame) -> str:
        if frame.task:
            return frame.task
        instruction = self.task.get("instruction")
        return str(instruction or self.task.get("id") or "")

    @staticmethod
    def _require_lerobot() -> Any:
        try:
            from lerobot.datasets.lerobot_dataset import LeRobotDataset
        except Exception as error:
            raise LeRobotDependencyError(
                "Canonical LeRobot export requires lerobot[dataset]==0.6.0. "
                "Install the teleoperation extra from the locked Python project."
            ) from error
        return LeRobotDataset

    def _camera_keys(self, image_names: Sequence[str]) -> dict[str, str]:
        keys: dict[str, str] = {}
        for image_name in sorted(image_names):
            key = _safe_key(image_name)
            if key in keys.values():
                key = f"{key}_{hashlib.sha256(image_name.encode()).hexdigest()[:8]}"
            keys[image_name] = key
        return keys

    def _validate_episode_images(self, episode: CollectedEpisode) -> tuple[str, ...]:
        if not episode.frames:
            raise DatasetWriterError(f"Episode {episode.episode_index} contains no frames.")
        image_names = tuple(sorted(episode.frames[0].images))
        if not image_names:
            raise DatasetWriterError(
                "Video dataset export requires at least one RGB camera. "
                "Enable RGB capture before exporting training data."
            )
        expected_names = set(image_names)
        for frame in episode.frames:
            if set(frame.images) != expected_names:
                raise DatasetWriterError(
                    f"Episode {episode.episode_index} does not contain the same cameras in every frame."
                )
            for image_name in image_names:
                # Validate from the declared metadata so a full episode of pixels is not copied
                # just to check shapes; write_episode materializes one frame at a time.
                image = frame.images[image_name]
                if image.numpy_dtype() != np.uint8 or len(image.shape) != 3 or image.shape[2] != 3:
                    raise DatasetWriterError(
                        f"RGB camera '{image_name}' must contain uint8 HWC frames with three channels."
                    )
                shape = (int(image.shape[0]), int(image.shape[1]))
                if self._image_shape is None:
                    self._image_shape = shape
                elif self._image_shape != shape:
                    raise DatasetWriterError(
                        "All RGB cameras in a LeRobot ACT/Pi0.5 dataset must have the same resolution."
                    )
        return image_names

    def _ensure_dataset(self, episode: CollectedEpisode, image_names: tuple[str, ...]) -> None:
        if self._dataset is not None:
            return
        image_keys = self._camera_keys(image_names)
        if self._image_shape is None:
            raise DatasetWriterError("Could not determine the RGB camera resolution.")
        height, width = self._image_shape
        features: dict[str, dict[str, Any]] = {
            "observation.state": {
                "dtype": "float32",
                "shape": (len(self.state_names),),
                "names": list(self.state_names),
            },
            "action": {
                "dtype": "float32",
                "shape": (len(self.action_names),),
                "names": list(self.action_names),
            },
        }
        for image_name, image_key in image_keys.items():
            features[f"observation.images.{image_key}"] = {
                "dtype": "video",
                "shape": (3, height, width),
                "names": ["channel", "height", "width"],
            }
        LeRobotDataset = self._require_lerobot()
        try:
            from lerobot.configs import RGBEncoderConfig

            self._dataset = LeRobotDataset.create(
                repo_id=self.repo_id,
                root=self.dataset_root,
                robot_type=self.robot_type,
                fps=self.fps,
                features=features,
                image_writer_threads=0,
                use_videos=True,
                video_backend="pyav",
                rgb_encoder=_lerobot_rgb_encoder(RGBEncoderConfig, width, height),
            )
        except Exception as error:
            raise DatasetWriterError(f"Could not create the canonical LeRobot dataset: {error}") from error
        self._image_keys = image_keys

    def write_episode(
        self,
        episode: CollectedEpisode,
        *,
        progress: Callable[[int, int], None] | None = None,
    ) -> Path | None:
        if self.successful_only and not episode.successful:
            return None
        image_names = self._validate_episode_images(episode)
        self._ensure_dataset(episode, image_names)
        if set(image_names) != set(self._image_keys):
            raise DatasetWriterError("The set of camera names changed across exported episodes.")
        if self._dataset is None:
            raise DatasetWriterError("The canonical LeRobot dataset was not initialized.")
        try:
            for frame_number, frame in enumerate(episode.frames, start=1):
                task = self._task_label(frame)
                if not task.strip():
                    raise DatasetWriterError(
                        f"Episode {episode.episode_index}, frame {frame.frame_index} has no task text."
                    )
                values: dict[str, Any] = {
                    "observation.state": _six_values(frame.state, "observation.state", len(self.state_names)),
                    "action": _six_values(frame.action, "action", len(self.action_names)),
                    "task": task,
                }
                for image_name, image_key in self._image_keys.items():
                    values[f"observation.images.{image_key}"] = frame.images[image_name].array()
                self._dataset.add_frame(values)
                if progress:
                    progress(frame_number, len(episode.frames))
            self._dataset.save_episode()
        except DatasetWriterError:
            raise
        except Exception as error:
            raise DatasetWriterError(
                f"Could not write episode {episode.episode_index} to the canonical LeRobot dataset: {error}"
            ) from error
        return self.dataset_root

    def write_attempt(self, episode: CollectedEpisode) -> Path | None:
        if episode.successful:
            return None
        path = self.root / "attempts" / (
            f"episode-{episode.episode_index:06d}-attempt-"
            f"{(episode.summary.attempt or 0):03d}.json"
        )
        atomic_write_json(path, {"summary": episode.summary.to_dict(), "frameCount": len(episode.frames)})
        return path

    def write_collection(
        self,
        result: CollectionResult,
        *,
        task: Mapping[str, Any],
        profile: Mapping[str, Any],
        scene_archive: str | Path,
        progress: Callable[[int, int, int, int], None] | None = None,
    ) -> Path:
        candidates = result.successful_episodes if self.successful_only else result.final_episodes
        for episode_number, episode in enumerate(candidates, start=1):
            self.write_episode(
                episode,
                progress=(
                    (lambda frame_number, frame_count, number=episode_number: progress(
                        number, len(candidates), frame_number, frame_count
                    ))
                    if progress
                    else None
                ),
            )
        for episode in result.failed_attempts:
            self.write_attempt(episode)
        manifest = build_generation_manifest(
            task,
            profile,
            scene_archive,
            result,
            output_paths=self.manifest_output_paths(),
        )
        return self.finalize(manifest)

    def manifest_output_paths(self) -> dict[str, str]:
        """Output paths recorded in the generation manifest before finalization adds videos."""
        return {"root": str(self.dataset_root), "dataset": str(self.dataset_root)}

    def finalize(self, manifest: Mapping[str, Any]) -> Path:
        if self._dataset is None:
            raise DatasetWriterError(
                "Video dataset export requires at least one successful RGB episode."
            )
        try:
            self._dataset.finalize()
        except Exception as error:
            raise DatasetWriterError(f"Could not finalize the canonical LeRobot dataset: {error}") from error
        guard_zero_variance_feature_stats(self.dataset_root)
        video_paths = sorted(str(path) for path in (self.dataset_root / "videos").rglob("*.mp4"))
        manifest_value = dict(manifest)
        output_paths = dict(manifest_value.get("outputPaths", {}))
        output_paths["manifest"] = str(self.root / "generation_manifest.json")
        output_paths["videos"] = video_paths
        manifest_value["outputPaths"] = output_paths
        manifest_value["datasetFormat"] = "lerobot-v3-canonical-video"
        atomic_write_json(self.root / "generation_manifest.json", manifest_value)
        return self.root


def _canonical_fingerprint(value: Any) -> str:
    payload = json.dumps(_jsonable(value), sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _file_fingerprint(path: str | Path) -> str | None:
    source = Path(path)
    if not source.is_file():
        return None
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def build_generation_manifest(
    task: Mapping[str, Any],
    profile: Mapping[str, Any],
    scene_archive: str | Path,
    result: CollectionResult,
    *,
    output_paths: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return build_generation_manifest_from_summaries(
        task,
        profile,
        scene_archive,
        episode_summaries=result.summaries,
        attempt_summaries=tuple(episode.summary for episode in result.attempts),
        failure_summaries=tuple(episode.summary for episode in result.failed_attempts),
        cancelled=result.cancelled,
        output_paths=output_paths,
    )


def build_generation_manifest_from_summaries(
    task: Mapping[str, Any],
    profile: Mapping[str, Any],
    scene_archive: str | Path,
    *,
    episode_summaries: Iterable[EpisodeSummary],
    attempt_summaries: Iterable[EpisodeSummary],
    failure_summaries: Iterable[EpisodeSummary] = (),
    cancelled: bool = False,
    output_paths: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the manifest from episode summaries only, so callers need not retain frames."""
    attempt_records = [summary.to_dict() for summary in attempt_summaries]
    failures = [summary.to_dict() for summary in failure_summaries]
    scene_fingerprint = profile.get("sceneFingerprint")
    return {
        "version": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "task": _jsonable(task),
        "profile": _jsonable(profile),
        "fingerprints": {
            "task": _canonical_fingerprint(task),
            "profile": _canonical_fingerprint(profile),
            "scene": str(scene_fingerprint) if scene_fingerprint is not None else None,
            "sceneArchive": _file_fingerprint(scene_archive),
        },
        "sceneFingerprint": str(scene_fingerprint) if scene_fingerprint is not None else None,
        "seeds": [
            {
                "episodeIndex": summary.get("episodeIndex"),
                "attempt": summary.get("attempt"),
                "seed": summary.get("seed"),
            }
            for summary in attempt_records
        ],
        "episodeSummaries": [summary.to_dict() for summary in episode_summaries],
        "failures": failures,
        "versions": {
            "python": sys.version.split()[0],
            "numpy": _package_version("numpy"),
            "mujoco": _package_version("mujoco"),
            "pyarrow": _package_version("pyarrow"),
        },
        "successfulOnly": bool(
            profile.get("export", {}).get("successfulOnly", True)
            if isinstance(profile.get("export"), Mapping)
            else True
        ),
        "cancelled": cancelled,
        "outputPaths": _jsonable(dict(output_paths or {})),
    }
