# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Convert Wav2Lip PyTorch model to OpenVINO IR format.

This script converts the Wav2Lip encoder/decoder model from a PyTorch .pth
checkpoint into OpenVINO Intermediate Representation (.xml/.bin) files for
optimized inference on Intel hardware (CPU, GPU, NPU).

Based on: https://docs.openvino.ai/2024/notebooks/wav2lip-with-output.html

Usage:
    python convert_to_openvino.py [--checkpoint PATH] [--output PATH] [--img-size 256] [--batch-size 16]
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import torch
import openvino as ov

script_dir = Path(__file__).parent.resolve()
sys.path.insert(0, str(script_dir))

from modules.lipsync.wav2lip.wav2lip256.models import Wav2Lip as Wav2Lip256


def load_pytorch_model(checkpoint_path: str) -> torch.nn.Module:
    """Load the Wav2Lip PyTorch model from a checkpoint file."""
    model = Wav2Lip256()
    checkpoint = torch.load(
        checkpoint_path, map_location=lambda storage, loc: storage, weights_only=True
    )
    state_dict = checkpoint["state_dict"]
    new_state_dict = {}
    for k, v in state_dict.items():
        new_state_dict[k.replace("module.", "")] = v
    model.load_state_dict(new_state_dict)
    model.eval()
    return model


