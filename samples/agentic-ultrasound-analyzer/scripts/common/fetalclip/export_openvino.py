# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Export FetalCLIP image encoder to OpenVINO IR format.

Run once to generate the IR files:
    python -m common.fetalclip.export_openvino --device GPU

Produces:
    common/fetalclip/fetalclip_image_encoder.xml
    common/fetalclip/fetalclip_image_encoder.bin
    common/fetalclip/fetalclip_text_features.pt  (pre-computed text embeddings)
"""

import os
import sys
import json
import argparse
import torch
import numpy as np
import open_clip
from pathlib import Path
import openvino as ov

# Ensure project root is importable
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def export(output_model_path=None, device: str = "GPU"):
    base_dir = Path(__file__).parent
    config_path = base_dir / "FetalCLIP_config.json"
    weights_path = base_dir / "FetalCLIP_weights.pt"
    output_xml = Path(output_model_path) if output_model_path else base_dir / "fetalclip_image_encoder.xml"
    output_xml = output_xml.expanduser().resolve()
    output_xml.parent.mkdir(parents=True, exist_ok=True)
    text_features_path = base_dir / "fetalclip_text_features.pt"

    if not weights_path.exists():
        print(f"ERROR: Weights not found at {weights_path}")
        sys.exit(1)

    print("Loading FetalCLIP model...")
    with open(config_path, "r") as f:
        config_data = json.load(f)
    open_clip.factory._MODEL_CONFIGS["FetalCLIP"] = config_data

    model, _, preprocess = open_clip.create_model_and_transforms(
        "FetalCLIP", pretrained=str(weights_path)
    )
    model.eval()

    # --- Pre-compute text features ---
    from common.fetalclip.classifier import (
        FETAL_DETECTION_PROMPTS,
        FETAL_PLANE_PROMPTS,
    )

    tokenizer = open_clip.get_tokenizer("FetalCLIP")

    print("Pre-computing text features...")
    with torch.no_grad():
        fetal_tokens = tokenizer(FETAL_DETECTION_PROMPTS["fetal"])
        nonfetal_tokens = tokenizer(FETAL_DETECTION_PROMPTS["non_fetal"])
        plane_tokens = tokenizer(list(FETAL_PLANE_PROMPTS.values()))

        fetal_text_features = model.encode_text(fetal_tokens)
        fetal_text_features /= fetal_text_features.norm(dim=-1, keepdim=True)

        nonfetal_text_features = model.encode_text(nonfetal_tokens)
        nonfetal_text_features /= nonfetal_text_features.norm(dim=-1, keepdim=True)

        plane_text_features = model.encode_text(plane_tokens)
        plane_text_features /= plane_text_features.norm(dim=-1, keepdim=True)

    # Save pre-computed text features
    torch.save(
        {
            "fetal": fetal_text_features,
            "nonfetal": nonfetal_text_features,
            "plane": plane_text_features,
            "plane_labels": list(FETAL_PLANE_PROMPTS.keys()),
        },
        text_features_path,
    )
    print(f"✅ Text features saved: {text_features_path}")

    # --- Export image encoder to OpenVINO via ONNX ---
    print("Exporting image encoder to ONNX...")

    # Create a wrapper that only does image encoding
    class ImageEncoderWrapper(torch.nn.Module):
        def __init__(self, clip_model):
            super().__init__()
            self.visual = clip_model.visual

        def forward(self, x):
            return self.visual(x)

    encoder = ImageEncoderWrapper(model)
    encoder.eval()

    # Trace with dummy input (224x224 is the expected input size)
    dummy_input = torch.randn(1, 3, 224, 224)
    onnx_path = output_xml.with_suffix(".onnx")

    torch.onnx.export(
        encoder,
        dummy_input,
        str(onnx_path),
        input_names=["pixel_values"],
        output_names=["image_features"],
        dynamic_axes={"pixel_values": {0: "batch"}, "image_features": {0: "batch"}},
        # Keep LayerNormalization at its supported ONNX opset instead of downgrading it.
        opset_version=18,
    )
    print(f"   ONNX saved: {onnx_path}")

    print("Converting ONNX to OpenVINO IR...")  
    # Converts ONNX model to OpenVINO IR with static input shape
    ov_model = ov.convert_model(str(onnx_path), input=[1, 3, 224, 224])
    ov.save_model(ov_model, str(output_xml))
    print(f"✅ OpenVINO IR saved: {output_xml}")

    # Clean up ONNX
    onnx_path.unlink()

    # Verify inference with the optimized model on the selected device
    core = ov.Core()
    compiled = core.compile_model(ov_model, device)
    result = compiled(dummy_input.numpy())
    print(f"   Verification: output shape = {result[0].shape}")
    print(f"\nDone! FetalCLIP is now ready for {device} inference.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export FetalCLIP image encoder to OpenVINO IR.")
    parser.add_argument(
        "--output-model-path",
        type=Path,
        help="Destination XML path for the OpenVINO model (defaults beside this script).",
    )
    parser.add_argument(
        "--device",
        default="CPU",
        help="OpenVINO device to use for verification (default: CPU)",
    )
    args = parser.parse_args()
    export(args.output_model_path, args.device)
