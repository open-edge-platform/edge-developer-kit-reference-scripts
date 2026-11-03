# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import hashlib
import json
import os
import re
import shutil
import threading
import time
import zipfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, BinaryIO, Callable, Dict, Iterator, Optional

import httpx
from fastapi import HTTPException, status
from fastapi.responses import JSONResponse, StreamingResponse
from worker_common.sse import SSE_HEADERS, sse_event

from modules.utils import path_name_problem


def model_name_parser(model_id: str):
    if (
        model_id.startswith("openvino:")
        or model_id.startswith("llamacpp:")
        or model_id.startswith("openai:")
    ):
        parts = model_id.split(":", 1)
        if len(parts) == 2:
            return parts[0], parts[1]
    else:
        return None, model_id


def remove_path(path: Path) -> None:
    """Removes a file or a directory tree, whichever ``path`` is."""
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    elif path.exists() or path.is_symlink():
        path.unlink()


def check_model_exists(
    model_path: Path,
    force_override: bool,
    cleanup_callback: Optional[Callable[[Path], None]] = None,
):
    if model_path.exists():
        if not force_override:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Model at '{model_path}' already exists. Use 'force_override=True' to overwrite.",
            )
        if cleanup_callback:
            cleanup_callback(model_path)


def safe_relative_path(name: Optional[str]) -> str:
    """``name`` as a relative POSIX path inside a model directory.

    A client name that is absolute, names a drive, climbs out with ``..`` or has a part Windows
    can't hold is refused before anything is staged.
    """
    normalized = (name or "").replace("\\", "/")
    parts = [part for part in normalized.split("/") if part not in ("", ".")]
    if (
        not parts
        or normalized.startswith("/")
        or ".." in parts
        or re.match(r"^[A-Za-z]:", parts[0])
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file path '{name}'.",
        )
    for part in parts:
        problem = path_name_problem(part)
        if problem:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid file path '{name}': '{part}' {problem}.",
            )
    return "/".join(parts)


def extract_and_validate_zip(file_obj, target_dir: Path):
    """Extracts the model folder of an uploaded zip into ``target_dir``.

    Everything beside the shallowest ``*model.xml`` moves in, replacing same-name entries; nothing is
    created unless the archive is a valid model.
    """
    temp_extract_dir = target_dir.parent / (
        target_dir.name + "_temp_extract_" + os.urandom(4).hex()
    )

    if temp_extract_dir.exists():
        shutil.rmtree(temp_extract_dir)
    temp_extract_dir.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(file_obj, "r") as zip_ref:
            zip_ref.extractall(temp_extract_dir)

        model_xml_paths = list(temp_extract_dir.rglob("*model.xml"))

        if not model_xml_paths:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The uploaded zip file does not contain a 'model.xml' file.",
            )

        model_xml_paths.sort(key=lambda p: len(p.parts))
        source_dir = model_xml_paths[0].parent

        target_dir.mkdir(parents=True, exist_ok=True)
        for item in source_dir.iterdir():
            dest_path = target_dir / item.name
            if dest_path.exists():
                remove_path(dest_path)
            shutil.move(str(item), str(dest_path))

    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid zip file.",
        )
    finally:
        if temp_extract_dir.exists():
            shutil.rmtree(temp_extract_dir)


# Chunked model upload: one `POST .../model/upload/chunk` per chunk (fields: the routes' Form docs).
# Chunks may arrive out of order or twice; in-order ones are appended, early ones wait beside the file.
# Staging is `<models dir>/../.uploads/<backend>/`, outside the listings; abandoned uploads go after a
# day or on DELETE. A file that can't be assembled, extracted or committed discards the whole upload.

UPLOADS_DIR_NAME = ".uploads"
MAX_TOTAL_CHUNKS = 1_000_000
STALE_UPLOAD_SECONDS = 24 * 60 * 60
_COPY_BUFFER_BYTES = 8 * 1024 * 1024
_UPLOAD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_upload_locks_guard = threading.Lock()
_upload_locks: Dict[str, threading.Lock] = {}


@contextmanager
def _upload_lock(upload_dir: Path) -> Iterator[None]:
    key = str(upload_dir)
    with _upload_locks_guard:
        lock = _upload_locks.setdefault(key, threading.Lock())
    with lock:
        yield


