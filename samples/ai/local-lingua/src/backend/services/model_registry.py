# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Model registry service — manages model metadata and runtime assignments.

Reads config.yaml to build a list of available models per pipeline stage,
including alternatives. The UI uses this to populate dropdowns; the pipeline
service uses assignments to know which model+device to load.

To add a new model option:
1. Add it under the appropriate stage in config.yaml (as active or alternative)
2. Export it: python setup/export_models.py --model <key>
3. It will appear in the UI automatically
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).resolve().parents[3] / "config.yaml"

# Maps config model keys to pipeline stage names
_CONFIG_KEY_TO_STAGE = {
    "whisper": "transcription",
    "translator": "translation",
    "sentiment": "sentiment",
    "tts": "text_to_speech",
    "voice_emotion": "voice_emotion",
    "mission_cue_llm": "mission_cue_llm",
}

# Community ONNX exports (no OpenVINO IR conversion step — see
# transcriber_cohere_asr.py / sentiment_tiny_aya.py) downloaded straight into
# export_dir. Mirrors the same-named dicts in model_download_service.py; kept
# in sync manually since download and registry-status-check are separate
# modules, same as the rest of this file's duplication with that one.
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
    """True only if every file in `expected` exists at its exact expected size.

    Checking size, not just presence, matters: a download truncated partway
    (e.g. by a full disk) leaves the small graph file and some data shards
    present, which would otherwise look like a complete export and never get
    retried — see the size-verification note in model_download_service.py's
    _download_and_verify.
    """
    return all(
        (export_dir / name).exists() and (export_dir / name).stat().st_size == size
        for name, size in expected.items()
    )


