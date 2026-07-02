# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0


import os
import sys
import json
import logging
import contextlib
from typing import Optional, Tuple

import numpy as np
import openvino as ov
from piper import PiperVoice
from piper.config import PiperConfig, SynthesisConfig

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def _suppress_native_output(enabled: bool = True):
    """Silence C++-level stdout/stderr (e.g. OpenVINO's NPU compiler dumps).

    OpenVINO writes these to the native file descriptors, so we swap fd 1/2
    directly. Used only around a best-effort compile on an accelerator; the
    Python exception (with a clean message) is still raised and logged.
    """
    if not enabled:
        yield
        return
    sys.stdout.flush()
    sys.stderr.flush()
    saved = [os.dup(1), os.dup(2)]
    devnull = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(devnull, 1)
        os.dup2(devnull, 2)
        yield
    finally:
        os.dup2(saved[0], 1)
        os.dup2(saved[1], 2)
        os.close(devnull)
        for fd in saved:
            os.close(fd)


def ensure_ir(onnx_path: str, ir_path: str) -> str:
    """Convert an ONNX model to OpenVINO IR (``.xml`` + ``.bin``) if needed."""
    bin_path = os.path.splitext(ir_path)[0] + ".bin"
    if os.path.exists(ir_path) and os.path.exists(bin_path):
        logger.info("Using cached OpenVINO IR: %s", ir_path)
        return ir_path

    logger.info("Converting ONNX -> OpenVINO IR: %s", ir_path)
    ov_model = ov.convert_model(onnx_path)
    ov.save_model(ov_model, ir_path)
    return ir_path


class OVPiperVoice(PiperVoice):
    """A PiperVoice whose neural inference runs on an OpenVINO compiled model."""

    def attach(self, compiled_model) -> "OVPiperVoice":
        self._ov_compiled = compiled_model
        return self

    def phoneme_ids_to_audio(
        self,
        phoneme_ids,
        syn_config: Optional[SynthesisConfig] = None,
        include_alignments: bool = False,
    ):
        if syn_config is None:
            syn_config = SynthesisConfig()

        cfg = self.config
        length_scale = (
            syn_config.length_scale
            if syn_config.length_scale is not None
            else cfg.length_scale
        )
        noise_scale = (
            syn_config.noise_scale
            if syn_config.noise_scale is not None
            else cfg.noise_scale
        )
        noise_w_scale = (
            syn_config.noise_w_scale
            if syn_config.noise_w_scale is not None
            else cfg.noise_w_scale
        )

        phoneme_ids_array = np.expand_dims(np.array(phoneme_ids, dtype=np.int64), 0)
        args = {
            "input": phoneme_ids_array,
            "input_lengths": np.array([phoneme_ids_array.shape[1]], dtype=np.int64),
            "scales": np.array(
                [noise_scale, length_scale, noise_w_scale], dtype=np.float32
            ),
        }

        speaker_id = syn_config.speaker_id
        if cfg.num_speakers <= 1:
            speaker_id = None
        elif speaker_id is None:
            speaker_id = 0
        if speaker_id is not None:
            args["sid"] = np.array([speaker_id], dtype=np.int64)

        audio = np.asarray(self._ov_compiled(args)[0]).squeeze()

        # The IR model has no alignment output; mirror the base class contract.
        if include_alignments:
            return audio, None
        return audio


def load_ov_voice(
    model_path: str,
    config_path: str,
    ir_path: str,
    device: str = "CPU",
) -> Tuple[OVPiperVoice, str]:
    """Load a Piper voice that runs on OpenVINO IR.

    Converts the ONNX model to IR (cached), compiles it for ``device`` (falling
    back to ``CPU`` if that device cannot compile this model), and returns the
    ready-to-use voice plus the device actually used.
    """
    with open(config_path, "r", encoding="utf-8") as f:
        config_dict = json.load(f)

    ensure_ir(model_path, ir_path)

    core = ov.Core()
    device = device.upper()
    try:
        # Suppress the verbose native compiler dump on accelerators; the Python
        # exception below still carries a clean message if compilation fails.
        with _suppress_native_output(device != "CPU"):
            compiled = core.compile_model(ir_path, device)
        used_device = device
        logger.info("Compiled OpenVINO IR for device '%s'", device)
    except Exception as e:  # noqa: BLE001 - device may not support this model
        if device == "CPU":
            raise
        logger.warning(
            "OpenVINO could not compile for '%s'; falling back to CPU. "
            "This Piper model uses dynamic shapes, which the NPU does not support.",
            device,
        )
        compiled = core.compile_model(ir_path, "CPU")
        used_device = "CPU"

    # session=None: OVPiperVoice never uses ONNX Runtime, only OpenVINO.
    voice = OVPiperVoice(config=PiperConfig.from_dict(config_dict), session=None)
    voice.attach(compiled)
    return voice, used_device
