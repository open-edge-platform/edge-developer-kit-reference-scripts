# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Model resolution, download, and pipeline initialization."""

import logging
import os

import torch

from modules.audio import _project_root

logger = logging.getLogger("uvicorn.error")

DIARIZATION_MODEL_ID = "pyannote/speaker-diarization-community-1"

MODELSCOPE_DOMAIN = "www.modelscope.cn"


def get_model_directory(source: str = "huggingface") -> str:
    """Resolve the project-local model cache directory for this worker."""
    cache_dir = os.path.join(_project_root(), "models", "diarization")
    os.makedirs(cache_dir, exist_ok=True)
    if source == "huggingface":
        os.environ["HF_HOME"] = cache_dir
    logger.info("Model cache directory (%s): %s", source, cache_dir)
    return cache_dir


def download_from_modelscope(model_id: str, cache_dir: str) -> str:
    """Download a model repo from ModelScope and return the local path."""
    # Pin to the CN endpoint to avoid the multi-endpoint discovery returning 405
    os.environ.setdefault("MODELSCOPE_DOMAIN", MODELSCOPE_DOMAIN)
    from modelscope import snapshot_download as ms_snapshot_download

    local_dir = os.path.join(cache_dir, model_id.replace("/", os.sep))
    logger.info("Downloading %s from ModelScope to %s...", model_id, local_dir)
    return ms_snapshot_download(repo_id=model_id, local_dir=local_dir)


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
        pipeline_ref = DIARIZATION_MODEL_ID
    else:
        use_auth = {}
        pipeline_ref = download_from_modelscope(DIARIZATION_MODEL_ID, cache_dir)

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
