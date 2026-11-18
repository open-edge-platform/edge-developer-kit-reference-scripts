# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Convert a downloaded raw recording bundle into a canonical LeRobot v3 dataset.

Conversion runs in two passes so memory stays bounded by one episode, not the whole dataset:

1. Scan: read each episode's JSON metadata, its small state/action arrays and its camera video
   descriptions. This validates the whole bundle (frame counts, cameras, resolution,
   cadence) before any slow video encoding starts, without decoding pixels.
2. Stream: load one episode, hand it to the LeRobot writer, drop it, and move on.

Raw dataset format 2 stores each camera of an episode as an AV1 MP4 (``videos/``) and state/action
in ``frames.npz``.
"""

from __future__ import annotations

import argparse
import json
import zipfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Any

import numpy as np

from .dataset import (
    CollectedEpisode,
    EpisodeFrame,
    EpisodeSummary,
    LeRobotV3Writer,
    RGBImage,
    build_generation_manifest_from_summaries,
)


RAW_DATASET_FORMAT_VERSION = 2
COLLECTION_FORMAT_VERSION = 1
RAW_DATASET_FORMAT = "robotic-studio-raw-dataset"
# Frame intervals may vary by a physics step around the frame period (see FrameClock); anything
# further off is a gap or a different capture rate.
FRAME_INTERVAL_TOLERANCE = 0.25
_CONTROL_MODES = {"physics-only", "kinematically-assisted"}


class RawDatasetError(RuntimeError):
    """The downloaded raw recording dataset is invalid or cannot be converted."""


def _record(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RawDatasetError(f"{label} must contain an object.")
    return value


def _read_json(path: Path, label: str) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RawDatasetError(f"Could not read {label} from '{path}'.") from error
    return _record(value, label)


def _episode_directory(raw_root: Path, episode_index: int) -> Path:
    if not isinstance(episode_index, int) or isinstance(episode_index, bool) or episode_index < 0:
        raise RawDatasetError("The raw episode index must be a non-negative integer.")
    return raw_root / "episodes" / f"episode-{episode_index:06d}"


def _source_index(episode: Mapping[str, Any]) -> int:
    source_index = episode.get("episodeIndex")
    if not isinstance(source_index, int) or isinstance(source_index, bool) or source_index < 0:
        raise RawDatasetError("The raw episode has an invalid episode index.")
    return source_index


def _episode_label(episode: Mapping[str, Any]) -> Any:
    return episode.get("episodeId", episode.get("episodeIndex"))


# --- episode.json parsing -------------------------------------------------------------------


@dataclass(frozen=True)
class _RawFrame:
    frame_index: int
    timestamp: float
    task: str
    # Camera name -> episode video key.
    image_keys: Mapping[str, str]
    phase: str | None
    selected_object: str | None
    randomization: list[Mapping[str, Any]]
    metadata: Mapping[str, Any]


@dataclass(frozen=True)
class _RawSummary:
    seed: int
    attempts: int
    randomization: tuple[Mapping[str, Any], ...]
    selected_object: str | None
    phase: str | None
    phase_history: tuple[str, ...]
    control_mode: str | None


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _parse_frames(metadata: Mapping[str, Any]) -> list[_RawFrame]:
    raw_frames = metadata.get("frames")
    if not isinstance(raw_frames, list):
        raise RawDatasetError("The raw episode metadata has no frames.")
    camera_keys: dict[str, str] = {}
    frames: list[_RawFrame] = []
    for raw_frame_value in raw_frames:
        raw_frame = _record(raw_frame_value, "raw frame")
        frame_index = raw_frame.get("frameIndex")
        timestamp = raw_frame.get("timestamp")
        task = raw_frame.get("task")
        raw_images = raw_frame.get("images", {})
        if (
            not isinstance(frame_index, int)
            or isinstance(frame_index, bool)
            or frame_index < 0
            or not isinstance(timestamp, (int, float))
            or isinstance(timestamp, bool)
            or not np.isfinite(timestamp)
            or not isinstance(task, str)
            or not task.strip()
            or not isinstance(raw_images, Mapping)
        ):
            raise RawDatasetError("The raw episode contains invalid frame fields.")

        image_keys: dict[str, str] = {}
        for image_name, descriptor_value in raw_images.items():
            if not isinstance(image_name, str):
                raise RawDatasetError("The raw episode contains an invalid image name.")
            descriptor = _record(descriptor_value, "raw image metadata")
            key = descriptor.get("video")
            if not isinstance(key, str) or not key:
                raise RawDatasetError(f"The raw episode image '{image_name}' is missing its video.")
            if camera_keys.setdefault(image_name, key) != key:
                raise RawDatasetError(f"The raw episode image '{image_name}' changes its video key.")
            image_keys[image_name] = key

        raw_randomization = raw_frame.get("randomization", [])
        if not isinstance(raw_randomization, list) or not all(
            isinstance(value, Mapping) for value in raw_randomization
        ):
            raise RawDatasetError("The raw episode randomization metadata is invalid.")
        frames.append(
            _RawFrame(
                frame_index=frame_index,
                timestamp=float(timestamp),
                task=task,
                image_keys=image_keys,
                phase=_optional_str(raw_frame.get("phase")),
                selected_object=_optional_str(raw_frame.get("selectedObject")),
                randomization=raw_randomization,
                metadata=_record(raw_frame.get("metadata", {}), "raw frame metadata"),
            )
        )
    return frames


def _parse_summary(metadata: Mapping[str, Any]) -> _RawSummary:
    raw_summary = _record(metadata.get("summary"), "raw episode summary")
    randomization = raw_summary.get("randomization", [])
    phase_history = raw_summary.get("phaseHistory", [])
    if not isinstance(randomization, list) or not all(
        isinstance(value, Mapping) for value in randomization
    ):
        raise RawDatasetError("The raw episode summary randomization is invalid.")
    if not isinstance(phase_history, list) or not all(isinstance(value, str) for value in phase_history):
        raise RawDatasetError("The raw episode phase history is invalid.")
    try:
        seed = int(raw_summary.get("seed", 0))
        attempts = int(raw_summary.get("attempts", 1))
    except (TypeError, ValueError) as error:
        raise RawDatasetError("The raw episode summary has an invalid seed or attempt count.") from error
    control_mode = raw_summary.get("controlMode")
    return _RawSummary(
        seed=seed,
        attempts=attempts,
        randomization=tuple(randomization),
        selected_object=_optional_str(raw_summary.get("selectedObject")),
        phase=_optional_str(raw_summary.get("phase")),
        phase_history=tuple(phase_history),
        control_mode=str(control_mode) if control_mode in _CONTROL_MODES else None,
    )


# --- frames.npz access without decompressing whole arrays -----------------------------------


@dataclass(frozen=True)
class _ArrayHeader:
    shape: tuple[int, ...]
    dtype: np.dtype
    fortran_order: bool


def _read_npy_header(stream: IO[bytes]) -> _ArrayHeader:
    version = np.lib.format.read_magic(stream)
    if version == (1, 0):
        shape, fortran_order, dtype = np.lib.format.read_array_header_1_0(stream)
    elif version == (2, 0):
        shape, fortran_order, dtype = np.lib.format.read_array_header_2_0(stream)
    else:
        raise RawDatasetError(f"Unsupported .npy format version {version[0]}.{version[1]}.")
    dtype = np.dtype(dtype)
    if dtype.hasobject:
        raise RawDatasetError("The raw episode contains object arrays, which are not supported.")
    return _ArrayHeader(tuple(int(size) for size in shape), dtype, bool(fortran_order))


def _npz_headers(archive: zipfile.ZipFile) -> dict[str, _ArrayHeader]:
    """Read every array's shape and dtype; only the first few bytes of each member are inflated."""
    headers: dict[str, _ArrayHeader] = {}
    for member in archive.namelist():
        if member.endswith(".npy"):
            with archive.open(member) as stream:
                headers[member[: -len(".npy")]] = _read_npy_header(stream)
    return headers


