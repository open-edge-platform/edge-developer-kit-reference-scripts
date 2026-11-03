# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import os
import shutil
import threading
from typing import Optional

import numpy as np
import openwakeword
from model_downloader import fetch_url
from openwakeword.model import Model

from utils.util import validate_and_sanitize_cache_dir, create_cache_directory
import worker_common

logger = logging.getLogger("uvicorn.error")

_OWW_RELEASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1"

# Shared feature extractors and the VAD every wake word model depends on.
DEPENDENCY_MODEL_URLS = {
    "embedding_model": f"{_OWW_RELEASE}/embedding_model.onnx",
    "melspectrogram": f"{_OWW_RELEASE}/melspectrogram.onnx",
    "silero_vad": f"{_OWW_RELEASE}/silero_vad.onnx",
}

# Pre-trained wake word models that can be named by file name.
PREDEFINED_MODEL_URLS = {
    name: f"{_OWW_RELEASE}/{name}"
    for name in (
        "hey_jarvis_v0.1.onnx",
        "alexa_v0.1.onnx",
        "hey_mycroft_v0.1.onnx",
        "hey_rhasspy_v0.1.onnx",
        "timer_v0.1.onnx",
        "weather_v0.1.onnx",
    )
}

# Silence around a scored recording, so a wake word at its very start or end
# still fills the model's window.
CLIP_PADDING_SECONDS = 1


