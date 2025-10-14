# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import torch
import os
import json
import openvino as ov

from pathlib import Path
from huggingface_hub import hf_hub_download

from kokoro import KPipeline, KModel


class OVKModel(KModel):
    def __init__(
        self, model_dir: str, device: str, repo_id: str = "hexgrad/Kokoro-82M"
    ):
        torch.nn.Module.__init__(self)

        core = ov.Core()
        self.repo_id = repo_id
        self.model_dir = model_dir

        self.download_kokoro_model()

        with open(Path(f"{self.model_dir}/config.json"), encoding="utf8") as f:
            config = json.load(f)
        self.vocab = config["vocab"]
        self.model = core.compile_model(
            Path(f"{self.model_dir}/openvino_model.xml"), device.upper()
        )
        self.context_length = config["plbert"]["max_position_embeddings"]

    @property
    def device(self):
        return torch.device("cpu")

    def forward_with_tokens(
        self, input_ids: torch.LongTensor, ref_s: torch.FloatTensor, speed: float = 1
    ) -> tuple[torch.FloatTensor, torch.LongTensor]:
        outputs = self.model([input_ids, ref_s, torch.tensor(speed)])
        return torch.from_numpy(outputs[0]), torch.from_numpy(outputs[1])

    def download_kokoro_model(self):
        if not Path(f"{self.model_dir}/openvino_model.xml").exists():
            pipeline = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
            model = pipeline.model
            model.forward = model.forward_with_tokens
            # Use os.urandom for entropy instead of torch.randint
            rand_bytes = os.urandom(48)
            # Map each byte (0-255) into range 1..99 (inclusive)
            input_list = [(b % 99) + 1 for b in rand_bytes]
            input_ids = torch.LongTensor([[0, *input_list, 0]])
            style = torch.randn(1, 256)
            # speed: derive a value in 1..9 and represent as float32 tensor
            speed_byte = os.urandom(1)[0]
            speed_val = float((speed_byte % 9) + 1)
            speed = torch.tensor([speed_val], dtype=torch.float32)

            ov_model = ov.convert_model(
                model,
                example_input=(input_ids, style, speed),
                input=[ov.PartialShape("[1, 2..]"), ov.PartialShape([1, -1])],
            )
            ov.save_model(ov_model, Path(f"{self.model_dir}/openvino_model.xml"))
            hf_hub_download(
                repo_id=self.repo_id, filename="config.json", local_dir=self.model_dir
            )

            del model