def _read_npz_array(archive: zipfile.ZipFile, key: str) -> np.ndarray:
    with archive.open(f"{key}.npy") as stream:
        return np.lib.format.read_array(stream, allow_pickle=False)


def _open_npz(path: Path) -> zipfile.ZipFile:
    try:
        return zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as error:
        raise RawDatasetError(f"Could not open '{path}'.") from error


def _check_state_action(state: _ArrayHeader, action: _ArrayHeader, frame_count: int) -> None:
    if (
        len(state.shape) != 2
        or len(action.shape) != 2
        or state.shape[0] != frame_count
        or action.shape[0] != frame_count
    ):
        raise RawDatasetError("The raw episode frame arrays are inconsistent.")


def _camera_keys(frames: Sequence[_RawFrame]) -> dict[str, str]:
    keys: dict[str, str] = {}
    for frame in frames:
        keys.update(frame.image_keys)
    return keys


def _episode_videos(metadata: Mapping[str, Any], directory: Path) -> dict[str, tuple[Path, Mapping[str, Any]]]:
    """Return camera -> (video path, description)."""
    raw_videos = metadata.get("videos")
    if raw_videos is None:
        raise RawDatasetError("The raw episode has no camera videos. Record it again.")
    videos: dict[str, tuple[Path, Mapping[str, Any]]] = {}
    for name, description_value in _record(raw_videos, "raw episode videos").items():
        description = _record(description_value, f"raw video '{name}'")
        relative = description.get("path")
        parts = Path(relative).parts if isinstance(relative, str) else ()
        if not parts or Path(relative).is_absolute() or ".." in parts:
            raise RawDatasetError(f"The raw episode video '{name}' has an invalid path.")
        videos[str(name)] = (directory / relative, description)
    return videos


