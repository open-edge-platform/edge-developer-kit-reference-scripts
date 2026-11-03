# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Model resolution, download, and pipeline initialization."""

import logging
import os
from pathlib import Path

import torch
from model_downloader import fetch_snapshot

from worker_common import project_root, use_shared_hf_cache

logger = logging.getLogger("uvicorn.error")

DIARIZATION_MODEL_ID = "pyannote/speaker-diarization-community-1"

MODELSCOPE_DOMAIN = "www.modelscope.cn"


def get_model_directory(source: str = "huggingface") -> str:
    """Resolve the project-local model cache directory for this worker."""
    cache_dir = os.path.join(str(project_root()), "models", "diarization")
    if source == "huggingface":
        # Hub downloads go to the shared cache; a legacy hub in this folder moves there first
        # (before makedirs, since an emptied folder is removed).
        moved = use_shared_hf_cache(Path(cache_dir))
        if moved:
            logger.info(moved)
    os.makedirs(cache_dir, exist_ok=True)
    logger.info("Model cache directory (%s): %s", source, cache_dir)
    return cache_dir


def download_pipeline(
    model_id: str, cache_dir: str, source: str, token: str | None = None
) -> str:
    """Mirror the pipeline repo from ``source`` into the cache (idempotent); returns its path."""
    # Pin to the CN endpoint to avoid the multi-endpoint discovery returning 405
    os.environ.setdefault("MODELSCOPE_DOMAIN", MODELSCOPE_DOMAIN)
    local_dir = os.path.join(cache_dir, model_id.replace("/", os.sep))
    logger.info("Downloading %s from %s to %s...", model_id, source, local_dir)
    return str(fetch_snapshot(model_id, local_dir, source=source, token=token))


def initialize_pipeline(device: str, source: str):
    """Load and return the pyannote speaker diarization pipeline.

    Raises on any failure so the worker process exits during startup.
    """
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
        pipeline_ref = download_pipeline(
            DIARIZATION_MODEL_ID, cache_dir, source, token=hf_token
        )
    else:
        use_auth = {}
        pipeline_ref = download_pipeline(DIARIZATION_MODEL_ID, cache_dir, source)

    # Deferred import: HF_HOME must be set before huggingface_hub is imported
    from pyannote.audio import Pipeline

    device_str = device.lower()
    use_xpu = device_str.startswith("xpu")
    if use_xpu and not torch.xpu.is_available():
        raise RuntimeError(
            "Device '%s' was requested but no XPU device is available. "
            "Ensure intel_extension_for_pytorch is installed and an Intel XPU "
            "device is present, or switch to a supported device." % device_str
        )

    logger.info(
        "Loading diarization pipeline (%s) from %s...", DIARIZATION_MODEL_ID, source
    )
    pipeline = Pipeline.from_pretrained(pipeline_ref, **use_auth)

    if use_xpu:
        pipeline.to(torch.device(device_str))
        logger.info("Using Intel XPU device '%s' for diarization pipeline.", device_str)

    logger.info("Diarization pipeline loaded successfully.")
    return pipeline
