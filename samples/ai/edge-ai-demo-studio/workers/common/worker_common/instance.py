# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""The service-instance contract: where an instance may write and how it finds a sibling.

The app spawns each instance with INSTANCE_ID, INSTANCE_KEY ("type@id"), INSTANCE_DATA_DIR and
EDGE_AI_STUDIO_URL set, plus ``--instance-id``/``--data-dir``. Siblings have no fixed port: they answer
through the app at ``/api/<type>@<instance>``. An embedded server (OVMS, a sidecar) binds ``--port + 1``.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, AsyncIterator, Iterator

from worker_common.proxy import loopback_opener

__all__ = [
    "INSTANCE_HEADER",
    "add_instance_args",
    "async_shared_model_lock",
    "instance_data_dir",
    "instance_id",
    "instance_key",
    "resolve_service_address",
    "service_base_url",
    "shared_model_lock",
    "staged_model_file",
    "studio_address",
    "studio_url",
    "with_instance_header",
]

_logger = logging.getLogger(__name__)

#: The packaged app's address, for a worker run by hand; the app always sets EDGE_AI_STUDIO_URL.
_DEFAULT_STUDIO_URL = "http://127.0.0.1:8080"


def add_instance_args(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    """Add ``--instance-id`` and ``--data-dir`` (default None, so the environment applies) to ``parser``."""
    parser.add_argument(
        "--instance-id",
        type=str,
        default=None,
        help="Identity of this service instance (the app passes it; also INSTANCE_ID env)",
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default=None,
        help="Writable directory owned by this instance (same as INSTANCE_DATA_DIR env)",
    )
    return parser


def _from_argv(flag: str) -> str | None:
    """``flag``'s value from ``sys.argv``, for code that runs before ``parse_args()``; None on any error."""
    dest = flag.lstrip("-").replace("-", "_")
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument(flag, dest=dest, default=None)
    try:
        parsed, _unknown = parser.parse_known_args(sys.argv[1:])
    except (SystemExit, argparse.ArgumentError):
        return None
    return getattr(parsed, dest, None)


def instance_id(args: argparse.Namespace | None = None) -> str | None:
    """This process's instance id, or None.

    From ``args.instance_id``, else ``--instance-id`` in ``sys.argv`` when ``args`` is None, else
    ``INSTANCE_ID``.
    """
    if args is not None:
        value = getattr(args, "instance_id", None)
        if value:
            return value
    else:
        value = _from_argv("--instance-id")
        if value:
            return value
    return os.environ.get("INSTANCE_ID") or None


def instance_key() -> str | None:
    """``"type@instanceId"`` from the ``INSTANCE_KEY`` environment, or None."""
    return os.environ.get("INSTANCE_KEY") or None


#: Response header naming the instance that answered (its ``INSTANCE_KEY``), so the app's health
#: checks and proxy never take another process on that port for it.
INSTANCE_HEADER = "x-edge-ai-studio-instance"


def with_instance_header(app: Any) -> Any:
    """``app`` with :data:`INSTANCE_HEADER` on every HTTP response; unchanged without ``INSTANCE_KEY``."""
    key = instance_key()
    if not key:
        return app
    header = (INSTANCE_HEADER.encode("latin-1"), key.encode("latin-1"))

    async def answer_as_instance(scope, receive, send):
        if scope["type"] != "http":
            await app(scope, receive, send)
            return

        async def send_with_header(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message.get("headers", ()), header]}
            await send(message)

        await app(scope, receive, send_with_header)

    return answer_as_instance


def instance_data_dir(
    default: str | os.PathLike[str],
    *,
    args: argparse.Namespace | None = None,
    create: bool = True,
) -> Path:
    """The absolute directory this instance owns: the one place a worker asks "where may I write".

    From ``args.data_dir``, else ``--data-dir`` in ``sys.argv`` when ``args`` is None, else
    ``INSTANCE_DATA_DIR``, else ``default``. Created unless ``create=False``.
    """
    raw = None
    if args is not None:
        raw = getattr(args, "data_dir", None)
    else:
        raw = _from_argv("--data-dir")
    raw = raw or os.environ.get("INSTANCE_DATA_DIR") or default
    path = Path(raw).resolve()
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def studio_url() -> str:
    """Loopback base URL of the app, no trailing slash."""
    return (os.environ.get("EDGE_AI_STUDIO_URL") or _DEFAULT_STUDIO_URL).rstrip("/")