def _video_frame_size(name: str, description: Mapping[str, Any], frame_count: int) -> tuple[int, int]:
    width, height, count = description.get("width"), description.get("height"), description.get("frameCount")
    if not all(isinstance(value, int) and not isinstance(value, bool) and value > 0 for value in (width, height)):
        raise RawDatasetError(f"The raw episode video '{name}' has invalid dimensions.")
    if count != frame_count:
        raise RawDatasetError(
            f"The raw episode image '{name}' must have one video frame per recorded frame."
        )
    return height, width  # type: ignore[return-value]


# --- Pass 1: scan ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _ScannedEpisode:
    timestamps: tuple[float, ...]
    cameras: tuple[str, ...]
    camera_sizes: Mapping[str, tuple[int, int]]
    state_width: int
    action_width: int


def _scan_raw_episode(raw_root: Path, episode: Mapping[str, Any]) -> _ScannedEpisode:
    """Validate one episode for LeRobot export without decompressing its camera frames."""
    directory = _episode_directory(raw_root, _source_index(episode))
    try:
        metadata = _read_json(directory / "episode.json", "episode metadata")
        frames = _parse_frames(metadata)
        _parse_summary(metadata)
        if not frames:
            raise RawDatasetError("The raw episode has no frames.")
        cameras = tuple(sorted(frames[0].image_keys))
        if not cameras:
            raise RawDatasetError(
                "Video dataset export requires at least one RGB camera. "
                "Enable RGB capture before recording training data."
            )
        if any(tuple(sorted(frame.image_keys)) != cameras for frame in frames):
            raise RawDatasetError("The raw episode does not contain the same cameras in every frame.")

        with _open_npz(directory / "frames.npz") as archive:
            headers = _npz_headers(archive)
            if "state" not in headers or "action" not in headers:
                raise RawDatasetError("The raw episode is missing saved arrays.")
            _check_state_action(headers["state"], headers["action"], len(frames))
            # State and action are small; reading them lets NaNs fail before encoding starts.
            for key in ("state", "action"):
                values = _read_npz_array(archive, key)
                if not np.issubdtype(values.dtype, np.number) or not np.all(np.isfinite(values)):
                    raise RawDatasetError(f"The raw episode {key} values must be finite numbers.")

        videos = _episode_videos(metadata, directory)
        camera_sizes: dict[str, tuple[int, int]] = {}
        for name in cameras:
            video = videos.get(name)
            if video is None or not video[0].is_file():
                raise RawDatasetError(f"The raw episode image '{name}' is missing its video.")
            camera_sizes[name] = _video_frame_size(name, video[1], len(frames))
    except RawDatasetError as error:
        raise RawDatasetError(f"Episode '{_episode_label(episode)}': {error}") from error
    except (OSError, ValueError, EOFError, zipfile.BadZipFile) as error:
        raise RawDatasetError(f"Episode '{_episode_label(episode)}' could not be read.") from error
    return _ScannedEpisode(
        timestamps=tuple(frame.timestamp for frame in frames),
        cameras=cameras,
        camera_sizes=camera_sizes,
        state_width=headers["state"].shape[1],
        action_width=headers["action"].shape[1],
    )