def _digest(*parts: str) -> str:
    return hashlib.sha256("\0".join(parts).encode("utf-8")).hexdigest()[:32]


def _validate_upload_id(upload_id: Optional[str]) -> Optional[str]:
    if upload_id in (None, ""):
        return None
    if not _UPLOAD_ID_RE.match(upload_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="upload_id must be 1-64 characters of letters, digits, '-' or '_'.",
        )
    return upload_id


def upload_staging_dir(
    models_dir: Path,
    task: str,
    repo_id: str,
    upload_id: Optional[str],
    relative_path: str,
) -> Path:
    """Where one upload is staged; without an `upload_id` each file is its own upload, keyed by path."""
    models_dir = Path(models_dir).resolve()
    upload_key = (
        f"id:{upload_id}" if upload_id else f"file:{os.path.basename(relative_path)}"
    )
    return (
        models_dir.parent
        / UPLOADS_DIR_NAME
        / models_dir.name
        / _digest(task, repo_id, upload_key)
    )


def _prune_stale_uploads(root: Path, keep: Path) -> None:
    if not root.is_dir():
        return
    cutoff = time.time() - STALE_UPLOAD_SECONDS
    for child in root.iterdir():
        try:
            if child != keep and child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue


def _write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle)
    os.replace(tmp, path)


def _read_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _copy_stream(source: BinaryIO, dest: BinaryIO) -> int:
    written = 0
    while True:
        block = source.read(_COPY_BUFFER_BYTES)
        if not block:
            return written
        dest.write(block)
        written += len(block)


def _load_file_state(
    file_dir: Path, relative_path: str, total_chunks: int, total_size: Optional[int]
) -> Dict[str, Any]:
    state_path = file_dir / "state.json"
    state = _read_json(state_path) if file_dir.is_dir() else None
    if state is not None and (
        state.get("relative_path") != relative_path
        or state.get("total_chunks") != total_chunks
        or (
            total_size is not None
            and state.get("total_size") not in (None, total_size)
        )
    ):
        # Left over from a different file under the same key: don't mix its chunks into this one.
        shutil.rmtree(file_dir, ignore_errors=True)
        state = None

    if state is None:
        file_dir.mkdir(parents=True, exist_ok=True)
        state = {
            "relative_path": relative_path,
            "total_chunks": total_chunks,
            "total_size": total_size,
            "next_index": 0,
            "bytes": 0,
        }
        _write_json_atomic(state_path, state)

    # The data file must hold exactly the recorded prefix; a crash-truncated chunk is received again.
    data_path = file_dir / "data.partial"
    size = data_path.stat().st_size if data_path.exists() else 0
    if size != state["bytes"]:
        if size > state["bytes"]:
            with data_path.open("r+b") as handle:
                handle.truncate(state["bytes"])
        else:
            data_path.unlink(missing_ok=True)
            state["next_index"] = 0
            state["bytes"] = 0
            _write_json_atomic(state_path, state)
    return state


def _append_to_file(file_dir: Path, state: Dict[str, Any], source: BinaryIO) -> None:
    data_path = file_dir / "data.partial"
    start = state["bytes"]
    with data_path.open("ab") as dest:
        try:
            written = _copy_stream(source, dest)
            dest.flush()
        except BaseException:
            dest.truncate(start)
            raise
    state["bytes"] = start + written
    state["next_index"] += 1
    _write_json_atomic(file_dir / "state.json", state)


def _store_chunk(
    file_dir: Path, state: Dict[str, Any], chunk_index: int, source: BinaryIO
) -> None:
    if chunk_index < state["next_index"]:
        return  # Already appended: a retry of a chunk that did arrive.

    if chunk_index > state["next_index"]:
        part = file_dir / f"part_{chunk_index:07d}"
        tmp = part.with_name(part.name + ".tmp")
        with tmp.open("wb") as dest:
            _copy_stream(source, dest)
        os.replace(tmp, part)
        return

    _append_to_file(file_dir, state, source)
    while True:
        part = file_dir / f"part_{state['next_index']:07d}"
        if not part.exists():
            return
        with part.open("rb") as src:
            _append_to_file(file_dir, state, src)
        part.unlink()


