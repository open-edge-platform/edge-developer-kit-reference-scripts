# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import io
import json
import os
import argparse
import logging
import tempfile
import uuid
from typing import Optional
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("uvicorn.error")

CONFIG = {
    "port": 8026,
    "device": "cpu",
    "source": "huggingface",
}

DIARIZATION_PIPELINE = None
EMBEDDING_MODEL = None

SPEAKER_MATCH_THRESHOLD = 0.5

# ── Async job store ─────────────────────────────────────────────────
# Each job: {"status": "pending"|"completed"|"error", "result": ..., "error": ...}
_jobs: dict[str, dict] = {}
# Cap to prevent unbounded memory growth
_MAX_JOBS = 100
# Maximum number of jobs that may be queued/running at once.
# New submissions are rejected with 503 when this limit is reached.
_MAX_PENDING_JOBS = 20


def get_local_ffmpeg_path() -> str | None:
    """Return the path to the bundled ffmpeg binary, or None if not found."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    thirdparty_dir = os.path.join(project_root, "thirdparty")
    for name in ("ffmpeg.exe", "ffmpeg"):
        path = os.path.join(thirdparty_dir, "ffmpeg", "bin", name)
        if os.path.exists(path):
            return path
    return None


def get_local_ffprobe_path() -> str | None:
    """Return the path to the bundled ffprobe binary, or None if not found."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    thirdparty_dir = os.path.join(project_root, "thirdparty")
    for name in ("ffprobe.exe", "ffprobe"):
        path = os.path.join(thirdparty_dir, "ffmpeg", "bin", name)
        if os.path.exists(path):
            return path
    return None