def _check_consistent_episodes(scanned: Sequence[_ScannedEpisode]) -> tuple[int, int]:
    first = scanned[0]
    for episode in scanned[1:]:
        if episode.cameras != first.cameras:
            raise RawDatasetError("The set of camera names changes across recorded episodes.")
        if (episode.state_width, episode.action_width) != (first.state_width, first.action_width):
            raise RawDatasetError("State or action width changes across recorded episodes.")
    # LeRobot stores one image shape for all camera features. Use the largest source image area
    # as the shared size so smaller views are enlarged rather than reducing the best source detail.
    return max(
        (size for episode in scanned for size in episode.camera_sizes.values()),
        key=lambda size: (size[0] * size[1], size[0], size[1]),
    )


# --- Pass 2: load one episode ---------------------------------------------------------------


def load_raw_episode(
    raw_root: str | Path,
    episode: Mapping[str, Any],
    episode_index: int,
    *,
    progress: Callable[[int, int], None] | None = None,
    control_mode: str | None = None,
    image_size: tuple[int, int] | None = None,
) -> CollectedEpisode:
    """Load one portable raw episode and renumber it for the converted dataset."""
    directory = _episode_directory(Path(raw_root), _source_index(episode))
    label = _episode_label(episode)
    metadata = _read_json(directory / "episode.json", "episode metadata")
    raw_frames = _parse_frames(metadata)
    raw_summary = _parse_summary(metadata)
    videos = _episode_videos(metadata, directory)
    try:
        with _open_npz(directory / "frames.npz") as archive:
            headers = _npz_headers(archive)
            if "state" not in headers or "action" not in headers:
                raise RawDatasetError(f"Episode '{label}' is missing saved arrays.")
            _check_state_action(headers["state"], headers["action"], len(raw_frames))
            state_values = _read_npz_array(archive, "state")
            action_values = _read_npz_array(archive, "action")
        camera_frames = {
            name: _read_video_frames(name, videos.get(name), len(raw_frames))
            for name in _camera_keys(raw_frames)
        }
    except (OSError, ValueError, EOFError, zipfile.BadZipFile) as error:
        raise RawDatasetError(f"Episode '{label}' could not be read.") from error

    if image_size is not None:
        camera_frames = {
            name: [_resize_rgb_image(image, image_size) for image in images]
            for name, images in camera_frames.items()
        }

    frames: list[EpisodeFrame] = []
    try:
        for position, raw_frame in enumerate(raw_frames):
            frames.append(
                EpisodeFrame.from_values(
                    raw_frame.frame_index,
                    raw_frame.timestamp,
                    state_values[position],
                    action_values[position],
                    raw_frame.task,
                    phase=raw_frame.phase,
                    selected_object=raw_frame.selected_object,
                    randomization=raw_frame.randomization,
                    images={name: camera_frames[name][position] for name in raw_frame.image_keys},
                    metadata=raw_frame.metadata,
                )
            )
            if progress:
                progress(position + 1, len(raw_frames))
    except ValueError as error:
        raise RawDatasetError(f"Episode '{label}' contains invalid frame values: {error}") from error

    summary = EpisodeSummary(
        episode_index=episode_index,
        seed=raw_summary.seed,
        status="success",
        attempts=raw_summary.attempts,
        steps=len(frames),
        randomization=raw_summary.randomization,
        selected_object=raw_summary.selected_object,
        phase=raw_summary.phase,
        phase_history=raw_summary.phase_history,
        control_mode=raw_summary.control_mode or control_mode,
    )
    return CollectedEpisode(summary, tuple(frames))


