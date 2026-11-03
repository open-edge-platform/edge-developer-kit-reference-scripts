# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Running the shared OpenVINO Model Server as a child of a worker: spawn, readiness poll, stop.

OVMS runs in its own session so signals aimed at the worker's group don't reach it before the worker
stops it; on Linux it also gets SIGTERM on parent death (``PR_SET_PDEATHSIG``), so a killed worker
doesn't leave it holding its port. Windows relies on the atexit ``stop``.
"""

from __future__ import annotations

import atexit
import logging
import os
import signal
import subprocess  # nosec B404 - spawns the bundled OVMS binary only
import sys
import threading
import time
import urllib.error
import urllib.parse
from typing import IO, Any, Callable, Sequence

from worker_common.proxy import loopback_opener
from worker_common.startup import startup_stage

__all__ = ["OvmsServer", "model_ready_url"]

logger = logging.getLogger(__name__)

_PR_SET_PDEATHSIG = 1


def _load_prctl() -> Any | None:
    """``libc.prctl`` on Linux; None wherever it cannot be had."""
    if not sys.platform.startswith("linux"):
        return None
    try:
        import ctypes

        return ctypes.CDLL("libc.so.6", use_errno=True).prctl
    except (OSError, AttributeError):
        return None


# Resolved once, in the parent: nothing is imported or looked up in the
# child between fork and exec (what the ``preexec_fn`` docs warn against).
_PRCTL = _load_prctl()


def _child_setup() -> None:
    """``preexec_fn`` for OVMS (POSIX): own session, then SIGTERM when the forking thread ends (Linux).

    A ``prctl`` failure is swallowed, since an exception here would abort the spawn.
    """
    os.setsid()
    if _PRCTL is not None:
        try:
            _PRCTL(_PR_SET_PDEATHSIG, int(signal.SIGTERM), 0, 0, 0)
        except Exception:  # noqa: BLE001 - never let this stop OVMS from starting
            pass

#: ``(stream, line)`` callback for captured output; ``stream`` is ``"out"`` or ``"error"``.
OutputCallback = Callable[[str, str], None]


def model_ready_url(port: int, model_name: str, *, host: str = "127.0.0.1") -> str:
    """OVMS's KServe readiness URL for ``model_name`` (slashes are escaped)."""
    return f"http://{host}:{port}/v2/models/{urllib.parse.quote(model_name, safe='')}/ready"


def startup_timeout(default: int = 600) -> int:
    """Seconds to wait for a model, from the app's ``STARTUP_TIMEOUT`` (else ``default``)."""
    raw = os.environ.get("STARTUP_TIMEOUT", "").strip()
    try:
        value = int(raw)
    except ValueError:
        if raw:
            logger.warning("Invalid STARTUP_TIMEOUT %r, using %ss", raw, default)
        return default
    return value if value > 0 else default