class ModelManager:
    def __init__(self):
        self.model: Optional[Model] = None
        self.model_paths: list[str] = []
        self.vad_threshold: float = 0.2
        # Serializes loads, so two reloads never leave one's model with the other's paths.
        # Prediction doesn't take it: a load builds the new model first and swaps it in whole.
        self._load_lock = threading.Lock()

    @staticmethod
    def get_model_directory() -> str:
        model_dir = str(worker_common.models_dir("wake-word-detection"))
        return model_dir

    @staticmethod
    def resolve_model_path(model: str) -> str:
        """Path of ``model`` (absolute, or a file name in the model directory).

        A missing predefined model is downloaded; any other missing file raises FileNotFoundError.
        """
        model_dir = ModelManager.get_model_directory()

        model_dir = validate_and_sanitize_cache_dir(model_dir)
        create_cache_directory(model_dir)

        if os.path.isabs(model):
            model_path = model
        else:
            model_path = os.path.join(model_dir, model)

        if not os.path.isfile(model_path):
            model_filename = os.path.basename(model_path)

            if model_filename in PREDEFINED_MODEL_URLS:
                logger.info(
                    f"Model {model_filename} not found. Downloading from openWakeWord..."
                )
                try:
                    fetch_url(PREDEFINED_MODEL_URLS[model_filename], dest=model_path)
                    logger.info(f"Successfully downloaded {model_filename}")
                except Exception as e:
                    raise FileNotFoundError(
                        f"Failed to download model {model_filename}: {str(e)}"
                    )
            else:
                raise FileNotFoundError(
                    f"Model file not found: {model_path}. Please provide a valid path or use a predefined model."
                )

        return model_path

    def download_dependencies(self):
        """Download dependent models if not already present."""
        model_dir = self.get_model_directory()

        model_dir = validate_and_sanitize_cache_dir(model_dir)

        create_cache_directory(model_dir)

        # Locked: a sibling instance starting at once waits and finds the file rather than replacing
        # the copy this instance may have open (Windows refuses that).
        for model_name, url in DEPENDENCY_MODEL_URLS.items():
            model_path = os.path.join(model_dir, f"{model_name}.onnx")
            with worker_common.shared_model_lock(model_path):
                if not os.path.isfile(model_path):
                    logger.info(f"Downloading {model_name} ...")
                fetch_url(url, dest=model_path)

        # openWakeWord loads its VAD from the package's own resources directory
        # and offers no override for it, so mirror that one file into place.
        resources_dir = os.path.join(
            os.path.dirname(os.path.abspath(openwakeword.__file__)), "resources", "models"
        )
        vad_target = os.path.join(resources_dir, "silero_vad.onnx")
        with worker_common.shared_model_lock(vad_target):
            if not os.path.isfile(vad_target):
                with worker_common.staged_model_file(vad_target) as staged:
                    shutil.copyfile(os.path.join(model_dir, "silero_vad.onnx"), staged)

        logger.info("All required models are present.")

    def load_models(self, model_paths: list[str], vad_threshold: float = 0.2):
        """Load the wake word models at ``model_paths``; ValueError when there are none."""
        if not model_paths:
            raise ValueError("No wake word models specified.")

        model_dir = validate_and_sanitize_cache_dir(self.get_model_directory())
        with self._load_lock:
            self._load_models_locked(model_paths, vad_threshold, model_dir)

    @staticmethod
    def _build_model(model_paths: list[str], vad_threshold: float, model_dir: str) -> Model:
        return Model(
            wakeword_models=model_paths,
            inference_framework="onnx",
            vad_threshold=vad_threshold,
            # Feature extractors fetched by download_dependencies(); without
            # these openWakeWord looks in its own package resources.
            melspec_model_path=os.path.join(model_dir, "melspectrogram.onnx"),
            embedding_model_path=os.path.join(model_dir, "embedding_model.onnx"),
        )

    def _load_models_locked(self, model_paths: list[str], vad_threshold: float, model_dir: str):
        try:
            model = self._build_model(model_paths, vad_threshold, model_dir)
            self.model = model
            self.model_paths = model_paths
            self.vad_threshold = vad_threshold

            logger.info("Wake word model loaded successfully!")
            logger.info(f"Available models: {list(self.model.models.keys())}")
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            raise

    def reload_models(self, model_filenames: list[str], vad_threshold: float = 0.2):
        """Resolve (downloading if needed) and load ``model_filenames``; ValueError when empty."""
        if not model_filenames:
            raise ValueError("No model filenames provided for reloading.")

        new_paths = [self.resolve_model_path(model) for model in model_filenames]

        self.load_models(new_paths, vad_threshold)

    def predict(self, audio_chunk):
        """Each model's score for one audio chunk; RuntimeError before a model is loaded."""
        model = self.model
        if model is None:
            raise RuntimeError("Model not loaded")

        return model.predict(audio_chunk)

    def score_clip(self, samples: np.ndarray) -> dict[str, list[float]]:
        """Each loaded model's score for every 80 ms step of ``samples`` (16 kHz mono int16).

        Runs on a copy of the models, so the live detection buffers never see the clip. The clip is
        padded with ``CLIP_PADDING_SECONDS`` of silence at each end, so step ``i`` ends
        ``(i + 1) * 0.08 - CLIP_PADDING_SECONDS`` seconds into it.
        """
        with self._load_lock:
            model_paths, vad_threshold = list(self.model_paths), self.vad_threshold
        if not model_paths:
            raise RuntimeError("Model not loaded")
        model_dir = validate_and_sanitize_cache_dir(self.get_model_directory())
        model = self._build_model(model_paths, vad_threshold, model_dir)
        steps = model.predict_clip(samples, padding=CLIP_PADDING_SECONDS)
        return {name: [float(step[name]) for step in steps] for name in model.models}

    def get_model_names(self) -> list[str]:
        if self.model is None:
            return []
        return list(self.model.models.keys())

    def is_model_loaded(self, filename: str) -> bool:
        if self.model is None:
            return False

        model_name = filename.replace(".onnx", "")
        return model_name in self.model.models

    def list_available_models(self) -> list[dict]:
        """``{filename, path}`` of every .onnx file in the model directory."""
        model_dir = self.get_model_directory()

        if not os.path.exists(model_dir):
            return []

        models = []
        for filename in os.listdir(model_dir):
            if filename.endswith(".onnx"):
                file_path = os.path.join(model_dir, filename)
                models.append(
                    {
                        "filename": filename,
                        "path": file_path,
                    }
                )

        return models
