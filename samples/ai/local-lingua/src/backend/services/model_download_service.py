"""Model download service — downloads and exports models from HuggingFace.

Handles the first-use model download flow:
1. Downloads model weights from HuggingFace Hub
2. Exports to OpenVINO IR format (or just downloads if pre-quantized)
3. Saves tokenizer/processor alongside the model

Pre-quantized models (like OpenVINO/whisper-base-int8-ov and
tngtech/Kokoro-82M-int8-ov) are downloaded directly without export.

Tokens are accepted per-request and never persisted.
"""

import logging
from pathlib import Path
from typing import Any, Dict, Optional

import yaml

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parents[3]
CONFIG_PATH = ROOT_DIR / "config.yaml"

STAGE_TO_CONFIG_KEY = {
    "transcription": "whisper",
    "audio_to_text": "whisper",
    "translation": "translator",
    "sentiment": "sentiment",
    "text_to_speech": "tts",
    "voice_emotion": "voice_emotion",
    "mission_cue_llm": "mission_cue_llm",
}


def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _find_model_config(model_id: str, stage: str) -> Optional[Dict[str, Any]]:
    """Find the model config entry (active or alternative) for the given model_id."""
    config = _load_config()
    config_key = STAGE_TO_CONFIG_KEY.get(stage)
    if not config_key:
        return None

    models_cfg = config.get("models", {}).get(config_key, {})

    # Check if it's the active model
    active_name = models_cfg.get("name", "")
    if active_name.endswith(model_id) or model_id in active_name:
        return {
            "name": active_name,
            "export_dir": models_cfg.get("export_dir", ""),
            "config_key": config_key,
            "pre_quantized": models_cfg.get("pre_quantized", False),
        }

    # Check alternatives
    for alt in models_cfg.get("alternatives", []):
        alt_name = alt.get("name", "")
        if alt_name.endswith(model_id) or model_id in alt_name:
            return {
                "name": alt_name,
                "export_dir": alt.get("export_dir", ""),
                "config_key": config_key,
                "pre_quantized": alt.get("pre_quantized", False),
            }

    # Check TTS language models (in alternatives that have them)
    for alt in models_cfg.get("alternatives", []):
        for lang_model in alt.get("language_models", []):
            lang_name = lang_model.get("name", "")
            if lang_name.endswith(model_id) or model_id in lang_name:
                return {
                    "name": lang_name,
                    "export_dir": lang_model.get("export_dir", ""),
                    "config_key": config_key,
                    "is_tts_lang": True,
                }

    return None


