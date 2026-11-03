# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Optional noise suppression with the OMZ ``noise-suppression-poconetlike-0001`` model.

Fetched into ``<models>/<model>/<precision>/`` (the OMZ layout) and compiled on first use.
"""

from __future__ import annotations

import copy
import logging
import os
import tempfile

import numpy as np
import openvino as ov
import openvino.properties.hint as hints
from model_downloader import fetch_omz_ir
from pydub import AudioSegment
from worker_common import openvino_pinned_cpu_config

from modules.audio import wav_read, wav_write

logger = logging.getLogger("uvicorn.error")


def download_omz_model(models_root: str, model_id: str, model_precision: str = "FP32") -> str:
    """Fetch the IR pair for ``model_id`` and return the ``.xml`` path."""
    logger.info("Downloading %s (%s) from OpenVINO Model Zoo ...", model_id, model_precision)
    xml_path = fetch_omz_ir(models_root, model_name=model_id, precision=model_precision)
    logger.info("Model %s downloaded to %s", model_id, os.path.dirname(xml_path))
    return str(xml_path)


def load_denoise_model(model_xml: str, device: str):
    core = ov.Core()
    config = {hints.performance_mode: hints.PerformanceMode.LATENCY, **openvino_pinned_cpu_config()}
    if not os.path.exists(model_xml):
        raise FileNotFoundError(f"Model file not found: {model_xml}")
    compiled_model = core.compile_model(model_xml, device, config)
    logger.info("Denoising model %s loaded and compiled on %s.", model_xml, device)
    return compiled_model


def denoise(compiled_model, file_path: str) -> bytes:
    """Run the stateful OMZ suppression model over a 16 kHz WAV; returns WAV bytes."""
    ov_encoder = compiled_model

    audio = AudioSegment.from_wav(f"{file_path}")
    target_sr = 16000
    resampled_audio = audio.set_frame_rate(target_sr)
    resampled_audio.export(f"{file_path}", format="wav")

    inp_shapes = {name: obj.shape for obj in ov_encoder.inputs for name in obj.get_names()}
    out_shapes = {name: obj.shape for obj in ov_encoder.outputs for name in obj.get_names()}

    state_out_names = [n for n in out_shapes.keys() if "state" in n]
    state_inp_names = [n for n in inp_shapes.keys() if "state" in n]
    if len(state_inp_names) != len(state_out_names):
        raise RuntimeError(
            "Number of input states of the model ({}) is not equal to number of output states({})".format(
                len(state_inp_names), len(state_out_names)
            )
        )

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

        inputs = {"input": input[None, :]}
        for n in state_inp_names:
            if res:
                inputs[n] = infer_request.get_tensor(n.replace("inp", "out")).data
            else:
                inputs[n] = np.zeros(inp_shapes[n], dtype=np.float32)

        infer_request.infer(inputs)
        res = infer_request.get_tensor("output")
        samples_out.append(copy.deepcopy(res.data).squeeze(0))

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
