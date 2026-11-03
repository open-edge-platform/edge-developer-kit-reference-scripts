# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Repository path discovery by walking up to a sentinel, never by counting `..` (breaks when a worker moves).

Module-level imports stay stdlib-only: list_models.py scripts load this file by path, outside the worker venv.
"""

from __future__ import annotations

import errno
import functools
import os
import shutil
from pathlib import Path

# Present only at workers/, so it identifies that directory unambiguously.
_WORKERS_SENTINEL = Path("scripts") / "worker-common.sh"


@functools.lru_cache(maxsize=None)
def workers_root(start: str | Path | None = None) -> Path:
    """The `workers/` directory containing the caller.

    Raises RuntimeError if the sentinel is missing, so a misplaced file fails rather than misplace models.
    """
    here = Path(start) if start is not None else Path(__file__).resolve()
    if here.is_file():
        here = here.parent
    for candidate in (here, *here.parents):
        if (candidate / _WORKERS_SENTINEL).is_file():
            return candidate
    raise RuntimeError(
        f"Could not locate the workers/ root above {here}: "
        f"no {_WORKERS_SENTINEL.as_posix()} found."
    )


@functools.lru_cache(maxsize=None)
def project_root(start: str | Path | None = None) -> Path:
    """The repository root, one level above `workers/`."""
    return workers_root(start).parent


def models_dir(*parts: str) -> Path:
    """`<repo>/models`, optionally joined with `parts`."""
    return project_root().joinpath("models", *parts)


def hf_home() -> Path:
    """The Hugging Face cache workers share: ``HF_HOME`` when set, else ``<repo>/models/huggingface``."""
    return Path(os.environ.get("HF_HOME") or models_dir("huggingface"))


def hf_hub_cache() -> Path:
    """Where huggingface_hub keeps repositories: ``HF_HUB_CACHE``, else ``hub`` under :func:`hf_home`."""
    return Path(os.environ.get("HF_HUB_CACHE") or hf_home() / "hub")


def hf_repo_dir(repo_id: str, repo_type: str = "model") -> Path:
    """One repository's folder in the hub cache (``models--<org>--<name>``), whether or not it exists.

    It holds the blobs and every snapshot, so removing it removes the whole download.
    """
    return hf_hub_cache() / f"{repo_type}s--{repo_id.replace('/', '--')}"


def existing_paths(*candidates: str | Path) -> list[str]:
    """The ``candidates`` on disk, each once, in order.

    A dangling symlink counts: it is on disk too, and removing the preset removes it.
    """
    seen: list[str] = []
    for candidate in candidates:
        path = Path(candidate)
        if (path.exists() or path.is_symlink()) and str(path) not in seen:
            seen.append(str(path))
    return seen


def use_shared_hf_cache(legacy: Path | None = None) -> str | None:
    """Point this process at the shared Hugging Face cache, for a worker started without the launchers.

    Call it before huggingface_hub is imported, as the hub reads ``HF_HOME`` once at import. Repositories
    in ``legacy`` (the worker's own old ``HF_HOME``) move into the shared cache; returns a message to log.
    """
    if not os.environ.get("HF_HOME"):
        # The token `hf auth login` saved sits in the HF_HOME the hub would
        # have used; keep reading it there.
        os.environ.setdefault("HF_TOKEN_PATH", str(_user_hf_home() / "token"))
        os.environ["HF_HOME"] = str(models_dir("huggingface"))
    if legacy is None:
        return None
    return _merge_hf_cache(Path(legacy), hf_home())


def _user_hf_home() -> Path:
    """huggingface_hub's own default ``HF_HOME``."""
    cache = os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache"
    return Path(cache) / "huggingface"


# A Hugging Face cache's repository folders (models--org--name, ...).
_HUB_REPO_PREFIXES = ("models--", "datasets--", "spaces--")


def _merge_hf_cache(legacy: Path, home: Path) -> str | None:
    """Move the repositories of the cache at ``legacy`` into ``home``, under ``hub/`` or at the top as found.

    A repository both hold is merged file by file, keeping the shared copy; relative snapshot symlinks stay
    valid. Renames only: a cache on another file system is left in place, since copying could outlast the
    startup timeout.
    """
    from worker_common.instance import shared_model_lock

    if not legacy.is_dir() or legacy.resolve() == home.resolve():
        return None
    layouts = ((legacy / "hub", home / "hub"), (legacy, home))
    if not any(_repos(source) for source, _ in layouts):
        return None

    home.mkdir(parents=True, exist_ok=True)
    moved = 0
    # Two instances starting together must not both move the same repository.
    with shared_model_lock(home / "hub"):
        try:
            for source, target in layouts:
                for repo in _repos(source):
                    destination = target / repo.name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        os.rename(repo, destination)
                    except OSError as error:
                        if _cross_device(error) or not destination.is_dir():
                            raise
                        _merge_tree(repo, destination)
                    moved += 1
        except OSError as error:
            if not _cross_device(error):
                raise
            return (
                f"Left the Hugging Face cache {legacy} in place: it is on another file "
                f"system than {home}. Delete it to free the space."
            )
        # What is left is duplicates of files the shared cache holds, and
        # locks; xet/ is the hub client's chunk cache and logs.
        for leftover in (legacy / "hub", legacy / "xet", *_repos(legacy)):
            shutil.rmtree(leftover, ignore_errors=True)
        try:
            legacy.rmdir()
        except OSError:
            pass  # holds more than a cache
    if moved == 0:
        return None
    return f"Moved {moved} Hugging Face repositories from {legacy} into the shared cache {home}"


def _repos(folder: Path) -> list[Path]:
    """The repository folders directly in ``folder``."""
    if not folder.is_dir():
        return []
    return sorted(
        path for path in folder.iterdir() if path.is_dir() and path.name.startswith(_HUB_REPO_PREFIXES)
    )


def _merge_tree(source: Path, target: Path) -> None:
    """Moves every file and symlink under ``source`` that ``target`` lacks."""
    for directory, _, files in os.walk(source):
        for name in files:
            path = Path(directory, name)
            destination = target / path.relative_to(source)
            if os.path.lexists(destination):
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.rename(path, destination)


def _cross_device(error: OSError) -> bool:
    # ERROR_NOT_SAME_DEVICE on Windows.
    return error.errno == errno.EXDEV or getattr(error, "winerror", None) == 17


def thirdparty_dir(*parts: str) -> Path:
    """`<repo>/thirdparty` — ffmpeg, git and other project-level tools."""
    return project_root().joinpath("thirdparty", *parts)


def workers_thirdparty_dir(*parts: str) -> Path:
    """`workers/thirdparty` — uv and OVMS."""
    return workers_root().joinpath("thirdparty", *parts)


def migrate_legacy_models_dir(legacy: Path, target: Path) -> str | None:
    """Move a worker's in-tree `<worker dir>/models/<name>` to the shared `target`; call before any download.

    Moves only when `target` is absent; when both exist `legacy` is ignored, never merged or deleted.
    Returns a one-line message to log, or None when there is nothing to report.
    """
    from worker_common.instance import shared_model_lock

    if target.exists() or not legacy.exists():
        return _migration_report(legacy, target)
    # Two instances starting together must not both move the same folder.
    with shared_model_lock(target):
        if target.exists() or not legacy.exists():
            return _migration_report(legacy, target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(legacy), str(target))
    return f"Migrated legacy models directory {legacy} -> {target}"


def _migration_report(legacy: Path, target: Path) -> str | None:
    """What :func:`migrate_legacy_models_dir` says when there is nothing to move."""
    if target.exists() and legacy.exists():
        return f"{target} already exists; ignoring legacy models directory {legacy}."
    return None
