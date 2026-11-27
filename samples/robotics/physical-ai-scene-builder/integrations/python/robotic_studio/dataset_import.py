# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Read a real-robot LeRobot v3 recording so an agent can rebuild its scene (MCP dataset tools).

Each subcommand prints one JSON line on stdout; errors go to stderr with exit code 1.

    prepare ZIP OUT                      extract an uploaded archive safely and summarize it
    frames ROOT EPISODE TIME OUT [--camera KEY ...]
                                         decode each camera's frame at TIME seconds into the episode
    trajectory ROOT EPISODE              the episode's observation.state and action per frame
    compare REAL SIM OUT                 how well a simulated camera render lines up with a real frame
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np

INFO_PATH = "meta/info.json"
EPISODES_DIR = "meta/episodes"
# v3 always uses these layouts; the templates in info.json are not trusted as paths.
DATA_PATH = "data/chunk-{chunk:03d}/file-{file:03d}.parquet"
VIDEO_PATH = "videos/{key}/chunk-{chunk:03d}/file-{file:03d}.mp4"
MAX_MEMBERS = 20_000
MAX_EXTRACTED_BYTES = 8 * 1024**3
MAX_LISTED_EPISODES = 200
MAX_TRAJECTORY_FRAMES = 20_000
FEATURE_KEY = re.compile(r"^[A-Za-z0-9_.\-]{1,128}$")
STATE_KEY = "observation.state"
ACTION_KEY = "action"


class DatasetError(ValueError):
    """The archive or dataset cannot be used; the message is shown to the user."""


def _member_path(name: str) -> PurePosixPath | None:
    """The archive member's relative path, or None for entries to skip (directories, macOS metadata)."""
    if "\\" in name or name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        raise DatasetError(f"The archive contains an unsafe path: {name!r}.")
    path = PurePosixPath(name)
    if any(part == ".." for part in path.parts):
        raise DatasetError(f"The archive contains an unsafe path: {name!r}.")
    if name.endswith("/") or not path.parts or path.parts[0] == "__MACOSX" or path.name == ".DS_Store":
        return None
    return path


def extract_archive(archive_path: Path, destination: Path) -> None:
    """Extract a zip without following links or writing outside ``destination``, within size limits."""
    destination.mkdir(parents=True, exist_ok=True)
    base = destination.resolve()
    try:
        archive = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as error:
        raise DatasetError("The upload is not a zip archive. Zip the dataset folder and share the .zip.") from error
    with archive:
        members = archive.infolist()
        if len(members) > MAX_MEMBERS:
            raise DatasetError(f"The archive has more than {MAX_MEMBERS} files; share one recording.")
        written = 0
        for member in members:
            relative = _member_path(member.filename)
            if relative is None:
                continue
            if stat.S_ISLNK(member.external_attr >> 16):
                raise DatasetError(f"The archive contains a link, which is not allowed: {member.filename!r}.")
            target = (base / relative).resolve()
            if not target.is_relative_to(base):
                raise DatasetError(f"The archive contains an unsafe path: {member.filename!r}.")
            target.parent.mkdir(parents=True, exist_ok=True)
            # The header's size can lie, so the limit counts the bytes actually written.
            with archive.open(member) as source, target.open("wb") as sink:
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    if written > MAX_EXTRACTED_BYTES:
                        raise DatasetError("The extracted dataset is larger than 8 GB; share one recording.")
                    sink.write(chunk)


def find_root(directory: Path) -> Path:
    """The folder holding ``meta/info.json``: the archive root or one folder (up to three levels) down."""
    candidates = [path.parent.parent for path in directory.glob("meta/info.json")]
    for depth in ("*", "*/*", "*/*/*"):
        if candidates:
            break
        candidates = [path.parent.parent for path in directory.glob(f"{depth}/meta/info.json")]
    if not candidates:
        raise DatasetError("No meta/info.json found. Share a LeRobot v3 dataset folder as a zip.")
    if len(candidates) > 1:
        raise DatasetError("The archive holds more than one dataset; share one recording at a time.")
    return candidates[0]