def download_and_export_model(
    model_id: str,
    stage: str,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """Download a model from HuggingFace and export it to OpenVINO IR format.

    For pre-quantized models (pre_quantized: true in config), downloads the
    entire repo without running export. For standard models, downloads and
    converts to OpenVINO IR.

    Args:
        model_id: Short model ID (e.g. "whisper-base-int8-ov", "Kokoro-82M-int8-ov")
        stage: Pipeline stage name
        token: Optional HuggingFace access token (never stored)

    Returns:
        Dict with export path and status
    """
    model_cfg = _find_model_config(model_id, stage)
    if not model_cfg:
        raise ValueError(f"Model '{model_id}' not found in config for stage '{stage}'")

    hf_model_name = model_cfg["name"]
    export_dir = ROOT_DIR / model_cfg["export_dir"]
    config_key = model_cfg["config_key"]
    pre_quantized = model_cfg.get("pre_quantized", False)

    # Check if already downloaded/exported (local dir or HF cache)
    if _is_exported(export_dir, hf_model_name):
        logger.info("Model '%s' already available at %s", model_id, export_dir)
        return {"exportDir": str(export_dir), "alreadyExported": True}

    export_dir.mkdir(parents=True, exist_ok=True)

    # Set token for huggingface_hub if provided
    hf_kwargs = {}
    if token:
        hf_kwargs["token"] = token

    # Pre-quantized models: download directly from HuggingFace Hub
    if pre_quantized:
        logger.info("Downloading pre-quantized model '%s' to %s", hf_model_name, export_dir)
        _download_pretrained(hf_model_name, export_dir, hf_kwargs)
        return {"exportDir": str(export_dir), "alreadyExported": False}

    logger.info("Downloading and exporting '%s' to %s", hf_model_name, export_dir)

    if config_key == "whisper":
        _export_whisper(hf_model_name, export_dir, hf_kwargs)
    elif config_key == "translator":
        _export_translator(hf_model_name, export_dir, hf_kwargs)
    elif config_key == "sentiment":
        _export_sentiment(hf_model_name, export_dir, hf_kwargs)
    elif config_key == "tts":
        _export_tts(hf_model_name, export_dir, hf_kwargs)
    elif config_key == "voice_emotion":
        _export_voice_emotion(hf_model_name, export_dir, hf_kwargs)
    else:
        raise ValueError(f"Unknown config key: {config_key}")

    return {"exportDir": str(export_dir), "alreadyExported": False}


def download_and_export_model_streaming(
    model_id: str,
    stage: str,
    token: Optional[str] = None,
    progress_callback=None,
) -> Dict[str, Any]:
    """Download and export with progress callbacks for SSE streaming.

    progress_callback(percent: int, message: str) is called during download.
    Uses huggingface_hub's tqdm override for real progress on large downloads.
    """
    if progress_callback is None:
        progress_callback = lambda p, m: None

    model_cfg = _find_model_config(model_id, stage)
    if not model_cfg:
        raise ValueError(f"Model '{model_id}' not found in config for stage '{stage}'")

    hf_model_name = model_cfg["name"]
    export_dir = ROOT_DIR / model_cfg["export_dir"]
    config_key = model_cfg["config_key"]
    pre_quantized = model_cfg.get("pre_quantized", False)

    if _is_exported(export_dir, hf_model_name):
        progress_callback(100, "Already downloaded")
        return {"exportDir": str(export_dir), "alreadyExported": True}

    export_dir.mkdir(parents=True, exist_ok=True)

    hf_kwargs = {}
    if token:
        hf_kwargs["token"] = token

    progress_callback(5, "Starting download...")

    if pre_quantized:
        progress_callback(10, "Downloading model files...")
        _download_pretrained_with_progress(hf_model_name, export_dir, hf_kwargs, progress_callback)
        return {"exportDir": str(export_dir), "alreadyExported": False}

    progress_callback(10, "Downloading model weights...")

    if config_key == "whisper":
        progress_callback(15, "Downloading Whisper model...")
        _export_whisper(hf_model_name, export_dir, hf_kwargs)
    elif config_key == "translator":
        _export_translator_with_progress(hf_model_name, export_dir, hf_kwargs, progress_callback)
    elif config_key == "sentiment":
        if "tiny-aya" in hf_model_name.lower():
            _export_tiny_aya(export_dir, hf_kwargs, progress_callback)
        else:
            _export_generic_with_progress(hf_model_name, export_dir, hf_kwargs, progress_callback, "sentiment")
    elif config_key == "tts":
        progress_callback(15, "Downloading TTS model...")
        _export_tts(hf_model_name, export_dir, hf_kwargs)
    elif config_key == "voice_emotion":
        _export_generic_with_progress(
            hf_model_name, export_dir, hf_kwargs, progress_callback, "voice emotion",
            is_audio=True,
        )
    else:
        raise ValueError(f"Unknown config key: {config_key}")

    progress_callback(95, "Finalizing...")
    return {"exportDir": str(export_dir), "alreadyExported": False}


_AUDEERING_HEAD_KEYS = {
    "dense_weight": "classifier.dense.weight",
    "dense_bias": "classifier.dense.bias",
    "out_proj_weight": "classifier.out_proj.weight",
    "out_proj_bias": "classifier.out_proj.bias",
}


def _save_audeering_head(weights_dir: Path, export_dir: Path) -> None:
    """Save the audeering regression head alongside the OV model.

    AutoModel loads only the base wav2vec2, so the head that turns pooled hidden
    states into arousal/dominance/valence never makes it into the OV graph and has
    to be carried separately. Without it the runtime has no regression layer at all,
    so a missing head is raised rather than warned about — a silently headless
    export produces confident nonsense.

    Read from the already-downloaded snapshot, so this needs no extra network.
    """
    import numpy as np

    state = None
    safetensors_path = weights_dir / "model.safetensors"
    bin_path = weights_dir / "pytorch_model.bin"
    if safetensors_path.exists():
        import safetensors.torch
        state = safetensors.torch.load_file(str(safetensors_path))
    elif bin_path.exists():
        import torch
        state = torch.load(str(bin_path), map_location="cpu")

    if state is None:
        raise RuntimeError(f"No weights file in {weights_dir} to extract the head from")

    missing = [k for k in _AUDEERING_HEAD_KEYS.values() if k not in state]
    if missing:
        raise RuntimeError(f"Regression head keys missing from checkpoint: {missing}")

    head = {k: state[v].float().cpu().numpy() for k, v in _AUDEERING_HEAD_KEYS.items()}
    np.savez(str(export_dir / "classifier_head.npz"), **head)
    logger.info("Saved regression head to %s", export_dir / "classifier_head.npz")


def _export_generic_with_progress(
    model_name: str, export_dir: Path, hf_kwargs: dict, progress_callback, label: str,
    is_audio: bool = False,
):
    """Download and export smaller classification models with progress."""
    from huggingface_hub import snapshot_download
    import tqdm
    import tempfile
    import shutil

    class ProgressTqdm(tqdm.tqdm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._last_pct = 0

        def update(self, n=1):
            super().update(n)
            if self.total and self.total > 0:
                pct = int((self.n / self.total) * 55) + 15
                if pct != self._last_pct:
                    self._last_pct = pct
                    progress_callback(pct, f"Downloading {label}... {pct - 15}%")

    progress_callback(15, f"Downloading {label} model...")
    cache_dir = tempfile.mkdtemp(prefix="hf_download_")
    snapshot_download(
        repo_id=model_name,
        local_dir=cache_dir,
        local_dir_use_symlinks=False,
        tqdm_class=ProgressTqdm,
        **hf_kwargs,
    )

    progress_callback(72, f"Converting {label} to OpenVINO IR...")

    if "audeering" in model_name:
        import openvino as ov
        import torch
        from transformers import AutoModel, AutoConfig

        config = AutoConfig.from_pretrained(cache_dir, trust_remote_code=True)
        model = AutoModel.from_pretrained(cache_dir, config=config, trust_remote_code=True)
        model.eval()
        dummy_input = torch.randn(1, 48000)
        with torch.no_grad():
            ov_model = ov.convert_model(model, example_input=dummy_input, input=[ov.PartialShape([1, -1])])
        export_dir.mkdir(parents=True, exist_ok=True)
        ov.save_model(ov_model, str(export_dir / "openvino_model.xml"))
        # The OV graph is the base encoder only — carry the regression head too.
        _save_audeering_head(Path(cache_dir), export_dir)
    else:
        from optimum.intel import OVModelForSequenceClassification
        model = OVModelForSequenceClassification.from_pretrained(cache_dir, export=True, compile=False)
        model.save_pretrained(export_dir)

    progress_callback(85, "Saving tokenizer/processor...")
    if is_audio:
        # Audio models need the feature extractor (preprocessor_config.json). Several
        # of these repos also ship a vocab.json, so AutoTokenizer succeeds and would
        # write text-tokenizer files while leaving the runtime with no preprocessor.
        from transformers import Wav2Vec2FeatureExtractor
        Wav2Vec2FeatureExtractor.from_pretrained(cache_dir).save_pretrained(str(export_dir))
        source_config = Path(cache_dir) / "config.json"
        if source_config.exists():
            shutil.copy(source_config, export_dir / "config.json")
    else:
        from transformers import AutoTokenizer
        try:
            tokenizer = AutoTokenizer.from_pretrained(cache_dir)
            tokenizer.save_pretrained(export_dir)
        except Exception:
            from transformers import Wav2Vec2FeatureExtractor
            fe = Wav2Vec2FeatureExtractor.from_pretrained(cache_dir)
            fe.save_pretrained(str(export_dir))

    shutil.rmtree(cache_dir, ignore_errors=True)
    progress_callback(92, f"{label.capitalize()} model ready")
    logger.info("%s model exported to %s", label, export_dir)


def _download_pretrained_with_progress(model_name: str, export_dir: Path, hf_kwargs: dict, progress_callback):
    """Download pre-quantized model with progress reporting via custom tqdm."""
    from huggingface_hub import snapshot_download
    import tqdm

    class ProgressTqdm(tqdm.tqdm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._last_pct = 0

        def update(self, n=1):
            super().update(n)
            if self.total and self.total > 0:
                pct = int((self.n / self.total) * 80) + 10  # Map to 10-90%
                if pct != self._last_pct:
                    self._last_pct = pct
                    progress_callback(pct, f"Downloading... {pct}%")

    snapshot_download(
        repo_id=model_name,
        local_dir=str(export_dir),
        local_dir_use_symlinks=False,
        tqdm_class=ProgressTqdm,
        **hf_kwargs,
    )
    progress_callback(90, "Download complete, verifying...")


def _export_translator_with_progress(model_name: str, export_dir: Path, hf_kwargs: dict, progress_callback):
    """Export translator with progress — downloads via snapshot_download for progress, then exports."""
    from huggingface_hub import snapshot_download
    from optimum.intel import OVModelForSeq2SeqLM
    from transformers import AutoTokenizer
    import tempfile
    import tqdm

    # Phase 1: Download model files with real progress via tqdm override
    class ProgressTqdm(tqdm.tqdm):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._last_pct = 0

        def update(self, n=1):
            super().update(n)
            if self.total and self.total > 0:
                pct = int((self.n / self.total) * 50) + 15  # Map to 15-65%
                if pct != self._last_pct:
                    self._last_pct = pct
                    progress_callback(pct, f"Downloading... {pct - 15}%")

    progress_callback(15, "Downloading model files...")
    cache_dir = tempfile.mkdtemp(prefix="hf_download_")
    snapshot_download(
        repo_id=model_name,
        local_dir=cache_dir,
        local_dir_use_symlinks=False,
        tqdm_class=ProgressTqdm,
        **hf_kwargs,
    )

    # Phase 2: Export from local cache to OpenVINO IR
    progress_callback(68, "Converting to OpenVINO IR...")
    model = OVModelForSeq2SeqLM.from_pretrained(
        cache_dir, export=True, compile=False
    )

    progress_callback(82, "Saving model...")
    model.save_pretrained(export_dir)

    progress_callback(88, "Saving tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(cache_dir)
    tokenizer.save_pretrained(export_dir)

    # Cleanup temp dir
    import shutil
    shutil.rmtree(cache_dir, ignore_errors=True)

    progress_callback(92, "Export complete")
    logger.info("Translator exported to %s", export_dir)


# Community ONNX exports downloaded straight into export_dir (see
# _export_cohere_asr / _export_tiny_aya) with no OpenVINO IR conversion step —
# these dicts double as both the download-time size-verification list and the
# "is this actually fully downloaded" check, so a download truncated partway
# (e.g. by a full disk) is never mistaken for a completed one just because the
# small graph file made it down before a multi-GB data shard didn't.
_COHERE_ASR_FILES = {
    "encoder_model_q4f16.onnx": 1410988,
    "encoder_model_q4f16.onnx_data": 1435501056,
    "decoder_model_merged_fp16.onnx": 155297,
    "decoder_model_merged_fp16.onnx_data": 337993728,
}
_TINY_AYA_FILES = {
    "model_fp16.onnx": 246241,
    "model_fp16.onnx_data": 2094129152,
    "model_fp16.onnx_data_1": 2088878080,
    "model_fp16.onnx_data_2": 2084675584,
    "model_fp16.onnx_data_3": 558923776,
}


def _onnx_files_complete(export_dir: Path, expected: Dict[str, int]) -> bool:
    return all(
        (export_dir / name).exists() and (export_dir / name).stat().st_size == size
        for name, size in expected.items()
    )


def _is_exported(export_dir: Path, hf_model_name: str = "") -> bool:
    if export_dir.exists() and (
        (export_dir / "openvino_model.xml").exists()
        or (export_dir / "openvino_encoder_model.xml").exists()
        or (export_dir / "model.xml").exists()
        or (export_dir / "model.bin").exists()
        or _onnx_files_complete(export_dir, _COHERE_ASR_FILES)
        or _onnx_files_complete(export_dir, _TINY_AYA_FILES)
    ):
        # An audeering export also needs the regression head and the audio
        # preprocessor; without them the IR alone is unusable, so treat that as
        # not-yet-exported rather than skipping the download as complete.
        if "audeering" in hf_model_name:
            required = ("classifier_head.npz", "preprocessor_config.json")
            missing = [f for f in required if not (export_dir / f).exists()]
            if missing:
                logger.warning(
                    "Export at %s is incomplete (missing %s) — re-exporting",
                    export_dir, ", ".join(missing),
                )
                return False
        return True
    # Also check HuggingFace hub cache for pre-quantized models
    if hf_model_name:
        try:
            from huggingface_hub import try_to_load_from_cache
            cached = try_to_load_from_cache(hf_model_name, "openvino_model.xml")
            if cached is not None:
                return True
        except Exception:
            pass
    return False


def _download_pretrained(model_name: str, export_dir: Path, hf_kwargs: dict):
    """Download a pre-quantized model directly from HuggingFace Hub.

    Uses huggingface_hub.snapshot_download to fetch all model files into
    the local export directory. No conversion or export step needed.
    """
    from huggingface_hub import snapshot_download

    snapshot_download(
        repo_id=model_name,
        local_dir=str(export_dir),
        local_dir_use_symlinks=False,
        **hf_kwargs,
    )
    logger.info("Pre-quantized model downloaded to %s", export_dir)


def _export_whisper(model_name: str, export_dir: Path, hf_kwargs: dict):
    config = _load_config()
    whisper_cfg = config.get("models", {}).get("whisper", {})
    backend = whisper_cfg.get("backend", "faster-whisper")

    # This is invoked for both the active model and any alternative, but always
    # reads the *active* backend rather than the alternative's own — the caller
    # (_find_model_config) doesn't thread that field through. Cohere Transcribe
    # is always an alternative, so key off the model name instead of trusting
    # `backend` here.
    if "cohere-transcribe" in model_name.lower():
        _export_cohere_asr(export_dir, hf_kwargs)
    elif backend == "faster-whisper":
        _download_faster_whisper(model_name, export_dir)
    else:
        from optimum.intel import OVModelForSpeechSeq2Seq
        from transformers import WhisperProcessor

        model = OVModelForSpeechSeq2Seq.from_pretrained(
            model_name, export=True, compile=False, **hf_kwargs
        )
        model.save_pretrained(export_dir)

        processor = WhisperProcessor.from_pretrained(model_name, **hf_kwargs)
        processor.save_pretrained(export_dir)
        logger.info("Whisper exported to %s", export_dir)


def _export_cohere_asr(export_dir: Path, hf_kwargs: dict):
    """Download Cohere Transcribe's community ONNX export + cache its mel filterbank.

    optimum-intel has no export config for the `cohere_asr` architecture (checked
    against TasksManager directly — not registered), so there's no
    `OVModelFor*.from_pretrained(..., export=True)` path here like the other
    stages. Instead this downloads the pre-exported ONNX graphs from
    onnx-community/cohere-transcribe-03-2026-ONNX (encoder: q4f16, ~1.4GB;
    decoder: fp16, ~340MB — the fp16 decoder is required because the
    quantized/q4 decoder variants use onnxruntime's `GatherBlockQuantized` op
    for the embedding table, which OpenVINO's ONNX frontend can't convert).
    transcriber_cohere_asr.py compiles these directly from ONNX at load time.

    The mel filterbank matrix only depends on (sample_rate, n_fft, n_mels) —
    not on audio — so it's computed once here via librosa (an export-only
    dependency, like torch) and cached as a .npy so the runtime wrapper never
    needs librosa.
    """
    repo_id = "onnx-community/cohere-transcribe-03-2026-ONNX"
    # Small config/tokenizer files aren't worth pinning a size for; the large
    # ONNX graph/data files reuse _COHERE_ASR_FILES so the expected sizes here
    # and the ones _is_exported checks against can't drift apart.
    files = {"tokenizer.json": None, "tokenizer_config.json": None,
             "preprocessor_config.json": None, "config.json": None}
    files.update({f"onnx/{name}": size for name, size in _COHERE_ASR_FILES.items()})

    export_dir.mkdir(parents=True, exist_ok=True)
    for filename, expected_size in files.items():
        _download_and_verify(repo_id, filename, export_dir, hf_kwargs, expected_size)

    import librosa
    import numpy as np
    mel_filters = librosa.filters.mel(sr=16000, n_fft=512, n_mels=128, fmin=0.0, fmax=8000.0, norm="slaney")
    np.save(export_dir / "mel_filters.npy", mel_filters.astype(np.float32))
    logger.info("Cohere Transcribe exported to %s", export_dir)


def _download_and_verify(repo_id: str, filename: str, export_dir: Path, hf_kwargs: dict, expected_size: Optional[int] = None) -> Path:
    """Download one file from HF hub and verify it landed intact.

    hf_hub_download resumes/retries at the HTTP layer, but a copy interrupted
    partway by a full disk, killed process, or a flaky mount can still leave a
    truncated file in export_dir with no exception raised — and the OpenVINO
    ONNX frontend's error for a truncated/missing external-data file
    ("Invalid usage of method for externally stored data ...") gives no hint
    that the download, not the model code, is at fault. Checking the copied
    file's size against HF's reported size turns that into a clear, actionable
    error at download time instead of a cryptic one at load time.
    """
    import shutil
    from huggingface_hub import hf_hub_download

    local_path = hf_hub_download(repo_id=repo_id, filename=filename, **hf_kwargs)
    dest = export_dir / Path(filename).name
    shutil.copyfile(local_path, dest)

    actual_size = dest.stat().st_size
    if expected_size is not None and actual_size != expected_size:
        dest.unlink(missing_ok=True)
        raise RuntimeError(
            f"Download of '{filename}' is incomplete or corrupted: expected "
            f"{expected_size} bytes, got {actual_size}. This usually means the "
            f"disk ran out of space during download — check available space "
            f"under {export_dir} and retry."
        )

    logger.info("Downloaded %s -> %s (%d bytes)", filename, dest, actual_size)
    return dest


def _download_faster_whisper(model_name: str, export_dir: Path):
    """Download a faster-whisper (CTranslate2) model.

    faster-whisper handles its own download and caching. We trigger a load
    to force the download into the specified directory.
    """
    from faster_whisper import WhisperModel

    size_map = {
        "openai/whisper-tiny": "tiny",
        "openai/whisper-small": "small",
        "openai/whisper-medium": "medium",
        "openai/whisper-large-v3": "large-v3",
    }
    model_size = size_map.get(model_name, "small")

    logger.info("Downloading faster-whisper model '%s' to %s", model_size, export_dir)
    export_dir.mkdir(parents=True, exist_ok=True)

    WhisperModel(model_size, device="cpu", compute_type="int8", download_root=str(export_dir))
    logger.info("faster-whisper model '%s' downloaded to %s", model_size, export_dir)


def _export_translator(model_name: str, export_dir: Path, hf_kwargs: dict):
    from optimum.intel import OVModelForSeq2SeqLM
    from transformers import AutoTokenizer

    model = OVModelForSeq2SeqLM.from_pretrained(
        model_name, export=True, compile=False, **hf_kwargs
    )
    model.save_pretrained(export_dir)

    tokenizer = AutoTokenizer.from_pretrained(model_name, **hf_kwargs)
    tokenizer.save_pretrained(export_dir)
    logger.info("Translator exported to %s", export_dir)


def _export_sentiment(model_name: str, export_dir: Path, hf_kwargs: dict):
    # Tiny Aya is always an alternative here, never the active model, and needs
    # a completely different download path (community ONNX, no OV export at
    # all) — see _export_tiny_aya for why. Keyed off model name for the same
    # reason _export_whisper keys off "cohere-transcribe": the active
    # `models.sentiment.backend` field is all this function normally sees, not
    # the specific alternative's own backend.
    if "tiny-aya" in model_name.lower():
        _export_tiny_aya(export_dir, hf_kwargs)
        return

    from optimum.intel import OVModelForSequenceClassification
    from transformers import AutoTokenizer

    model = OVModelForSequenceClassification.from_pretrained(
        model_name, export=True, compile=False, **hf_kwargs
    )
    model.save_pretrained(export_dir)

    tokenizer = AutoTokenizer.from_pretrained(model_name, **hf_kwargs)
    tokenizer.save_pretrained(export_dir)
    logger.info("Sentiment model exported to %s", export_dir)


def _export_tiny_aya(export_dir: Path, hf_kwargs: dict, progress_callback=None):
    """Download Tiny Aya's community ONNX export (fp16 — see module docstring
    in sentiment_tiny_aya.py for why the quantized variants and OpenVINO IR
    caching both don't work for this model).

    No conversion happens here — sentiment_tiny_aya.py does the
    ONNX -> NullNode-patch -> NNCF-compress pipeline at load time, since the
    result can't be saved back to disk as OpenVINO IR anyway. This function
    only fetches the raw files (~6.8GB, so progress_callback gets a per-file
    update rather than leaving the caller with no feedback for minutes).
    """
    repo_id = "onnx-community/tiny-aya-global-ONNX"
    # Small config/tokenizer files aren't worth pinning a size for; the large
    # ONNX graph/data files reuse _TINY_AYA_FILES so the expected sizes here
    # and the ones _is_exported checks against can't drift apart.
    files = {"tokenizer.json": None, "tokenizer_config.json": None,
             "chat_template.jinja": None, "config.json": None, "generation_config.json": None}
    files.update({f"onnx/{name}": size for name, size in _TINY_AYA_FILES.items()})

    export_dir.mkdir(parents=True, exist_ok=True)
    for i, (filename, expected_size) in enumerate(files.items()):
        _download_and_verify(repo_id, filename, export_dir, hf_kwargs, expected_size)
        if progress_callback:
            pct = 15 + int((i + 1) / len(files) * 75)
            progress_callback(pct, f"Downloaded {filename}")
    logger.info("Tiny Aya exported to %s", export_dir)


def _export_tts(model_name: str, export_dir: Path, hf_kwargs: dict):
    logger.warning("TTS export not supported for model: %s (use pre-quantized models)", model_name)


def _export_voice_emotion(model_name: str, export_dir: Path, hf_kwargs: dict):
    """Export voice emotion model to OpenVINO IR.

    Handles audeering dimensional models (custom architecture, trust_remote_code)
    and standard wav2vec2 classification models.
    For audeering models, the OV export only captures the base wav2vec2 layers,
    so we separately save the classifier head weights as a numpy file.
    """
    import numpy as np
    from transformers import Wav2Vec2FeatureExtractor

    export_dir.mkdir(parents=True, exist_ok=True)

    if "audeering" in model_name:
        import openvino as ov
        import torch
        from transformers import AutoModel, AutoConfig

        config = AutoConfig.from_pretrained(model_name, trust_remote_code=True, **hf_kwargs)
        model = AutoModel.from_pretrained(
            model_name, config=config, trust_remote_code=True, **hf_kwargs
        )
        model.eval()

        dummy_input = torch.randn(1, 48000)
        with torch.no_grad():
            ov_model = ov.convert_model(
                model,
                example_input=dummy_input,
                input=[ov.PartialShape([1, -1])],
            )
        ov.save_model(ov_model, str(export_dir / "openvino_model.xml"))

        # Extract and save the classifier head separately. AutoModel usually returns
        # only the base wav2vec2, in which case the head has to come from the raw
        # checkpoint instead of the loaded module.
        state = model.state_dict()
        if all(v in state for v in _AUDEERING_HEAD_KEYS.values()):
            head_data = {k: state[v].float().cpu().numpy() for k, v in _AUDEERING_HEAD_KEYS.items()}
            np.savez(str(export_dir / "classifier_head.npz"), **head_data)
            logger.info("Saved classifier head to %s", export_dir / "classifier_head.npz")
        else:
            from huggingface_hub import hf_hub_download
            logger.info("Head not in module state dict, reading it from the checkpoint")
            weights = hf_hub_download(model_name, "model.safetensors", **hf_kwargs)
            _save_audeering_head(Path(weights).parent, export_dir)
    else:
        from optimum.intel import OVModelForAudioClassification

        model = OVModelForAudioClassification.from_pretrained(
            model_name, export=True, **hf_kwargs
        )
        model.save_pretrained(str(export_dir))

    feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(model_name, **hf_kwargs)
    feature_extractor.save_pretrained(str(export_dir))
    logger.info("Voice emotion model exported to %s", export_dir)