def _finish_file(
    upload_dir: Path,
    file_dir: Path,
    state: Dict[str, Any],
    relative_path: str,
    extract_zip: bool,
) -> None:
    total_size = state.get("total_size")
    if total_size is not None and state["bytes"] != total_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{relative_path}' assembled to {state['bytes']} bytes, "
                f"expected {total_size}."
            ),
        )

    data_path = file_dir / "data.partial"
    data_path.touch(exist_ok=True)
    tree = upload_dir / "tree"
    if extract_zip and relative_path.lower().endswith(".zip"):
        extract_and_validate_zip(data_path, tree)
    else:
        dest = tree / relative_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(data_path, dest)
    shutil.rmtree(file_dir, ignore_errors=True)


def _commit_upload(
    tree: Path, target_dir: Path, force_override: bool, replace_target_dir: bool
) -> None:
    tree.mkdir(parents=True, exist_ok=True)
    if replace_target_dir:
        check_model_exists(target_dir, force_override, cleanup_callback=remove_path)
        target_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(tree), str(target_dir))
        return

    files = sorted(p for p in tree.rglob("*") if p.is_file())
    for src in files:
        check_model_exists(target_dir / src.relative_to(tree), force_override)
    for src in files:
        dest = target_dir / src.relative_to(tree)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            remove_path(dest)
        shutil.move(str(src), str(dest))


def check_upload_conflict(
    target_dir: Path,
    relative_path: str,
    force_override: bool,
    replace_target_dir: bool,
) -> None:
    """409 before any bytes are staged when the upload could never commit."""
    target = target_dir if replace_target_dir else target_dir / relative_path
    check_model_exists(target, force_override)


def receive_upload_chunk(
    *,
    source: BinaryIO,
    models_dir: Path,
    task: str,
    repo_id: str,
    target_dir: Path,
    relative_path: str,
    chunk_index: int,
    total_chunks: int,
    total_size: Optional[int] = None,
    upload_id: Optional[str] = None,
    force_override: bool = False,
    commit: bool = True,
    replace_target_dir: bool = True,
    extract_zip: bool = False,
) -> Dict[str, Any]:
    """Stages one chunk; once its file is complete, assembles it and (with ``commit``) moves the upload
    into ``target_dir``.

    ``replace_target_dir`` makes the model directory the unit (replaced only with ``force_override``);
    otherwise each file is. Blocking: call it from a sync handler.
    """
    relative_path = safe_relative_path(relative_path)
    upload_id = _validate_upload_id(upload_id)
    if not 1 <= total_chunks <= MAX_TOTAL_CHUNKS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"total_chunks must be between 1 and {MAX_TOTAL_CHUNKS}.",
        )
    if not 0 <= chunk_index < total_chunks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"chunk_index must be between 0 and {total_chunks - 1}.",
        )
    if total_size is not None and total_size < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="total_size must not be negative.",
        )

    upload_dir = upload_staging_dir(
        models_dir, task, repo_id, upload_id, relative_path
    )
    file_key = _digest(relative_path)
    result = {
        "chunk_index": chunk_index,
        "relative_path": relative_path,
        "upload_id": upload_id,
    }

    with _upload_lock(upload_dir):
        # With an id, a retry after its file (or the whole upload) went through answers as the first did.
        done_marker = upload_dir / "done" / file_key
        if upload_id and (upload_dir / "committed").exists():
            return {**result, "file_completed": True, "completed": True,
                    "received_chunks": total_chunks, "internal_path": str(target_dir)}
        if upload_id and done_marker.exists() and not commit:
            return {**result, "file_completed": True, "completed": False,
                    "received_chunks": total_chunks, "internal_path": ""}

        check_upload_conflict(target_dir, relative_path, force_override, replace_target_dir)

        if not upload_dir.exists():
            _prune_stale_uploads(upload_dir.parent, keep=upload_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)
        os.utime(upload_dir)

        file_completed = done_marker.exists()
        received = total_chunks
        if not file_completed:
            file_dir = upload_dir / "files" / file_key
            state = _load_file_state(file_dir, relative_path, total_chunks, total_size)
            _store_chunk(file_dir, state, chunk_index, source)
            received = state["next_index"]
            file_completed = received == total_chunks

        committed = False
        if file_completed:
            try:
                if not done_marker.exists():
                    _finish_file(upload_dir, file_dir, state, relative_path, extract_zip)
                    done_marker.parent.mkdir(parents=True, exist_ok=True)
                    done_marker.touch()
                if commit:
                    _commit_upload(
                        upload_dir / "tree", target_dir, force_override, replace_target_dir
                    )
                    committed = True
            except BaseException:
                shutil.rmtree(upload_dir, ignore_errors=True)
                raise

        if committed:
            shutil.rmtree(upload_dir, ignore_errors=True)
            if upload_id:
                upload_dir.mkdir(parents=True, exist_ok=True)
                (upload_dir / "committed").touch()

    return {
        **result,
        "file_completed": file_completed,
        "completed": committed,
        "received_chunks": received,
        "internal_path": str(target_dir) if committed else "",
    }


