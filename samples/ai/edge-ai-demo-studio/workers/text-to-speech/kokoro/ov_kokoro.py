# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import logging
from pathlib import Path

import torch
import openvino as ov

from kokoro import KModel
from export import export_to_openvino, export_static_model

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class OVKModel(KModel):
    def __init__(
        self,
        model_dir: str,
        device: str,
        repo_id: str = "hexgrad/Kokoro-82M",
        source: str = "huggingface",
    ):
        torch.nn.Module.__init__(self)
        self.core = ov.Core()
        self.source = source
        self.repo_id = repo_id
        self._device_name = device.upper()
        self.model_dir = model_dir
        # NPU uses static model via NPUW; all other devices use the dynamic model.
        self.model_path = self._get_model_path(prefer_static="NPU" in device)
        self._uses_static = self.model_path.name == "openvino_model-static.xml"

        with open(Path(f"{self.model_dir}/config.json"), encoding="utf8") as f:
            config = json.load(f)
        self.vocab = config["vocab"]
        self.context_length = config["plbert"]["max_position_embeddings"]

        if device == "CPU":
            device_name = self.core.get_property("CPU", "FULL_DEVICE_NAME")
            if "Xeon" in device_name:
                logger.error(
                    f"Xeon CPU detected ({device_name}), which has poor OpenVINO performance. Falling back to PyTorch model."
                )
                raise RuntimeError("Xeon CPU detected, falling back to PyTorch model")

        gpu_cache_dir = str(Path(model_dir) / ".cache" / "gpu")
        npu_cache_dir = str(Path(model_dir) / ".cache" / "npuw")

        if "NPU" in device:
            # NOTE: NPU plugin requires additional configuration options to run custom pipeline with offloading precision-sensitive part of the model to CPU.
            # Caching is also recommended to speed up compilation time in subsequent runs.
            ov_config = {
                "NPU_USE_NPUW": "YES",
                "NPUW_DEVICES": "NPU,CPU",
                "NPUW_KOKORO": "YES",
                "NPUW_CACHE_DIR": npu_cache_dir,
            }
        elif "GPU" in device:
            # NOTE: GPU plugin by default tries to run computations in fp16, but for this model
            # fp16 does not have enough precision and produces NaNs (silent audio).
            # CACHE_DIR persists compiled GPU kernels to disk so every new process start is fast.
            ov_config = {
                "INFERENCE_PRECISION_HINT": ov.Type.f32,
                "CACHE_DIR": gpu_cache_dir,
            }
        else:
            ov_config = {}

        logger.info(f"Loading model on {device} with OpenVINO runtime ...")
        self.model = self.core.compile_model(self.model_path, device.upper(), ov_config)

    @property
    def device(self):
        return torch.device("cpu")

    def forward_with_tokens(self, input_ids: torch.LongTensor, ref_s: torch.FloatTensor, speed: float = 1) -> tuple[torch.FloatTensor, torch.LongTensor]:
        text_len = input_ids.shape[-1]

        if "NPU" in self._device_name and text_len < self.context_length:
            # NOTE: NPU plugin requires static input shapes, so we pad input_ids to the maximum context length.
            input_ids = torch.nn.functional.pad(input_ids, (0, self.context_length - text_len), value=16)

        outputs = self.model([input_ids, ref_s, torch.tensor(speed)])
        audio = torch.from_numpy(outputs[0])
        pred_dur = torch.from_numpy(outputs[1])

        if "NPU" in self._device_name and text_len < self.context_length:
            pred_dur = pred_dur[:text_len]

        return audio, pred_dur

    def _get_model_path(self, prefer_static: bool = False) -> Path:
        """Return the path to the OpenVINO model, downloading and exporting if necessary."""
        if prefer_static:
            static_path = Path(self.model_dir) / "openvino_model-static.xml"
            if static_path.exists():
                return static_path

        dynamic_path = export_to_openvino(
            model_dir=self.model_dir,
            repo_id=self.repo_id,
            source=self.source,
        )

        if "NPU" in self._device_name:
            return export_static_model(
                model_dir=self.model_dir,
                dynamic_model_path=dynamic_path,
            )

        return dynamic_path
