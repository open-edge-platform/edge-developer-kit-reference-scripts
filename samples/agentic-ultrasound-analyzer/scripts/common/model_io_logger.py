# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Model I/O Logger — captures inputs and outputs of all models in the pipeline.

Enabled automatically when admin config logging is set to "verbose".
Logs are written to reports/model_io_<run_id>.jsonl (one JSON line per model call).

Also generates a NotebookLM-friendly summary at reports/model_io_<run_id>_notebook.txt
after each complete workflow run.
"""

import os
import json
import time
import datetime
import threading
from contextvars import ContextVar

from common.config import config

_LOG_DIR = os.path.join(os.getcwd(), "reports")
_lock = threading.RLock()

_current_run = ContextVar("model_io_run", default=None)


def is_enabled():
    return config.logging_level == "verbose"


def start_run(run_id: str, workflow: str = "analyze"):
    """Start a new model I/O logging run."""
    if not is_enabled():
        _current_run.set(None)
        return
    with _lock:
        _current_run.set((run_id, []))
        _log_entry({
            "event": "run_start",
            "run_id": run_id,
            "workflow": workflow,
        })


def log_model_io(model: str, input_data: dict, output_data: dict, latency_ms: float = 0):
    """Log a single model invocation's input and output."""
    if not is_enabled():
        return
    entry = {
        "event": "model_call",
        "model": model,
        "input": input_data,
        "output": output_data,
        "latency_ms": round(latency_ms, 1),
    }
    _log_entry(entry)


def end_run():
    """End the current run and write the NotebookLM summary file."""
    try:
        if not is_enabled():
            return
        run = _current_run.get()
        if run is None:
            return
        with _lock:
            _log_entry({"event": "run_end", "run_id": run[0]})
            _write_notebook_summary()
    finally:
        _current_run.set(None)


def _log_entry(entry: dict):
    """Append a JSON line to the run log file."""
    entry["timestamp"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    with _lock:
        run = _current_run.get()
        run_id = run[0] if run is not None else None
        if run_id:
            run[1].append(entry)
        log_path = os.path.join(_LOG_DIR, f"model_io_{run_id or 'unknown'}.jsonl")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _write_notebook_summary():
    """Generate a NotebookLM-friendly plain text file summarizing the workflow."""
    run = _current_run.get()
    if run is None:
        return
    run_id, entries = run
    if not run_id or not entries:
        return

    summary_path = os.path.join(_LOG_DIR, f"model_io_{run_id}_notebook.txt")
    model_calls = [e for e in entries if e.get("event") == "model_call"]

    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("=" * 80 + "\n")
        f.write("ULTRASOUND AGENTIC WORKFLOW — MODEL INPUT/OUTPUT TRACE\n")
        f.write(f"Run ID: {run_id}\n")
        f.write(f"Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("=" * 80 + "\n\n")

        f.write("PIPELINE OVERVIEW\n")
        f.write("-" * 40 + "\n")
        f.write("Image → FetalCLIP (classify) → EchoVLM (analyze) → Qwen2.5 (report) → PDF\n")
        f.write("       └─ if fetal: enriched prompt with anatomical plane context\n")
        f.write("       └─ if non-fetal: generic analysis prompt\n\n")

        for i, call in enumerate(model_calls, 1):
            model = call["model"]
            latency = call["latency_ms"]
            f.write("─" * 80 + "\n")
            f.write(f"STEP {i}: {model} ({latency:.0f} ms)\n")
            f.write("─" * 80 + "\n\n")

            f.write("INPUT:\n")
            inp = call["input"]
            if model == "EchoVLM_V2":
                # Format the messages nicely
                messages = inp.get("messages", [])
                for msg in messages:
                    role = msg.get("role", "unknown")
                    content = msg.get("content", "")
                    if isinstance(content, list):
                        text_parts = [p["text"] for p in content if p.get("type") == "text"]
                        has_image = any(p.get("type") == "image_url" for p in content)
                        f.write(f"  [{role}]: {chr(10).join(text_parts)}\n")
                        if has_image:
                            img_ref = inp.get("image_ref", "<base64 image>")
                            f.write(f"  [image]: {img_ref}\n")
                    else:
                        f.write(f"  [{role}]: {content}\n")
            else:
                for key, val in inp.items():
                    val_str = str(val)
                    if len(val_str) > 500:
                        val_str = val_str[:500] + "..."
                    f.write(f"  {key}: {val_str}\n")

            f.write("\nOUTPUT:\n")
            out = call["output"]
            for key, val in out.items():
                val_str = str(val)
                if len(val_str) > 1000:
                    val_str = val_str[:1000] + "..."
                f.write(f"  {key}: {val_str}\n")
            f.write("\n")

        # Summary table
        f.write("\n" + "=" * 80 + "\n")
        f.write("TIMING SUMMARY\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"{'Model':<25} {'Latency (ms)':>12}\n")
        f.write("-" * 40 + "\n")
        total_ms = 0
        for call in model_calls:
            f.write(f"{call['model']:<25} {call['latency_ms']:>12.0f}\n")
            total_ms += call["latency_ms"]
        f.write("-" * 40 + "\n")
        f.write(f"{'TOTAL':<25} {total_ms:>12.0f}\n")
