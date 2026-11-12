# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Qwen3-ForcedAligner worker process.

Runs under the Qwen3-ASR conversion environment
(`workers/common/ovms-export-qwen3-asr`, provisioned by start.sh / start.ps1)
— NOT the worker's own venv, which has no torch/transformers/optimum-intel.
Communicates with the parent (main.py) over stdin/stdout using one JSON object
per line:

Parent -> child (stdin):
    {"transcript": str, "language": str, "wav_path": str}

Child -> parent (stdout):
    On startup, once the model is loaded:   {"ready": true}
    Per request, on success:                {"words": [{"start": float, "end": float, "text": str}, ...]}
    Per request, on failure:                {"error": str}

stdout is reserved exclusively for this protocol. Everything else (model
export progress, library logs, our own diagnostics) is sent to stderr, which
the parent inherits straight into the worker's log stream.
"""

import argparse
import importlib.util
import json
import os
import sys
import wave
from pathlib import Path

import numpy as np

import torch
from transformers import AutoProcessor
from optimum.intel import OVModelForQwen3ASRForcedAligner

# Redirect stdout to stderr immediately, before importing anything that might
# print to stdout on its own (huggingface_hub, transformers, etc.), and keep a
# separate raw handle for the actual protocol messages.
_protocol_stdout = os.fdopen(os.dup(sys.stdout.fileno()), "w", buffering=1)
sys.stdout = sys.stderr

MODEL_ID = "Qwen/Qwen3-ForcedAligner-0.6B-hf"


def _model_dir() -> Path:
    """`models/stt/forced-aligner/<MODEL_ID>`, resolved with worker_common's paths.py.

    Loaded by file path: this environment does not have worker_common installed.
    """
    for parent in Path(__file__).resolve().parents:
        if (parent / "scripts" / "worker-common.sh").is_file():
            candidate = parent / "common" / "worker_common" / "paths.py"
            spec = importlib.util.spec_from_file_location("worker_common_paths", candidate)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module.models_dir("stt", "forced-aligner", *MODEL_ID.split("/"))
    raise RuntimeError("workers root (scripts/worker-common.sh) not found above aligner_proc.py")


def _send(payload: dict) -> None:
    _protocol_stdout.write(json.dumps(payload) + "\n")
    _protocol_stdout.flush()


def _load_wav_mono16k(wav_path: str) -> np.ndarray:
    """Load a 16kHz mono 16-bit PCM WAV as a float32 array in [-1, 1].

    `main.py` always converts uploads via `_convert_to_wav()` (see
    modules/audio.py) before invoking the aligner, so the file is guaranteed to already be 16kHz
    mono 16-bit PCM. This avoids pulling in librosa (and its heavy transitive
    deps) into the Qwen3-ASR environment just to decode/resample audio.
    """
    with wave.open(wav_path, "rb") as wf:
        if wf.getframerate() != 16000 or wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise ValueError(
                f"Expected 16kHz mono 16-bit PCM WAV, got "
                f"{wf.getframerate()}Hz, {wf.getnchannels()}ch, "
                f"{wf.getsampwidth() * 8}-bit: {wav_path}"
            )
        raw = wf.readframes(wf.getnframes())
    pcm = np.frombuffer(raw, dtype=np.int16)
    return (pcm.astype(np.float32) / 32768.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Qwen3-ForcedAligner worker process")
    parser.add_argument("--device", type=str, default="CPU")
    args = parser.parse_args()

    model_dir = str(_model_dir())

    if not os.path.isdir(model_dir):
        print(f"Exporting forced aligner {MODEL_ID} to {model_dir} ...")
        os.makedirs(os.path.dirname(model_dir), exist_ok=True)
        aligner_model = OVModelForQwen3ASRForcedAligner.from_pretrained(
            MODEL_ID, export=True
        )
        aligner_model.save_pretrained(model_dir)
        del aligner_model
        print(f"Forced aligner exported to {model_dir}")
    else:
        print(f"Forced aligner already exported at {model_dir}")

    print("Loading forced aligner processor and model ...")
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = OVModelForQwen3ASRForcedAligner.from_pretrained(
        model_dir, device=args.device
    )
    print("Forced aligner ready.")
    _send({"ready": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            transcript = request["transcript"]
            language = request.get("language") or "English"
            wav_path = request["wav_path"]

            audio = _load_wav_mono16k(wav_path)

            aligner_inputs, word_lists = processor.prepare_forced_aligner_inputs(
                audio=audio,
                transcript=transcript,
                language=language,
            )
            aligner_inputs = aligner_inputs.to(model.device)

            with torch.inference_mode():
                outputs = model(**aligner_inputs)

            aligned = processor.decode_forced_alignment(
                logits=outputs.logits,
                input_ids=aligner_inputs["input_ids"],
                word_lists=word_lists,
                timestamp_token_id=model.config.timestamp_token_id,
            )[0]

            words = [
                {
                    "start": float(item["start_time"]),
                    "end": float(item["end_time"]),
                    "text": str(item["text"]),
                }
                for item in aligned
            ]
            _send({"words": words})
        except Exception as e:  # noqa: BLE001 - report any failure to the parent
            print(f"Forced alignment request failed: {e}")
            _send({"error": str(e)})


if __name__ == "__main__":
    main()
