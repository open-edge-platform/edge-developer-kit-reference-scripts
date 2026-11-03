# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import logging
from pathlib import Path

import numpy as np
import torch
import openvino as ov
from worker_common.devices import openvino_compile_config, openvino_execution_device

from kokoro import KModel
from export import NPU_MODEL_NAME, export_to_openvino, export_static_model

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

#: Audio samples per predicted duration unit (24 kHz output; the decoder
#: renders each frame of ``pred_dur`` as 600 samples).
SAMPLES_PER_FRAME = 600

#: Decoder block sizes NPUW_KOKORO tries on the NPU, fastest first. The plugin default (200) hangs
#: some NPUs (ZE_RESULT_ERROR_DEVICE_LOST, seen on driver 32.0.100.5540 / OpenVINO 2026.2.1); the
#: next size is tried when a probe inference fails. If none works, OVKModel raises and main.py
#: falls back to PyTorch on the CPU.
NPUW_KOKORO_BLOCK_SIZES = (200, 100)

#: Remembers the block size that worked, so later starts skip the ones that hang this NPU.
NPU_BLOCK_SIZE_FILE = "npuw-block-size.json"


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
        # AUTO goes to OpenVINO as is. It never picks the NPU, so only a named NPU gets the static model.
        device = device.upper()
        self._device_name = device
        self.model_dir = model_dir
        # NPU uses static model via NPUW; all other devices use the dynamic model.
        self.model_path = self._get_model_path(prefer_static="NPU" in device)
        self._uses_static = self.model_path.name == NPU_MODEL_NAME

        with open(Path(f"{self.model_dir}/config.json"), encoding="utf8") as f:
            config = json.load(f)
        self.vocab = config["vocab"]
        self.context_length = config["plbert"]["max_position_embeddings"]

        logger.info(f"Loading model on {device} with OpenVINO runtime ...")
        if "NPU" in device:
            self.model = self._compile_npu(device)
        else:
            # The GPU plugin defaults to fp16, which yields NaNs (silent audio) for this model.
            # CACHE_DIR keeps compiled kernels on disk so later starts are fast.
            gpu_cache_dir = str(Path(model_dir) / ".cache" / "gpu")
            ov_config = openvino_compile_config(
                device, gpu={"INFERENCE_PRECISION_HINT": "f32", "CACHE_DIR": gpu_cache_dir}
            )
            self.model = self.core.compile_model(self.model_path, device, ov_config)
        execution_device = openvino_execution_device(self.model, device)
        if execution_device == "CPU":
            device_name = self.core.get_property("CPU", "FULL_DEVICE_NAME")
            if "Xeon" in device_name:
                logger.error(
                    f"Xeon CPU detected ({device_name}), which has poor OpenVINO performance. Falling back to PyTorch model."
                )
                raise RuntimeError("Xeon CPU detected, falling back to PyTorch model")
        logger.info(f"Kokoro runs on {execution_device}")

    @property
    def device(self):
        return torch.device("cpu")

    def _compile_npu(self, device: str) -> ov.CompiledModel:
        """Compile for the NPU with the largest block size that passes a probe inference."""
        fingerprint = self._npu_fingerprint()
        memo_path = Path(self.model_dir) / ".cache" / NPU_BLOCK_SIZE_FILE
        sizes = list(NPUW_KOKORO_BLOCK_SIZES)
        remembered = self._read_block_size(memo_path, fingerprint)
        if remembered in sizes:
            # Larger sizes already failed on this driver and OpenVINO; skip them.
            sizes = sizes[sizes.index(remembered):]

        errors = []
        for size in sizes:
            ov_config = {
                # NPUW offloads the precision-sensitive part of the model to the CPU.
                "NPU_USE_NPUW": "YES",
                "NPUW_DEVICES": "NPU,CPU",
                "NPUW_KOKORO": "YES",
                "NPUW_KOKORO_BLOCK_SIZE": str(size),
                # One cache per block size: a blob compiled for another size must not be reused.
                "NPUW_CACHE_DIR": str(Path(self.model_dir) / ".cache" / f"npuw-b{size}"),
            }
            logger.info(f"Compiling for {device} with NPUW_KOKORO_BLOCK_SIZE={size} ...")
            try:
                compiled = self.core.compile_model(self.model_path, device, ov_config)
                self._probe(compiled)
            except RuntimeError as e:
                # Free the failed model's NPU memory before compiling the next size.
                compiled = None
                last_line = str(e).strip().splitlines()[-1] if str(e).strip() else repr(e)
                logger.warning(f"NPUW_KOKORO_BLOCK_SIZE={size} failed on {device}: {last_line}")
                errors.append(f"{size}: {last_line}")
                continue
            logger.info(f"NPUW_KOKORO_BLOCK_SIZE={size} works on {device}")
            self._write_block_size(memo_path, fingerprint, size)
            return compiled
        raise RuntimeError(f"Kokoro does not run on {device} with any block size ({'; '.join(errors)})")

    def _probe(self, compiled: ov.CompiledModel) -> None:
        """One full-width inference; raises if the NPU hangs or the audio has NaNs."""
        input_ids = np.full((1, self.context_length), 16, dtype=np.int64)
        input_ids[0, :12] = [0, 50, 83, 54, 156, 57, 135, 16, 65, 156, 87, 0]
        ref_s = np.random.default_rng(0).standard_normal((1, 256)).astype(np.float32) * 0.1
        audio = compiled([input_ids, ref_s, np.array([1.0], dtype=np.float32)])[0]
        if not np.isfinite(audio).all():
            raise RuntimeError("probe inference produced NaN/inf audio")

    def _npu_fingerprint(self) -> dict:
        """What a remembered block size depends on: a driver or OpenVINO update retries them all."""
        try:
            driver = str(self.core.get_property("NPU", "NPU_DRIVER_VERSION"))
        except RuntimeError:
            driver = "unknown"
        return {"openvino": ov.get_version(), "driver": driver}

    @staticmethod
    def _read_block_size(path: Path, fingerprint: dict) -> int | None:
        try:
            data = json.loads(path.read_text(encoding="utf8"))
        except (OSError, ValueError):
            return None
        if data.get("fingerprint") != fingerprint:
            return None
        return data.get("block_size")

    @staticmethod
    def _write_block_size(path: Path, fingerprint: dict, size: int) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"block_size": size, "fingerprint": fingerprint}), encoding="utf8")
        except OSError as e:
            logger.warning(f"Could not save the NPU block size to {path}: {e}")

    def forward_with_tokens(self, input_ids: torch.LongTensor, ref_s: torch.FloatTensor, speed: float = 1) -> tuple[torch.FloatTensor, torch.LongTensor]:
        text_len = input_ids.shape[-1]

        if "NPU" in self._device_name and text_len < self.context_length:
            # The NPU needs static input shapes: pad to the context length.
            input_ids = torch.nn.functional.pad(input_ids, (0, self.context_length - text_len), value=16)

        outputs = self.model([input_ids, ref_s, torch.tensor(speed)])
        audio = torch.from_numpy(outputs[0])
        pred_dur = torch.from_numpy(outputs[1])

        if "NPU" in self._device_name and text_len < self.context_length:
            # The padding tokens get durations (and audio) of their own; keep
            # only the frames of the real tokens.
            pred_dur = pred_dur[:text_len]
            audio = audio[: int(pred_dur.sum()) * SAMPLES_PER_FRAME]

        return audio, pred_dur

    def _get_model_path(self, prefer_static: bool = False) -> Path:
        """Return the path to the OpenVINO model, downloading and exporting if necessary."""
        if prefer_static:
            static_path = Path(self.model_dir) / NPU_MODEL_NAME
            if static_path.exists():
                return static_path

        if "NPU" in self._device_name:
            # Traced from PyTorch on its own; the dynamic IR is not needed.
            return export_static_model(
                model_dir=self.model_dir,
                repo_id=self.repo_id,
                source=self.source,
            )

        return export_to_openvino(
            model_dir=self.model_dir,
            repo_id=self.repo_id,
            source=self.source,
        )