def studio_address(address: str | None) -> str | None:
    """A sibling's address as the app handed it over, as a URL to call.

    A path (``/api/<type>@<id>/v1``) is joined to :func:`studio_url`, so the call goes through the app's
    proxy and survives the sibling moving port; a full URL or None comes back as is.
    """
    if address and address.startswith("/"):
        return studio_url() + address
    return address


def resolve_service_address(service_type: str, *, timeout: float = 5.0) -> str | None:
    """Base URL of ``service_type``'s running instance, looked up through the app (never via a proxy).

    Never raises: None, with a warning logged, on any error, non-200 response or malformed body. The
    address is valid only while that instance runs, so a long-lived client should re-resolve periodically.
    """
    raw_url = f"{studio_url()}/api/services/address?{urllib.parse.urlencode({'type': service_type})}"
    parsed = urllib.parse.urlsplit(raw_url)
    if parsed.scheme != "http" or parsed.hostname not in (
        "localhost", "127.0.0.1", "::1"
    ):
        _logger.warning("Rejected non-loopback studio URL")
        return None
    url_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~:/?#[]@!$&'()*+,;=%"
    url = ""
    for ch in raw_url:
        allowed_char = ""
        for allowed in url_chars:
            if allowed == ch:
                allowed_char = allowed
                break
        if not allowed_char:
            _logger.warning("Rejected invalid studio URL character")
            return None
        url += allowed_char
    try:
        with loopback_opener().open(url, timeout=timeout) as response:  # nosec B310 - loopback app URL
            if response.status != 200:
                body_preview = response.read().decode("utf-8", errors="replace")[:200]
                _logger.warning(
                    "resolve_service_address(%r): %s responded %s: %s",
                    service_type, url, response.status, body_preview,
                )
                return None
            body = json.loads(response.read().decode("utf-8"))
            return studio_url() + body["address"]
    except urllib.error.HTTPError as exc:
        try:
            body_preview = exc.read().decode("utf-8", errors="replace")[:200]
        except Exception:  # noqa: BLE001 - best-effort only, never let logging raise
            body_preview = ""
        _logger.warning(
            "resolve_service_address(%r): %s responded %s: %s", service_type, url, exc.code, body_preview,
        )
        return None
    except (urllib.error.URLError, OSError, ValueError, KeyError) as exc:
        _logger.warning("resolve_service_address(%r): %s failed: %s", service_type, url, exc)
        return None


def service_base_url(service_type: str, *, suffix: str = "", env: str | None = None) -> str:
    """Base URL for calling a sibling service, with ``suffix`` appended.

    The ``env`` variable (e.g. ``TEXT_GENERATION_URL``) pins a fixed address; else
    :func:`resolve_service_address`; else a deliberately unreachable ``/api/<type>@not-added`` URL, so the
    call fails clearly instead of hitting a guessed port.
    """
    if env:
        override = os.environ.get(env)
        if override:
            return override.rstrip("/") + suffix
    address = resolve_service_address(service_type)
    if address:
        return address + suffix
    return f"{studio_url()}/api/{service_type}@not-added{suffix}"


def _pid_alive(pid: int) -> bool | None:
    """Whether ``pid`` is alive, or None when that cannot be determined (callers then use the mtime rule)."""
    if os.name == "nt":
        try:
            import ctypes

            process_query_limited_information = 0x1000
            handle = ctypes.windll.kernel32.OpenProcess(process_query_limited_information, False, pid)
        except Exception:  # noqa: BLE001 - any platform/ctypes surprise -> unknown
            return None
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists, owned by another user
    except OSError:
        return None
    return True


