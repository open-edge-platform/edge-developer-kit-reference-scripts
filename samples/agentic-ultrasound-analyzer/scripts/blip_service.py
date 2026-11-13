# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
BLIP Embedding Microservice — FastAPI server for image/text embeddings.

Runs OpenVINO BLIP model as a standalone service, decoupling it from
the main Flask backend.  Accepts image files or text and returns
L2-normalised embeddings (dimension 256).

Usage:
    python blip_service.py                       # uses BLIP_SERVICE_PORT, GPU
    python blip_service.py --vision-device GPU --text-device GPU
    BLIP_VISION_DEVICE=CPU python blip_service.py
"""

import argparse
from pathlib import Path
import io
import os
import time

import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image
import openvino as ov
from common.device_selection import resolve_device
from common.openvino_blip.openvino_blip_embeddings import OpenVINOBlipEmbeddings

# ---------------------------------------------------------------------------
# Configuration (env vars override CLI defaults)
# ---------------------------------------------------------------------------
BLIP_MODEL = os.environ.get("BLIP_MODEL", "Salesforce/blip-itm-base-coco")
BLIP_SERVICE_PORT = int(os.environ.get("BLIP_SERVICE_PORT", "15100"))
if os.environ.get("CPU_MODE", "1") == "1":
    for device_env in (
        "IMG_EMBEDDING_DEVICE",
        "TXT_EMBEDDING_DEVICE",
    ):
        os.environ[device_env] = "CPU"
_OPENVINO_AVAILABLE_DEVICES = ov.Core().available_devices
BLIP_VISION_DEVICE = resolve_device(os.environ.get("IMG_EMBEDDING_DEVICE", "NPU"), _OPENVINO_AVAILABLE_DEVICES)
BLIP_TEXT_DEVICE = resolve_device(os.environ.get("TXT_EMBEDDING_DEVICE", "GPU"), _OPENVINO_AVAILABLE_DEVICES)

app = FastAPI(title="BLIP Embedding Service")

embedder: OpenVINOBlipEmbeddings | None = None


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
@app.on_event("startup")
def load_model():
    global embedder
    print(f"Loading BLIP model: {BLIP_MODEL}")
    print(f"  Vision device: {BLIP_VISION_DEVICE}")
    print(f"  Text   device: {BLIP_TEXT_DEVICE}")
    model_dir = Path(__file__).resolve().parent / "models" / "blip_embeddings"
    model_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    embedder = OpenVINOBlipEmbeddings(
        model_id=BLIP_MODEL,
        ov_vision_proj_model=str(model_dir / "blip_vision_proj_model.xml"),
        ov_text_proj_model=str(model_dir / "blip_text_proj_model.xml"),
        ov_vision_device=BLIP_VISION_DEVICE,
        ov_text_device=BLIP_TEXT_DEVICE,
    )
    elapsed = time.perf_counter() - t0
    print(f"BLIP model loaded in {elapsed:.2f}s")


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "model": BLIP_MODEL,
            "vision_device": BLIP_VISION_DEVICE,
            "text_device": BLIP_TEXT_DEVICE}


# ---------------------------------------------------------------------------
# POST /embed_image  — accepts multipart image file
# ---------------------------------------------------------------------------
@app.post("/embed_image")
async def embed_image(image: UploadFile = File(...)):
    if embedder is None:
        raise HTTPException(503, "Model not loaded")

    try:
        data = await image.read()
        pil_img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:
        raise HTTPException(400, f"Invalid image: {exc}")

    t0 = time.perf_counter()
    arr = np.array(pil_img)
    embedding = embedder.embed_image(arr)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    # Convert numpy array to plain list of floats
    vec = embedding.tolist() if hasattr(embedding, "tolist") else list(embedding)
    return {"embedding": vec, "dim": len(vec), "elapsed_ms": round(elapsed_ms, 2)}


# ---------------------------------------------------------------------------
# POST /embed_text  — accepts form field or JSON
# ---------------------------------------------------------------------------
@app.post("/embed_text")
async def embed_text(text: str = Form(...)):
    if embedder is None:
        raise HTTPException(503, "Model not loaded")

    if not text or not text.strip():
        raise HTTPException(400, "Text is empty")

    t0 = time.perf_counter()
    embedding = embedder.embed_query(text)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    vec = embedding.tolist() if hasattr(embedding, "tolist") else list(embedding)
    return {"embedding": vec, "dim": len(vec), "elapsed_ms": round(elapsed_ms, 2)}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BLIP Embedding Microservice")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=BLIP_SERVICE_PORT)
    parser.add_argument("--vision-device", default=BLIP_VISION_DEVICE)
    parser.add_argument("--text-device", default=BLIP_TEXT_DEVICE)
    args = parser.parse_args()

    # Push CLI overrides into globals so startup sees them
    BLIP_VISION_DEVICE = args.vision_device
    BLIP_TEXT_DEVICE = args.text_device

    print("=" * 60)
    print("  BLIP EMBEDDING MICROSERVICE")
    print("=" * 60)
    print(f"  Host          : {args.host}")
    print(f"  Port          : {args.port}")
    print(f"  Vision device : {args.vision_device}")
    print(f"  Text device   : {args.text_device}")
    print("=" * 60)

    uvicorn.run(app, host=args.host, port=args.port)
