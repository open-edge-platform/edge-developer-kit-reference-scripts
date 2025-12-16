# Copyright (C) 2025 Intel Corporation 
# SPDX-License-Identifier: Apache-2.0

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
        "--output-dir",
        type=str,
        default="./data/ov_models",
        help="Directory to save the converted OpenVINO model."
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

    # ---- NEVER STORE TAINTED PATHS ----
    model_weight_dir = args.model_weight_dir
    dataset_dir = args.dataset_dir
    run_eval = args.run_eval
    eval_device = args.eval_device
    enable_npu_high_precision = args.enable_npu_high_precision

    # ---- SANITIZE OUTPUT DIR (NEW VARIABLE) ----
    try:
        safe_output_dir = validate_output_dir(args.output_dir)
    except ValueError as e:
        print(f"Invalid output_dir: {e}", file=sys.stderr)
        sys.exit(1)

    # ---- SAFE SINK ----
    os.makedirs(safe_output_dir, exist_ok=True)

    # ---- DATASET SETUP ----
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

    # ---- USE SAFE PATH ONLY ----
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