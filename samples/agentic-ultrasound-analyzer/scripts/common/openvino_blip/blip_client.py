# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
BLIP Service HTTP Client — drop-in replacement for OpenVINOBlipEmbeddings.

Provides the same public interface (embed_image, embed_query, embed_images,
embed_documents) but delegates to a remote BLIP microservice over HTTP.

Usage:
    from common.openvino_blip.blip_client import BlipServiceClient

    client = BlipServiceClient()
    embedding = client.embed_image("path/to/image.png")
    embedding = client.embed_query("ultrasound of left kidney")
"""

import io
import os
from pathlib import Path
from typing import List

import numpy as np
import requests
from PIL import Image


class BlipServiceClient:
    """HTTP client that mirrors the OpenVINOBlipEmbeddings interface."""

    def __init__(self, base_url: str | None = None, timeout: float = 30):
        if base_url is None:
            base_url = os.environ.get(
                "BLIP_SERVICE_URL",
                f"http://localhost:{os.environ.get('BLIP_SERVICE_PORT', '15100')}",
            )
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._session = requests.Session()

    # ----- image embeddings -----

    def embed_image(self, image) -> np.ndarray:
        """Embed a single image. Accepts file path (str/Path) or numpy array."""
        if isinstance(image, (str, Path)):
            image_path = Path(image)
            if not image_path.exists():
                raise ValueError(f"Image file {image_path} does not exist.")
            with open(image_path, "rb") as f:
                data = f.read()
            filename = image_path.name
        elif isinstance(image, np.ndarray):
            pil_img = Image.fromarray(image)
            buf = io.BytesIO()
            pil_img.save(buf, format="PNG")
            data = buf.getvalue()
            filename = "image.png"
        else:
            raise ValueError("Image must be a file path or a numpy array.")

        resp = self._session.post(
            f"{self.base_url}/embed_image",
            files={"image": (filename, data, "image/png")},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        vec = resp.json()["embedding"]
        return np.array(vec, dtype=np.float32)

    def embed_images(self, image_uris: List[str]) -> List[np.ndarray]:
        """Embed multiple images sequentially."""
        return [self.embed_image(uri) for uri in image_uris]

    # ----- text embeddings -----

    def embed_query(self, text: str) -> np.ndarray:
        """Embed a single text string."""
        if not text:
            print("Text is empty.")
            return None
        resp = self._session.post(
            f"{self.base_url}/embed_text",
            data={"text": text},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        vec = resp.json()["embedding"]
        return np.array(vec, dtype=np.float32)

    def embed_documents(self, texts: List[str]) -> List[np.ndarray]:
        """Embed multiple texts sequentially."""
        return [self.embed_query(t) for t in texts]
