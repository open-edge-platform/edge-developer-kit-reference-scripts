# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

from colpali_engine.models import (
    ColPali,
    ColPaliProcessor,
    ColQwen2,
    ColQwen2_5,
    ColQwen2_5_Processor,
    ColQwen2Processor,
)
from optimum.intel.openvino import OVModelForVisualCausalLM
from transformers import AutoProcessor, AutoTokenizer

MODEL_REGISTRY = [
    {
        "model_class": ColQwen2_5,
        "processor_class": ColQwen2_5_Processor,
        "model_ids": [
            "tsystems/colqwen2.5-3b-multilingual-v1.0",
            "Metric-AI/colqwen2.5-3b-multilingual",
            "Metric-AI/ColQwen2.5-3b-multilingual-v1.0",
            "Metric-AI/ColQwen2.5-7b-multilingual-v1.0",
            "vidore/colqwen2.5-v0.2",
        ],
    },
    {
        "model_class": ColQwen2,
        "processor_class": ColQwen2Processor,
        "model_ids": [
            "tsystems/colqwen2-7b-v1.0",
            "vidore/colqwen2-v0.1",
            "vidore/colqwen2-v1.0",
        ],
    },
    {
        "model_class": ColPali,
        "processor_class": ColPaliProcessor,
        "model_ids": ["vidore/colpali-v1.2"],
    },
    {
        "model_class": OVModelForVisualCausalLM,
        "processor_class": AutoProcessor,
        "tokenizer_class": AutoTokenizer,
        "model_ids": [
            "OpenVINO/Phi-3.5-vision-instruct-fp16-ov",
            "Qwen/Qwen2.5-VL-3B-Instruct",
            "Qwen/Qwen2.5-VL-7B-Instruct",
            "Qwen/Qwen2-VL-2B-Instruct",
            "Qwen/Qwen2-VL-7B-Instruct",
        ],
    },
]
