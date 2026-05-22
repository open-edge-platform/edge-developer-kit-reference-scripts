# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import shlex
import logging
import subprocess  # nosec
import numpy as np
import soundfile as sf

import openvino as ov
import openvino_genai

import wave
import os
import copy
from time import perf_counter

logger = logging.getLogger('uvicorn.error')


class OptimumCLI:
    def run_export(model_name_or_path, output_dir):
        # Build the command as a list to avoid shell injection
        command = [
            "optimum-cli",
            "export",
            "openvino",
            "--trust-remote-code",
            "--model", model_name_or_path,
            output_dir
        ]
        subprocess.run(command)


def download_default_model(model_name_or_path, output_dir):
    logger.info(
        f"Downloading default model: {model_name_or_path} to {output_dir}")
    OptimumCLI.run_export(model_name_or_path, output_dir)


def verify_device_available(device):
    logger.info(f"Verifying device availability: {device.upper()}")
    core = ov.Core()
    available_devices = core.available_devices
    if device.upper() in available_devices:
        return device.upper()
    else:
        logger.error(
            f"Device not available: {device.upper()}. Default to CPU device.")
        return "CPU"


def load_model_pipeline(model_dir, device="CPU"):
    logger.info(f"Initializing pipeline on device: {device}")
    pipeline = openvino_genai.WhisperPipeline(model_dir, device)
    return pipeline


def resample(audio, src_sample_rate, dst_sample_rate):
    if src_sample_rate == dst_sample_rate:
        return audio
    duration = audio.shape[0] / src_sample_rate
    resampled_data = np.zeros(
        shape=(int(duration * dst_sample_rate)), dtype=np.float32)
    x_old = np.linspace(0, duration, audio.shape[0], dtype=np.float32)
    x_new = np.linspace(0, duration, resampled_data.shape[0], dtype=np.float32)
    resampled_audio = np.interp(x_new, x_old, audio)
    return resampled_audio.astype(np.float32)


def language_mapping(language):
    mapping = {
        "english": "<|en|>",
        "chinese": "<|zh|>",
    }
    return mapping.get(language, "<|en|>")


def transcribe(pipeline, audio, language="english"):
    config = pipeline.get_generation_config()
    if config.is_multilingual:
        config.language = language_mapping(language)
        config.task = "transcribe"

    data, fs = sf.read(audio)
    resampled_audio = resample(
        audio=data,
        src_sample_rate=fs,
        dst_sample_rate=16000
    ).astype(np.float32)

    results = pipeline.generate(resampled_audio, config)
    if results.texts and len(results.texts) > 0:
        return results.texts[0]
    else:
        logger.error("No transcription results.")
        return ""


def translate(pipeline, audio, source_language="english"):
    '''
    translate is taking the source language and output to english
    '''
    config = pipeline.get_generation_config()
    if config.is_multilingual:
        config.language = language_mapping(source_language)
        config.task = "translate"

    data, fs = sf.read(audio)
    resampled_audio = resample(
        audio=data,
        src_sample_rate=fs,
        dst_sample_rate=16000
    ).astype(np.float32)
    results = pipeline.generate(resampled_audio, config)
    if results.texts and len(results.texts) > 0:
        return results.texts[0]
    else:
        logger.error("No translation results.")
        return ""

# DENOISE UTILS
def download_omz_model(model_id: str, output_dir: str):
    """Download the model using Open Model Zoo downloader."""
    try:
        subprocess.run(
            ["omz_downloader", "--name", model_id, "-o", output_dir],
            check=True
        )
        logger.info(f"Model {model_id} downloaded successfully.")
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to download model {model_id}: {str(e)}")
        raise

def load_denoise_model(model_dir: str, device: str):
    """Load and compile the denoising model."""
    import openvino.properties.hint as hints

    core = ov.Core()
    config = {hints.performance_mode: hints.PerformanceMode.LATENCY}
    
    if not os.path.exists(model_dir):
        raise FileNotFoundError(f"Model file not found: {model_dir}")

    compiled_model = core.compile_model(model_dir, device, config)
    logger.info(f"Denoising model {model_dir} loaded and compiled.")
    return compiled_model

