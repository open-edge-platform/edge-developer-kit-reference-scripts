#!/bin/bash
# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

echo -e "Initializing OpenVINO VLLM service ..."
export DEFAULT_MODEL_ID=${DEFAULT_MODEL_ID:-Qwen/Qwen2.5-7B-Instruct}
export MODEL_PATH=${MODEL_PATH:-./data/ov_model}
export MODEL_PRECISION=${MODEL_PRECISION:-int4}
export TASK=${TASK:-text-generation-with-past}
export SERVED_MODEL_NAME=${SERVED_MODEL_NAME:-ov-vllm}
export MAX_MODEL_LEN=${MAX_MODEL_LEN:-2048}
export GPU_MEMORY_UTILIZATION=${GPU_MEMORY_UTILIZATION:-0.9}
export MAX_NUM_SEQS=${MAX_NUM_SEQS:-1}
export VLLM_OPENVINO_DEVICE=${VLLM_OPENVINO_DEVICE:-CPU}
export VLLM_OPENVINO_KVCACHE_SPACE=${VLLM_OPENVINO_KVCACHE_SPACE:-8}

echo -e "Using the following configuration:"
echo -e "- VLLM_OPENVINO_DEVICE: ${VLLM_OPENVINO_DEVICE}"
echo -e "- VLLM_OPENVINO_KVCACHE_SPACE: ${VLLM_OPENVINO_KVCACHE_SPACE}"
echo -e "- DEFAULT_MODEL_ID: ${DEFAULT_MODEL_ID}"
echo -e "- MODEL_PATH: ${MODEL_PATH}"
echo -e "- MODEL_PRECISION: ${MODEL_PRECISION}"
echo -e "- TASK: ${TASK}"
echo -e "- SERVED_MODEL_NAME: ${SERVED_MODEL_NAME}"
echo -e "- MAX_MODEL_LEN: ${MAX_MODEL_LEN}"
echo -e "- GPU_MEMORY_UTILIZATION: ${GPU_MEMORY_UTILIZATION}"
echo -e "- MAX_NUM_SEQS: ${MAX_NUM_SEQS}"

if [ ! -d "$MODEL_PATH" ]; then
    echo -e "Model path does not exist: $MODEL_PATH. Downloading the default model: $DEFAULT_MODEL_ID ..."
    optimum-cli export openvino \
        --model "$DEFAULT_MODEL_ID" \
        --task "$TASK" \
        --weight-format "$MODEL_PRECISION" \
        --sym \
        --ratio 1.0 \
        --group-size -1 \
        "$MODEL_PATH"
fi

if [ ! -f "$MODEL_PATH/openvino_model.xml" ]; then
    echo -e "Model file does not exist: $MODEL_PATH/openvino_model.xml. Please export the model first and save to $MODEL_PATH"
    exit 1
fi

echo -e "Starting OpenVINO VLLM service ..."
vllm serve "$MODEL_PATH" \
    --served_model_name "$SERVED_MODEL_NAME" \
    --max-model-len "$MAX_MODEL_LEN" \
    --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
    --max-num-seqs "$MAX_NUM_SEQS"