def convert_wav2lip_to_openvino(
    checkpoint_path: str,
    output_path: str,
    img_size: int = 256,
    batch_size: int = 16,
) -> Path:
    """Convert the Wav2Lip model to OpenVINO IR format."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if output_path.exists():
        print(f"OpenVINO model already exists: {output_path}")
        return output_path

    print(f"Loading PyTorch checkpoint: {checkpoint_path}")
    model = load_pytorch_model(checkpoint_path)

    mel_batch = torch.FloatTensor(np.random.rand(batch_size, 1, 80, 16))
    img_batch = torch.FloatTensor(np.random.rand(batch_size, 6, img_size, img_size))

    example_inputs = {
        "audio_sequences": mel_batch,
        "face_sequences": img_batch,
    }

    print("Converting Wav2Lip model to OpenVINO IR...")
    ov_model = ov.convert_model(model, example_input=example_inputs)

    # Set dynamic batch dimension for flexible inference
    for input_tensor in ov_model.inputs:
        shape = input_tensor.get_partial_shape()
        shape[0] = -1  # dynamic batch
        input_tensor.get_node().set_partial_shape(shape)
    ov_model.validate_nodes_and_infer_types()

    ov.save_model(ov_model, str(output_path), compress_to_fp16=True)
    print(f"Saved OpenVINO model (FP16): {output_path}")
    return output_path


def _synthetic_speech_mel(img_size: int = 256):
    """Generate a speech-like mel spectrogram matching Wav2Lip's audio pipeline.

    Wav2Lip mels are symmetric-normalized to roughly [-4, 4] (hparams:
    symmetric_mels=True, max_abs_value=4). Uniform random noise in [0, 1) does
    NOT resemble this, so calibrating on noise produces wrong activation ranges
    for the audio encoder and badly degrades the quantized model. Here we
    synthesize a voiced, syllable-modulated waveform and run it through the
    model's own melspectrogram to get a realistic distribution.
    """
    from modules.lipsync.wav2lip.wav2lip256 import audio as a256

    sr, dur = 16000, 6.0
    t = np.arange(int(sr * dur)) / sr
    f0 = 120 + 40 * np.sin(2 * np.pi * 0.7 * t)  # wandering pitch 80-160 Hz
    phase = 2 * np.pi * np.cumsum(f0) / sr
    voiced = sum((1.0 / h) * np.sin(h * phase) for h in range(1, 12))
    syllable = 0.5 * (1 + np.sin(2 * np.pi * 4.0 * t))  # ~4 Hz syllable rate
    breath = 0.05 * np.random.randn(t.size)
    wav = ((voiced * syllable) + breath).astype(np.float32)
    wav = 0.9 * wav / np.max(np.abs(wav))
    return a256.melspectrogram(wav)  # (80, T)


def _load_calibration_faces(avatar_path: str, img_size: int):
    """Load real avatar face crops as float images for calibration."""
    import cv2
    from glob import glob

    face_dir = Path(avatar_path) / "face_images"
    paths = sorted(
        glob(f"{face_dir}/*.[jpJP][pnPN]*[gG]"),
        key=lambda x: int(Path(x).stem),
    )
    faces = [cv2.imread(p) for p in paths]
    faces = [f for f in faces if f is not None]
    if not faces:
        return None
    faces = [cv2.resize(f, (img_size, img_size)) for f in faces]
    return np.asarray(faces)  # (N, H, W, 3) uint8


def build_calibration_data(
    avatar_path: str,
    img_size: int = 256,
    batch_size: int = 16,
    num_samples: int = 32,
):
    """Build representative calibration batches matching real inference inputs.

    The face branch input is a 6-channel concat of [lower-half-masked, original]
    normalized to [0, 1] (see Wav2lipAvatar._run_lipsync_inference); the audio
    branch input is a symmetric mel in ~[-4, 4]. Calibrating on data that matches
    these distributions is what keeps INT8 lipsync quality close to FP16.
    """
    faces = _load_calibration_faces(avatar_path, img_size)
    if faces is None:
        print(
            f"WARNING: no calibration faces at {avatar_path}; "
            "falling back to random face data (lower INT8 quality)."
        )
        faces = (np.random.rand(batch_size, img_size, img_size, 3) * 255).astype(
            np.uint8
        )

    mel = _synthetic_speech_mel(img_size)
    step, n_faces = 16, len(faces)
    max_start = max(1, mel.shape[1] - step)

    def face_batch(offset):
        idx = [(offset + i) % n_faces for i in range(batch_size)]
        batch = faces[idx]
        masked = batch.copy()
        masked[:, img_size // 2 :] = 0
        img6 = np.concatenate((masked, batch), axis=3) / 255.0
        return np.transpose(img6, (0, 3, 1, 2)).astype(np.float32)

    def mel_batch(offset):
        chunks = [
            mel[:, (offset * 7 + i) % max_start : (offset * 7 + i) % max_start + step]
            for i in range(batch_size)
        ]
        arr = np.asarray(chunks)[:, :, :, None]
        return np.transpose(arr, (0, 3, 1, 2)).astype(np.float32)

    return [
        {"audio_sequences": mel_batch(k), "face_sequences": face_batch(k)}
        for k in range(num_samples)
    ]


def quantize_wav2lip_to_int8(
    fp16_model_path: str,
    output_path: str,
    avatar_path: str,
    img_size: int = 256,
    batch_size: int = 16,
    num_calibration_samples: int = 32,
) -> Path:
    """Quantize FP16 OpenVINO model to INT8 using NNCF post-training quantization.

    Uses realistic calibration data (real avatar faces + speech-like mels) so the
    quantized model preserves lip motion. Wav2Lip is a convolutional
    encoder/decoder, so we do NOT pass model_type=TRANSFORMER (which applies
    attention-oriented quantization logic inappropriate for a CNN).
    """
    import nncf

    output_path = Path(output_path)
    if output_path.exists():
        print(f"INT8 model already exists: {output_path}")
        return output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)

    core = ov.Core()
    model = core.read_model(fp16_model_path)

    samples = build_calibration_data(
        avatar_path=avatar_path,
        img_size=img_size,
        batch_size=batch_size,
        num_samples=num_calibration_samples,
    )
    calibration_data = nncf.Dataset(samples, lambda s: s)

    print("Running NNCF post-training quantization (INT8)...")
    quantized_model = nncf.quantize(
        model,
        calibration_data,
        preset=nncf.QuantizationPreset.MIXED,
    )

    ov.save_model(quantized_model, str(output_path))
    print(f"Saved INT8 model: {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Convert Wav2Lip model to OpenVINO IR")
    parser.add_argument(
        "--checkpoint",
        type=str,
        default="models/wav2lip/checkpoints/wav2lipv2.pth",
        help="Path to the PyTorch checkpoint file",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="models/wav2lip/checkpoints/wav2lipv2_ov/wav2lip.xml",
        help="Output path for the OpenVINO IR model (.xml)",
    )
    parser.add_argument(
        "--img-size",
        type=int,
        default=256,
        help="Face image size (default: 256)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=16,
        help="Batch size for example input (default: 16)",
    )
    args = parser.parse_args()

    checkpoint_path = Path(args.checkpoint)
    if not checkpoint_path.exists():
        print(f"Error: Checkpoint not found: {checkpoint_path}")
        sys.exit(1)

    convert_wav2lip_to_openvino(
        checkpoint_path=str(checkpoint_path),
        output_path=args.output,
        img_size=args.img_size,
        batch_size=args.batch_size,
    )


if __name__ == "__main__":
    main()
