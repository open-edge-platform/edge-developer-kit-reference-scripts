# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Download and export all models to OpenVINO IR format.

Usage:
    python setup/export_models.py
    python setup/export_models.py --model whisper
    python setup/export_models.py --model translator
    python setup/export_models.py --model sentiment
    python setup/export_models.py --model tts
    python setup/export_models.py --model voice_emotion
"""

import argparse
import logging
from pathlib import Path

import yaml
from optimum.intel import (
    OVModelForSeq2SeqLM,
    OVModelForSequenceClassification,
    OVModelForSpeechSeq2Seq,
)
from optimum.intel.openvino import OVModelForTextToSpeechSeq2Seq

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT_DIR / "config.yaml"


def load_config():
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _download_pretrained(model_id: str, export_dir: Path):
    """Download a pre-quantized model directly from HuggingFace Hub."""
    from huggingface_hub import snapshot_download

    if (export_dir / "openvino_model.xml").exists() or \
       (export_dir / "openvino_encoder_model.xml").exists():
        logger.info("Pre-quantized model already at %s, skipping.", export_dir)
        return

    export_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading pre-quantized model %s to %s ...", model_id, export_dir)
    snapshot_download(
        repo_id=model_id,
        local_dir=str(export_dir),
        local_dir_use_symlinks=False,
    )
    logger.info("Downloaded %s to %s", model_id, export_dir)


def export_whisper(config: dict):
    whisper_cfg = config["models"]["whisper"]
    model_id = whisper_cfg["name"]
    export_dir = ROOT_DIR / whisper_cfg["export_dir"]
    backend = whisper_cfg.get("backend", "faster-whisper")

    if backend == "faster-whisper":
        _download_faster_whisper(model_id, export_dir, whisper_cfg)
        return

    if backend == "openvino":
        _export_whisper_openvino(model_id, export_dir)
        return

    pre_quantized = whisper_cfg.get("pre_quantized", False)
    if pre_quantized:
        _download_pretrained(model_id, export_dir)
        return

    if (export_dir / "openvino_encoder_model.xml").exists():
        logger.info("Whisper already exported at %s, skipping.", export_dir)
        return

    logger.info("Exporting Whisper from %s ...", model_id)
    model = OVModelForSpeechSeq2Seq.from_pretrained(
        model_id, export=True, compile=False
    )
    model.save_pretrained(export_dir)
    logger.info("Whisper exported to %s", export_dir)

    from transformers import WhisperProcessor
    processor = WhisperProcessor.from_pretrained(model_id)
    processor.save_pretrained(export_dir)
    logger.info("Whisper processor saved to %s", export_dir)


def _export_whisper_openvino(model_id: str, export_dir: Path):
    """Export Whisper model to OpenVINO IR format with processor."""
    if (export_dir / "openvino_encoder_model.xml").exists():
        logger.info("Whisper OV already exported at %s, skipping.", export_dir)
        return

    export_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Exporting Whisper OV from %s ...", model_id)
    model = OVModelForSpeechSeq2Seq.from_pretrained(
        model_id, export=True, compile=False
    )
    model.save_pretrained(str(export_dir))
    logger.info("Whisper OV model exported to %s", export_dir)

    from transformers import AutoProcessor
    processor = AutoProcessor.from_pretrained(model_id)
    processor.save_pretrained(str(export_dir))
    logger.info("Whisper OV processor saved to %s", export_dir)


def _download_faster_whisper(model_id: str, export_dir: Path, whisper_cfg: dict):
    """Download a faster-whisper CTranslate2 model."""
    # download_root stores it HF-cache-style (models--.../snapshots/<hash>/model.bin),
    # not directly under export_dir, so the check must search recursively.
    if next(export_dir.rglob("model.bin"), None) is not None:
        logger.info("faster-whisper model already at %s, skipping.", export_dir)
        return

    from faster_whisper import WhisperModel

    size_map = {
        "openai/whisper-tiny": "tiny",
        "openai/whisper-small": "small",
        "openai/whisper-medium": "medium",
        "openai/whisper-large-v3": "large-v3",
    }
    model_size = size_map.get(model_id, whisper_cfg.get("model_size", "base"))
    compute_type = whisper_cfg.get("compute_type", "int8")

    export_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading faster-whisper model '%s' (size=%s) to %s ...", model_id, model_size, export_dir)
    WhisperModel(model_size, device="cpu", compute_type=compute_type, download_root=str(export_dir))
    logger.info("faster-whisper model downloaded to %s", export_dir)


def export_translator(config: dict):
    model_id = config["models"]["translator"]["name"]
    export_dir = ROOT_DIR / config["models"]["translator"]["export_dir"]

    if (export_dir / "openvino_encoder_model.xml").exists():
        logger.info("Translator already exported at %s, skipping.", export_dir)
    else:
        logger.info("Exporting translator from %s ...", model_id)
        model = OVModelForSeq2SeqLM.from_pretrained(model_id, export=True, compile=False)
        model.save_pretrained(export_dir)
        logger.info("Translator exported to %s", export_dir)

        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(model_id)
        tokenizer.save_pretrained(export_dir)
        logger.info("Translator tokenizer saved to %s", export_dir)

    # Also save PyTorch weights for microservice mode (raw transformers, full precision).
    # A model this size shards into model-0000N-of-0000N.safetensors + an index file
    # rather than a single model.safetensors, so check for either form.
    pt_weights_exist = (
        (export_dir / "model.safetensors").exists()
        or (export_dir / "model.safetensors.index.json").exists()
        or (export_dir / "pytorch_model.bin").exists()
        or (export_dir / "pytorch_model.bin.index.json").exists()
    )
    if not pt_weights_exist:
        logger.info("Saving PyTorch weights for microservice mode...")
        from transformers import AutoModelForSeq2SeqLM
        pt_model = AutoModelForSeq2SeqLM.from_pretrained(model_id)
        pt_model.save_pretrained(export_dir, safe_serialization=True)
        logger.info("PyTorch weights saved to %s", export_dir)


def export_sentiment(config: dict):
    model_id = config["models"]["sentiment"]["name"]
    export_dir = ROOT_DIR / config["models"]["sentiment"]["export_dir"]

    if (export_dir / "openvino_model.xml").exists():
        logger.info("Sentiment model already exported at %s, skipping.", export_dir)
        return

    logger.info("Exporting sentiment model from %s ...", model_id)
    model = OVModelForSequenceClassification.from_pretrained(
        model_id, export=True, compile=False
    )
    model.save_pretrained(export_dir)
    logger.info("Sentiment model exported to %s", export_dir)

    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    tokenizer.save_pretrained(export_dir)
    logger.info("Sentiment tokenizer saved to %s", export_dir)


def export_tts(config: dict):
    tts_cfg = config["models"]["tts"]
    model_id = tts_cfg["name"]
    export_dir = ROOT_DIR / tts_cfg["export_dir"]

    if tts_cfg.get("pre_quantized", False):
        _download_pretrained(model_id, export_dir)
        return

    logger.warning("No export handler for TTS model: %s", model_id)

    import numpy as np
    embedding_path = export_dir / "speaker_embedding.npy"
    if not embedding_path.exists():
        rng = np.random.default_rng(seed=42)
        embedding = rng.standard_normal(512).astype(np.float32)
        embedding = embedding / np.linalg.norm(embedding)
        np.save(str(embedding_path), embedding)
        logger.info("Default speaker embedding saved to %s", embedding_path)


def export_voice_emotion(config: dict):
    """Export wav2vec2 voice emotion model to OpenVINO IR.

    Handles both categorical (OVModelForAudioClassification) and dimensional
    (audeering regression) models. The audeering model outputs 3 continuous
    values (arousal, dominance, valence) rather than class logits.
    """
    cfg = config["models"]["voice_emotion"]
    model_id = cfg["name"]
    export_dir = ROOT_DIR / cfg["export_dir"]
    mode = cfg.get("mode", "categorical")

    if (export_dir / "openvino_model.xml").exists():
        logger.info("Voice emotion model already exported at %s", export_dir)
        return

    logger.info("Exporting voice emotion (%s): %s -> %s", mode, model_id, export_dir)
    export_dir.mkdir(parents=True, exist_ok=True)

    if mode == "dimensional" or "audeering" in model_id:
        _export_audeering_emotion(model_id, export_dir)
    else:
        from optimum.intel import OVModelForAudioClassification
        model = OVModelForAudioClassification.from_pretrained(model_id, export=True)
        model.save_pretrained(str(export_dir))

    from transformers import Wav2Vec2FeatureExtractor
    feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(model_id)
    feature_extractor.save_pretrained(str(export_dir))
    logger.info("Voice emotion model exported to %s", export_dir)


def _export_audeering_emotion(model_id: str, export_dir: Path):
    """Export audeering wav2vec2 dimensional emotion model to OpenVINO IR.

    The audeering model uses a custom Wav2Vec2 with a regression head that
    outputs [arousal, dominance, valence]. The OV export only captures the
    base wav2vec2 layers, so we separately save the classifier head weights
    as classifier_head.npz for the runtime to apply via numpy.
    """
    import openvino as ov
    import torch
    import numpy as np

    logger.info("Loading audeering model %s for OV export...", model_id)

    from transformers import AutoModel, AutoConfig
    config = AutoConfig.from_pretrained(model_id, trust_remote_code=True)
    model = AutoModel.from_pretrained(model_id, config=config, trust_remote_code=True)
    model.eval()

    dummy_input = torch.randn(1, 48000)

    with torch.no_grad():
        ov_model = ov.convert_model(
            model,
            example_input=dummy_input,
            input=[ov.PartialShape([1, -1])],
        )

    ov.save_model(ov_model, str(export_dir / "openvino_model.xml"))
    logger.info("Audeering emotion model exported to %s", export_dir)

    # Extract classifier head from the full safetensors/pytorch weights file.
    # AutoModel only loads the base wav2vec2, so we read the raw weights directly.
    head_keys = {
        "dense_weight": "classifier.dense.weight",
        "dense_bias": "classifier.dense.bias",
        "out_proj_weight": "classifier.out_proj.weight",
        "out_proj_bias": "classifier.out_proj.bias",
    }

    state = model.state_dict()
    if all(v in state for v in head_keys.values()):
        head_data = {k: state[v].cpu().numpy() for k, v in head_keys.items()}
    else:
        # AutoModel may not load the head — fall back to reading from hub file directly
        logger.info("Head not in model state_dict, loading from hub weights file...")
        try:
            from huggingface_hub import hf_hub_download
            import safetensors.torch
            weights_path = hf_hub_download(model_id, "model.safetensors")
            full_state = safetensors.torch.load_file(weights_path)
            if all(v in full_state for v in head_keys.values()):
                head_data = {k: full_state[v].numpy() for k, v in head_keys.items()}
            else:
                head_data = None
                logger.warning("Classifier head keys not found in safetensors file")
        except Exception as e:
            head_data = None
            logger.warning("Failed to load classifier head from hub: %s", e)

    if head_data:
        np.savez(str(export_dir / "classifier_head.npz"), **head_data)
        logger.info("Classifier head saved to %s", export_dir / "classifier_head.npz")
    else:
        logger.warning("Classifier head not saved — voice emotion will fall back to raw features")


def export_mission_cue_llm(config: dict):
    """Download the pre-quantized LLM used to parse unformatted PDFs into cues."""
    cfg = config["models"].get("mission_cue_llm")
    if not cfg:
        logger.info("No mission_cue_llm configured, skipping.")
        return
    model_id = cfg["name"]
    export_dir = ROOT_DIR / cfg["export_dir"]
    _download_pretrained(model_id, export_dir)


EXPORTERS = {
    "whisper": export_whisper,
    "translator": export_translator,
    "sentiment": export_sentiment,
    "tts": export_tts,
    "voice_emotion": export_voice_emotion,
    "mission_cue_llm": export_mission_cue_llm,
}


def export_alternatives(config: dict, model_key: str = None):
    """Export alternative models listed in config.yaml.

    For each alternative that has an export_dir defined, attempts export
    using the same exporter as the active model for that stage.
    """
    models_cfg = config.get("models", {})
    keys = [model_key] if model_key else list(EXPORTERS.keys())

    for key in keys:
        cfg = models_cfg.get(key, {})
        for alt in cfg.get("alternatives", []):
            alt_name = alt.get("name", "")
            alt_dir = alt.get("export_dir", "")
            if not alt_name or not alt_dir:
                continue

            export_path = ROOT_DIR / alt_dir
            if (export_path / "openvino_model.xml").exists() or \
               (export_path / "openvino_encoder_model.xml").exists() or \
               (export_path / "model.xml").exists() or \
               (export_path / "model.bin").exists():
                logger.info("Alternative '%s' already exported, skipping.", alt_name)
                continue

            logger.info("Exporting alternative: %s -> %s", alt_name, alt_dir)
            # Build a temporary config that points to the alternative
            temp_config = dict(config)
            temp_models = dict(config["models"])
            temp_models[key] = {**cfg, "name": alt_name, "export_dir": alt_dir}
            temp_config["models"] = temp_models

            try:
                EXPORTERS[key](temp_config)
            except Exception as exc:
                logger.error("Failed to export alternative '%s': %s", alt_name, exc)


def main():
    parser = argparse.ArgumentParser(description="Export models to OpenVINO IR")
    parser.add_argument(
        "--model",
        choices=list(EXPORTERS.keys()),
        help="Export a specific model (default: all active models)",
    )
    parser.add_argument(
        "--alternatives",
        action="store_true",
        help="Also export alternative models listed in config.yaml",
    )
    args = parser.parse_args()

    config = load_config()

    if args.model:
        EXPORTERS[args.model](config)
        if args.alternatives:
            export_alternatives(config, args.model)
    else:
        failed = []
        for name, export_fn in EXPORTERS.items():
            logger.info("=== Exporting %s ===", name)
            try:
                export_fn(config)
            except Exception as exc:
                logger.error("FAILED to export %s: %s", name, exc, exc_info=True)
                failed.append(name)

        if args.alternatives:
            logger.info("=== Exporting alternatives ===")
            export_alternatives(config)

        if failed:
            logger.warning("Some models failed to export: %s", ", ".join(failed))
            logger.warning("Run 'make prereq' again or export individually with: python setup/export_models.py --model <name>")

    logger.info("All done.")


if __name__ == "__main__":
    main()
