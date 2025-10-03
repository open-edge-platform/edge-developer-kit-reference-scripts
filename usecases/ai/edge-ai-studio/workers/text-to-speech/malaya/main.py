# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from huggingface_hub import snapshot_download
from malaya_speech.torch_model.vits.model_infer import SynthesizerTrn
from malaya_speech.torch_model.vits.commons import intersperse
from malaya_speech.utils.text import TTS_SYMBOLS
from malaya_speech.tts import load_text_ids
import torch
import os
import json
import time
import argparse
import psutil
import wave

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import socket
import io
import numpy as np
from schemas import OpenAISpeechRequest, VoicesResponse

try:
    from malaya_boilerplate.hparams import HParams
except BaseException:
    from malaya_boilerplate.train.config import HParams


# Global constants
AVAILABLE_VOICES = ["Husein", "Shafiqah Idayu", "Anwar Ibrahim"]
AVAILABLE_MODEL = "malaysia-ai/malay-VITS-multispeaker"
# Global variables for model state
model_state = {"model": None, "hps": None, "device": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan context manager for model loading and cleanup"""
    # Startup: Load the model
    print("Starting up Malaya TTS server...")

    # Get device and FP16 settings from app state
    device = getattr(app.state, "device", "auto")
    use_fp16 = getattr(app.state, "use_fp16", None)
    device = get_device(device)

    print(f"Loading Malaya TTS model on device: {device}")
    if use_fp16 is not None:
        print(f"FP16 mode: {'enabled' if use_fp16 else 'disabled'}")
    else:
        print(f"FP16 mode: auto (will use FP16 on XPU devices)")

    model, hps = load_model(device, use_fp16)

    # Store in global state
    model_state["model"] = model
    model_state["hps"] = hps
    model_state["device"] = device

    print("Model loaded successfully!")
    print(f"Available voices: {', '.join(AVAILABLE_VOICES)}")

    print("Warming up model")
    predefined_message = "Selamat datang ke Malaya TTS server."
    synthesize_speech(model, hps, predefined_message, AVAILABLE_VOICES[0], device, 1)
    print("Model warm-up completed.")

    yield

    # Shutdown: Clean up resources
    print("Shutting down Malaya TTS server...")
    model_state["model"] = None
    model_state["hps"] = None
    model_state["device"] = None
    print("Cleanup completed.")


def get_device(device_arg):
    """Get the appropriate device based on user selection and availability."""
    if device_arg == "AUTO":
        if hasattr(torch, "xpu") and torch.xpu.is_available():
            return "xpu"
        else:
            return "cpu"
    elif "xpu" in device_arg:
        if ":" in device_arg:
            device_id = device_arg.split(":")[-1]
            if hasattr(torch, "xpu") and torch.xpu.is_available():
                num_gpus = torch.xpu.device_count()
                if int(device_id) < num_gpus:
                    return f"xpu:{device_id}"
                else:
                    print(
                        f"Warning: XPU {device_id} not available, falling back to CPU"
                    )
                    return "cpu"
            else:
                print("Warning: XPU not available, falling back to CPU")
                return "cpu"
        else:
            return "xpu"
    else:
        return "cpu"


def load_model(device, use_fp16=None):
    """Load and configure the VITS model."""
    print("Loading model...")
    # Download model files
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))
    model_cache_dir = os.path.join(project_root, "models", "huggingface")
    folder = snapshot_download(
        repo_id=AVAILABLE_MODEL,
        cache_dir=model_cache_dir,
    )

    # Load configuration
    with open(os.path.join(folder, "config.json")) as fopen:
        hps = HParams(**json.load(fopen))

    # Initialize model
    model = SynthesizerTrn(
        len(TTS_SYMBOLS),
        hps.data.filter_length // 2 + 1,
        hps.train.segment_size // hps.data.hop_length,
        n_speakers=hps.data.n_speakers,
        **hps.model,
    ).eval()

    # Load weights and move to device
    model.load_state_dict(
        torch.load(os.path.join(folder, "model.pth"), map_location="cpu")
    )
    model = model.to(device)

    # Determine if we should use FP16
    should_use_fp16 = False
    if use_fp16 is None:
        # Auto-detect: use FP16 for XPU devices
        should_use_fp16 = device.startswith("xpu")
    else:
        should_use_fp16 = use_fp16

    # Convert to FP16 if requested and supported
    if should_use_fp16:
        print(f"Converting model to FP16 for GPU optimization...")
        model = model.half()  # Convert to FP16
        print(f"Model converted to FP16 successfully")

    return model, hps


def synthesize_speech(model, hps, text, speaker, device, speed=1.0):
    """Synthesize speech from text using the loaded model."""
    speaker_id = {
        "Husein": 0,
        "Shafiqah Idayu": 1,
        "Anwar Ibrahim": 2,
    }

    # Initialize text normalizer
    normalizer = load_text_ids(pad_to=None, understand_punct=True, is_lower=False)

    print(f"Synthesizing text: '{text}'")
    print(f"Using speaker: {speaker}")
    print(f"Using speed: {speed}")

    # Convert OpenAI speed to VITS length_scale
    # OpenAI speed: 1.0 = normal, >1.0 = faster, <1.0 = slower
    # VITS length_scale: 1.0 = normal, <1.0 = faster, >1.0 = slower
    # So we need to invert the relationship
    length_scale = 1.0 / speed

    # Normalize text
    t, ids = normalizer.normalize(text, add_fullstop=False)

    # Prepare tensors
    if hps.data.add_blank:
        ids = intersperse(ids, 0)
    ids = torch.LongTensor(ids).to(device)
    ids_lengths = torch.LongTensor([ids.size(0)]).to(device)
    ids = ids.unsqueeze(0)
    sid = torch.tensor([speaker_id[speaker]]).to(device)

    # Convert sid to match model dtype (important for FP16)
    model_dtype = next(model.parameters()).dtype
    if model_dtype == torch.float16:
        sid = sid.to(torch.int64)  # Keep sid as int64, but ensure it's compatible

    # Start timing the inference
    start_time = time.time()

    # Perform inference
    with torch.no_grad():
        audio = model.infer(
            ids,
            ids_lengths,
            noise_scale=0.0,
            noise_scale_w=0.0,
            length_scale=length_scale,
            sid=sid,
        )
        # Move result back to CPU for numpy conversion
        y_ = audio[0].cpu().numpy()

    # End timing
    end_time = time.time()
    inference_time = end_time - start_time

    return y_, inference_time


def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Malaya Speech TTS Server with OpenAI-compatible API"
    )
    parser.add_argument(
        "--device",
        type=str,
        default="auto",
        help="Device to use for inference (auto, cpu, xpu). Default: auto",
    )
    parser.add_argument(
        "--port",
        type=str,
        default="5004",
        help="Server port (default: 5004)",
    )
    parser.add_argument(
        "--fp16",
        action="store_true",
        help="Use FP16 precision for faster inference on GPU (default: auto-detect based on device)",
    )
    parser.add_argument(
        "--no-fp16",
        action="store_true",
        help="Disable FP16 precision even on GPU",
    )
    return parser.parse_args()


def get_local_ip():
    interfaces_stats = psutil.net_if_stats()
    interfaces_addrs = psutil.net_if_addrs()

    candidates = []

    for iface, stats in interfaces_stats.items():
        # Skip interfaces that are down
        if not stats.isup:
            continue

        # Skip loopback
        if iface.lower() == "lo" or iface.lower().startswith("loopback"):
            continue

        # Skip common virtual interfaces (VMware, Docker, Hyper-V, VirtualBox, etc.)
        if any(
            v in iface.lower()
            for v in [
                "vmware",
                "docker",
                "vbox",
                "virbr",
                "hyper-v",
                "br-",
                "tun",
                "tap",
                "wg",
            ]
        ):
            continue

        # Find IPv4 addresses for this interface
        for addr in interfaces_addrs.get(iface, []):
            if addr.family == socket.AF_INET:
                candidates.append((stats.speed, iface, addr.address))

    if not candidates:
        return None

    # Pick the interface with the highest speed
    best = max(candidates, key=lambda x: x[0])
    return best[2]


def setup_routes(app: FastAPI):
    """Setup FastAPI routes for TTS endpoints"""

    @app.post("/v1/audio/speech")
    async def create_speech(request: OpenAISpeechRequest):
        """OpenAI-compatible endpoint for text-to-speech using Malaya model"""

        # Check if model is loaded
        if model_state["model"] is None:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "service_unavailable",
                    "message": "Model is not loaded yet. Please wait for server startup to complete.",
                    "type": "server_error",
                },
            )

        # Validate supported voices
        if request.voice not in AVAILABLE_VOICES:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "invalid_voice",
                    "message": f"Unsupported voice: {request.voice}. Available voices: {', '.join(AVAILABLE_VOICES)}",
                    "type": "invalid_request_error",
                },
            )

        try:
            # Get model components from global state
            model = model_state["model"]
            hps = model_state["hps"]
            device = model_state["device"]

            # Synthesize speech using the loaded model
            print("speed: ", request.speed)
            audio_data, inference_time = synthesize_speech(
                model, hps, request.input, request.voice, device, request.speed
            )

            # Convert numpy array to bytes
            audio_data = audio_data.squeeze().astype(np.float32)

            # Convert to appropriate format
            if request.response_format == "wav":
                # Create WAV format bytes
                import wave

                buffer = io.BytesIO()
                with wave.open(buffer, "wb") as wav_file:
                    wav_file.setnchannels(1)  # Mono
                    wav_file.setsampwidth(2)  # 16-bit
                    wav_file.setframerate(hps.data.sampling_rate)
                    # Convert float32 to int16
                    audio_int16 = (audio_data * 32767).astype(np.int16)
                    wav_file.writeframes(audio_int16.tobytes())

                audio_bytes = buffer.getvalue()
                content_type = "audio/wav"

            else:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "invalid_format",
                        "message": f"Unsupported format: {request.response_format}. Supported formats: wav",
                        "type": "invalid_request_error",
                    },
                )

            # Log statistics
            audio_duration = len(audio_data) / hps.data.sampling_rate
            print(
                f"Generated audio for '{request.input[:50]}...' in {inference_time:.3f}s"
            )
            print(
                f"Audio duration: {audio_duration:.3f}s, RTF: {inference_time/audio_duration:.3f}x"
            )

            # Return streaming or non-streaming response based on request.stream
            if request.stream:
                # Create streaming response generator
                def audio_stream():
                    chunk_size = 9600  # Match the client's expected chunk size
                    for i in range(0, len(audio_bytes), chunk_size):
                        yield audio_bytes[i : i + chunk_size]

                return StreamingResponse(
                    audio_stream(),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"attachment; filename=speech.{request.response_format}",
                        "Cache-Control": "no-cache",
                    },
                )
            else:
                # Return complete audio file at once
                return Response(
                    content=audio_bytes,
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f"attachment; filename=speech.{request.response_format}",
                        "Cache-Control": "no-cache",
                    },
                )

        except Exception as e:
            print(f"Error generating speech: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "processing_error",
                    "message": "Failed to generate speech",
                    "type": "server_error",
                },
            )

    @app.get("/v1/audio/voices")
    async def list_voices():
        """List all available voices for text-to-speech"""
        try:
            return VoicesResponse(voices=AVAILABLE_VOICES)
        except Exception as e:
            print(f"Error listing voices: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "server_error",
                    "message": "Failed to retrieve voice list",
                    "type": "server_error",
                },
            )

    @app.get("/v1/models")
    async def list_models():
        """List all available models for text-to-speech"""
        try:
            return JSONResponse(content={"models": [AVAILABLE_MODEL]})
        except Exception as e:
            print(f"Error listing models: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "server_error",
                    "message": "Failed to retrieve voice list",
                    "type": "server_error",
                },
            )


def create_app(device="auto", use_fp16=None):
    """Create and configure FastAPI application."""
    app = FastAPI(lifespan=lifespan)

    # Store device and FP16 settings in app state for lifespan to use
    app.state.device = device
    app.state.use_fp16 = use_fp16

    # Get the current machine's IP address
    local_ip = get_local_ip()

    # Build the list of allowed origins
    allowed_origins = [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        f"http://{local_ip}:8080",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    return app


def run_server(app: FastAPI, port: int):
    """Run the FastAPI server."""
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=port)


def main():
    """Main function."""
    # Parse arguments
    args = parse_arguments()

    # Get device from args
    device = args.device
    port = int(args.port)

    # Determine FP16 usage from arguments
    use_fp16 = None  # Default: auto-detect
    if args.fp16:
        use_fp16 = True
    elif args.no_fp16:
        use_fp16 = False

    # Create app with device and FP16 configuration
    app = create_app(device, use_fp16)

    # Setup routes (no parameters needed since model is loaded in lifespan)
    setup_routes(app)

    print(f"Starting Malaya TTS server on port {port}")
    print(f"Device: {device}")
    if use_fp16 is not None:
        print(f"FP16 mode: {'enabled' if use_fp16 else 'disabled'}")
    else:
        print(f"FP16 mode: auto (will use FP16 on XPU devices)")
    print(f"Available endpoints:")
    print(f"  - POST /audio/speech - Generate speech from text")
    print(f"  - GET /audio/voices - List available voices")
    print(f"Available voices: {', '.join(AVAILABLE_VOICES)}")

    run_server(app, port)


if __name__ == "__main__":
    main()