class ModelRegistry:
    """Manages model metadata, availability, and runtime target assignments.

    Model metadata schema (per plan):
        modelId, displayName, stage, supportedLanguages, supportedTargets,
        recommendedTarget, localPath, enabled
    """

    def __init__(self, config_path: Optional[Path] = None) -> None:
        self._config_path = config_path or _CONFIG_PATH
        self._models: List[Dict[str, Any]] = []
        self._assignments: Dict[str, Dict[str, str]] = {}
        self._load_config()

    def _load_config(self) -> None:
        """Read config.yaml and populate model list with registry metadata."""
        try:
            with open(self._config_path, "r") as f:
                config = yaml.safe_load(f)
        except FileNotFoundError:
            logger.error("Config file not found: %s", self._config_path)
            config = {}

        models_cfg = config.get("models", {})
        device = config.get("device", "GPU")
        fallback = config.get("fallback_device", "CPU")
        supported_langs = [
            lang["code"]
            for lang in config.get("language", {}).get("supported", [])
        ]

        self._models = []

        for config_key, stage in _CONFIG_KEY_TO_STAGE.items():
            model_cfg = models_cfg.get(config_key)
            if not model_cfg:
                continue

            # Active model
            supported_targets = model_cfg.get("supported_targets", ["CPU", "GPU", "NPU"])
            model_name = model_cfg.get("name", config_key)
            model_id = self._make_model_id(model_name)
            active_exported = self._is_exported(model_cfg.get("export_dir", ""), model_name)

            # Per-stage recommended_target or device override takes priority over global default
            stage_device = model_cfg.get("recommended_target", model_cfg.get("device", device))
            recommended = stage_device if stage_device in supported_targets else (
                device if device in supported_targets else fallback
            )

            self._models.append({
                "modelId": model_id,
                "displayName": model_name,
                "stage": stage,
                "supportedLanguages": supported_langs,
                "supportedTargets": supported_targets,
                "recommendedTarget": recommended,
                "localPath": model_cfg.get("export_dir", ""),
                "downloadUrl": f"https://huggingface.co/{model_name}",
                "requiresToken": model_cfg.get("requires_token", False),
                "preQuantized": model_cfg.get("pre_quantized", False),
                "enabled": active_exported,
                "isActive": True,
            })

            # Alternative models (available for switching)
            for alt in model_cfg.get("alternatives", []):
                alt_targets = alt.get("supported_targets", ["CPU", "GPU", "NPU"])
                alt_name = alt.get("name", "")
                alt_id = self._make_model_id(alt_name)
                exported = self._is_exported(alt.get("export_dir", ""), alt_name)

                self._models.append({
                    "modelId": alt_id,
                    "displayName": alt_name,
                    "stage": stage,
                    "supportedLanguages": supported_langs,
                    "supportedTargets": alt_targets,
                    "recommendedTarget": device if device in alt_targets else fallback,
                    "localPath": alt.get("export_dir", ""),
                    "downloadUrl": f"https://huggingface.co/{alt_name}",
                    "requiresToken": alt.get("requires_token", False),
                    "enabled": exported,
                    "isActive": False,
                    "note": alt.get("note", ""),
                })

        # Set default assignments: prefer active model if downloaded,
        # otherwise fall back to first downloaded alternative
        for model in self._models:
            stage = model["stage"]
            if stage not in self._assignments and model.get("isActive") and model.get("enabled"):
                self._assignments[stage] = {
                    "modelId": model["modelId"],
                    "target": model["recommendedTarget"],
                    "source": "config",
                }

        # Fallback: if the active model isn't downloaded, use first available
        # alternative. This is a silent substitution of a model the user never
        # chose, so record it and say so in the log.
        for model in self._models:
            stage = model["stage"]
            if stage not in self._assignments and model.get("enabled"):
                configured = next(
                    (m["displayName"] for m in self._models
                     if m["stage"] == stage and m.get("isActive")),
                    "?",
                )
                self._assignments[stage] = {
                    "modelId": model["modelId"],
                    "target": model["recommendedTarget"],
                    "source": "fallback",
                    "fallbackFrom": configured,
                }
                logger.warning(
                    "Stage '%s': configured model '%s' is not exported — falling back to '%s'. "
                    "Download the configured model or update config.yaml.",
                    stage, configured, model["displayName"],
                )

        logger.info(
            "Model registry loaded %d models (%d active) from config",
            len(self._models),
            sum(1 for m in self._models if m.get("isActive")),
        )

    @staticmethod
    def _make_model_id(name: str) -> str:
        """Derive a short modelId from a HuggingFace model name."""
        return name.split("/")[-1] if "/" in name else name

    def _is_exported(self, export_dir: str, model_name: str = "") -> bool:
        """Check if a model has been exported/downloaded."""
        if not export_dir:
            return False
        path = Path(__file__).resolve().parents[3] / export_dir
        if path.exists():
            # Direct file checks (OpenVINO IR, CTranslate2)
            if (path / "openvino_model.xml").exists():
                return True
            if (path / "openvino_encoder_model.xml").exists():
                return True
            if (path / "model.xml").exists():
                return True
            if (path / "model.bin").exists():
                return True
            # Cohere Transcribe / Tiny Aya: community ONNX exports downloaded
            # straight into export_dir with no OpenVINO IR conversion step
            # (compiled/compressed directly from ONNX at load time instead —
            # see transcriber_cohere_asr.py / sentiment_tiny_aya.py). Checking
            # exact sizes, not just presence, matters here: a download
            # truncated partway (e.g. by a full disk) leaves the small graph
            # file and some data shards present, which would otherwise look
            # like a complete export and never get retried.
            if _onnx_files_complete(path, _COHERE_ASR_FILES):
                return True
            if _onnx_files_complete(path, _TINY_AYA_FILES):
                return True
            # faster-whisper stores model.bin nested under models--*/snapshots/*/
            for model_bin in path.rglob("model.bin"):
                return True

        # Check HuggingFace hub cache for pre-quantized models
        if model_name:
            try:
                from huggingface_hub import try_to_load_from_cache
                cached = try_to_load_from_cache(model_name, "openvino_model.xml")
                if cached is not None:
                    return True
            except Exception:
                pass
        return False

    def get_models(
        self,
        stage: Optional[str] = None,
        target: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return models, optionally filtered by stage and/or target.

        Only returns enabled models (those with exported OV IR files).
        """
        results = [m for m in self._models if m.get("enabled", True)]
        if stage:
            results = [m for m in results if m["stage"] == stage]
        if target:
            results = [
                m for m in results if target in m["supportedTargets"]
            ]
        return results

    def get_all_models(self) -> List[Dict[str, Any]]:
        """Return all models including disabled alternatives (for admin UI)."""
        return self._models

    def get_model(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Return a single model by its ID, or None if not found."""
        for m in self._models:
            if m["modelId"] == model_id:
                return m
        return None

    def select_model(
        self, stage: str, model_id: str, target: str, source: str = "user"
    ) -> Dict[str, Any]:
        """Assign a model+target to a pipeline stage.

        Validates that the model exists, belongs to the stage, and supports
        the requested target.

        Parameters
        ----------
        source : str
            Provenance of the assignment — "user" (explicit selection),
            "config" (config.yaml default), or "fallback" (substituted because
            the intended choice was unusable). Surfaced in the Settings UI.

        Returns
        -------
        dict with the updated assignment, or raises ValueError on bad input.
        """
        model = self.get_model(model_id)
        if model is None:
            raise ValueError(f"Model '{model_id}' not found in registry")
        if model["stage"] != stage:
            raise ValueError(
                f"Model '{model_id}' belongs to stage '{model['stage']}', "
                f"not '{stage}'"
            )
        if target not in model["supportedTargets"]:
            raise ValueError(
                f"Target '{target}' not supported by model '{model_id}'. "
                f"Supported: {model['supportedTargets']}"
            )
        if not model.get("enabled"):
            # Re-check disk/cache — model may have been downloaded after registry init
            if self._is_exported(model.get("localPath", ""), model.get("displayName", "")):
                model["enabled"] = True
            else:
                raise ValueError(
                    f"Model '{model_id}' is not exported yet. "
                    f"Run: python setup/export_models.py"
                )

        self._assignments[stage] = {
            "modelId": model_id,
            "target": target,
            "source": source,
        }
        logger.info(
            "Stage '%s' assigned model '%s' on target '%s' (source: %s)",
            stage,
            model_id,
            target,
            source,
        )
        return self._assignments[stage]

    def restore_assignments(self, saved: Dict[str, Dict[str, str]]) -> Dict[str, str]:
        """Re-apply persisted user selections on top of the config defaults.

        Each entry is validated exactly as a live selection would be, so a
        stale record — model since deleted, target no longer supported, config
        rewritten — is discarded in favour of the config default rather than
        failing startup or wedging a stage on a device that cannot load it.

        Parameters
        ----------
        saved : dict
            {stage: {"modelId": str, "target": str}}, typically read from the
            settings table.

        Returns
        -------
        dict of {stage: reason} for entries that could not be restored.
        """
        rejected: Dict[str, str] = {}

        for stage, assignment in (saved or {}).items():
            model_id = (assignment or {}).get("modelId")
            target = (assignment or {}).get("target")
            if not model_id or not target:
                rejected[stage] = "incomplete record"
                continue

            try:
                self.select_model(stage, model_id, target, source="user")
                logger.info(
                    "Restored saved selection for '%s': %s on %s", stage, model_id, target
                )
            except ValueError as exc:
                rejected[stage] = str(exc)
                logger.warning(
                    "Discarding saved selection for '%s' (%s) — keeping default '%s'",
                    stage, exc, (self._assignments.get(stage) or {}).get("modelId", "none"),
                )

        return rejected

    def downgrade_target(self, stage: str, target: str, reason: str) -> None:
        """Record that a stage is actually running on a different target.

        Called when a model fails to load on its assigned device and the
        wrapper falls back, so the registry and Settings UI stop advertising a
        device the stage is not really using.
        """
        assignment = self._assignments.get(stage)
        if not assignment or assignment.get("target") == target:
            return

        logger.warning(
            "Stage '%s' could not run on '%s' (%s) — now on '%s'",
            stage, assignment.get("target"), reason, target,
        )
        assignment["target"] = target
        assignment["source"] = "fallback"
        assignment["fallbackReason"] = reason

    def get_current_assignment(
        self, stage: str
    ) -> Optional[Dict[str, str]]:
        """Return the current model+target assignment for a stage."""
        return self._assignments.get(stage)