def _read_owner_pid(lock_dir: str) -> int | None:
    """The pid in ``lock_dir``'s owner file, or None if it is missing or unreadable."""
    try:
        with open(os.path.join(lock_dir, "owner"), encoding="utf-8") as handle:
            data = json.load(handle)
        return int(data["pid"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _write_owner_file(lock_dir: str) -> None:
    """Record this process as the lock's holder; if this fails, reclaiming falls back to the mtime rule."""
    try:
        with open(os.path.join(lock_dir, "owner"), "w", encoding="utf-8") as handle:
            json.dump({"pid": os.getpid(), "started": time.time()}, handle)
    except OSError:
        pass


def _remove_lock_dir(lock_dir: str, *, attempts: int = 100, delay: float = 0.05) -> None:
    """Delete ``lock_dir``, retrying until it is gone.

    On Windows ``rmtree`` fails while a waiter is reading the ``owner`` file, which would leave a lock
    owned by a live pid that nobody ever reclaims. Reads take microseconds, so a few retries suffice.
    """
    # rmtree's own outcome, not a look afterwards: once it is gone a waiter
    # may take the lock at once, and that new lock must not be deleted too.
    for _ in range(attempts):
        try:
            shutil.rmtree(lock_dir)
            return
        except FileNotFoundError:
            return
        except OSError:
            time.sleep(delay)
    _logger.warning("Could not remove the lock %s; another process may wait on it", lock_dir)


def _mtime_stale(lock_dir: str, stale: float) -> bool:
    try:
        return time.time() - os.path.getmtime(lock_dir) > stale
    except OSError:
        return False  # raced with the holder removing it, or it is gone already


@contextlib.contextmanager
def shared_model_lock(
    path: str | os.PathLike[str],
    *,
    timeout: float = 14400.0,
    stale: float = 7200.0,
) -> Iterator[None]:
    """Cross-process lock (a ``{path}.lock`` directory) so instances sharing a models directory never
    download or convert the same model at once; do the "already done" check inside it.

    A held lock is reclaimed only when its owner pid is confirmed dead or, with liveness unknown, its mtime
    is older than ``stale``; a live holder only makes the waiter raise ``TimeoutError`` after ``timeout``
    (4 h by default, as converting a large model is slow).
    """
    lock_dir = str(path).rstrip("/\\") + ".lock"
    os.makedirs(os.path.dirname(lock_dir) or ".", exist_ok=True)
    started = time.time()
    announced = False
    while True:
        try:
            os.mkdir(lock_dir)
            _write_owner_file(lock_dir)
            break
        except FileExistsError:
            owner_pid = _read_owner_pid(lock_dir)
            if owner_pid is not None:
                alive = _pid_alive(owner_pid)
            else:
                alive = None
            if alive is False:
                reclaim = True
            elif alive is True:
                reclaim = False
            else:
                reclaim = _mtime_stale(lock_dir, stale)
            if reclaim:
                # Rename aside first: only one of several simultaneous reclaimers can win the
                # rename, and the losers keep waiting rather than delete what the winner claimed.
                graveyard = f"{lock_dir}.stale.{os.getpid()}.{time.time_ns()}"
                try:
                    os.rename(lock_dir, graveyard)
                except OSError:
                    pass
                else:
                    shutil.rmtree(graveyard, ignore_errors=True)
                continue
            if time.time() - started > timeout:
                raise TimeoutError(f"Timed out after {timeout}s waiting for {lock_dir}")
            if not announced:
                # A warning, so a worker that sets up no logging still says why it is stuck here.
                announced = True
                _logger.warning(
                    "Waiting for %s: another process (pid %s) is preparing the same model",
                    lock_dir,
                    owner_pid if owner_pid is not None else "unknown",
                )
            time.sleep(1.0)
    try:
        yield
    finally:
        _remove_lock_dir(lock_dir)


@contextlib.asynccontextmanager
async def async_shared_model_lock(
    path: str | os.PathLike[str], **kwargs: float
) -> AsyncIterator[None]:
    """:func:`shared_model_lock` for a coroutine: it waits on a thread so the event loop keeps serving."""
    lock = shared_model_lock(path, **kwargs)
    await asyncio.to_thread(lock.__enter__)
    try:
        yield
    finally:
        lock.__exit__(None, None, None)


@contextlib.contextmanager
def staged_model_file(path: str | os.PathLike[str]) -> Iterator[str]:
    """Write a model file where no reader ever sees it half written.

    Yields the same file name in a private directory beside ``path``. On success every file there is
    moved into place, ``path`` last, so a sibling's ``path.exists()`` implies its companions (an IR's
    ``.bin``) are in place too. If the block raises, nothing is moved.
    """
    final = Path(path)
    final.parent.mkdir(parents=True, exist_ok=True)
    staging = final.parent / f".{final.name}.staging-{os.getpid()}-{time.time_ns()}"
    staging.mkdir()
    try:
        yield str(staging / final.name)
        written = sorted(staging.iterdir(), key=lambda entry: entry.name == final.name)
        for entry in written:
            os.replace(entry, final.parent / entry.name)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
