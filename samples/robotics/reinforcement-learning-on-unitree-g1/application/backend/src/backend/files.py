# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path
from typing import Callable

from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask


def managed_path(root: Path, path: Path) -> Path:
	absolute_root = root.absolute()
	try:
		relative_path = path.absolute().relative_to(absolute_root)
	except ValueError as error:
		raise HTTPException(status_code=409, detail="Resource path is outside its managed data directory.") from error
	candidate = absolute_root
	for part in relative_path.parts:
		candidate /= part
		if candidate.is_symlink():
			raise HTTPException(status_code=409, detail="Resource paths cannot include symbolic links.")
	resolved_root = root.resolve()
	if not path.resolve().is_relative_to(resolved_root):
		raise HTTPException(status_code=409, detail="Resource path is outside its managed data directory.")
	return path


def add_directory_to_archive(
	archive: zipfile.ZipFile,
	directory: Path,
	archive_prefix: str,
	managed_root: Path,
) -> None:
	resolved_directory = managed_path(managed_root, directory)
	if not resolved_directory.exists():
		return
	for path in sorted(resolved_directory.rglob("*")):
		if path.is_symlink():
			raise HTTPException(status_code=409, detail="Archive contents cannot include symbolic links.")
		if path.is_file():
			managed_path(managed_root, path)
			archive.write(
				path,
				(Path(archive_prefix) / path.relative_to(resolved_directory)).as_posix(),
			)


def create_zip_response(
	archive_name: str,
	write_contents: Callable[[zipfile.ZipFile], None],
) -> FileResponse:
	with tempfile.NamedTemporaryFile(prefix="humanoid-rl-", suffix=".zip", delete=False) as temporary:
		archive_path = Path(temporary.name)
	try:
		with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
			write_contents(archive)
	except Exception:
		archive_path.unlink(missing_ok=True)
		raise
	return FileResponse(
		archive_path,
		media_type="application/zip",
		filename=archive_name,
		background=BackgroundTask(archive_path.unlink, missing_ok=True),
	)