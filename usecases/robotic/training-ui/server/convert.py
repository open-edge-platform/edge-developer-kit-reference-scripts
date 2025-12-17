# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import sys
import time
import logging
import argparse
import numpy as np
from collections import deque, OrderedDict

import torch
import openvino as ov
import openvino.properties as props
from openvino.runtime import serialize

from lerobot.policies.act.configuration_act import ACTConfig
from lerobot.policies.act.modeling_act import ACTPolicy
from lerobot.datasets.lerobot_dataset import LeRobotDatasetMetadata
from lerobot.datasets.utils import dataset_to_policy_features
from lerobot.configs.types import FeatureType
from lerobot.datasets.lerobot_dataset import LeRobotDataset


DEBUG = os.environ.get("DEBUG", "0") == "1"
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG if DEBUG else logging.INFO)


def create_placeholder_observation(input_features, batch_size=1, dtype=torch.float32):
    """Create placeholder tensors that mirror the model's expected inputs."""
    if not input_features:
        raise ValueError(
            "No input features provided for placeholder creation.")

    data = OrderedDict()
    for feature_key, feature in input_features.items():
        if feature.shape is None:
            raise ValueError(
                f"Feature '{feature_key}' does not define a shape.")

        full_shape = (batch_size, *feature.shape)
        # Use uniform random tensors to avoid introducing bias while keeping dtype consistent.
        data[feature_key] = torch.rand(full_shape, dtype=dtype)

    return data


class ACTPolicyWrapper(torch.nn.Module):
    """
    Wrapper for ACTPolicy to make it traceable for OpenVINO conversion.
    This wrapper is stateless and returns the entire action chunk.
    The calling code is responsible for managing the action queue.
    """

    def __init__(self, policy):
        super().__init__()
        self.policy = policy
        self.input_keys = list(self.policy.config.input_features.keys())
        if self.policy.config.temporal_ensemble_coeff is not None:
            logger.warning(
                "The provided wrapper does not support temporal ensembling for tracing. "
                "Please use a model without temporal ensembling or implement external state management for it."
                "Setting temporal_ensemble_coeff to None."
            )
            self.policy.config.temporal_ensemble_coeff = None

    @torch.no_grad()
    def forward(self, *inputs):
        """
        This method wraps `predict_action_chunk` and is JIT-traceable.
        It returns a full chunk of predicted actions.
        """
        if len(inputs) != len(self.input_keys):
            raise ValueError(
                f"Expected {len(self.input_keys)} inputs, received {len(inputs)}."
            )

        batch = {
            feature_key: tensor for feature_key, tensor in zip(self.input_keys, inputs)
        }
        print(batch)

        self.policy.eval()
        # predict_action_chunk is coming from ACTPolicy
        actions = self.policy.predict_action_chunk(batch)
        return actions


def load_model(model_weight_path, dataset_dir):
    if not os.path.exists(model_weight_path):
        raise FileNotFoundError("Model weight path does not exist.")

    if not os.path.exists(dataset_dir):
        raise FileNotFoundError("Dataset directory does not exist.")

    dataset_metadata = LeRobotDatasetMetadata(
        "sample_lerobot_dataset",
        root=dataset_dir
    )
    features = dataset_to_policy_features(dataset_metadata.features)
    output_features = {
        key: ft for key, ft in features.items() if ft.type is FeatureType.ACTION
    }
    input_features = {
        key: ft for key, ft in features.items() if key not in output_features
    }
    logger.info(f"Input features: {input_features}")
    logger.info(f"Output features: {output_features}")

    cfg = ACTConfig(
        input_features=input_features,
        output_features=output_features,
    )
    from lerobot.configs.policies import PreTrainedConfig
    cfg = PreTrainedConfig.from_pretrained(
        model_weight_path
    )

    policy = ACTPolicy.from_pretrained(
        model_weight_path,
        config=cfg,
    )
    policy.to("cpu")
    logger.debug(f"Policy model info:\n{policy}")

    return policy


def convert_to_openvino(policy, output_dir):
    example_input = create_placeholder_observation(
        policy.config.input_features)

    logger.info("Creating wrapper for JIT tracing...")
    wrapper = ACTPolicyWrapper(policy)
    wrapper.eval()

    # Prepare individual tensor inputs for tracing
    example_inputs = tuple(example_input[key] for key in wrapper.input_keys)

    logger.info("Tracing the model ...")
    try:
        with torch.no_grad():
            traced_policy = torch.jit.trace(
                wrapper,
                example_inputs,
                strict=False
            )
    except Exception as e:
        raise RuntimeError(
            f"Error during tracing: {e}. "
            "Ensure the model is compatible with JIT tracing and all inputs are tensors."
        )

    logger.info("Testing traced model ...")
    with torch.no_grad():
        traced_output = traced_policy(*example_inputs)
        logger.debug(f"Traced output shape: {traced_output.shape}")
        logger.debug(f"Traced output: {traced_output}")

    logger.info("Saving the traced model ...")
    traced_model_path = os.path.join(output_dir, "traced_model.pt")
    traced_policy.save(traced_model_path)
    logger.info(f"Traced model saved to: {traced_model_path}")

    logger.info("Converting to OpenVINO ...")
    ov_model_path = os.path.join(output_dir, "model.xml")
    ov_input = []
    for tensor in example_inputs:
        np_dtype = tensor.numpy().dtype
        ov_dtype = ov.Type(np_dtype)
        ov_input.append((list(tensor.shape), ov_dtype))

    ov_model = ov.convert_model(traced_policy, input=ov_input)
    ov.save_model(ov_model, ov_model_path)

    core = ov.Core()
    saved_model = core.read_model(ov_model_path)
    for i, inp in enumerate(saved_model.inputs):
        # Set the name according to the original feature keys
        inp.get_tensor().set_names({wrapper.input_keys[i]})
    for i, out in enumerate(saved_model.outputs):
        out.get_tensor().set_names({f"outputs_{i}"})

    logger.info(f"{saved_model}")
    saved_xml_path = os.path.join(output_dir, "ov_model.xml")
    saved_bin_path = os.path.join(output_dir, "ov_model.bin")
    serialize(saved_model, saved_xml_path, saved_bin_path)
    logger.info(f"OpenVINO model saved to: {saved_xml_path}")


