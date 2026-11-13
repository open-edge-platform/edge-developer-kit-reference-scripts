# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from pathlib import Path
from typing import Any, Dict, List
import os
import json
import openvino as ov
import numpy as np
import requests
import torch.nn as nn

from transformers import BlipProcessor, BlipForImageTextRetrieval
from PIL import Image
from common.device_selection import resolve_device
from common.numerics import safe_l2_normalize

# Helper classes for OpenVINO BLIP embeddings
class VisionEmbeddings(nn.Module):
    def __init__(self, vision_model, vision_proj):
        super().__init__()
        self.vision_model = vision_model
        self.vision_proj = vision_proj
    
    def forward(self, pixel_values):
        vision_outputs = self.vision_model(pixel_values)
        image_cls = vision_outputs[0][:, 0, :]
        return self.vision_proj(image_cls)

# Helper classes for OpenVINO BLIP embeddings
class TextEmbeddings(nn.Module):
    def __init__(self, text_encoder, text_proj):
        super().__init__()
        self.text_encoder = text_encoder
        self.text_proj = text_proj

    def forward(self, input_ids, attention_mask):
        text_outputs = self.text_encoder(input_ids=input_ids, attention_mask=attention_mask)
        text_cls = text_outputs[0][:, 0, :]
        return self.text_proj(text_cls)