def _resize_rgb_image(image: RGBImage, image_size: tuple[int, int]) -> RGBImage:
    """Resize one camera frame to the dataset-wide LeRobot image shape (height, width)."""
    if image.shape[:2] == image_size:
        return image
    try:
        from PIL import Image
    except ImportError as error:
        raise RawDatasetError("Resizing mixed-resolution cameras requires Pillow.") from error
    height, width = image_size
    with Image.fromarray(image.array(), mode="RGB") as source:
        resized = source.resize((width, height), Image.Resampling.BILINEAR)
        try:
            return RGBImage.from_array(np.asarray(resized, dtype=np.uint8))
        finally:
            resized.close()


def _read_video_frames(
    name: str,
    video: tuple[Path, Mapping[str, Any]] | None,
    frame_count: int,
) -> list[RGBImage]:
    from .video import VideoCodecError, decode_video

    if video is None:
        raise RawDatasetError(f"The raw episode image '{name}' is missing its video.")
    try:
        images = [RGBImage.from_array(frame) for frame in decode_video(video[0])]
    except VideoCodecError as error:
        raise RawDatasetError(str(error)) from error
    except Exception as error:  # noqa: BLE001 - PyAV raises its own error hierarchy.
        raise RawDatasetError(f"The raw episode video '{name}' could not be decoded: {error}") from error
    if len(images) != frame_count:
        raise RawDatasetError(
            f"The raw episode video '{name}' has {len(images)} frames for {frame_count} recorded frames."
        )
    return images


# --- Capture rate ---------------------------------------------------------------------------


class _NoFrameIntervals(RawDatasetError):
    pass


def infer_capture_fps(episode_timestamps: Sequence[Sequence[float]]) -> int:
    """Infer frame cadence from simulation timestamps instead of UI stream rate.

    Recorders place frames on a fixed grid of simulated time, but a frame period is rarely a whole
    number of physics steps (1/30 s at 2 ms steps alternates 34 ms and 32 ms intervals), so the
    rate is the mean interval and each interval may differ from it by part of a period.
    """
    intervals = [
        right - left
        for timestamps in episode_timestamps
        for left, right in zip(timestamps, timestamps[1:])
        if right > left
    ]
    if not intervals:
        raise _NoFrameIntervals("At least one episode needs two increasing frame timestamps to infer FPS.")
    mean_interval = float(np.mean(np.asarray(intervals, dtype=np.float64)))
    fps = int(round(1.0 / mean_interval))
    if fps < 1:
        raise RawDatasetError("Frame timestamps imply an invalid capture rate.")
    # A single dataset must have a coherent temporal contract; do not silently encode at a
    # different cadence than the samples were collected at.
    period = 1.0 / fps
    if any(abs(interval - period) > FRAME_INTERVAL_TOLERANCE * period for interval in intervals):
        raise RawDatasetError(
            "Recorded frame timestamps have inconsistent cadence; split captures by rate before conversion."
        )
    return fps


