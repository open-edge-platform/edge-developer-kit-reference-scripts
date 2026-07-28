# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import copy
import logging
import os
import tempfile

import numpy as np
import openvino as ov
import openvino.properties.hint as hints
import requests
from pydub import AudioSegment

from modules.audio import wav_read, wav_write

logger = logging.getLogger("uvicorn.error")


def download_omz_model(model_dir: str, model_id: str, model_precision: str = "FP32"):
    """Download the model directly from OpenVINO Model Zoo storage."""
    # Create the model directory structure
    model_path = os.path.join(model_dir, "intel", model_id, model_precision)
    os.makedirs(model_path, exist_ok=True)

    # Base URL for OpenVINO Model Zoo storage
    base_url = "https://storage.openvinotoolkit.org/repositories/open_model_zoo/temp"

    # Download both .xml and .bin files
    for file_ext in ["xml", "bin"]:
        file_url = f"{base_url}/{model_id}/{model_precision}/{model_id}.{file_ext}"
        file_path = os.path.join(model_path, f"{model_id}.{file_ext}")

        try:
            logger.info(f"Downloading {file_url}...")
            response = requests.get(file_url, stream=True, timeout=30)
            response.raise_for_status()

            with open(file_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)

            logger.info(f"Successfully downloaded {model_id}.{file_ext}")

        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to download {file_url}: {str(e)}")
            # Clean up partial downloads
            if os.path.exists(file_path):
                os.remove(file_path)
            raise RuntimeError(f"Failed to download model {model_id}.{file_ext}")

    logger.info(f"Model {model_id} downloaded successfully to {model_path}.")


def load_denoise_model(model_dir: str, device: str):
    """Load and compile the denoising model."""
    core = ov.Core()
    config = {hints.performance_mode: hints.PerformanceMode.LATENCY}

    if not os.path.exists(model_dir):
        raise FileNotFoundError(f"Model file not found: {model_dir}")

    compiled_model = core.compile_model(model_dir, device, config)
    logger.info(f"Denoising model {model_dir} loaded and compiled.")
    return compiled_model


def denoise(compiled_model, file_path):
    ov_encoder = compiled_model

    # Load the audio file
    audio = AudioSegment.from_wav(f"{file_path}")

    # Set the target sampling rate (16000 Hz)
    target_sr = 16000

    # Resample the audio to the target sampling rate
    resampled_audio = audio.set_frame_rate(target_sr)

    # Export the resampled audio to a new WAV file
    resampled_audio.export(f"{file_path}", format="wav")

    inp_shapes = {
        name: obj.shape for obj in ov_encoder.inputs for name in obj.get_names()
    }
    out_shapes = {
        name: obj.shape for obj in ov_encoder.outputs for name in obj.get_names()
    }

    state_out_names = [n for n in out_shapes.keys() if "state" in n]
    state_inp_names = [n for n in inp_shapes.keys() if "state" in n]
    if len(state_inp_names) != len(state_out_names):
        raise RuntimeError(
            "Number of input states of the model ({}) is not equal to number of output states({})".format(
                len(state_inp_names), len(state_out_names)
            )
        )

    compiled_model = compiled_model
    infer_request = compiled_model.create_infer_request()
    sample_inp, freq_data = wav_read(str(file_path))
    sample_size = sample_inp.shape[0]

    infer_request.infer()
    delay = 0
    if "delay" in out_shapes:
        delay = infer_request.get_tensor("delay").data[0]
        sample_inp = np.pad(sample_inp, ((0, delay),))
    freq_model = 16000
    if "freq" in out_shapes:
        freq_model = infer_request.get_tensor("freq").data[0]

    if freq_data != freq_model:
        raise RuntimeError(
            "Wav file {} sampling rate {} does not match model sampling rate {}".format(
                file_path, freq_data, freq_model
            )
        )

    input_size = inp_shapes["input"][1]
    res = None

    samples_out = []
    while sample_inp is not None and sample_inp.shape[0] > 0:
        if sample_inp.shape[0] > input_size:
            input = sample_inp[:input_size]
            sample_inp = sample_inp[input_size:]
        else:
            input = np.pad(
                sample_inp, ((0, input_size - sample_inp.shape[0]),), mode="constant"
            )
            sample_inp = None

        # forms input
        inputs = {"input": input[None, :]}

        # add states to input
        for n in state_inp_names:
            if res:
                inputs[n] = infer_request.get_tensor(n.replace("inp", "out")).data
            else:
                # on the first iteration fill states by zeros
                inputs[n] = np.zeros(inp_shapes[n], dtype=np.float32)

        infer_request.infer(inputs)
        res = infer_request.get_tensor("output")
        samples_out.append(copy.deepcopy(res.data).squeeze(0))

    # concat output patches and align with input
    sample_out = np.concatenate(samples_out, 0)
    sample_out = sample_out[delay : sample_size + delay]

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_f:
        output_file = tmp_f.name
    try:
        wav_write(output_file, sample_out, freq_data)
        with open(output_file, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(output_file):
            os.remove(output_file)
