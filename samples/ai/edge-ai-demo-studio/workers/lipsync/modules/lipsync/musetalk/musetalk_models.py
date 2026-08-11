# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""MuseTalk model management: download, OpenVINO conversion and shared
compiled-model caches.

MuseTalk (https://github.com/TMElyralab/MuseTalk) generates a lipsynced face
crop per frame with three networks:

  * a Whisper-tiny encoder turning 16 kHz audio into per-frame features of
    shape (50, 384): 10 audio tokens (2 per frame, +/-2 frames of context)
    stacked across the encoder's 5 hidden-state levels;
  * a single-step latent-inpainting UNet (SD-1.5 architecture, 384-dim
    cross-attention) fed 8-channel latents — the VAE latent of the
    mouth-masked face concatenated with the latent of the reference face;
  * the sd-vae-ft-mse VAE — the encoder only runs at avatar load time to
    precompute per-frame latents, the decoder runs per inferred batch.

PyTorch is only imported for the one-time IR conversion; the running service
stays OpenVINO-only, matching the Wav2Lip integration.
"""

import json
import time
from pathlib import Path
from threading import Lock

import numpy as np
import openvino as ov

from modules.base.logger import getLogger

MUSETALK_MODEL_DIR = Path("models/musetalk")
UNET_WEIGHTS_PATH = MUSETALK_MODEL_DIR / "musetalkV15" / "unet.pth"
UNET_CONFIG_PATH = MUSETALK_MODEL_DIR / "musetalkV15" / "musetalk.json"
VAE_DIR = MUSETALK_MODEL_DIR / "sd-vae"
WHISPER_DIR = MUSETALK_MODEL_DIR / "whisper"

OV_DIR = MUSETALK_MODEL_DIR / "ov"
OV_UNET_PATH = OV_DIR / "unet.xml"
OV_VAE_ENCODER_PATH = OV_DIR / "vae_encoder.xml"
OV_VAE_DECODER_PATH = OV_DIR / "vae_decoder.xml"
OV_WHISPER_PATH = OV_DIR / "whisper_encoder.xml"

FACE_SIZE = 256  # MuseTalk generates 256x256 face crops
LATENT_SIZE = FACE_SIZE // 8  # VAE downscales by 8
AUDIO_FEATURE_SHAPE = (50, 384)  # 10 whisper tokens x 5 hidden-state levels
WHISPER_MEL_SHAPE = (1, 80, 3000)  # whisper's fixed 30s log-mel window
VAE_ENCODE_BATCH = 4  # static batch for the (load-time only) encoder

_COMPILED_CACHE = {}
_CACHE_LOCK = Lock()


def download_musetalk_models(source="huggingface"):
    """Fetch the MuseTalk V1.5 UNet, sd-vae-ft-mse and whisper-tiny weights."""
    if source == "modelscope":
        from modelscope import snapshot_download
    else:
        from huggingface_hub import snapshot_download

    log = getLogger(__file__)
    if not UNET_WEIGHTS_PATH.exists() or not UNET_CONFIG_PATH.exists():
        log.info("Downloading MuseTalk V1.5 UNet...")
        snapshot_download(
            "TMElyralab/MuseTalk",
            local_dir=str(MUSETALK_MODEL_DIR),
            allow_patterns=["musetalkV15/*"],
        )
    if not (VAE_DIR / "config.json").exists():
        log.info("Downloading sd-vae-ft-mse VAE...")
        snapshot_download(
            "stabilityai/sd-vae-ft-mse",
            local_dir=str(VAE_DIR),
            allow_patterns=["config.json", "diffusion_pytorch_model.safetensors"],
        )
    if not (WHISPER_DIR / "preprocessor_config.json").exists():
        log.info("Downloading whisper-tiny audio encoder...")
        snapshot_download(
            "openai/whisper-tiny",
            local_dir=str(WHISPER_DIR),
            allow_patterns=[
                "config.json",
                "model.safetensors",
                "preprocessor_config.json",
                "generation_config.json",
            ],
        )
    log.info("MuseTalk models ready.")


def _sinusoidal_positional_encoding(seq_len, d_model):
    """The PositionalEncoding MuseTalk adds to whisper features before the
    UNet cross-attention (musetalk/models/unet.py)."""
    position = np.arange(seq_len, dtype=np.float64)[:, None]
    div_term = np.exp(
        np.arange(0, d_model, 2, dtype=np.float64) * (-np.log(10000.0) / d_model)
    )
    pe = np.zeros((seq_len, d_model), dtype=np.float64)
    pe[:, 0::2] = np.sin(position * div_term)
    pe[:, 1::2] = np.cos(position * div_term)
    return pe[None].astype(np.float32)  # (1, seq_len, d_model)


def convert_musetalk_to_openvino(batch_size=16):
    """Convert the MuseTalk networks to OpenVINO IR if not already done.

    The only place this module touches PyTorch; imported lazily so the
    running service stays OpenVINO-only once the IRs exist. Everything the
    reference pipeline applies around the raw networks (audio positional
    encoding, the zero diffusion timestep, VAE latent scaling) is folded into
    the exported graphs so the runtime feeds plain tensors.
    """
    if all(
        p.exists()
        for p in (OV_UNET_PATH, OV_VAE_ENCODER_PATH, OV_VAE_DECODER_PATH, OV_WHISPER_PATH)
    ):
        return

    import torch
    from diffusers import AutoencoderKL, UNet2DConditionModel
    from transformers import WhisperModel

    log = getLogger(__file__)
    OV_DIR.mkdir(parents=True, exist_ok=True)

    def _dynamic_batch(model):
        for input_tensor in model.inputs:
            shape = input_tensor.get_partial_shape()
            shape[0] = -1
            input_tensor.get_node().set_partial_shape(shape)
        model.validate_nodes_and_infer_types()

    if not OV_WHISPER_PATH.exists():
        log.info("Converting whisper-tiny encoder to OpenVINO IR...")
        whisper = WhisperModel.from_pretrained(WHISPER_DIR).eval()

        class WhisperEncoderWrapper(torch.nn.Module):
            """Whisper encoder returning all hidden-state levels stacked, the
            way MuseTalk's AudioProcessor consumes them: (1, 1500, 5, 384)."""

            def __init__(self, encoder):
                super().__init__()
                self.encoder = encoder

            def forward(self, audio_mel):
                out = self.encoder(audio_mel, output_hidden_states=True)
                return torch.stack(out.hidden_states, dim=2)

        with torch.no_grad():
            ov_model = ov.convert_model(
                WhisperEncoderWrapper(whisper.encoder),
                example_input={"audio_mel": torch.zeros(WHISPER_MEL_SHAPE)},
            )
        ov.save_model(ov_model, str(OV_WHISPER_PATH))
        del whisper
        log.info(f"Saved {OV_WHISPER_PATH}")

    if not OV_UNET_PATH.exists():
        log.info("Converting MuseTalk UNet to OpenVINO IR (this can take a while)...")
        with open(UNET_CONFIG_PATH) as f:
            unet_config = json.load(f)
        unet = UNet2DConditionModel.from_config(unet_config)
        weights = torch.load(UNET_WEIGHTS_PATH, map_location="cpu", weights_only=True)
        unet.load_state_dict(weights)
        unet.eval()

        class UNetWrapper(torch.nn.Module):
            """Single-step inpainting UNet with MuseTalk's audio positional
            encoding and the constant t=0 timestep folded in."""

            def __init__(self, unet):
                super().__init__()
                self.unet = unet
                self.register_buffer(
                    "pe",
                    torch.from_numpy(
                        _sinusoidal_positional_encoding(*AUDIO_FEATURE_SHAPE)
                    ),
                )
                self.register_buffer("timesteps", torch.tensor([0]))

            def forward(self, latent_model_input, audio_features):
                return self.unet(
                    latent_model_input,
                    self.timesteps,
                    encoder_hidden_states=audio_features + self.pe,
                ).sample

        with torch.no_grad():
            ov_model = ov.convert_model(
                UNetWrapper(unet),
                example_input={
                    "latent_model_input": torch.zeros(
                        batch_size, 8, LATENT_SIZE, LATENT_SIZE
                    ),
                    "audio_features": torch.zeros(batch_size, *AUDIO_FEATURE_SHAPE),
                },
            )
        _dynamic_batch(ov_model)
        ov.save_model(ov_model, str(OV_UNET_PATH))
        del unet
        log.info(f"Saved {OV_UNET_PATH}")

    if not OV_VAE_ENCODER_PATH.exists() or not OV_VAE_DECODER_PATH.exists():
        log.info("Converting sd-vae-ft-mse to OpenVINO IR...")
        vae = AutoencoderKL.from_pretrained(VAE_DIR).eval()
        scaling = vae.config.scaling_factor

        class VAEEncoderWrapper(torch.nn.Module):
            """Deterministic VAE encode: latent distribution mode, pre-scaled."""

            def __init__(self, vae):
                super().__init__()
                self.vae = vae

            def forward(self, images):
                return self.vae.encode(images).latent_dist.mode() * scaling

        class VAEDecoderWrapper(torch.nn.Module):
            def __init__(self, vae):
                super().__init__()
                self.vae = vae

            def forward(self, latents):
                return self.vae.decode(latents / scaling).sample

        with torch.no_grad():
            if not OV_VAE_ENCODER_PATH.exists():
                ov_model = ov.convert_model(
                    VAEEncoderWrapper(vae),
                    example_input={
                        "images": torch.zeros(
                            VAE_ENCODE_BATCH, 3, FACE_SIZE, FACE_SIZE
                        )
                    },
                )
                _dynamic_batch(ov_model)
                ov.save_model(ov_model, str(OV_VAE_ENCODER_PATH))
                log.info(f"Saved {OV_VAE_ENCODER_PATH}")
            if not OV_VAE_DECODER_PATH.exists():
                ov_model = ov.convert_model(
                    VAEDecoderWrapper(vae),
                    example_input={
                        "latents": torch.zeros(
                            batch_size, 4, LATENT_SIZE, LATENT_SIZE
                        )
                    },
                )
                _dynamic_batch(ov_model)
                ov.save_model(ov_model, str(OV_VAE_DECODER_PATH))
                log.info(f"Saved {OV_VAE_DECODER_PATH}")
        del vae


def ensure_musetalk_openvino_models(source="huggingface", batch_size=16):
    """Download and convert everything MuseTalk needs (idempotent)."""
    needed = (OV_UNET_PATH, OV_VAE_ENCODER_PATH, OV_VAE_DECODER_PATH, OV_WHISPER_PATH)
    if not all(p.exists() for p in needed):
        download_musetalk_models(source)
        convert_musetalk_to_openvino()
    # The whisper feature extractor config is needed at runtime even when the
    # IRs already exist.
    if not (WHISPER_DIR / "preprocessor_config.json").exists():
        download_musetalk_models(source)


def _compile(model_path, device, reshape=None):
    core = ov.Core()
    model = core.read_model(model_path)
    if reshape is not None:
        # Static shapes: NPU requires them, and the GPU plugin is dramatically
        # slower with dynamic shapes (see the Wav2Lip integration).
        model.reshape(reshape)
    compiled = core.compile_model(model, device)
    return compiled, compiled.create_infer_request()


def get_shared_musetalk_inference(device, batch_size):
    """Compiled UNet + VAE decoder pair (static batch) shared by every session
    using the same parameters, with the lock serializing their shared infer
    requests."""
    device = device.upper()
    key = ("unet_vae", device, batch_size)
    with _CACHE_LOCK:
        entry = _COMPILED_CACHE.get(key)
        if entry is None:
            log = getLogger(__file__)
            log.info(f"Compiling MuseTalk UNet + VAE decoder on {device} (batch {batch_size})...")
            unet, unet_request = _compile(
                OV_UNET_PATH,
                device,
                {
                    "latent_model_input": [batch_size, 8, LATENT_SIZE, LATENT_SIZE],
                    "audio_features": [batch_size, *AUDIO_FEATURE_SHAPE],
                },
            )
            vae, vae_request = _compile(
                OV_VAE_DECODER_PATH,
                device,
                {"latents": [batch_size, 4, LATENT_SIZE, LATENT_SIZE]},
            )
            entry = {
                "unet": unet,
                "unet_request": unet_request,
                "vae_decoder": vae,
                "vae_decoder_request": vae_request,
                "lock": Lock(),
            }
            # Warm up so the first real batch doesn't pay lazy-allocation cost.
            latents = np.zeros(
                (batch_size, 8, LATENT_SIZE, LATENT_SIZE), dtype=np.float32
            )
            audio = np.zeros((batch_size, *AUDIO_FEATURE_SHAPE), dtype=np.float32)
            pred = unet_request.infer(
                {"latent_model_input": latents, "audio_features": audio}
            )[unet.output(0)]
            vae_request.infer({"latents": pred})
            _COMPILED_CACHE[key] = entry
            log.info("MuseTalk UNet + VAE decoder ready.")
        return entry


def get_shared_whisper_encoder(device):
    """Compiled whisper encoder (fixed 30s mel window) and its lock."""
    device = device.upper()
    key = ("whisper", device)
    with _CACHE_LOCK:
        entry = _COMPILED_CACHE.get(key)
        if entry is None:
            getLogger(__file__).info(f"Compiling MuseTalk whisper encoder on {device}...")
            compiled, request = _compile(
                OV_WHISPER_PATH, device, {"audio_mel": list(WHISPER_MEL_SHAPE)}
            )
            request.infer(
                {"audio_mel": np.zeros(WHISPER_MEL_SHAPE, dtype=np.float32)}
            )
            entry = {"model": compiled, "request": request, "lock": Lock()}
            _COMPILED_CACHE[key] = entry
        return entry


def get_shared_vae_encoder(device):
    """Compiled VAE encoder (avatar load time only) and its lock."""
    device = device.upper()
    key = ("vae_encoder", device)
    with _CACHE_LOCK:
        entry = _COMPILED_CACHE.get(key)
        if entry is None:
            getLogger(__file__).info(f"Compiling MuseTalk VAE encoder on {device}...")
            compiled, request = _compile(
                OV_VAE_ENCODER_PATH,
                device,
                {"images": [VAE_ENCODE_BATCH, 3, FACE_SIZE, FACE_SIZE]},
            )
            entry = {"model": compiled, "request": request, "lock": Lock()}
            _COMPILED_CACHE[key] = entry
        return entry


def measure_musetalk_inference_fps(device, batch_size, runs=5):
    """Median frames/sec of one full UNet + VAE-decode batch on device.

    Uses (and warms) the same shared inference requests the sessions will use,
    so the number reflects what lip_sync actually gets.
    """
    entry = get_shared_musetalk_inference(device, batch_size)
    unet, unet_request = entry["unet"], entry["unet_request"]
    vae, vae_request = entry["vae_decoder"], entry["vae_decoder_request"]

    rng = np.random.default_rng(0)
    latents = rng.standard_normal(
        (batch_size, 8, LATENT_SIZE, LATENT_SIZE), dtype=np.float32
    )
    audio = rng.standard_normal(
        (batch_size, *AUDIO_FEATURE_SHAPE), dtype=np.float32
    )

    with entry["lock"]:
        times = []
        for _ in range(runs + 1):
            start = time.perf_counter()
            pred = unet_request.infer(
                {"latent_model_input": latents, "audio_features": audio}
            )[unet.output(0)]
            vae_request.infer({"latents": pred})
            times.append(time.perf_counter() - start)

    batch_time = sorted(times[1:])[len(times[1:]) // 2]
    fps = batch_size / batch_time
    getLogger(__file__).info(
        f"MuseTalk inference on {device}: {batch_time:.3f}s per batch of "
        f"{batch_size} => {fps:.1f} FPS"
    )
    return fps
