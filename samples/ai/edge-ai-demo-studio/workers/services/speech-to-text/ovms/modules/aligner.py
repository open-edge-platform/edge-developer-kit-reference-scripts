# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Lifecycle of the Qwen3-ForcedAligner subprocess, which gives Qwen3-ASR transcripts word timings.

Qwen3-ASR has no timestamp tokens, so OVMS cannot return word (or segment) timings for it. The
forced aligner (``aligner_proc.py``) runs in the Qwen3-ASR conversion environment
(``workers/common/ovms-export-qwen3-asr``), the only one with torch/transformers and the
optimum-intel fork that exports it. It talks one JSON object per line over stdin/stdout; see
``aligner_proc.py`` for the protocol.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import subprocess  # nosec B404 - spawns the local aligner process
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from model_downloader.ovms import export_profile_for

logger = logging.getLogger(__name__)

ALIGNER_MODEL_ID = "Qwen/Qwen3-ForcedAligner-0.6B-hf"

# Worker language codes -> the language names Qwen3's processor expects in
# `prepare_forced_aligner_inputs(language=...)`.
ISO_TO_QWEN_LANGUAGE = {
    "en": "English",
    "zh": "Chinese",
    "yue": "Cantonese",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "pt": "Portuguese",
    "id": "Indonesian",
    "it": "Italian",
    "ko": "Korean",
    "ru": "Russian",
    "th": "Thai",
    "vi": "Vietnamese",
    "ja": "Japanese",
    "tr": "Turkish",
    "hi": "Hindi",
    "ms": "Malay",
    "nl": "Dutch",
    "sv": "Swedish",
    "da": "Danish",
    "fi": "Finnish",
    "pl": "Polish",
    "cs": "Czech",
    "fa": "Persian",
    "el": "Greek",
    "ro": "Romanian",
    "hu": "Hungarian",
}
DEFAULT_ALIGNER_LANGUAGE = "English"

_WORKER_DIR = Path(__file__).resolve().parent.parent


def is_qwen3_asr(model_id: str) -> bool:
    """Whether ``model_id`` is a Qwen3-ASR model (word timings come from the forced aligner)."""
    return model_id.lower().startswith("qwen/qwen3-asr")


def to_aligner_language(language: Optional[str]) -> str:
    """A worker language code as the name Qwen3's processor expects (``auto`` -> English)."""
    if not language or language.strip().lower() == "auto":
        return DEFAULT_ALIGNER_LANGUAGE
    return ISO_TO_QWEN_LANGUAGE.get(language.strip().lower(), language)


class Aligner:
    """The running aligner process. Not thread-safe: callers serialize :meth:`align`."""

    def __init__(self, process: subprocess.Popen) -> None:
        self.process = process
        # stdout lines, read on a thread so waits can time out instead of
        # blocking on readline(); None marks EOF.
        self._lines: queue.Queue[Optional[str]] = queue.Queue()
        threading.Thread(target=self._pump, name="aligner-stdout", daemon=True).start()

    def _pump(self) -> None:
        for line in self.process.stdout:
            self._lines.put(line)
        self._lines.put(None)

    def _next_message(self, deadline: float) -> Optional[dict]:
        """The next JSON message, or None at the deadline. Raises if the process exited."""
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            try:
                line = self._lines.get(timeout=remaining)
            except queue.Empty:
                return None
            if line is None:
                code = self.process.wait()
                raise RuntimeError(f"forced aligner process exited with code {code}")
            line = line.strip()
            if not line:
                continue
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                logger.warning("forced aligner: ignoring non-JSON output: %s", line)

    def wait_ready(self, timeout: float) -> bool:
        """Block until the process reports ``{"ready": true}``; False on timeout."""
        deadline = time.monotonic() + timeout
        while True:
            message = self._next_message(deadline)
            if message is None:
                return False
            if message.get("ready") is True:
                return True

    def align(self, transcript: str, language: str, wav_path: str, timeout: float = 60.0) -> list[dict]:
        """Word timings ``[{"start", "end", "text"}]`` for one transcript of a 16 kHz mono WAV."""
        if self.process.poll() is not None:
            raise RuntimeError(f"forced aligner process is not running (exit code {self.process.returncode})")
        request = {"transcript": transcript, "language": language, "wav_path": wav_path}
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()

        message = self._next_message(time.monotonic() + timeout)
        if message is None:
            # The answer may still arrive and would be read as the next
            # request's: stop the process rather than desynchronize.
            self.stop()
            raise RuntimeError(f"forced aligner did not respond within {timeout}s; stopped it")
        if "error" in message:
            raise RuntimeError(f"forced aligner reported an error: {message['error']}")
        return list(message.get("words") or [])

    def stop(self) -> None:
        """Terminate the process (idempotent)."""
        if self.process.poll() is not None:
            return
        try:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        except Exception as exc:  # noqa: BLE001
            logger.error("Error stopping the forced aligner: %s", exc)


def _aligner_python(stt_model_id: str) -> Path:
    """The interpreter of the environment ``stt_model_id`` converts with (Qwen3-ASR's)."""
    profile = export_profile_for(stt_model_id)
    venv = profile.venv() if profile is not None else None
    if venv is None:
        raise RuntimeError(f"no conversion environment is configured for {stt_model_id}")
    python = venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not python.is_file():
        raise RuntimeError(
            f"Python not found at {python}; start the worker through start.sh / start.ps1, "
            f"which provisions {profile.project}"
        )
    return python


def start_aligner(stt_model_id: str, device: str = "CPU") -> Aligner:
    """Launch ``aligner_proc.py``, which exports the aligner to ``models/stt/forced-aligner`` on first use.
    """
    python = _aligner_python(stt_model_id)
    env = os.environ.copy()
    # The venv's own interpreter and packages, not whatever the worker runs with.
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env["VIRTUAL_ENV"] = str(python.parent.parent)
    env["PATH"] = os.pathsep.join([str(python.parent), env.get("PATH", "")])
    command = [
        str(python),
        str(_WORKER_DIR / "aligner_proc.py"),
        "--device", device,
    ]
    logger.info("Starting forced aligner: %s", " ".join(command))
    process = subprocess.Popen(  # nosec B603 - fixed interpreter and script
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=None,
        text=True,
        encoding="utf-8",
        bufsize=1,
        env=env,
    )
    return Aligner(process)
