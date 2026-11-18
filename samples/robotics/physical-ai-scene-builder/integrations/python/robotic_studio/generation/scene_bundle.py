# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import hashlib
import json
import posixpath
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from types import TracebackType
from typing import Any, Self
from zipfile import BadZipFile, ZipFile

from ..xml_utils import ElementTree, parse_xml

ARCHIVE_VERSION = 1
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
# Matches MAX_SPLAT_BYTES (packages/types/src/splat.ts): the splat is the largest entry.
MAX_ENTRY_BYTES = 500 * 1024 * 1024
MAX_ENTRY_COUNT = 1_000
SUPPORTED_FILE_EXTENSIONS = {"glb", "obj", "stl", "png", "jpg", "jpeg", "ply", "spz"}


class SceneBundleError(ValueError):
    pass


def _archive_error(message: str) -> SceneBundleError:
    return SceneBundleError(f"Scene bundle is invalid: {message}")


def _normalize_path(value: str, *, asset: bool = True) -> str:
    if not value or value.startswith("/") or ":" in value.split("/")[0]:
        raise _archive_error(f"asset path '{value}' must be relative")
    normalized = posixpath.normpath(value.replace("\\", "/"))
    if normalized in {"", "."} or normalized.startswith("../") or normalized == "..":
        raise _archive_error(f"asset path '{value}' escapes the bundle")
    if asset:
        if normalized in {"manifest.json", "scene.xml"}:
            raise _archive_error(f"asset path '{value}' is reserved")
        extension = normalized.rsplit(".", 1)[-1].lower() if "." in normalized else ""
        if extension not in SUPPORTED_FILE_EXTENSIONS:
            raise _archive_error(f"asset path '{value}' uses an unsupported file type")
    return normalized


def _validate_scene_xml(xml_bytes: bytes, asset_paths: set[str]) -> None:
    if not xml_bytes.strip():
        raise _archive_error("scene.xml is empty")
    try:
        root = parse_xml(xml_bytes)
    except ElementTree.ParseError as error:
        raise _archive_error("scene.xml is not valid XML") from error
    if root.tag.rsplit("}", 1)[-1] != "mujoco":
        raise _archive_error("scene.xml root must be mujoco")
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] == "include":
            raise _archive_error("MJCF include elements are not supported in bundles")
        file_value = element.attrib.get("file")
        if file_value is None:
            continue
        path = _normalize_path(file_value)
        if path not in asset_paths:
            raise _archive_error(f"scene.xml references missing asset '{path}'")
        if element.attrib.get("file", "").startswith(("http:", "https:", "file:")):
            raise _archive_error("external MJCF asset URLs are not supported")


@dataclass
class SceneBundle:
    root: Path
    scene_path: Path
    scene_name: str
    manifest: Mapping[str, Any]
    _temporary: TemporaryDirectory[str] | None = None

    @property
    def backdrop_path(self) -> str | None:
        return next(
            (
                _normalize_path(str(entry["path"]))
                for entry in self.manifest.get("files", [])
                if isinstance(entry, Mapping) and entry.get("kind") == "splat"
            ),
            None,
        )

    def close(self) -> None:
        if self._temporary is not None:
            self._temporary.cleanup()
            self._temporary = None

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        _exception_type: type[BaseException] | None,
        _exception: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        self.close()