def _load_audio_via_pydub(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """Decode audio bytes using pydub (requires ffmpeg for WebM/Opus/etc.)."""
    from pydub import AudioSegment
    import pydub.utils

    local_ffmpeg = get_local_ffmpeg_path()
    local_ffprobe = get_local_ffprobe_path()

    if local_ffmpeg:
        AudioSegment.converter = local_ffmpeg
    if local_ffprobe:
        pydub.utils.get_prober_name = lambda: local_ffprobe

    # Write to a temp file so ffmpeg can seek it
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        audio = AudioSegment.from_file(tmp_path)
        wav_io = io.BytesIO()
        audio.export(wav_io, format="wav")
        wav_io.seek(0)
        return sf.read(wav_io, dtype="float32", always_2d=False)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def load_audio_to_array(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """Load audio bytes into a numpy float32 array at the original sample rate.

    Tries soundfile first (fast path for WAV/FLAC/OGG). Falls back to
    pydub+ffmpeg for formats soundfile does not support, such as the
    WebM/Opus streams produced by the browser MediaRecorder API.
    """
    try:
        data, sample_rate = sf.read(
            io.BytesIO(audio_bytes), dtype="float32", always_2d=False
        )
    except Exception:
        logger.warning(
            "soundfile could not decode audio — retrying with pydub/ffmpeg fallback"
        )
        data, sample_rate = _load_audio_via_pydub(audio_bytes)
    if data.ndim > 1:
        data = data.mean(axis=1)
    return data, sample_rate


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def get_model_directory(source: str = "huggingface") -> str:
    """Resolve the project-local model cache directory for the given source."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    cache_dir = os.path.join(project_root, "models", source)
    os.makedirs(cache_dir, exist_ok=True)
    if source == "huggingface":
        os.environ["HF_HOME"] = cache_dir
    logger.info("Model cache directory (%s): %s", source, cache_dir)
    return cache_dir


EMBEDDING_MODEL_ID = "pyannote/embedding"
DIARIZATION_MODEL_ID = "pyannote/speaker-diarization-3.1"
# Sub-models referenced inside speaker-diarization-3.1/config.yaml
SEGMENTATION_MODEL_ID = "pyannote/segmentation-3.0"
WESPEAKER_MODEL_ID = "pyannote/wespeaker-voxceleb-resnet34-LM"
# PLDA model defaulted by pyannote.audio >=4.0 (not in config.yaml, injected at runtime)
COMMUNITY_MODEL_ID = "pyannote/speaker-diarization-community-1"

MODELSCOPE_DOMAIN = "www.modelscope.cn"


def download_from_modelscope(model_id: str, cache_dir: str) -> str:
    """Download a model repo from ModelScope and return the local path."""
    # Pin to the CN endpoint to avoid the multi-endpoint discovery returning 405
    os.environ.setdefault("MODELSCOPE_DOMAIN", MODELSCOPE_DOMAIN)
    from modelscope import snapshot_download as ms_snapshot_download

    local_dir = os.path.join(cache_dir, model_id.replace("/", os.sep))
    logger.info("Downloading %s from ModelScope to %s...", model_id, local_dir)
    path = ms_snapshot_download(repo_id=model_id, local_dir=local_dir)
    return path


def _build_pipeline_from_local(pipeline_dir: str, model_paths: dict):
    """Construct SpeakerDiarization from locally-downloaded model directories.

    Instead of patching config.yaml (which breaks on fresh downloads), we read
    it only for hyper-parameters and pass local paths directly to the pipeline
    constructor.  Both Model.from_pretrained and PLDA.from_pretrained natively
    support local directories.
    """
    import yaml
    from pyannote.audio.pipelines import SpeakerDiarization

    config_path = os.path.join(pipeline_dir, "config.yaml")
    with open(config_path) as f:
        config = yaml.safe_load(f)

    pipeline_params = config["pipeline"]["params"]
    pipeline = SpeakerDiarization(
        segmentation=model_paths["segmentation"],
        embedding=model_paths["embedding"],
        clustering=pipeline_params.get("clustering", "AgglomerativeClustering"),
        embedding_batch_size=pipeline_params.get("embedding_batch_size", 32),
        embedding_exclude_overlap=pipeline_params.get(
            "embedding_exclude_overlap", True
        ),
        segmentation_batch_size=pipeline_params.get("segmentation_batch_size", 32),
        plda={
            "checkpoint": model_paths["community"],
            "subfolder": "plda",
        },
    )
    pipeline.instantiate(config.get("params", {}))
    return pipeline


def initialize_models():
    """Load pyannote embedding model and diarization pipeline.

    Raises on any failure so the worker process exits during startup.
    """
    global DIARIZATION_PIPELINE, EMBEDDING_MODEL

    source = CONFIG.get("source", "huggingface")
    cache_dir = get_model_directory(source)

    if source == "huggingface":
        hf_token = os.environ.get("HF_TOKEN")
        if not hf_token:
            raise RuntimeError(
                "HF_TOKEN environment variable not set. "
                "pyannote models are gated and require a HuggingFace token "
                "with accepted license agreements. "
                "Set your token in Settings, then restart the service."
            )
        use_auth = {"token": hf_token}
        embedding_ref = EMBEDDING_MODEL_ID
        pipeline_ref = DIARIZATION_MODEL_ID
    else:
        use_auth = {}
        embedding_ref = download_from_modelscope(EMBEDDING_MODEL_ID, cache_dir)
        segmentation_ref = download_from_modelscope(SEGMENTATION_MODEL_ID, cache_dir)
        wespeaker_ref = download_from_modelscope(WESPEAKER_MODEL_ID, cache_dir)
        community_ref = download_from_modelscope(COMMUNITY_MODEL_ID, cache_dir)
        pipeline_ref = download_from_modelscope(DIARIZATION_MODEL_ID, cache_dir)

    # Deferred import: HF_HOME must be set before huggingface_hub is imported
    from pyannote.audio import Pipeline, Model, Inference

    logger.info(
        "Loading speaker embedding model (%s) from %s...", EMBEDDING_MODEL_ID, source
    )
    embedding_model = Model.from_pretrained(embedding_ref, **use_auth)

    device_str = CONFIG.get("device", "cpu").lower()
    if device_str.startswith("xpu"):
        if not torch.xpu.is_available():
            raise RuntimeError(
                "Device '%s' was requested but no XPU device is available. "
                "Ensure intel_extension_for_pytorch is installed and an Intel XPU "
                "device is present, or switch to a supported device." % device_str
            )
        embedding_model = embedding_model.to(device_str)
        logger.info("Using Intel XPU device '%s' for embedding model.", device_str)

    EMBEDDING_MODEL = Inference(embedding_model, window="whole")

    logger.info(
        "Loading diarization pipeline (%s) from %s...", DIARIZATION_MODEL_ID, source
    )
    if source == "huggingface":
        DIARIZATION_PIPELINE = Pipeline.from_pretrained(pipeline_ref, **use_auth)
    else:
        DIARIZATION_PIPELINE = _build_pipeline_from_local(
            pipeline_ref,
            {
                "segmentation": segmentation_ref,
                "embedding": wespeaker_ref,
                "community": community_ref,
            },
        )
    logger.info("Diarization models loaded successfully.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing diarization worker...")
    initialize_models()
    yield
    logger.info("Shutting down diarization worker.")


allowed_cors = json.loads(os.getenv("ALLOWED_CORS", '["http://localhost"]'))
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthcheck")
def get_healthcheck():
    return "OK"


def _compute_embedding(audio_bytes: bytes) -> dict:
    """CPU-bound embedding inference (runs in thread pool)."""
    audio_array, sample_rate = load_audio_to_array(audio_bytes)
    waveform = torch.tensor(audio_array).unsqueeze(0)
    embedding = EMBEDDING_MODEL({"waveform": waveform, "sample_rate": sample_rate})
    embedding = np.array(embedding, dtype=np.float32).flatten()
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm
    return {"embedding": embedding.tolist()}


@app.post("/v1/embedding")
async def create_embedding(
    file: UploadFile = File(...),
):
    """Generate a normalized speaker embedding vector from an audio file."""
    if EMBEDDING_MODEL is None:
        raise HTTPException(
            status_code=503,
            detail="Embedding model not loaded.",
        )

    try:
        audio_bytes = await file.read()
        max_audio_size = 100 * 1024 * 1024  # 100 MB
        if len(audio_bytes) > max_audio_size:
            raise HTTPException(status_code=413, detail="File too large (max 100 MB)")
        return await asyncio.to_thread(_compute_embedding, audio_bytes)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error generating embedding: %s", e)
        raise HTTPException(
            status_code=500, detail="Failed to generate embedding"
        ) from e


def _evict_oldest_jobs() -> None:
    """Remove oldest completed/error jobs when the store exceeds _MAX_JOBS."""
    if len(_jobs) <= _MAX_JOBS:
        return
    removable = [jid for jid, j in _jobs.items() if j["status"] != "pending"]
    for jid in removable[: len(_jobs) - _MAX_JOBS]:
        _jobs.pop(jid, None)


def _pending_job_count() -> int:
    return sum(1 for j in _jobs.values() if j["status"] == "pending")


async def _run_diarization_job(
    job_id: str,
    audio_bytes: bytes,
    reference_embedding: Optional[str],
    reference_label: str,
    other_label: str,
    speaker_profiles: Optional[str],
    unknown_label: str,
    num_speakers: Optional[int],
    speaker_match_threshold: Optional[float] = None,
) -> None:
    """Background task that runs diarization and stores the result."""
    try:
        result = await asyncio.to_thread(
            _compute_diarization,
            audio_bytes,
            reference_embedding,
            reference_label,
            other_label,
            speaker_profiles,
            unknown_label,
            num_speakers,
            speaker_match_threshold,
        )
        _jobs[job_id] = {"status": "completed", "result": result}
    except Exception as e:
        logger.error("Diarization job %s failed: %s", job_id, e)
        _jobs[job_id] = {"status": "error", "error": str(e)}


@app.post("/v1/diarize")
async def diarize_audio(
    file: UploadFile = File(...),
    reference_embedding: Optional[str] = Form(None),
    reference_label: str = Form("Reference"),
    other_label: str = Form("Other"),
    speaker_profiles: Optional[str] = Form(None),
    unknown_label: str = Form("Unknown"),
    num_speakers: Optional[int] = Form(None),
    speaker_match_threshold: Optional[float] = Form(None),
):
    """Submit an async diarization job.

    Returns a job ID immediately.  Poll ``GET /v1/diarize/{job_id}``
    to retrieve the status and results.

    Supports two modes for speaker identification:

    **Multi-speaker mode** (preferred): Pass ``speaker_profiles`` as a
    JSON-encoded array of ``{"label": str, "embedding": list[float]}``
    objects.  Each detected speaker is matched to the closest profile
    above the similarity threshold; unmatched speakers are labelled
    with ``unknown_label``.

    **Legacy single-speaker mode**: Pass ``reference_embedding`` (a
    JSON-encoded list of floats) together with ``reference_label`` and
    ``other_label``.

    Returns:
        {"job_id": str}
    """
    if DIARIZATION_PIPELINE is None:
        raise HTTPException(
            status_code=503,
            detail="Diarization pipeline not loaded.",
        )

    audio_bytes = await file.read()
    max_audio_size = 100 * 1024 * 1024  # 100 MB
    if len(audio_bytes) > max_audio_size:
        raise HTTPException(status_code=413, detail="File too large (max 100 MB)")

    _evict_oldest_jobs()
    if _pending_job_count() >= _MAX_PENDING_JOBS:
        raise HTTPException(
            status_code=503,
            detail="Server busy: too many pending jobs. Try again later.",
        )

    job_id = uuid.uuid4().hex
    _jobs[job_id] = {"status": "pending"}

    asyncio.create_task(
        _run_diarization_job(
            job_id,
            audio_bytes,
            reference_embedding,
            reference_label,
            other_label,
            speaker_profiles,
            unknown_label,
            num_speakers,
            speaker_match_threshold,
        )
    )

    return {"job_id": job_id}


@app.get("/v1/diarize/{job_id}")
async def get_diarize_status(job_id: str):
    """Check the status of an async diarization job.

    Returns:
        - ``{"status": "pending"}`` while processing
        - ``{"status": "completed", "result": {"segments": [...]}}`` on success
        - ``{"status": "error", "error": "..."}`` on failure
    """
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return _jobs[job_id]


def _compute_diarization(
    audio_bytes: bytes,
    reference_embedding: Optional[str],
    reference_label: str,
    other_label: str,
    speaker_profiles: Optional[str],
    unknown_label: str,
    num_speakers: Optional[int],
    speaker_match_threshold: Optional[float] = None,
) -> dict:
    """CPU-bound diarization inference (runs in thread pool)."""
    threshold = (
        speaker_match_threshold
        if speaker_match_threshold is not None
        else SPEAKER_MATCH_THRESHOLD
    )
    audio_array, sample_rate = load_audio_to_array(audio_bytes)

    waveform = torch.tensor(audio_array).unsqueeze(0)
    audio_input = {"waveform": waveform, "sample_rate": sample_rate}

    diarize_kwargs = {}
    if num_speakers is not None:
        diarize_kwargs["num_speakers"] = num_speakers

    diarization = DIARIZATION_PIPELINE(audio_input, **diarize_kwargs)
    if hasattr(diarization, "speaker_diarization"):
        diarization = diarization.speaker_diarization

    # Determine whether we need per-segment embeddings for speaker matching
    has_profiles = speaker_profiles is not None
    has_legacy_ref = reference_embedding is not None
    need_embeddings = (has_profiles or has_legacy_ref) and EMBEDDING_MODEL is not None

    # Collect segments and per-speaker embeddings
    segments = []
    speaker_embeddings: dict[str, list[np.ndarray]] = {}

    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append(
            {
                "speaker_id": speaker,
                "start": round(turn.start, 3),
                "end": round(turn.end, 3),
            }
        )
        if need_embeddings:
            chunk_array = audio_array[
                int(turn.start * sample_rate) : int(turn.end * sample_rate)
            ]
            if len(chunk_array) > sample_rate * 0.5:
                chunk_waveform = torch.tensor(chunk_array).unsqueeze(0)
                emb = EMBEDDING_MODEL(
                    {"waveform": chunk_waveform, "sample_rate": sample_rate}
                )
                emb = np.array(emb, dtype=np.float32).flatten()
                norm = np.linalg.norm(emb)
                if norm > 0:
                    emb = emb / norm
                speaker_embeddings.setdefault(speaker, []).append(emb)

    # ── Multi-speaker profile matching (preferred path) ─────────────────
    if has_profiles and speaker_embeddings:
        try:
            profiles = json.loads(speaker_profiles)
        except json.JSONDecodeError as exc:
            raise ValueError("speaker_profiles is not valid JSON") from exc
        if not isinstance(profiles, list) or len(profiles) > 50:
            raise ValueError("speaker_profiles must be an array of at most 50 entries")

        # Build normalised reference embeddings
        ref_entries: list[tuple[str, np.ndarray]] = []
        for p in profiles:
            if not isinstance(p, dict) or "label" not in p or "embedding" not in p:
                raise ValueError("Each profile must have 'label' and 'embedding' keys")
            if not isinstance(p["embedding"], list) or not all(
                isinstance(x, (int, float)) for x in p["embedding"]
            ):
                raise ValueError("Embedding must be a list of numbers")
            emb = np.array(p["embedding"], dtype=np.float32)
            norm = np.linalg.norm(emb)
            if norm > 0:
                emb = emb / norm
            ref_entries.append((p["label"], emb))

        # Average embedding per detected speaker
        avg_embeddings: dict[str, np.ndarray] = {}
        for spk_id, embs in speaker_embeddings.items():
            avg_embeddings[spk_id] = np.mean(embs, axis=0)
            logger.debug(
                "Speaker %s: %d embedding chunks collected, avg norm=%.4f",
                spk_id,
                len(embs),
                float(np.linalg.norm(avg_embeddings[spk_id])),
            )

        # Greedy 1-to-1 assignment: best match first, no duplicate labels
        assigned_labels: dict[str, str] = {}
        used_profiles: set[int] = set()
        used_speakers: set[str] = set()

        # Build all (similarity, speaker_id, profile_idx) pairs
        candidates = []
        for spk_id, avg_emb in avg_embeddings.items():
            for pi, (plabel, pemb) in enumerate(ref_entries):
                sim = cosine_similarity(avg_emb, pemb)
                logger.debug(
                    "Speaker matching: %s vs profile '%s' => similarity %.4f (threshold %.2f)",
                    spk_id,
                    plabel,
                    sim,
                    threshold,
                )
                candidates.append((sim, spk_id, pi, plabel))
        candidates.sort(key=lambda x: x[0], reverse=True)

        for sim, spk_id, pi, plabel in candidates:
            if spk_id in used_speakers or pi in used_profiles:
                continue
            if sim >= threshold:
                assigned_labels[spk_id] = plabel
                used_speakers.add(spk_id)
                used_profiles.add(pi)

        all_spk_ids = {seg["speaker_id"] for seg in segments}
        speaker_map = {
            sid: assigned_labels.get(sid, unknown_label) for sid in all_spk_ids
        }

    # ── Legacy single-reference matching ────────────────────────────────
    elif has_legacy_ref and speaker_embeddings:
        try:
            ref_data = json.loads(reference_embedding)
        except json.JSONDecodeError as exc:
            raise ValueError("reference_embedding is not valid JSON") from exc
        if not isinstance(ref_data, list) or not all(
            isinstance(x, (int, float)) for x in ref_data
        ):
            raise ValueError("reference_embedding must be a list of numbers")
        ref_emb = np.array(ref_data, dtype=np.float32)
        ref_norm = np.linalg.norm(ref_emb)
        if ref_norm > 0:
            ref_emb = ref_emb / ref_norm

        best_ref_speaker = None
        best_similarity = -1.0

        for spk_id, embs in speaker_embeddings.items():
            avg_emb = np.mean(embs, axis=0)
            sim = cosine_similarity(avg_emb, ref_emb)
            if sim > best_similarity:
                best_similarity = sim
                best_ref_speaker = spk_id

        speaker_role: dict[str, str] = {}
        for spk_id in speaker_embeddings:
            if spk_id == best_ref_speaker and best_similarity >= threshold:
                speaker_role[spk_id] = reference_label
            else:
                speaker_role[spk_id] = other_label

        speaker_map = speaker_role

    # ── No references — use raw speaker IDs ─────────────────────────────
    else:
        speaker_map = {}

    # Apply speaker labels, merge consecutive same-speaker segments, strip internal IDs
    merged = []
    for seg in segments:
        spk_id = seg.pop("speaker_id")
        seg["speaker"] = speaker_map.get(spk_id, spk_id)
        if merged and merged[-1]["speaker"] == seg["speaker"]:
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(seg)

    return {"segments": merged}


def parse_args():
    parser = argparse.ArgumentParser(description="Diarization Worker")
    parser.add_argument(
        "--port",
        type=int,
        default=8026,
        help="Port for the worker to listen on",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        help="Device to run models on (e.g. cpu, xpu, xpu:0, xpu:1)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="huggingface",
        choices=["huggingface", "modelscope"],
        help="Model source repository",
    )
    return parser.parse_args()


def main():
    global CONFIG

    args = parse_args()
    CONFIG["port"] = args.port
    CONFIG["device"] = args.device.lower()
    CONFIG["source"] = args.source

    uvicorn.run(
        app,
        host=os.environ.get("SERVER_HOST", "127.0.0.1"),
        port=int(os.environ.get("SERVER_PORT", args.port)),
    )


if __name__ == "__main__":
    main()