class OvmsServer:
    """One OVMS process: start it, wait for a model, stop it.

    ``args`` follow the executable. The executable and environment come from ``model_downloader.ovms_env``
    unless ``env`` is given, so serving runs where ``ovms --pull`` ran. Output is discarded unless
    ``on_output`` is set, which then gets each line of both streams.
    """

    def __init__(
        self,
        args: Sequence[str],
        *,
        env: Any | None = None,
        on_output: OutputCallback | None = None,
        name: str = "OVMS",
    ) -> None:
        self.args = [str(a) for a in args]
        self.name = name
        self._env = env
        self._on_output = on_output
        self._process: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._stop_registered = False

    # ── state ─────────────────────────────────────────────────────────

    @property
    def process(self) -> subprocess.Popen | None:
        return self._process

    @property
    def pid(self) -> int | None:
        return self._process.pid if self._process is not None else None

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    @property
    def returncode(self) -> int | None:
        return None if self._process is None else self._process.poll()

    # ── lifecycle ─────────────────────────────────────────────────────

    def _resolve_env(self) -> Any:
        if self._env is None:
            from model_downloader import ovms_env  # deferred: not a worker-common dependency

            self._env = ovms_env()
        return self._env

    def command(self) -> list[str]:
        """The full command line, resolving OVMS if it has not been yet."""
        return [str(self._resolve_env().executable), *self.args]

    def start(self) -> subprocess.Popen:
        """Spawn OVMS. Raises RuntimeError if it exits immediately."""
        with self._lock:
            if self.running:
                return self._process  # type: ignore[return-value]
            ovms = self._resolve_env()
            command = [str(ovms.executable), *self.args]
            logger.info("Starting %s: %s", self.name, " ".join(command))

            capture = self._on_output is not None
            popen_kwargs: dict[str, Any] = {
                "env": ovms.env,
                "text": True,
                "stdin": subprocess.DEVNULL,
                "stdout": subprocess.PIPE if capture else subprocess.DEVNULL,
                "stderr": subprocess.PIPE if capture else subprocess.DEVNULL,
            }
            if os.name == "nt":
                popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
            elif hasattr(os, "setsid"):
                # Own session and, on Linux, SIGTERM once the worker is gone (see module docstring).
                popen_kwargs["preexec_fn"] = _child_setup

            self._process = self._spawn(command, popen_kwargs)
            if self._process.poll() is not None:
                code = self._process.returncode
                self._process = None
                raise RuntimeError(f"{self.name} failed to start (exit code {code})")
            logger.info("%s started with PID %s", self.name, self._process.pid)

            if capture:
                for stream, kind in ((self._process.stdout, "out"), (self._process.stderr, "error")):
                    threading.Thread(
                        target=self._pump, args=(stream, kind), daemon=True
                    ).start()
            if not self._stop_registered:
                atexit.register(self.stop)
                self._stop_registered = True
            return self._process

    def _spawn(self, command: list[str], popen_kwargs: dict[str, Any]) -> subprocess.Popen:
        """``Popen`` from a keeper thread that lives as long as the child, when the death signal is used.

        ``PR_SET_PDEATHSIG`` fires when the forking *thread* exits, and callers start OVMS from short-lived
        pool threads. The keeper blocks in ``waitid(WNOWAIT)``, which neither reaps nor takes ``Popen``'s
        wait lock, so ``poll()``/``wait()``/``stop()`` still work. Spawn errors re-raise on the caller.
        """
        if _PRCTL is None or popen_kwargs.get("preexec_fn") is not _child_setup:
            return subprocess.Popen(command, **popen_kwargs)  # nosec B603

        outcome: list[Any] = []
        spawned = threading.Event()

        def keep() -> None:
            try:
                process = subprocess.Popen(command, **popen_kwargs)  # nosec B603
            except BaseException as exc:  # noqa: BLE001 - handed back to the caller
                outcome.append(exc)
                spawned.set()
                return
            outcome.append(process)
            spawned.set()
            try:
                os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOWAIT)
                return
            except ChildProcessError:
                return  # already reaped by stop()/wait() on another thread
            except (OSError, AttributeError):
                pass  # fall back to polling; leaving early would kill OVMS
            while process.poll() is None:
                time.sleep(1.0)

        threading.Thread(target=keep, name=f"{self.name} keeper", daemon=True).start()
        spawned.wait()
        result = outcome[0]
        if isinstance(result, BaseException):
            raise result
        return result

    def _pump(self, stream: IO[str] | None, kind: str) -> None:
        if stream is None or self._on_output is None:
            return
        try:
            for line in iter(stream.readline, ""):
                if line:
                    self._on_output(kind, line)
        except Exception:  # noqa: BLE001 - a closed pipe on shutdown
            pass
        finally:
            try:
                stream.close()
            except Exception:  # noqa: BLE001
                pass

    def wait_model_ready(
        self,
        model_name: str,
        port: int,
        *,
        timeout: float = 300,
        interval: float = 2.0,
        host: str = "127.0.0.1",
    ) -> bool:
        """Poll ``/v2/models/<name>/ready``, bypassing any proxy, until OVMS answers 200.

        Returns False on timeout or when the process exits first. Reported as the "loading-model" stage.
        """
        url = model_ready_url(port, model_name, host=host)
        opener = loopback_opener()
        deadline = time.monotonic() + timeout
        logger.info("Waiting for %s to report %s ready on port %s", self.name, model_name, port)
        with startup_stage("loading-model", model_name) as stage:
            while time.monotonic() < deadline:
                if self._process is not None and self._process.poll() is not None:
                    code = self._process.returncode
                    logger.error(
                        "%s exited with code %s before %s became ready",
                        self.name, code, model_name,
                    )
                    stage.fail(f"{self.name} exited with code {code} before {model_name} was loaded")
                    return False
                try:
                    with opener.open(url, timeout=5) as response:  # nosec B310 - loopback URL built above
                        if response.status == 200:
                            logger.info("%s is ready with model %s", self.name, model_name)
                            return True
                except (urllib.error.URLError, OSError, ValueError):
                    pass
                time.sleep(interval)
            logger.error("Timed out after %ss waiting for %s on port %s", timeout, model_name, port)
            stage.fail(f"{model_name} was not loaded within {timeout:g} s")
            return False

    def stop(self, *, timeout: float = 10) -> None:
        """Terminate OVMS, escalating to kill after ``timeout`` seconds. Idempotent."""
        with self._lock:
            process, self._process = self._process, None
        if process is None or process.poll() is not None:
            return
        logger.info("Stopping %s (PID %s)...", self.name, process.pid)
        try:
            process.terminate()
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                logger.warning("%s did not stop in %ss, killing it", self.name, timeout)
                process.kill()
                process.wait(timeout=5)
        except Exception as exc:  # noqa: BLE001 - best effort on shutdown
            logger.warning("Error while stopping %s: %s", self.name, exc)