def _inside(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise DatasetError(f"Dataset path {relative!r} leaves the dataset folder.")
    return path


def read_info(root: Path) -> dict[str, Any]:
    try:
        info = json.loads((root / INFO_PATH).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DatasetError("meta/info.json could not be read.") from error
    if not isinstance(info, dict):
        raise DatasetError("meta/info.json must be an object.")
    version = str(info.get("codebase_version", ""))
    if not version.startswith("v3"):
        raise DatasetError(
            f"This is a LeRobot {version or 'unknown-version'} dataset; only v3 is supported. Convert it with "
            "LeRobot's v2.1-to-v3.0 conversion script first."
        )
    fps = info.get("fps")
    if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not math.isfinite(fps) or fps <= 0:
        raise DatasetError("meta/info.json must give a positive fps.")
    features = info.get("features")
    if not isinstance(features, dict):
        raise DatasetError("meta/info.json must list the dataset features.")
    return info


def _names(feature: Any) -> list[str]:
    names = feature.get("names") if isinstance(feature, dict) else None
    if isinstance(names, dict):
        names = next((value for value in names.values() if isinstance(value, list)), None)
    if not isinstance(names, list):
        size = (feature.get("shape") or [0])[0] if isinstance(feature, dict) else 0
        return [f"{index}" for index in range(int(size) if isinstance(size, int) else 0)]
    return [str(name) for name in names]


def cameras(info: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for key, feature in info["features"].items():
        if not isinstance(feature, dict) or feature.get("dtype") != "video":
            continue
        if not FEATURE_KEY.match(key):
            raise DatasetError(f"Camera feature name {key!r} is not supported.")
        details = feature.get("info") if isinstance(feature.get("info"), dict) else {}
        shape = feature.get("shape") or [0, 0, 3]
        names = feature.get("names") or ["height", "width", "channels"]
        # Shape order follows names; LeRobot writes [height, width, channels].
        dims = dict(zip(names, shape, strict=False)) if isinstance(names, list) else {}
        result.append(
            {
                "key": key,
                "name": key.rsplit(".", 1)[-1],
                "width": int(details.get("video.width") or dims.get("width") or 0),
                "height": int(details.get("video.height") or dims.get("height") or 0),
                "codec": details.get("video.codec"),
                "fps": details.get("video.fps") or info["fps"],
            }
        )
    return result


def episodes(root: Path) -> list[dict[str, Any]]:
    import pyarrow.parquet as pq

    files = sorted((root / EPISODES_DIR).glob("chunk-*/file-*.parquet"))
    if not files:
        raise DatasetError("No meta/episodes parquet files found; this does not look like a LeRobot v3 dataset.")
    rows: list[dict[str, Any]] = []
    for file in files:
        table = pq.read_table(file)
        keep = [name for name in table.column_names if not name.startswith("stats/")]
        rows.extend(table.select(keep).to_pylist())
    rows.sort(key=lambda row: int(row.get("episode_index", 0)))
    return rows


def episode_row(root: Path, episode: int) -> dict[str, Any]:
    for row in episodes(root):
        if int(row.get("episode_index", -1)) == episode:
            return row
    raise DatasetError(f"Episode {episode} is not in this dataset.")


def summarize(root: Path) -> dict[str, Any]:
    info = read_info(root)
    rows = episodes(root)
    camera_list = cameras(info)
    fps = float(info["fps"])
    features = info["features"]
    unsupported = [key for key, feature in features.items() if isinstance(feature, dict) and feature.get("dtype") == "image"]
    listed = []
    for row in rows[:MAX_LISTED_EPISODES]:
        length = int(row.get("length") or 0)
        tasks = row.get("tasks") or []
        listed.append(
            {
                "index": int(row["episode_index"]),
                "length": length,
                "durationSeconds": round(length / fps, 3),
                "tasks": [str(task) for task in tasks] if isinstance(tasks, list) else [str(tasks)],
            }
        )
    if rows:
        first = rows[0]
        if not data_path(root, first).is_file():
            raise DatasetError(f"The data file for episode {first['episode_index']} is missing from the archive.")
        missing = [
            camera["key"]
            for camera in camera_list
            if not video_path(root, first, camera["key"]).is_file()
        ]
        if missing:
            raise DatasetError(f"Videos for {', '.join(missing)} are missing from the archive.")
    return {
        "codebaseVersion": info.get("codebase_version"),
        "robotType": info.get("robot_type"),
        "fps": fps,
        "totalEpisodes": len(rows),
        "totalFrames": int(info.get("total_frames") or sum(int(row.get("length") or 0) for row in rows)),
        "cameras": camera_list,
        "state": {"key": STATE_KEY, "names": _names(features[STATE_KEY])} if STATE_KEY in features else None,
        "action": {"key": ACTION_KEY, "names": _names(features[ACTION_KEY])} if ACTION_KEY in features else None,
        "episodes": listed,
        "episodesTruncated": len(rows) > MAX_LISTED_EPISODES,
        **({"unsupportedImageFeatures": unsupported} if unsupported else {}),
    }


def data_path(root: Path, row: dict[str, Any]) -> Path:
    try:
        chunk = int(row["data/chunk_index"])
        file = int(row["data/file_index"])
    except (KeyError, TypeError, ValueError) as error:
        raise DatasetError(f"Episode {row.get('episode_index')} does not say where its data is.") from error
    return _inside(root, DATA_PATH.format(chunk=chunk, file=file))


def video_path(root: Path, row: dict[str, Any], key: str) -> Path:
    if not FEATURE_KEY.match(key):
        raise DatasetError(f"Camera feature name {key!r} is not supported.")
    try:
        chunk = int(row[f"videos/{key}/chunk_index"])
        file = int(row[f"videos/{key}/file_index"])
    except (KeyError, TypeError, ValueError) as error:
        raise DatasetError(f"Episode {row.get('episode_index')} has no video for {key}.") from error
    return _inside(root, VIDEO_PATH.format(key=key, chunk=chunk, file=file))


def decode_frame(path: Path, seconds: float, fps: float) -> np.ndarray:
    """The RGB frame shown at ``seconds`` into the video file (nearest frame at or after it)."""
    import av

    container = av.open(str(path), mode="r")
    try:
        stream = container.streams.video[0]
        if stream.time_base is not None:
            container.seek(max(0, int(seconds / float(stream.time_base))), stream=stream, backward=True)
        last = None
        for frame in container.decode(stream):
            last = frame
            if frame.time is not None and frame.time >= seconds - 0.5 / fps:
                break
        if last is None:
            raise DatasetError(f"{path.name} has no decodable frames.")
        return last.to_ndarray(format="rgb24")
    finally:
        container.close()


def read_trajectory(root: Path, info: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    import pyarrow.parquet as pq

    episode = int(row["episode_index"])
    path = data_path(root, row)
    schema = pq.read_schema(path)
    columns = [name for name in ("frame_index", "timestamp", STATE_KEY, ACTION_KEY) if name in schema.names]
    table = pq.read_table(path, columns=[*columns, "episode_index"], filters=[("episode_index", "=", episode)])
    if table.num_rows == 0:
        raise DatasetError(f"Episode {episode} has no frames in its data file.")
    if table.num_rows > MAX_TRAJECTORY_FRAMES:
        table = table.slice(0, MAX_TRAJECTORY_FRAMES)
    if "frame_index" in columns:
        table = table.sort_by("frame_index")
    fps = float(info["fps"])
    timestamps = (
        [round(float(value), 6) for value in table.column("timestamp").to_pylist()]
        if "timestamp" in columns
        else [round(index / fps, 6) for index in range(table.num_rows)]
    )

    def matrix(key: str) -> list[list[float]] | None:
        if key not in columns:
            return None
        return [[round(float(value), 6) for value in item] for item in table.column(key).to_pylist()]

    state = matrix(STATE_KEY)
    action = matrix(ACTION_KEY)
    features = info["features"]
    result: dict[str, Any] = {
        "episode": episode,
        "fps": fps,
        "frames": table.num_rows,
        "timestamps": timestamps,
        "stateNames": _names(features.get(STATE_KEY)),
        "actionNames": _names(features.get(ACTION_KEY)),
        "state": state,
        "action": action,
    }
    if state:
        values = np.asarray(state, dtype=np.float64)
        result["stateRange"] = {"min": values.min(axis=0).round(6).tolist(), "max": values.max(axis=0).round(6).tolist()}
    return result


def extract_frames(root: Path, episode: int, seconds: float, output: Path, keys: list[str]) -> dict[str, Any]:
    from PIL import Image

    info = read_info(root)
    row = episode_row(root, episode)
    fps = float(info["fps"])
    available = {camera["key"]: camera for camera in cameras(info)}
    if not available:
        raise DatasetError("This dataset has no video cameras.")
    selected = keys or list(available)
    unknown = [key for key in selected if key not in available]
    if unknown:
        raise DatasetError(f"Unknown camera {', '.join(unknown)}; the dataset has {', '.join(available)}.")
    duration = int(row.get("length") or 0) / fps
    time = min(max(0.0, seconds), max(0.0, duration - 1.0 / fps))
    output.mkdir(parents=True, exist_ok=True)
    frames = []
    for index, key in enumerate(selected):
        start = float(row.get(f"videos/{key}/from_timestamp") or 0.0)
        pixels = decode_frame(video_path(root, row, key), start + time, fps)
        target = output / f"camera-{index}.png"
        Image.fromarray(pixels).save(target)
        frames.append(
            {"key": key, "name": available[key]["name"], "width": int(pixels.shape[1]), "height": int(pixels.shape[0]), "path": str(target)}
        )
    return {"episode": episode, "time": round(time, 6), "frameIndex": int(round(time * fps)), "cameras": frames}


def _gray(pixels: np.ndarray) -> np.ndarray:
    return pixels[..., :3].astype(np.float64) @ np.array([0.299, 0.587, 0.114])


def _edges(gray: np.ndarray) -> np.ndarray:
    """Strongest 8% of Sobel gradient magnitudes, ignoring flat images."""
    padded = np.pad(gray, 1, mode="edge")
    gx = (
        padded[:-2, 2:] + 2 * padded[1:-1, 2:] + padded[2:, 2:]
        - padded[:-2, :-2] - 2 * padded[1:-1, :-2] - padded[2:, :-2]
    )
    gy = (
        padded[2:, :-2] + 2 * padded[2:, 1:-1] + padded[2:, 2:]
        - padded[:-2, :-2] - 2 * padded[:-2, 1:-1] - padded[:-2, 2:]
    )
    magnitude = np.hypot(gx, gy)
    threshold = max(float(np.percentile(magnitude, 92)), 40.0)
    return magnitude > threshold


def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    result = mask.copy()
    height, width = mask.shape
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            shifted = np.zeros_like(mask)
            shifted[max(0, dy) : height + min(0, dy), max(0, dx) : width + min(0, dx)] = mask[
                max(0, -dy) : height + min(0, -dy), max(0, -dx) : width + min(0, -dx)
            ]
            result |= shifted
    return result


def compare_images(real_path: Path, sim_path: Path, output: Path) -> dict[str, Any]:
    """Edge alignment and brightness of a simulated render against a real frame, plus a review image.

    The review image is [real | simulated | overlay]: in the overlay, real edges are red, simulated
    edges cyan, and edges that line up white.
    """
    from PIL import Image

    real_image = Image.open(real_path).convert("RGB")
    sim_image = Image.open(sim_path).convert("RGB")
    if sim_image.size != real_image.size:
        sim_image = sim_image.resize(real_image.size, Image.Resampling.BILINEAR)
    real = np.asarray(real_image)
    sim = np.asarray(sim_image)
    real_gray = _gray(real)
    sim_gray = _gray(sim)
    real_edges = _edges(real_gray)
    sim_edges = _edges(sim_gray)
    radius = max(2, round(max(real.shape[:2]) / 200))
    precision = float((sim_edges & _dilate(real_edges, radius)).sum() / max(1, sim_edges.sum()))
    recall = float((real_edges & _dilate(sim_edges, radius)).sum() / max(1, real_edges.sum()))
    f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
    real_brightness = float(real_gray.mean())
    sim_brightness = float(sim_gray.mean())

    overlay = (0.5 * real_gray + 0.5 * sim_gray)[..., None].repeat(3, axis=2) * 0.45
    overlay[real_edges] = [255, 40, 40]
    overlay[sim_edges] = [40, 220, 255]
    overlay[real_edges & sim_edges] = [255, 255, 255]
    review = np.concatenate([real, sim, overlay.astype(np.uint8)], axis=1)
    image = Image.fromarray(review)
    if image.width > 1920:
        image = image.resize((1920, round(image.height * 1920 / image.width)), Image.Resampling.BILINEAR)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    return {
        "edgeF1": round(f1, 4),
        "edgePrecision": round(precision, 4),
        "edgeRecall": round(recall, 4),
        "meanAbsDifference": round(float(np.abs(real_gray - sim_gray).mean() / 255.0), 4),
        "brightnessRatio": round(sim_brightness / real_brightness, 4) if real_brightness > 0 else None,
        "width": int(real.shape[1]),
        "height": int(real.shape[0]),
        "edgeToleranceSpanPixels": radius,
        "reviewImage": str(output),
        "reviewWidth": image.width,
        "reviewHeight": image.height,
    }


def prepare(archive: Path, output: Path) -> dict[str, Any]:
    extracted = output / "dataset"
    try:
        extract_archive(archive, extracted)
        root = find_root(extracted)
        summary = summarize(root)
    except BaseException:
        shutil.rmtree(extracted, ignore_errors=True)
        raise
    return {"root": str(root), **summary}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_parser = commands.add_parser("prepare")
    prepare_parser.add_argument("archive", type=Path)
    prepare_parser.add_argument("output", type=Path)
    frames_parser = commands.add_parser("frames")
    frames_parser.add_argument("root", type=Path)
    frames_parser.add_argument("episode", type=int)
    frames_parser.add_argument("time", type=float)
    frames_parser.add_argument("output", type=Path)
    frames_parser.add_argument("--camera", action="append", default=[])
    trajectory_parser = commands.add_parser("trajectory")
    trajectory_parser.add_argument("root", type=Path)
    trajectory_parser.add_argument("episode", type=int)
    compare_parser = commands.add_parser("compare")
    compare_parser.add_argument("real", type=Path)
    compare_parser.add_argument("sim", type=Path)
    compare_parser.add_argument("output", type=Path)
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "prepare":
            result = prepare(arguments.archive, arguments.output)
        elif arguments.command == "frames":
            if not math.isfinite(arguments.time):
                raise DatasetError("time must be a finite number of seconds.")
            result = extract_frames(arguments.root, arguments.episode, arguments.time, arguments.output, arguments.camera)
        elif arguments.command == "trajectory":
            info = read_info(arguments.root)
            result = read_trajectory(arguments.root, info, episode_row(arguments.root, arguments.episode))
        else:
            result = compare_images(arguments.real, arguments.sim, arguments.output)
    except DatasetError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