class SceneBundleLoader:
    def load(self, archive_path: str | Path, destination: str | Path | None = None) -> SceneBundle:
        archive = Path(archive_path)
        if not archive.is_file():
            raise _archive_error(f"archive '{archive}' does not exist")
        if archive.stat().st_size > MAX_ARCHIVE_BYTES:
            raise _archive_error("compressed bundle exceeds the size limit")

        temporary: TemporaryDirectory[str] | None = None
        if destination is None:
            temporary = tempfile.TemporaryDirectory(prefix="robotic-studio-scene-")
            root = Path(temporary.name)
        else:
            root = Path(destination).resolve()
            root.mkdir(parents=True, exist_ok=True)

        try:
            with ZipFile(archive) as zipped:
                entries = [info for info in zipped.infolist() if not info.is_dir()]
                if len(entries) > MAX_ENTRY_COUNT + 2:
                    raise _archive_error("too many archive entries")
                entry_names = {info.filename for info in entries}
                if "manifest.json" not in entry_names or "scene.xml" not in entry_names:
                    raise _archive_error("manifest.json and scene.xml are required")
                expanded_size = sum(info.file_size for info in entries)
                if expanded_size > MAX_ARCHIVE_BYTES:
                    raise _archive_error("expanded bundle exceeds the size limit")
                try:
                    manifest = json.loads(zipped.read("manifest.json"))
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    raise _archive_error("manifest.json is not valid JSON") from error
                if not isinstance(manifest, dict):
                    raise _archive_error("manifest.json must contain an object")
                if manifest.get("version") != ARCHIVE_VERSION or manifest.get("entrypoint") != "scene.xml":
                    raise _archive_error("the bundle version or entrypoint is unsupported")
                scene_name = manifest.get("sceneName")
                files = manifest.get("files")
                if not isinstance(scene_name, str) or not isinstance(files, list):
                    raise _archive_error("manifest.json is missing required fields")
                if len(files) > MAX_ENTRY_COUNT:
                    raise _archive_error("too many asset entries")

                asset_paths: set[str] = set()
                backdrop_path: str | None = None
                for file_entry in files:
                    if not isinstance(file_entry, dict):
                        raise _archive_error("manifest.json contains an invalid asset entry")
                    path_value = file_entry.get("path")
                    if not isinstance(path_value, str):
                        raise _archive_error("manifest.json contains an invalid asset path")
                    path = _normalize_path(path_value)
                    kind = file_entry.get("kind")
                    if kind is not None and kind not in {"mesh", "texture", "splat"}:
                        raise _archive_error(f"asset '{path}' has an unsupported manifest kind")
                    if path.rsplit(".", 1)[-1].lower() in {"ply", "spz"} and kind != "splat":
                        raise _archive_error(f"PLY/SPZ asset '{path}' must be declared as a splat")
                    if kind == "splat":
                        if not path.startswith("splats/") or not path.lower().endswith((".ply", ".spz")):
                            raise _archive_error(f"splat asset '{path}' must be a splats/*.ply or splats/*.spz path")
                        if backdrop_path is not None:
                            raise _archive_error("only one splat backdrop is supported")
                        backdrop_path = path
                    if path in asset_paths:
                        raise _archive_error(f"asset path '{path}' is duplicated")
                    asset_paths.add(path)
                    if path not in entry_names:
                        raise _archive_error(f"manifest is missing archive entry '{path}'")
                    if zipped.getinfo(path).file_size > MAX_ENTRY_BYTES:
                        raise _archive_error(f"asset '{path}' exceeds the size limit")
                    bytes_value = zipped.read(path)
                    if not bytes_value or len(bytes_value) > MAX_ENTRY_BYTES:
                        raise _archive_error(f"asset '{path}' has an invalid size")
                    if file_entry.get("size") != len(bytes_value):
                        raise _archive_error(f"asset '{path}' has an incorrect size")
                    checksum = file_entry.get("sha256")
                    if not isinstance(checksum, str) or hashlib.sha256(bytes_value).hexdigest() != checksum.lower():
                        raise _archive_error(f"asset '{path}' failed checksum validation")

                expected_entries = {"manifest.json", "scene.xml", *asset_paths}
                extras = entry_names - expected_entries
                if extras:
                    raise _archive_error(f"archive contains an unlisted entry '{min(extras)}'")
                scene_bytes = zipped.read("scene.xml")
                if len(scene_bytes) > MAX_ENTRY_BYTES:
                    raise _archive_error("scene.xml exceeds the entry size limit")
                _validate_scene_xml(scene_bytes, asset_paths)

                scene_path = root / "scene.xml"
                scene_path.write_bytes(scene_bytes)
                for path in sorted(asset_paths):
                    destination_path = root / Path(*path.split("/"))
                    destination_path.parent.mkdir(parents=True, exist_ok=True)
                    destination_path.write_bytes(zipped.read(path))
        except BadZipFile as error:
            if temporary is not None:
                temporary.cleanup()
            raise _archive_error("the ZIP payload could not be read") from error
        except Exception:
            if temporary is not None:
                temporary.cleanup()
            raise

        return SceneBundle(
            root,
            scene_path,
            scene_name.strip() or "Untitled scene",
            manifest,
            temporary,
        )