def wav_read(wav_name):
    with wave.open(wav_name, "rb") as wav:
        if wav.getsampwidth() != 2:
            raise RuntimeError(f"wav file {wav_name} does not have int16 format")
        freq = wav.getframerate()
        data = wav.readframes(wav.getnframes())
        x = np.frombuffer(data, dtype=np.int16)
        x = x.astype(np.float32) * (1.0 / np.iinfo(np.int16).max)
        if wav.getnchannels() > 1:
            x = x.reshape(-1, wav.getnchannels())
            x = x.mean(1)
    return x, freq

def wav_write(wav_name, x, freq):
    x = np.clip(x, -1, +1)
    x = (x * np.iinfo(np.int16).max).astype(np.int16)
    with wave.open(wav_name, "wb") as wav:
        wav.setnchannels(1)
        wav.setframerate(freq)
        wav.setsampwidth(2)
        wav.writeframes(x.tobytes())

def denoise(compiled_model, file_path):
    from pydub import AudioSegment

    ov_encoder = compiled_model
    
    # Load the audio file
    audio = AudioSegment.from_wav(f"{file_path}")

    # Set the target sampling rate (16000 Hz)
    target_sr = 16000

    # Resample the audio to the target sampling rate
    resampled_audio = audio.set_frame_rate(target_sr)

    # Export the resampled audio to a new WAV file
    resampled_audio.export(f"{file_path}", format="wav")
    
    inp_shapes = {name: obj.shape for obj in ov_encoder.inputs for name in obj.get_names()}
    out_shapes = {name: obj.shape for obj in ov_encoder.outputs for name in obj.get_names()}

    state_out_names = [n for n in out_shapes.keys() if "state" in n]
    state_inp_names = [n for n in inp_shapes.keys() if "state" in n]
    if len(state_inp_names) != len(state_out_names):
        raise RuntimeError(
            "Number of input states of the model ({}) is not equal to number of output states({})".
                format(len(state_inp_names), len(state_out_names)))

    compiled_model = compiled_model
    infer_request = compiled_model.create_infer_request()
    sample_inp, freq_data = wav_read(str(file_path))
    sample_size = sample_inp.shape[0]

    infer_request.infer()
    delay = 0
    if "delay" in out_shapes:
        delay = infer_request.get_tensor("delay").data[0]
        sample_inp = np.pad(sample_inp, ((0, delay), ))
    freq_model = 16000
    if "freq" in out_shapes:
        freq_model = infer_request.get_tensor("freq").data[0]

    if freq_data != freq_model:
        raise RuntimeError(
            "Wav file {} sampling rate {} does not match model sampling rate {}".
                format(file_path, freq_data, freq_model))

    input_size = inp_shapes["input"][1]
    res = None

    samples_out = []
    while sample_inp is not None and sample_inp.shape[0] > 0:
        if sample_inp.shape[0] > input_size:
            input = sample_inp[:input_size]
            sample_inp = sample_inp[input_size:]
        else:
            input = np.pad(sample_inp, ((0, input_size - sample_inp.shape[0]), ), mode='constant')
            sample_inp = None

        #forms input
        inputs = {"input": input[None, :]}

        #add states to input
        for n in state_inp_names:
            if res:
                inputs[n] = infer_request.get_tensor(n.replace('inp', 'out')).data
            else:
                #on the first iteration fill states by zeros
                inputs[n] = np.zeros(inp_shapes[n], dtype=np.float32)

        infer_request.infer(inputs)
        res = infer_request.get_tensor("output")
        samples_out.append(copy.deepcopy(res.data).squeeze(0))

    #concat output patches and align with input
    sample_out = np.concatenate(samples_out, 0)
    sample_out = sample_out[delay:sample_size+delay]
    output_file = "./tmp_audio/tmp_denoise.wav"
    try:
        wav_write(output_file, sample_out, freq_data)
        with open(output_file, 'rb') as f:
            file_bytes = f.read()
        
        return file_bytes
    finally:
        os.remove(output_file)