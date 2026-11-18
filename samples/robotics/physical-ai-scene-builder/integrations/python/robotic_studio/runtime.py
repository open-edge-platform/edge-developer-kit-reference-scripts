# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Shared configuration loading for headless native runtime entry points."""

from __future__ import annotations

import json
import tempfile
import zipfile
from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .generation.native_scene import NativeScene
from .generation.scene_bundle import SceneBundleError, SceneBundleLoader

if TYPE_CHECKING:
    from .generation.native_env import NativeEnvironment


def _archive_directory(directory: Path, archive_path: Path) -> None:
    """Pack an extracted bundle directory so it goes through the archive validation path.

    Only ``manifest.json``, ``scene.xml``, and the files listed in the manifest are packed; the
    loader then validates the entrypoint, checksums, sizes, and MJCF asset references exactly as it
    does for a downloaded ``.mujoco-scene`` archive.
    """
    root = directory.resolve()
    manifest_path = root / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SceneBundleError(f"Scene bundle is invalid: '{directory}' has no manifest.json") from error
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SceneBundleError("Scene bundle is invalid: manifest.json is not valid JSON") from error
    if not isinstance(manifest, dict):
        raise SceneBundleError("Scene bundle is invalid: manifest.json must contain an object")
    names = ["manifest.json", "scene.xml"]
    files = manifest.get("files")
    if isinstance(files, list):
        for entry in files:
            path = entry.get("path") if isinstance(entry, dict) else None
            if isinstance(path, str) and path not in names:
                names.append(path)
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
        for name in names:
            source = (root / name).resolve()
            # Paths that escape the directory or do not exist are left out; the loader then reports
            # them as invalid or missing with its usual message.
            if source.is_relative_to(root) and source.is_file():
                archive.write(source, name)


def load_scene(scene_bundle_path: str | Path) -> NativeScene:
    """Load and compile a native MuJoCo scene bundle (``.mujoco-scene`` archive or its directory).

    The returned scene owns the loaded bundle indirectly; callers should close
    ``scene.bundle`` after closing the environment built from it.
    """
    path = Path(scene_bundle_path)
    if path.is_dir():
        with tempfile.TemporaryDirectory(prefix="robotic-studio-scene-dir-") as temporary:
            archive = Path(temporary) / "scene.mujoco-scene"
            _archive_directory(path, archive)
            bundle = SceneBundleLoader().load(archive)
    else:
        bundle = SceneBundleLoader().load(path)
    try:
        return NativeScene.compile(bundle)
    except Exception:
        bundle.close()
        raise


def load_profile(path: str | Path) -> dict[str, Any]:
    """Load a profile JSON object from disk with a useful validation error."""
    profile_path = Path(path)
    try:
        value = json.loads(profile_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read JSON configuration '{profile_path}'.") from error
    if not isinstance(value, dict):
        raise ValueError(f"JSON configuration '{profile_path}' must contain an object.")
    return value


def evaluation_environment(scene: NativeScene, profile: Mapping[str, Any]) -> NativeEnvironment:
    """Build the native environment exactly as the Evaluate worker does for ``profile``."""
    from .generation.native_env import NativeEnvironment

    cameras = profile.get("cameras", [])
    if not isinstance(cameras, list):
        raise ValueError("profile.cameras must be an array.")
    action_fields = profile.get("action")
    if not isinstance(action_fields, list):
        raise ValueError("profile.action must be an array.")
    # Only the backdrop is forwarded from the profile: Evaluate composites the same splat
    # backdrop as Generate (the asset is checked against the bundle and the XPU renderer is
    # initialized eagerly), while every other setting stays explicit.
    backdrop = profile.get("backdrop")
    return NativeEnvironment(
        scene,
        task={"randomization": profile.get("randomization", [])},
        profile=None if backdrop is None else {"backdrop": backdrop},
        action_fields=action_fields,
        physics_steps=profile.get("physicsSteps", 1),
        cameras=cameras,
        render_rgb=bool(cameras),
    )
