# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import signal
import sys
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import TextIO

from .environment import Observation


@contextmanager
def graceful_stop(stop_event: threading.Event, *, stdin: TextIO | None = None) -> Iterator[None]:
    """Stop on q + Enter or Ctrl+C without abandoning the evaluation lease."""
    previous_sigint = signal.getsignal(signal.SIGINT)
    can_handle_signals = threading.current_thread() is threading.main_thread()

    def handle_sigint(_signum: int, _frame: object) -> None:
        if not stop_event.is_set():
            print("\nStop requested; finishing the current step and releasing the session...", flush=True)
            stop_event.set()

    input_stream = stdin if stdin is not None else sys.stdin

    def listen_for_quit() -> None:
        while not stop_event.is_set():
            line = input_stream.readline()
            if not line:
                return
            if line.strip().lower() in {"q", "quit", "exit"}:
                if not stop_event.is_set():
                    print("Stop requested; finishing the current step and releasing the session...", flush=True)
                    stop_event.set()
                return

    if can_handle_signals:
        signal.signal(signal.SIGINT, handle_sigint)
    if input_stream.isatty() or stdin is not None:
        listener = threading.Thread(target=listen_for_quit, name="evaluation-quit-listener", daemon=True)
        listener.start()
    print("Evaluation is running. Enter q and press Enter, or press Ctrl+C, to stop gracefully.", flush=True)
    try:
        yield
    finally:
        stop_event.set()
        if can_handle_signals:
            signal.signal(signal.SIGINT, previous_sigint)


def progress_reporter(
    *,
    policy: str,
    device: str,
    interval: int = 20,
    clock: Callable[[], float] = time.monotonic,
) -> Callable[[Observation, int], None]:
    if interval < 1:
        raise ValueError("status_interval must be positive.")
    started_at = clock()
    last_report_at = started_at

    def report(observation: Observation, step_index: int) -> None:
        nonlocal last_report_at
        if step_index % interval != 0:
            return
        now = clock()
        elapsed = max(now - started_at, 1e-9)
        recent_elapsed = max(now - last_report_at, 1e-9)
        rate = interval / recent_elapsed if step_index > interval else step_index / elapsed
        last_report_at = now
        print(
            f"Running {policy} on {device} | step {step_index} | "
            f"simulation {observation.simulation_time:.2f}s | {rate:.1f} actions/s | "
            f"elapsed {elapsed:.1f}s",
            flush=True,
        )

    return report