def discard_chunk_upload(
    models_dir: Path,
    task: str,
    repo_id: str,
    filename: str,
    upload_id: Optional[str] = None,
) -> bool:
    """Drops a staged upload (cancel). ``True`` if there was one."""
    upload_id = _validate_upload_id(upload_id)
    upload_dir = upload_staging_dir(
        models_dir, task, repo_id, upload_id, safe_relative_path(filename)
    )
    with _upload_lock(upload_dir):
        if not upload_dir.exists():
            return False
        shutil.rmtree(upload_dir, ignore_errors=True)
        return True


def chunk_upload_message(result: Dict[str, Any]) -> str:
    if result["completed"]:
        return "Upload complete and model assembled"
    if result["file_completed"]:
        return "File uploaded"
    return "Chunk uploaded"


# OpenAI-style proxying

#: Generation can take many minutes and the app bounds its own calls, so only connecting is limited.
UPSTREAM_TIMEOUT = httpx.Timeout(None, connect=10.0)


def openai_error_body(
    message: str, status_code: int, error_type: str = "upstream_error"
) -> Dict[str, Any]:
    """An error in the shape OpenAI clients parse: ``{"error": {...}}``."""
    return {"error": {"message": message, "type": error_type, "code": status_code}}


def openai_error_response(
    status_code: int, message: str, error_type: str = "upstream_error"
) -> JSONResponse:
    return JSONResponse(
        openai_error_body(message, status_code, error_type), status_code=status_code
    )


def upstream_error_message(raw: bytes, fallback: str) -> str:
    """The message inside a model server's error body, whichever shape it uses
    (llama.cpp and OpenAI: ``{"error": {"message"}}``, OVMS: ``{"error": "..."}``,
    FastAPI: ``{"detail"}``), else the body text."""
    text = raw.decode("utf-8", errors="replace").strip()
    try:
        data = json.loads(text)
    except ValueError:
        return text or fallback
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"]
        for value in (error, data.get("detail"), data.get("message")):
            if isinstance(value, str) and value:
                return value
    return text or fallback


async def proxy_openai_stream(
    client: httpx.AsyncClient,
    url: str,
    body: Dict[str, Any],
    headers: Dict[str, str],
    backend_label: str,
):
    """Relays a streamed OpenAI-style call.

    A refused connection or error status answers as a JSON error with that status; only a failure
    mid-stream is reported in-band, as one terminated ``data: {"error": {...}}`` event.
    """
    request = client.build_request("POST", url, json=body, headers=headers)
    try:
        upstream = await client.send(request, stream=True)
    except httpx.RequestError as e:
        return openai_error_response(
            503, f"Could not connect to {backend_label}: {e}", "connection_error"
        )

    if upstream.status_code >= 400:
        try:
            raw = await upstream.aread()
        finally:
            await upstream.aclose()
        return openai_error_response(
            upstream.status_code,
            upstream_error_message(
                raw, f"{backend_label} answered with status {upstream.status_code}"
            ),
        )

    async def relay():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        except httpx.HTTPError as e:
            yield sse_event(
                openai_error_body(
                    f"Stream from {backend_label} failed: {e}", 502, "connection_error"
                )
            )
        finally:
            await upstream.aclose()

    return StreamingResponse(
        relay(),
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "text/event-stream"),
        headers=SSE_HEADERS,
    )
