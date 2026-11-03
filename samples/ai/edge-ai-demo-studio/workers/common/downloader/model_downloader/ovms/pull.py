# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""``ovms --pull``: download a model from a hub and convert it for OVMS.

OVMS reads the hub itself, so ModelScope is selected by pointing it there (``HF_ENDPOINT``).
:class:`OvmsPuller` streams progress and can cancel, for a long-lived owner (the multiserve
engine); :func:`pull` is the blocking one-shot services call before they start serving.
"""

from __future__ import annotations

import json
import os
from collections import deque
import signal
import re
import shutil
import subprocess  # nosec B404 - spawns the bundled OVMS binary with a fixed argument list
import threading
import time
from pathlib import Path
from typing import Any, Callable, ContextManager, Iterator, Sequence

from .._locks import model_lock
from .._startup import startup_stage
from ..errors import OvmsBusyError, OvmsError, OvmsNotFoundError
from ..sources import hf_endpoint_for_source
from .env import OvmsEnv, export_profile_for, has_optimum_cli, ovms_env

__all__ = [
    "PROGRESS_PREFIXES",
    "OvmsPuller",
    "build_pull_command",
    "drop_lfs_pointers",
    "pinned_cpu_args",
    "pull",
    "pull_device",
    "serve_lock_path",
]

#: Lines of ``ovms --pull`` output that report download progress.
PROGRESS_PREFIXES = ("Downloading lfs size", "Progress:")

#: What OVMS prints (then exits 1) when the repository holds a download it cannot resume, as after
#: an interrupted git-lfs fetch, and the flag it suggests: download that model again from scratch.
OVERWRITE_HINT = "Consider --overwrite_models"
OVERWRITE_FLAG = "--overwrite_models"
# How OVMS's git/HTTP layer reports a network hiccup (e.g. "SSL error: syscall failure: Resource
# temporarily unavailable" from modelscope.cn): worth another try, unlike a missing repository.
TRANSIENT_NETWORK_ERROR = re.compile(
    r"SSL error|Resource temporarily unavailable|timed out|Connection (reset|refused)"
    r"|Could not resolve|Failed to connect|unexpected EOF"
    # curl's words for a transfer cut short, as OVMS's git-lfs download reports them (e.g. a CDN
    # resetting the stream mid-file: "Stream error in the HTTP/2 framing layer").
    r"|HTTP/?2 framing layer|Failure when receiving data|Timeout was reached"
    r"|Couldn't connect|Transferred a partial file|Server returned nothing",
    re.IGNORECASE,
)
#: The line naming the curl error behind a failed git-lfs download; OVMS prints more after it, so
#: it is not among a failed pull's last lines.
LFS_FAILURE_CAUSE = re.compile(r"\[ERROR\] LFS (object download|batch request) failed: ")
#: What OVMS on Windows prints (then exits 1) resuming a half-downloaded file: it looks the file up
#: in the git tree by its Windows path ("unet\\openvino_model.bin"), which never matches, so every
#: later pull of that model fails the same way.
RESUME_PATH_ERROR = "Pull resume failed in git_tree_entry_bypath"
MISSING_OPTIMUM_ERROR = "missing optimum-intel"
_APP_CONTROL_BLOCKED = 4551
#: How a git-lfs pointer file starts: OVMS leaves one in place of each
#: large file until that file has been downloaded.
LFS_POINTER_HEADER = b"version https://git-lfs.github.com/spec/v1"
# A pointer is a few lines of text; anything larger is real content.
LFS_POINTER_MAX_SIZE = 1024
# Retries of a pull that failed on TRANSIENT_NETWORK_ERROR, and the waits before each.
NETWORK_RETRY_DELAYS = (5, 20)


def _pull_lock(path: str | os.PathLike[str]) -> ContextManager[None]:
    """Cross-process lock so two processes never convert the same model into a shared repository
    at once. A no-op without worker-common.
    """
    return model_lock(path)


def drop_lfs_pointers(model_dir: str | os.PathLike[str]) -> list[str]:
    """Delete the git-lfs pointer files in a partly downloaded model.

    Works around :data:`RESUME_PATH_ERROR`: without the pointer, OVMS lists the file as missing by
    its git-tree path and resumes it from the ``<file>lfs_part`` it keeps. Returns the removed
    files, relative to ``model_dir``.
    """
    root = Path(model_dir)
    removed: list[str] = []
    # OVMS looks for missing files only while its "<model>.lfswip" marker
    # says a pull is unfinished; without it a pointer-less model would be
    # taken as complete.
    if not root.is_dir() or not Path(f"{root}.lfswip").is_file():
        return removed
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if ".git" in relative.parts:
            continue
        try:
            if not path.is_file() or path.stat().st_size > LFS_POINTER_MAX_SIZE:
                continue
            with path.open("rb") as handle:
                if handle.read(len(LFS_POINTER_HEADER)) != LFS_POINTER_HEADER:
                    continue
            path.unlink()
        except OSError:
            continue
        removed.append(relative.as_posix())
    return removed


def optimum_cli_problem(env: OvmsEnv) -> str | None:
    """Why ``optimum-cli -h`` fails in ``env``, or ``None`` when it runs."""
    cli = shutil.which("optimum-cli", path=env.env.get("PATH"))
    if cli is None:
        return f"optimum-cli is not installed in {env.optimum_home}"
    name = Path(cli).name
    try:
        result = subprocess.run(  # nosec B603
            [cli, "-h"],
            env=env.env,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=120,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return None
    except OSError as exc:
        problem = f"{name} would not start: {exc.strerror or exc}"
        if getattr(exc, "winerror", None) == _APP_CONTROL_BLOCKED:
            problem += " (if Smart App Control is on, turn it off in Windows Security > App & browser control)"
        return problem
    if result.returncode != 0:
        lines = (result.stderr or result.stdout).strip().splitlines()
        return f"{name} -h exited with code {result.returncode}" + (f": {lines[-1]}" if lines else "")
    return None


def serve_lock_path(model_repository_path: str | os.PathLike[str], source_model: str) -> Path:
    """The lock to hold from pulling ``source_model`` until OVMS has loaded it.

    A pull rewrites the model's shared ``graph.pbtxt`` for its device and OVMS reads it on load,
    so two instances serving one model on different devices would load each other's graph. Take
    it before the pull, whose own lock (the same path without ``.serve``) nests inside it.
    """
    return Path(model_repository_path) / f"{source_model.replace('/', '__')}.serve"


def pull_device(device: str | None, task: str | None = None) -> str | None:
    """``--target_device`` for a pull: ``GPU.1`` becomes ``GPU``; empty stays unset.

    ``AUTO`` for ``text_generation`` stays unset too: AUTO cannot run LLM pipelines, whose KV-cache
    inputs have no precision until a real device compiles them ("Check
    'm_element_type.is_static()' failed"). Unset, OVMS picks dGPU, then iGPU, then CPU on load.
    """
    if not device:
        return None
    if task == "text_generation" and device.split(":", 1)[0].upper() == "AUTO":
        return None
    return device.split(".", 1)[0]


def pinned_cpu_args(device: str | None) -> list[str]:
    """``--plugin_config`` with this process's pinned CPU thread count, for a graph on ``device``.

    OpenVINO on Windows ignores the CPU affinity OVMS inherits (``worker_common.pinned_cpu_threads``).
    Nothing when unpinned, for an NPU graph (untested there), or without ``worker-common``.
    """
    if device and "NPU" in device.upper():
        return []
    try:
        from worker_common import openvino_pinned_cpu_config
    except ImportError:
        return []
    config = openvino_pinned_cpu_config()
    return ["--plugin_config", json.dumps(config)] if config else []


PLUGIN_CONFIG_FLAG = "--plugin_config"


def _with_pinned_plugin_config(extra_args: list[str], pinned: dict) -> list[str]:
    """``extra_args`` with the pinned thread count merged into their own ``--plugin_config``.

    OVMS keeps only the last ``--plugin_config``; the caller's keys win. A value that is not a JSON
    object is left for OVMS to reject.
    """
    index = extra_args.index(PLUGIN_CONFIG_FLAG) + 1
    if index >= len(extra_args):
        return extra_args
    try:
        config = json.loads(extra_args[index])
    except ValueError:
        return extra_args
    if not isinstance(config, dict):
        return extra_args
    merged = list(extra_args)
    merged[index] = json.dumps({**pinned, **config})
    return merged


def build_pull_command(
    executable: str | os.PathLike[str],
    source_model: str,
    model_repository_path: str | os.PathLike[str],
    *,
    task: str,
    target_device: str | None = None,
    pipeline_type: str | None = None,
    weight_format: str | None = None,
    extra_args: Sequence[str] = (),
    log_level: str | None = None,
) -> list[str]:
    """The ``ovms --pull`` argument list, without running it."""
    command = [
        str(executable),
        "--pull",
        "--model_repository_path",
        str(model_repository_path),
        "--source_model",
        source_model,
        "--task",
        task,
    ]
    device = pull_device(target_device, task)
    if device:
        command += ["--target_device", device]
    pinned = pinned_cpu_args(device)
    extra_args = list(extra_args)
    if pinned and PLUGIN_CONFIG_FLAG in extra_args:
        extra_args = _with_pinned_plugin_config(extra_args, json.loads(pinned[1]))
    else:
        command += pinned
    if pipeline_type:
        command += ["--pipeline_type", pipeline_type]
    if weight_format:
        # Only meaningful when OVMS converts through optimum-cli.
        command += ["--weight-format", weight_format]
    if log_level:
        command += ["--log_level", log_level]
    command += list(extra_args)
    return command


class OvmsPuller:
    """One ``ovms --pull`` at a time, streaming its output, cancelable.

    The OVMS environment is resolved on first use, so an owner can be
    constructed before ``workers/setup.sh`` has run and fail only when a
    pull is attempted.
    """

    def __init__(self, env: OvmsEnv | None = None):
        self._env = env
        self._process: subprocess.Popen[str] | None = None
        self._model: str | None = None
        self._cancel_requested = False
        self._lock = threading.Lock()

    @property
    def env(self) -> OvmsEnv:
        if self._env is None:
            self._env = ovms_env()
        return self._env

    def env_for(self, source_model: str) -> OvmsEnv:
        """The environment a pull of ``source_model`` runs in.

        A constructor-supplied environment wins; otherwise an ``EXPORT_PROFILES`` model gets its
        own and others the shared one. Raises :class:`OvmsError`, naming what to run, when the
        model's profile is not provisioned.
        """
        if self._env is not None:
            return self._env
        profile = export_profile_for(source_model)
        if profile is None:
            return self.env
        env = ovms_env(source_model=source_model)  # may raise OvmsNotFoundError
        venv = profile.venv()
        if venv is None or not has_optimum_cli(venv):
            raise OvmsError(
                f"{source_model} is converted with its own optimum environment "
                f"({profile.project}), which is not provisioned at {venv}. "
                f"From workers/: ./oep-setup.sh fetch {profile.project} && "
                f"thirdparty/uv/uv sync --project {profile.project} "
                f"(the start script of the worker serving it does this on first use)."
            )
        return env

    @property
    def current_model(self) -> str | None:
        """The model being pulled right now, or ``None``."""
        return self._model

    @property
    def is_running(self) -> bool:
        process = self._process
        return process is not None and process.poll() is None

    def iter_pull(
        self,
        source_model: str,
        model_repository_path: str | os.PathLike[str],
        *,
        task: str,
        source: Any = "huggingface",
        target_device: str | None = None,
        pipeline_type: str | None = None,
        weight_format: str | None = None,
        extra_args: Sequence[str] = (),
        log_level: str | None = None,
        progress_only: bool = False,
    ) -> Iterator[str]:
        """Run the pull, yielding its output lines (stripped, non-empty).

        ``progress_only`` keeps just the :data:`PROGRESS_PREFIXES` lines. After
        the stream ends, a non-zero exit raises :class:`OvmsError` (with
        ``cancelled=True`` when :meth:`cancel` stopped it); a second pull while
        one runs raises :class:`OvmsBusyError`; a missing binary raises
        :class:`OvmsNotFoundError`.
        """
        with self._lock:
            if self.is_running:
                raise OvmsBusyError(
                    f"another download ({self._model}) is already running; cancel it first",
                )
            env = self.env_for(source_model)  # may raise OvmsNotFoundError / OvmsError
            command = build_pull_command(
                env.executable,
                source_model,
                model_repository_path,
                task=task,
                target_device=target_device,
                pipeline_type=pipeline_type,
                weight_format=weight_format,
                extra_args=extra_args,
                log_level=log_level,
            )
            command_env = dict(env.env)
            endpoint = hf_endpoint_for_source(source)
            if endpoint:
                command_env["HF_ENDPOINT"] = endpoint
            Path(model_repository_path).mkdir(parents=True, exist_ok=True)

        # Cross-process lock, held through the yields, so another process pulling the same model
        # here waits instead of racing the conversion. Taken after the busy check, which guards
        # only this instance and must fail fast.
        lock_path = Path(model_repository_path) / source_model.replace("/", "__")
        model_dir = Path(model_repository_path) / source_model
        with _pull_lock(lock_path):
            returncode, unclean, tail = yield from self._run_resuming(
                command, command_env, source_model, model_dir, progress_only
            )
            for delay in NETWORK_RETRY_DELAYS:
                if (
                    returncode == 0
                    or self._cancel_requested
                    or not any(TRANSIENT_NETWORK_ERROR.search(line) for line in tail)
                ):
                    break
                if not progress_only:
                    yield f"{source_model}: network error ({tail[-1]}); trying again in {delay} s"
                time.sleep(delay)
                if self._cancel_requested:
                    break
                returncode, unclean, tail = yield from self._run_resuming(
                    command, command_env, source_model, model_dir, progress_only
                )
            if (
                returncode != 0
                and unclean
                and not self._cancel_requested
                and OVERWRITE_FLAG not in command
            ):
                # An interrupted git-lfs fetch leaves a repository OVMS cannot resume (every later
                # pull and serve exits 1 asking for --overwrite_models): download it again, once.
                if not progress_only:
                    yield (
                        f"{source_model}: the partial download cannot be resumed; "
                        f"downloading it again from scratch ({OVERWRITE_FLAG})"
                    )
                returncode, unclean, _resume_failed, tail = yield from self._run(
                    [*command, OVERWRITE_FLAG], command_env, source_model, progress_only
                )

        if returncode != 0:
            cancelled = self._cancel_requested or returncode in (-signal.SIGTERM, -signal.SIGINT)
            # What OVMS said last, so the failure carries its reason (the
            # progress-only stream drops every other line).
            reason = " | ".join(tail)[-400:]
            problem = None if cancelled or MISSING_OPTIMUM_ERROR not in reason else optimum_cli_problem(env)
            raise OvmsError(
                "download manually cancelled" if cancelled
                else f"ovms --pull {source_model} failed with exit code {returncode}"
                + (f" ({problem})" if problem else "")
                + (f": {reason}" if reason else ""),
                returncode=returncode,
                cancelled=cancelled,
                detail=problem,
            )

    def _run_resuming(
        self,
        command: Sequence[str],
        command_env: dict[str, str],
        source_model: str,
        model_dir: Path,
        progress_only: bool,
    ) -> Iterator[str]:
        """:meth:`_run`, once more after :func:`drop_lfs_pointers` when OVMS
        could not resume a partial download (:data:`RESUME_PATH_ERROR`).
        Returns ``(returncode, unclean, tail)``, ``unclean`` also when that
        did not help, so the caller falls back to :data:`OVERWRITE_FLAG`."""
        returncode, unclean, resume_failed, tail = yield from self._run(
            command, command_env, source_model, progress_only
        )
        if returncode != 0 and resume_failed and not self._cancel_requested:
            dropped = drop_lfs_pointers(model_dir)
            if dropped:
                if not progress_only:
                    yield (
                        f"{source_model}: could not resume {', '.join(dropped)}; "
                        "trying again by repository path"
                    )
                returncode, unclean, resume_failed, tail = yield from self._run(
                    command, command_env, source_model, progress_only
                )
        return returncode, unclean or (returncode != 0 and resume_failed), tail

    def _run(
        self,
        command: Sequence[str],
        command_env: dict[str, str],
        source_model: str,
        progress_only: bool,
    ) -> Iterator[str]:
        """One ``ovms --pull`` process: yields its lines, returns
        ``(returncode, unclean, resume_failed, tail)`` -- ``unclean`` when
        OVMS asked for :data:`OVERWRITE_FLAG` (a download it cannot resume),
        ``resume_failed`` when it printed :data:`RESUME_PATH_ERROR`, ``tail``
        its last few lines other than progress."""
        with self._lock:
            try:
                process = subprocess.Popen(  # nosec B603
                    list(command),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    universal_newlines=True,
                    env=command_env,
                )
            except FileNotFoundError as exc:
                raise OvmsNotFoundError(f"could not start {command[0]}: {exc}") from exc
            self._process = process
            self._model = source_model
            self._cancel_requested = False

        unclean = False
        resume_failed = False
        lfs_cause: str | None = None
        tail: deque[str] = deque(maxlen=3)
        try:
            assert process.stdout is not None
            for line in process.stdout:
                stripped = line.strip()
                if not stripped:
                    continue
                if OVERWRITE_HINT in stripped:
                    unclean = True
                if RESUME_PATH_ERROR in stripped:
                    resume_failed = True
                if LFS_FAILURE_CAUSE.match(stripped):
                    lfs_cause = stripped
                is_progress = stripped.startswith(PROGRESS_PREFIXES)
                if not is_progress:
                    tail.append(stripped)
                if progress_only and not is_progress:
                    continue
                yield stripped
            returncode = process.wait()
        finally:
            if process.poll() is None:
                # The stream closed early and the pull lock is released on the way out, so the
                # child must not keep writing the model behind a sibling's back.
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            self._process = None
            self._model = None
        lines = list(tail)
        if lfs_cause is not None and lfs_cause not in lines:
            # Last, so the retry notice and the error's reason name it.
            lines.append(lfs_cause)
        return returncode, unclean, resume_failed, lines

    def cancel(self, timeout: float = 5) -> bool:
        """Stop the running pull. ``True`` if there was one to stop."""
        process = self._process
        if process is None or process.poll() is not None:
            return False
        self._cancel_requested = True
        try:
            process.terminate()
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
        except OSError:
            return False
        return True


def pull(
    source_model: str,
    model_repository_path: str | os.PathLike[str],
    *,
    task: str,
    source: Any = "huggingface",
    target_device: str | None = None,
    pipeline_type: str | None = None,
    weight_format: str | None = None,
    extra_args: Sequence[str] = (),
    log_level: str | None = None,
    on_output: Callable[[str], None] | None = None,
    env: OvmsEnv | None = None,
) -> Path:
    """Blocking ``ovms --pull``; returns ``<model_repository_path>/<source_model>``.

    Output lines go to ``on_output`` (default: print). Raises :class:`OvmsError` on failure.
    Re-running on a pulled model is cheap: OVMS keeps the weights and regenerates only the graph.
    The startup panel shows Preparing without progress: what OVMS is doing cannot be told from
    outside.
    """
    emit = on_output or (lambda line: print(line, flush=True))
    puller = OvmsPuller(env)
    with startup_stage("preparing", source_model, failure=lambda exc: _pull_failure(source_model, exc)):
        for line in puller.iter_pull(
            source_model,
            model_repository_path,
            task=task,
            source=source,
            target_device=target_device,
            pipeline_type=pipeline_type,
            weight_format=weight_format,
            extra_args=extra_args,
            log_level=log_level,
        ):
            emit(line)
    return Path(model_repository_path) / source_model


def _pull_failure(source_model: str, exc: Exception) -> str:
    """The startup failure summary of a failed :func:`pull`."""
    if isinstance(exc, OvmsNotFoundError):
        return "OpenVINO Model Server is not installed; run the workers setup script"
    if isinstance(exc, OvmsError) and exc.detail:
        return f"Could not convert {source_model}: {exc.detail}"
    if isinstance(exc, OvmsError) and exc.returncode is not None:
        return f"Could not download or convert {source_model} (ovms --pull exit code {exc.returncode})"
    return f"Could not download or convert {source_model}: {exc}"