def resolve_capture_fps(episode_timestamps: Sequence[Sequence[float]], override: int | None) -> int:
    """Return the recorded cadence; an override is accepted only when it agrees with the timestamps."""
    try:
        inferred = infer_capture_fps(episode_timestamps)
    except _NoFrameIntervals:
        if override is None:
            raise
        return override
    if override is not None and override != inferred:
        raise RawDatasetError(
            f"--fps {override} does not match the recorded cadence of {inferred} FPS. "
            "Omit --fps to use the recorded cadence."
        )
    return inferred


# --- Conversion -----------------------------------------------------------------------------


def convert_raw_dataset(
    raw_directory: str | Path,
    output_directory: str | Path,
    *,
    repo_id: str = "converted/dataset",
    verbose: bool = True,
    include_non_physics: bool = False,
    fps: int | None = None,
) -> Path:
    """Convert a downloaded raw recording bundle into a canonical LeRobot v3 dataset.

    Every episode is validated before anything is written, then episodes are streamed through
    the writer one at a time so peak memory is about one episode regardless of dataset size.
    """
    raw_root = Path(raw_directory)
    output_root = Path(output_directory)
    metadata_root = raw_root.parent
    raw_manifest = _read_json(metadata_root / "raw-dataset.json", "raw dataset manifest")
    if (
        raw_manifest.get("format") != RAW_DATASET_FORMAT
        or raw_manifest.get("version") != RAW_DATASET_FORMAT_VERSION
    ):
        raise RawDatasetError(
            f"Unsupported raw dataset manifest: expected {RAW_DATASET_FORMAT} "
            f"v{RAW_DATASET_FORMAT_VERSION}. Download the raw dataset again."
        )
    collection = _read_json(metadata_root / "collection.json", "collection metadata")
    profile = _read_json(metadata_root / "profile.json", "teleoperation profile")
    if collection.get("version") != COLLECTION_FORMAT_VERSION:
        raise RawDatasetError(
            f"Unsupported raw dataset format: {collection.get('version')!r}. "
            f"Expected {COLLECTION_FORMAT_VERSION}."
        )
    if fps is not None and (not isinstance(fps, int) or isinstance(fps, bool) or fps < 1):
        raise RawDatasetError("FPS override must be a positive integer.")
    episodes = collection.get("episodes")
    if not isinstance(episodes, list):
        raise RawDatasetError("Collection metadata must contain an episodes array.")
    recorded = [
        _record(episode, "collection episode")
        for episode in episodes
        if isinstance(episode, Mapping)
        and episode.get("status") == "recorded"
        and isinstance(episode.get("frameCount"), int)
        and episode["frameCount"] > 0
    ]
    if not recorded:
        raise RawDatasetError("The raw dataset contains no recorded episodes.")

    untagged = [episode for episode in recorded if episode.get("controlMode") not in _CONTROL_MODES]
    if untagged:
        raise RawDatasetError(
            f"Episode '{_episode_label(untagged[0])}' does not record whether kinematic overrides "
            "were used. Record it again."
        )
    trainable = [episode for episode in recorded if episode.get("controlMode") == "physics-only"]
    excluded = len(recorded) - len(trainable)
    if excluded and not include_non_physics:
        if not trainable:
            raise RawDatasetError(
                "No episodes are physics-only demonstrations. This archive contains only "
                "kinematically assisted recordings. Regenerate with physics-only control, "
                "or pass --include-assisted to opt in explicitly."
            )
        recorded = trainable
        if verbose:
            print(f"Excluded {excluded} assisted episode(s) from training.", flush=True)

    def report_progress(
        phase: str,
        episode_number: int,
        episode_count: int,
        frame_number: int,
        frame_count: int,
    ) -> None:
        print(
            f"\r{phase}: episode {episode_number}/{episode_count}, "
            f"frame {frame_number}/{frame_count}",
            end="\n" if frame_number == frame_count else "",
            flush=True,
        )

    # Pass 1: validate the whole bundle and infer the cadence without decompressing pixels.
    if verbose:
        total_frames = sum(int(episode["frameCount"]) for episode in recorded)
        print(
            f"Checking {len(recorded)} recorded episodes ({total_frames} frames) in {raw_root}",
            flush=True,
        )
    scanned = [_scan_raw_episode(raw_root, episode) for episode in recorded]
    target_image_size = _check_consistent_episodes(scanned)
    capture_fps = resolve_capture_fps([episode.timestamps for episode in scanned], fps)
    del scanned

    task = {
        "id": str(profile.get("name") or "teleoperation"),
        "instruction": str(profile.get("name") or "teleoperation"),
    }
    export_profile = {**profile, "fps": int(capture_fps)}
    writer = LeRobotV3Writer(
        output_root,
        task=task,
        profile=export_profile,
        repo_id=repo_id,
        fps=int(capture_fps),
        successful_only=True,
    )
    if verbose:
        print(f"Writing LeRobot dataset at {capture_fps} FPS to {output_root / 'dataset'}", flush=True)

    # Pass 2: stream one episode at a time through the writer; keep only its summary.
    summaries: list[EpisodeSummary] = []
    episode_count = len(recorded)
    for number, entry in enumerate(recorded, start=1):
        episode = load_raw_episode(
            raw_root,
            entry,
            number - 1,
            progress=(
                (lambda frame, frames, number=number: report_progress(
                    "Loading raw recordings", number, episode_count, frame, frames
                ))
                if verbose
                else None
            ),
            control_mode=str(entry["controlMode"]),
            image_size=target_image_size,
        )
        writer.write_episode(
            episode,
            progress=(
                (lambda frame, frames, number=number: report_progress(
                    "Writing LeRobot dataset", number, episode_count, frame, frames
                ))
                if verbose
                else None
            ),
        )
        summaries.append(episode.summary)
        del episode

    if verbose:
        print("Finalizing LeRobot metadata and videos...", flush=True)
    manifest = build_generation_manifest_from_summaries(
        task,
        export_profile,
        metadata_root / "scene.mujoco-scene",
        episode_summaries=summaries,
        attempt_summaries=summaries,
        output_paths=writer.manifest_output_paths(),
    )
    writer.finalize(manifest)
    if verbose:
        print("LeRobot metadata and video finalization complete.", flush=True)
    return output_root / "dataset"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="convert_to_lerobot.py",
        description="Convert a Physical AI Scene Builder raw recording bundle into LeRobot v3.",
    )
    parser.add_argument("--input", default="raw", help="Raw dataset directory (default: raw).")
    parser.add_argument(
        "--output",
        default="converted",
        help="Conversion output directory (default: converted).",
    )
    parser.add_argument(
        "--repo-id",
        default="converted/dataset",
        help="Local LeRobot repository id (default: converted/dataset).",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress conversion progress output.",
    )
    parser.add_argument(
        "--include-assisted",
        action="store_true",
        help="Explicitly include kinematically assisted episodes in the training dataset.",
    )
    parser.add_argument(
        "--fps",
        type=int,
        help="Frame rate for episodes too short to infer it; must match the recorded cadence.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        output = convert_raw_dataset(
            arguments.input,
            arguments.output,
            repo_id=arguments.repo_id,
            verbose=not arguments.quiet,
            include_non_physics=arguments.include_assisted,
            fps=arguments.fps,
        )
    except (OSError, RawDatasetError, RuntimeError, ValueError, ImportError) as error:
        print(f"Raw dataset conversion failed: {error}")
        return 1
    print(f"LeRobot dataset written to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
