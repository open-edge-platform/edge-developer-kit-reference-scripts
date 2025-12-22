# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Model management module for wake word detection."""

import logging
import os
from typing import Optional

import openwakeword
from openwakeword.model import Model

from utils.util import validate_and_sanitize_cache_dir, create_cache_directory

logger = logging.getLogger("uvicorn.error")


class ModelManager:
    """Manages wake word detection models."""

    def __init__(self):
        self.model: Optional[Model] = None
        self.model_paths: list[str] = []
        self.vad_threshold: float = 0.2

    @staticmethod
    def get_model_directory() -> str:
        """Get the wake word detection model directory path."""
        script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
        model_dir = os.path.join(project_root, "models", "wake-word-detection")
        return model_dir

    @staticmethod
    def resolve_model_path(model: str) -> str:
        """Resolve a model path, checking if it exists.

        Args:
            model: Either an absolute path or a filename in models/wake-word-detection/

        Returns:
            Absolute path to the model file

        Raises:
            FileNotFoundError: If the model file doesn't exist
        """
        model_dir = ModelManager.get_model_directory()

        # Ensure the target model directory exists
        model_dir = validate_and_sanitize_cache_dir(model_dir)
        create_cache_directory(model_dir)

        if os.path.isabs(model):
            # If absolute path, use it directly
            model_path = model
        else:
            # Otherwise, look in the model directory
            model_path = os.path.join(model_dir, model)

        # If model doesn't exist, try to download it if it's a predefined model
        if not os.path.isfile(model_path):
            model_filename = os.path.basename(model_path)

            # Check if it's a predefined openWakeWord model
            predefined_models = {
                "hey_jarvis_v0.1.onnx": "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/hey_jarvis_v0.1.onnx",
                "alexa_v0.1.onnx": "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/alexa_v0.1.onnx",
                "hey_mycroft_v0.1.onnx": "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/hey_mycroft_v0.1.onnx",
                "hey_rhasspy_v0.1.onnx": "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/hey_rhasspy_v0.1.onnx",
                "timer_v0.1.onnx": "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/timer_v0.1.onnx",
                "weather_v0.1.onnx": "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/weather_v0.1.onnx",
            }

            if model_filename in predefined_models:
                logger.info(
                    f"Model {model_filename} not found. Downloading from openWakeWord..."
                )
                try:
                    # Ensure directory exists
                    os.makedirs(model_dir, exist_ok=True)

                    openwakeword.utils.download_file(
                        predefined_models[model_filename],
                        model_dir,
                    )
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

        # Validate and sanitize the cache directories
        model_dir = validate_and_sanitize_cache_dir(model_dir)

        # Create the directories if they don't exist
        create_cache_directory(model_dir)

        model_names = ["embedding_model", "melspectrogram", "silero_vad"]
        models_to_download = []

        for model_name in model_names:
            model_path = os.path.join(model_dir, f"{model_name}.onnx")
            if not os.path.isfile(model_path):
                models_to_download.append(model_name)

        if models_to_download:
            logger.info(f"Downloading models: {', '.join(models_to_download)}")
            openwakeword.utils.download_models(model_names=models_to_download)
        else:
            logger.info("All required models are already present.")

    def load_models(self, model_paths: list[str], vad_threshold: float = 0.2):
        """Load wake word detection models.

        Args:
            model_paths: List of model file paths to load
            vad_threshold: VAD threshold for voice activity detection

        Raises:
            ValueError: If no models are specified
            Exception: If model loading fails
        """
        if not model_paths:
            raise ValueError("No wake word models specified.")

        try:
            self.model = Model(
                wakeword_models=model_paths,
                inference_framework="onnx",
                vad_threshold=vad_threshold,
            )
            self.model_paths = model_paths
            self.vad_threshold = vad_threshold

            logger.info("Wake word model loaded successfully!")
            logger.info(f"Available models: {list(self.model.models.keys())}")
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            raise

    def reload_models(self, model_filenames: list[str], vad_threshold: float = 0.2):
        """Reload wake word models with new configuration.

        Args:
            model_filenames: List of model filenames to load
            vad_threshold: VAD threshold for voice activity detection

        Raises:
            ValueError: If no models are provided
        """
        if not model_filenames:
            raise ValueError("No model filenames provided for reloading.")

        # Resolve new model paths
        new_paths = [self.resolve_model_path(model) for model in model_filenames]

        # Load the new models
        self.load_models(new_paths, vad_threshold)

    def predict(self, audio_chunk):
        """Run prediction on an audio chunk.

        Args:
            audio_chunk: Audio data to process

        Returns:
            Prediction results from the model

        Raises:
            RuntimeError: If model is not loaded
        """
        if self.model is None:
            raise RuntimeError("Model not loaded")

        return self.model.predict(audio_chunk)

    def get_model_names(self) -> list[str]:
        """Get list of loaded model names."""
        if self.model is None:
            return []
        return list(self.model.models.keys())

    def is_model_loaded(self, filename: str) -> bool:
        """Check if a specific model file is currently loaded.

        Args:
            filename: Model filename to check

        Returns:
            True if the model is loaded, False otherwise
        """
        if self.model is None:
            return False

        model_name = filename.replace(".onnx", "")
        return model_name in self.model.models

    def list_available_models(self) -> list[dict]:
        """List all available wake word models in the models directory.

        Returns:
            List of model information dictionaries
        """
        model_dir = self.get_model_directory()

        if not os.path.exists(model_dir):
            return []

        # Find all .onnx files
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