# Class for creating OpenVINO BLIP embeddings
# This class is used to create embeddings for images and text using the BLIP model
class OpenVINOBlipEmbeddings(object):
    """OpenVINO Blip embedding model integration.

    Key init args — completion params:
        model: str
            Name of OpenVINO BLIP model to use. Currently supports "Salesforce/blip-itm-base-coco".
        ov_vision_device: str
            Device to use for inference. Options: "GPU", "CPU", "NPU".
        ov_text_device: str
            Device to use for inference. Options: "GPU", "CPU". NPU is not supported for text embeddings.
        ov_vision_proj_model: str
            Path to OpenVINO vision projection model file.
        ov_text_proj_model: str
            Path to OpenVINO text projection model file.

    See full list of supported init args and their descriptions in the params section.
    NPU does not support text embeddings currently due to static shape limitation.

    Instantiate:
        .. code-block:: python

            from langchain_openvino_multimodal import OpenvinoBlipEmbeddings

            embed = OpenvinoBlipEmbeddings(
                model_id="Salesforce/blip-itm-base-coco",
                ov_vision_device="GPU",
                ov_text_device="GPU",
            )

    Embed single text:
        .. code-block:: python

            input_text = "A photo of a cat"
            embed.embed_query(input_text)

    Embed multiple text:
        .. code-block:: python

            input_texts = ["Document 1...", "Document 2..."]
            embed.embed_documents(input_texts)

        .. code-block:: python

    Embed single image:
        .. code-block:: python

            input_image = "path/to/image.jpg"
            embed.embed_image(input_image)
    
    Embed multiple images:
        .. code-block:: python

            input_images = ["path/to/image1.jpg", "path/to/image2.jpg"]
            embed.embed_images(input_images)

    """
    model_id: str = "Salesforce/blip-itm-base-coco"
    ov_vision_proj_model: str = "blip_vision_proj_model.xml"
    ov_text_proj_model: str = "blip_text_proj_model.xml"
    ov_vision_device: str = "GPU"
    ov_text_device: str = "GPU"

    @staticmethod
    def _artifact_paths(model_xml_path: Path) -> List[Path]:
        """Return XML and sidecar BIN paths for a given OpenVINO model path."""
        bin_path = model_xml_path.with_suffix(".bin")
        return [model_xml_path, bin_path]

    @staticmethod
    def _delete_artifacts(paths: List[Path]) -> None:
        for path in paths:
            if path.exists():
                path.unlink()
                print(f"Deleted stale BLIP artifact: {path}")

    def _cleanup_if_device_changed(self, ov_vision_proj_model: Path, ov_text_proj_model: Path) -> None:
        """Delete cached BLIP XML/BIN files when configured devices change."""
        allow_reexport = os.environ.get("BLIP_ALLOW_REEXPORT_ON_DEVICE_CHANGE", "0").strip().lower() in {"1", "true", "yes", "on"}
        config_path = ov_vision_proj_model.parent / ".blip_device_config.json"
        current = {
            "ov_vision_device": self.ov_vision_device,
            "ov_text_device": self.ov_text_device,
        }

        previous = None
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    previous = json.load(f)
            except Exception:
                previous = None

        if previous and previous != current:
            if allow_reexport:
                print("BLIP device change detected, removing cached XML/BIN files.")
                self._delete_artifacts(self._artifact_paths(ov_vision_proj_model))
                self._delete_artifacts(self._artifact_paths(ov_text_proj_model))
            else:
                print("BLIP device change detected; keeping cached XML/BIN files (set BLIP_ALLOW_REEXPORT_ON_DEVICE_CHANGE=1 to force re-export).")

        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
    
    def __init__(self, model_id: str = "Salesforce/blip-itm-base-coco",
                 ov_vision_proj_model: str = "blip_vision_proj_model.xml",
                 ov_text_proj_model: str = "blip_text_proj_model.xml",
                 ov_vision_device: str = "GPU",
                 ov_text_device: str = "GPU") -> None:

        if "blip-itm-base-coco" not in model_id:
            raise ValueError("Only BLIP ITM COCO model is currently supported.")
        
        print("openvino-BLIP: Device-aware cache cleanup is enabled for BLIP XML/BIN files.")
        
        core = ov.Core()
        available_devices = core.available_devices
        self.ov_vision_device = resolve_device(ov_vision_device, available_devices)
        self.ov_text_device = resolve_device(ov_text_device, available_devices)
        
        if self.ov_text_device == "NPU":
            raise ValueError("NPU device is not supported for text embedding.")
        
        ov_vision_proj_model = Path(ov_vision_proj_model)
        ov_text_proj_model = Path(ov_text_proj_model)
        self._cleanup_if_device_changed(ov_vision_proj_model, ov_text_proj_model)

        need_export = not ov_vision_proj_model.exists() or not ov_text_proj_model.exists()

        if need_export:
            self.model = BlipForImageTextRetrieval.from_pretrained(model_id)
            self.processor = BlipProcessor.from_pretrained(model_id, use_fast=True)
            self.model.eval()

            # Use a synthetic image for model tracing (no network required)
            image = Image.new("RGB", (384, 384), color=(128, 128, 128))
            text = "A woman and a dog sitting on a beach"
            inputs = self.processor(image, text, truncation=True, return_tensors="pt")

            if not ov_vision_proj_model.exists():
                vision_with_proj = VisionEmbeddings(self.model.vision_model, self.model.vision_proj)
                vision_with_proj.eval()
                # this is necessary for NPU - it doesnt accept dynamic shapes
                input_shapes = {
                                "pixel_values": (1, 3, 384, 384),
                            }
                ov_vision_proj = ov.convert_model(vision_with_proj, input=input_shapes, example_input=inputs["pixel_values"])
                ov.save_model(ov_vision_proj, ov_vision_proj_model)

            if not ov_text_proj_model.exists():
                text_with_proj = TextEmbeddings(self.model.text_encoder, self.model.text_proj)
                text_with_proj.eval()
                # text cant be done on NPU since it has dynamic shapes, GPU is okay
                example_dict = {
                    "input_ids": inputs["input_ids"],
                    "attention_mask": inputs["attention_mask"]
                }
                ov_text_proj = ov.convert_model(text_with_proj, example_input=example_dict)
                ov.save_model(ov_text_proj, ov_text_proj_model)

            del self.model
        else:
            print(f"Vision model with projection will be loaded from {ov_vision_proj_model} on {self.ov_vision_device} device.")
            print(f"Text model with projection will be loaded from {ov_text_proj_model} on {self.ov_text_device} device.")

        self.processor = BlipProcessor.from_pretrained(model_id, use_fast=True, local_files_only=not need_export)
        
        self.ov_vision_proj = core.compile_model(ov_vision_proj_model, self.ov_vision_device)
        self.ov_text_proj = core.compile_model(ov_text_proj_model, self.ov_text_device)

        import threading
        self.vision_lock = threading.Lock()
        self.text_lock = threading.Lock()
        print("Initialization complete.")

        print(f"{self.model_id} model initialized with vision device: {self.ov_vision_device}, text device: {self.ov_text_device}")

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed texts."""
        text_embeddings = []
        for text in texts:
            text_embedding = self.embed_query(text)
            text_embeddings.append(text_embedding)
        
        return text_embeddings

    def embed_query(self, text: str) -> List[float]:
        """Embed text."""
        if text:
            inputs = self.processor(text=text, truncation=True, return_tensors="pt")
            inputs = dict(inputs)
            with self.text_lock:
                text_proj = self.ov_text_proj(inputs)

            text_proj = list(text_proj.values())[0]
            text_proj = text_proj.squeeze(0)
            text_embedding_norm = safe_l2_normalize(text_proj)
            return text_embedding_norm
        else:
            print("Text is empty.")
            return None
        
    def embed_images(self, image_uris: List[str]) -> List[List[float]]:
        """Embed images."""
        image_embeddings = []
        for image in image_uris:
            image_embedding = self.embed_image(image)
            image_embeddings.append(image_embedding)
        
        return image_embeddings
        
    def embed_image(self, image: str | np.ndarray) -> List[float]:
        """Embed image."""
        if isinstance(image, str):
            image = Path(image)
            if not image.exists():
                raise ValueError(f"Image file {image} does not exist.")
            image = Image.open(image)
        elif isinstance(image, np.ndarray):
            image = Image.fromarray(image)
        else:
            raise ValueError("Image must be a file path or a numpy array.")
        
        inputs = self.processor(images=image, return_tensors="pt")
        with self.vision_lock:
            image_proj = self.ov_vision_proj(inputs["pixel_values"])

        image_proj = list(image_proj.values())[0]
        image_proj = image_proj.squeeze(0)
        image_embedding_norm = safe_l2_normalize(image_proj)

        return image_embedding_norm