def evaluate_ov_model(ov_model_path, example_input, device="CPU", enable_npu_high_precision=False):
    """Evaluate the OpenVINO model with example input."""
    core = ov.Core()
    if not os.path.exists(ov_model_path):
        raise FileNotFoundError(
            f"OpenVINO model path does not exist: {ov_model_path}")

    ov_model = core.read_model(ov_model_path)

    # Priotize latency for real-time applications
    compile_properties = {
        props.hint.performance_mode(): props.hint.PerformanceMode.LATENCY
    }

    if device == "NPU" and enable_npu_high_precision:
        logger.info("Enabling NPU high precision mode for specific layers...")
        compile_properties["NPU_COMPILATION_MODE_PARAMS"] = "compute-layers-with-higher-precision=Sqrt,Power,ReduceMean,Add"

    compiled_model = core.compile_model(ov_model, device, compile_properties)
    inputs = {
        input_tensor.any_name: example_input[key].numpy()
        for input_tensor, key in zip(compiled_model.inputs, example_input.keys())
    }

    execution_time = []
    for i in range(5):
        logger.info(f"Warm-up run {i + 1} ...")
        results = compiled_model(inputs)

    for i in range(100):
        logger.info(f"Inferencing run {i + 1} ...")
        start_time = time.time()
        results = compiled_model(inputs)
        execution_time.append(time.time() - start_time)

    logger.info(
        f"[{device}] - Average execution time over 100 runs: {np.mean(execution_time):.6f} seconds")
    # The output is a dictionary, get the result tensor
    return list(results.values())[0]


def main():
    parser = argparse.ArgumentParser(
        description="Convert Lerobot ACT model to OpenVINO format."
    )
    parser.add_argument(
        "--model-weight-dir",
        type=str,
        required=True,
        help="Directory to the ACT model weights."
    )
    parser.add_argument(
        "--dataset-dir",
        type=str,
        required=True,
        help="Path to the dataset directory."
    )
    parser.add_argument(
        "--run-eval",
        action="store_true",
        help="Run evaluation after conversion."
    )
    parser.add_argument(
        "--eval-device",
        type=str,
        default="CPU",
        choices=["CPU", "GPU", "NPU"],
        help="Device to run the OpenVINO model on (default: CPU)."
    )
    parser.add_argument(
        "--enable-npu-high-precision",
        action="store_true",
        help="Enable NPU high precision mode for specific layers."
    )

    args = parser.parse_args()

    output_dir = "./data/ov_models"
    model_weight_dir = args.model_weight_dir
    dataset_dir = args.dataset_dir
    run_eval = args.run_eval
    eval_device = args.eval_device
    enable_npu_high_precision = args.enable_npu_high_precision

    safe_output_dir = os.path.abspath(output_dir)
    os.makedirs(safe_output_dir, exist_ok=True)

    dataset_repo_id = os.path.basename(os.path.normpath(dataset_dir))
    dataset_root = os.path.abspath(dataset_dir)
    dataset = LeRobotDataset(
        repo_id=dataset_repo_id,
        root=dataset_root,
        video_backend="pyav"
    )

    policy = load_model(model_weight_dir, dataset_dir)
    policy.eval()

    if policy.config.temporal_ensemble_coeff is not None:
        logger.warning(
            "Temporal ensembling is enabled and will be disabled for conversion."
        )
        policy.config.temporal_ensemble_coeff = None

    convert_to_openvino(policy, safe_output_dir)

    if run_eval:
        logger.info("Running evaluation on the OpenVINO and PyTorch models ...")

        example_input = create_placeholder_observation(
            policy.config.input_features
        )

        ov_model_path = os.path.join(safe_output_dir, "model.xml")

        action_queue = deque([], maxlen=policy.config.n_action_steps)
        if not action_queue:
            action_chunk_np = evaluate_ov_model(
                ov_model_path,
                example_input,
                eval_device,
                enable_npu_high_precision
            )
            for action in action_chunk_np[0]:
                action_queue.append(action)

        ov_action = action_queue.popleft()

        torch_action_queue = deque([], maxlen=policy.config.n_action_steps)
        if not torch_action_queue:
            with torch.no_grad():
                action_chunk_torch = policy.predict_action_chunk(example_input)
                for action in action_chunk_torch[0]:
                    torch_action_queue.append(action)

        torch_action = torch_action_queue.popleft().numpy()

        max_diff = np.max(np.abs(ov_action - torch_action))
        mean_diff = np.mean(np.abs(ov_action - torch_action))

        logger.info("### Conversion Summary ###")
        logger.info(f"- Max difference: {max_diff:.4f}")
        logger.info(f"- Mean difference: {mean_diff:.4f}")

if __name__ == "__main__":
    main()