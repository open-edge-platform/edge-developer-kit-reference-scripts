# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import cv2
import json
import time
import logging
import argparse
from pathlib import Path
import numpy as np

import torch
from lerobot.policies.act.modeling_act import ACTPolicy
from lerobot.policies.factory import make_pre_post_processors


NUM_BODY_JOINTS = 29
NUM_HAND_JOINTS = 6
NUM_LEG_JOINTS = 12           # 6 per leg × 2
NUM_WAIST_JOINTS = 3
NUM_ARM_JOINTS = NUM_BODY_JOINTS - NUM_LEG_JOINTS - \
    NUM_WAIST_JOINTS  # 14: 7 per arm × 2
NUM_ARM_BODY_OFFSET = NUM_LEG_JOINTS + \
    NUM_WAIST_JOINTS  # 15: index where arm joints start
NUM_FULL_BODY_ACTION = NUM_BODY_JOINTS + 2 * \
    NUM_HAND_JOINTS   # 41: legs + waist + arms + hands
NUM_UPPER_BODY_ACTION = NUM_ARM_JOINTS + 2 * \
    NUM_HAND_JOINTS   # 26: arms + hands only
NUM_WAIST_ARM_JOINTS = NUM_WAIST_JOINTS + NUM_ARM_JOINTS  # 17: waist + arms (no legs)
NUM_WAIST_ARM_ACTION = NUM_WAIST_ARM_JOINTS + 2 * \
    NUM_HAND_JOINTS   # 29: waist + arms + hands (no legs)
BODY_STATE_OFFSET = 5
BODY_ACTION_OFFSET = 6
CAMERA_WINDOW_NAME = "Dataset cameras"

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


def load_policy_model(
    model_dir: str, model_type: str, model_device: str,
    temporal_ensemble_coeff: float = 0.0,
):
    print("Loading policy model ...")
    if model_type == "act":
        model = ACTPolicy.from_pretrained(model_dir)
    else:
        raise RuntimeError("Not supported model type")
    model.to(model_device)
    model.eval()

    # Enable temporal ensembling: re-runs inference every step and blends overlapping
    # action predictions. Without this, n_action_steps=100 means the model runs fully
    # open-loop for 100 steps ignoring all intermediate observations.
    # The ensembler must be instantiated manually because from_pretrained() already ran
    # __init__ with temporal_ensemble_coeff=None (no ensembler created at that point).
    if temporal_ensemble_coeff > 0:
        print("Enable temporal ensemble coeff ...")
        from lerobot.policies.act.modeling_act import ACTTemporalEnsembler
        model.config.temporal_ensemble_coeff = temporal_ensemble_coeff
        model.temporal_ensembler = ACTTemporalEnsembler(
            temporal_ensemble_coeff, model.config.chunk_size
        )

    # Load the preprocessor/postprocessor from the checkpoint so that the exact
    # normalizer weights saved during training are used. Override the device to
    # match the deployment target (training may have used a different device).
    preprocess, postprocess = make_pre_post_processors(
        policy_cfg=model.config,
        pretrained_path=model_dir,
        preprocessor_overrides={"device_processor": {"device": model_device}},
    )

    # Derive expected action dimension directly from the model config.
    expected_action_dim = int(model.config.output_features["action"].shape[-1])
    print(f"Expected action dim from model config: {expected_action_dim}")

    return model, preprocess, postprocess, expected_action_dim


def load_image_bgr(image_path: str) -> np.ndarray:
    image = cv2.imread(image_path)
    if image is None:
        raise FileNotFoundError(f"Failed to read image: {image_path}")
    return image


def convert_bgr_image_to_tensor(image: np.ndarray) -> np.ndarray:
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    return np.transpose(image, (2, 0, 1))  # HWC -> CHW


def load_episode_data(episode_dir: str) -> dict:
    episode_data_path = Path(episode_dir).resolve() / "data.json"
    with open(episode_data_path, "r", encoding="utf-8") as file_handle:
        episode_data = json.load(file_handle)
    if "data" not in episode_data or not episode_data["data"]:
        raise ValueError(
            f"No frames found in episode data: {episode_data_path}")
    return episode_data


def configure_torch_device(model_device: str):
    device_type = model_device.split(":", maxsplit=1)[0]
    if device_type == "xpu":
        if not hasattr(torch, "xpu"):
            raise RuntimeError(
                "Torch XPU support is not available in this environment."
            )
        device_index = (
            int(model_device.split(":", maxsplit=1)
                [1]) if ":" in model_device else 0
        )
        torch.xpu.set_device(device_index)
    return device_type


def maybe_resize_for_display(image: np.ndarray, image_scale: float) -> np.ndarray:
    if image_scale == 1.0:
        return image
    return cv2.resize(image, dsize=None, fx=image_scale, fy=image_scale)


def annotate_camera_image(image: np.ndarray, label: str) -> np.ndarray:
    annotated_image = image.copy()
    cv2.putText(
        annotated_image,
        label,
        (16, 32),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return annotated_image


def show_camera_images(
    head_image: np.ndarray,
    table_image: np.ndarray,
    image_scale: float,
):
    display_head_image = maybe_resize_for_display(
        annotate_camera_image(head_image, "head image"), image_scale
    )
    display_table_image = maybe_resize_for_display(
        annotate_camera_image(table_image, "table image"), image_scale
    )
    combined_image = np.hstack([display_head_image, display_table_image])
    try:
        cv2.imshow(CAMERA_WINDOW_NAME, combined_image)
        pressed_key = cv2.waitKey(1) & 0xFF
        if pressed_key in {27, ord("q")}:
            raise KeyboardInterrupt
    except cv2.error:
        # No display available (e.g. headless server / missing Qt xcb plugin).
        # Silently skip the window; use --no-show-images to suppress this path.
        pass


def get_observation_real(robot_env) -> dict:
    """Read live joint positions and velocities from the real G1 robot."""
    dof_pos, dof_vel, *_ = robot_env.get_robot_state()
    return {
        "joint_positions": dof_pos,
        "joint_velocities": dof_vel,
    }


def _make_model_slot(
    model_dir: str,
    model_type: str,
    model_device: str,
    temporal_ensemble_coeff: float,
) -> tuple:
    """Load a policy model and return (model, preprocess, postprocess, expected_action_dim)."""
    return load_policy_model(
        model_dir, model_type, model_device,
        temporal_ensemble_coeff=temporal_ensemble_coeff,
    )


def run_policy_inference_real(
    args,
    robot_env,
    inspire_ctrl,
    image_client,
    hand_history: dict | None = None,
    first_frame: dict | None = None,
    use_arm_sdk: bool = False,
    dual_models: list | None = None,
):
    """Run ACT policy inference on the real G1 robot with Inspire hands.

    Camera images are sourced from the live ZMQ camera streams via ImageClient.
    Joint state observations come from the live robot.
    The loop runs indefinitely until interrupted (Ctrl-C).

    If first_frame is provided (loaded from --real-episode-dir), the robot is
    moved to the recorded initial joint positions before inference begins.

    If dual_models is provided, it must be a list of two tuples
    ``(model, preprocess, postprocess, expected_action_dim)`` for
    [pickup, putdown] models. The active model starts as pickup (index 0) and
    toggles each time the user presses controller button B.
    """
    model_device_type = configure_torch_device(args.model_device)

    if use_arm_sdk:
        import unitree_interface

        print("Initializing Arm SDK interface for arm control ...")
        arm_sdk = unitree_interface.ArmSdkInterface.create_g1_7dof(args.robot_net, re_init=False)
        arm_sdk_joint_indices = arm_sdk.get_joint_indices()
        robot_env.set_arm_sdk(arm_sdk, arm_sdk_joint_indices)

    # Safety: interpolate to default stance, then wait for button A before inference.
    controller = robot_env.read_controller_input()
    robot_env.move_to_default_pos()
    robot_env.default_pos_state()

    if first_frame is not None:
        print("Initializing robot from episode first frame state ...")
        init_body_joints = np.array(
            first_frame["state_body"][BODY_STATE_OFFSET:], dtype=np.float32
        )
        init_hand_l = np.array(first_frame["state_hand_left"], dtype=np.float32)
        init_hand_r = np.array(first_frame["state_hand_right"], dtype=np.float32)
        robot_env.move_to_pos(init_body_joints)
        inspire_ctrl.initialize()
        inspire_ctrl.ctrl_dual_hand(init_hand_l.tolist(), init_hand_r.tolist())
    else:
        inspire_ctrl.initialize()

    control_dt = 1.0 / 50.0  # 50 Hz control rate matching dataset

    # ── Model selection: single vs dual ─────────────────────────────────────
    use_dual_models = dual_models is not None and len(dual_models) == 2
    if use_dual_models:
        model_names = ["pickup", "putdown"]
        active_model_idx = 0
        model, preprocess, postprocess, expected_action_dim = dual_models[active_model_idx]
        print(f"Dual-model mode enabled. Starting with '{model_names[active_model_idx]}' model.")
        print("Press controller button B to switch models.")
    else:
        model, preprocess, postprocess, expected_action_dim = load_policy_model(
            args.model_dir,
            args.model_type,
            args.model_device,
            temporal_ensemble_coeff=args.temporal_ensemble_coeff,
        )

    BUTTON_B = 0x0200  # controller button B bitmask
    BUTTON_X = 0x0400  # controller button X bitmask — hold/idle toggle

    model.reset()
    preprocess.reset()
    postprocess.reset()

    left_hand_history: list[np.ndarray] = []
    right_hand_history: list[np.ndarray] = []
    obs_left_hand_history: list[np.ndarray] = []
    obs_right_hand_history: list[np.ndarray] = []
    waist_history: list[np.ndarray] = []
    obs_waist_history: list[np.ndarray] = []
    if hand_history is not None:
        hand_history["left"] = left_hand_history
        hand_history["right"] = right_hand_history
        hand_history["obs_left"] = obs_left_hand_history
        hand_history["obs_right"] = obs_right_hand_history
        hand_history["waist"] = waist_history
        hand_history["obs_waist"] = obs_waist_history

    print("Starting inferencing ...")
    t_step = 0
    prev_keys = 0  # previous controller key state for edge detection
    needs_smooth_transition = True  # smooth-in on first step and after model swap
    is_idle = False  # when True, hold current state and skip inference
    while True:
        step_start = time.time()

        # ── Controller input: X = idle toggle, B = model swap (dual only) ────
        current_keys = int(robot_env.read_controller_input().keys)
        x_pressed = bool((current_keys & BUTTON_X) and not (prev_keys & BUTTON_X))
        if x_pressed:
            is_idle = not is_idle
            print(f"Step {t_step}: {'Entering idle/hold — controller X pressed.' if is_idle else 'Resuming inference — controller X pressed.'}")
            if not is_idle:
                needs_smooth_transition = True

        if use_dual_models:
            b_pressed = bool((current_keys & BUTTON_B) and not (prev_keys & BUTTON_B))
            if b_pressed:
                active_model_idx = 1 - active_model_idx
                model, preprocess, postprocess, expected_action_dim = dual_models[active_model_idx]
                model.reset()
                preprocess.reset()
                postprocess.reset()
                needs_smooth_transition = True
                print(f"Switched to '{model_names[active_model_idx]}' model at step {t_step}.")

        prev_keys = current_keys
        if is_idle:
            elapsed = time.time() - step_start
            remaining = control_dt - elapsed
            if remaining > 0:
                time.sleep(remaining)
            continue

        # Observation state from live robot
        # Read live hand positions from the Inspire controller.
        # InspireController.hand_state.motor.q layout: [0-5] right hand, [6-11] left hand
        model_observation = get_observation_real(robot_env)
        live_hand_l, live_hand_r = inspire_ctrl.get_hand_state()
        obs_left_hand_history.append(live_hand_l.copy())
        obs_right_hand_history.append(live_hand_r.copy())
        obs_waist_history.append(
            model_observation["joint_positions"][NUM_LEG_JOINTS:NUM_LEG_JOINTS + NUM_WAIST_JOINTS].copy()
        )
        if expected_action_dim == NUM_UPPER_BODY_ACTION:
            observation_state = np.concatenate(
                [
                    model_observation["joint_positions"][NUM_ARM_BODY_OFFSET:],
                    live_hand_l,
                    live_hand_r,
                ]
            ).astype(np.float32)
        elif expected_action_dim == NUM_WAIST_ARM_ACTION:
            # 29-dim model: waist + arms + hands (no legs)
            observation_state = np.concatenate(
                [
                    model_observation["joint_positions"][NUM_LEG_JOINTS:],
                    live_hand_l,
                    live_hand_r,
                ]
            ).astype(np.float32)
        else:
            observation_state = np.concatenate(
                [
                    model_observation["joint_positions"],
                    live_hand_l,
                    live_hand_r,
                ]
            )

        # ── Camera frames from ZMQ streams ──────────────────────────────────
        head_image_bgr, _ = image_client.get_head_frame()
        table_image_bgr, _ = image_client.get_table_frame()
        if head_image_bgr is None or table_image_bgr is None:
            logger.info(f"Step {t_step}: camera frame not yet available (head={head_image_bgr is not None}, table={table_image_bgr is not None}) — waiting ...")
            time.sleep(0.01)
            continue  # retry without advancing t_step

        if args.show_images:
            show_camera_images(head_image_bgr, table_image_bgr, args.image_scale)

        head_image = convert_bgr_image_to_tensor(
            head_image_bgr).astype(np.float32) / 255.0
        table_image = convert_bgr_image_to_tensor(
            table_image_bgr).astype(np.float32) / 255.0

        # ── Policy inference ─────────────────────────────────────────────────
        observation = {
            "observation.images.head_image": torch.from_numpy(head_image).unsqueeze(0).to(
                args.model_device
            ),
            "observation.images.table_image": torch.from_numpy(table_image).unsqueeze(0).to(
                args.model_device
            ),
            "observation.state": torch.from_numpy(observation_state).unsqueeze(0).to(
                args.model_device
            ),
        }
        preprocessed_observation = preprocess(observation)

        with torch.no_grad():
            use_autocast = model_device_type in {"cuda", "xpu"}
            with torch.autocast(
                device_type=model_device_type,
                dtype=torch.bfloat16,
                enabled=use_autocast,
            ):
                action = model.select_action(preprocessed_observation)

        postprocessed_action = postprocess(action).float().squeeze(0)
        action_dim = postprocessed_action.shape[0]

        # ── Unpack action ────────────────────────────────────────────────────
        if action_dim == NUM_FULL_BODY_ACTION:
            last_robot_action = postprocessed_action[:NUM_BODY_JOINTS].cpu().numpy()
            last_left_hand_action = (
                postprocessed_action[NUM_BODY_JOINTS: NUM_BODY_JOINTS + NUM_HAND_JOINTS]
                .cpu()
                .numpy()
            )
            last_right_hand_action = (
                postprocessed_action[
                    NUM_BODY_JOINTS + NUM_HAND_JOINTS: NUM_BODY_JOINTS + 2 * NUM_HAND_JOINTS
                ]
                .cpu()
                .numpy()
            )
        elif action_dim == NUM_UPPER_BODY_ACTION:
            arm_action = postprocessed_action[:NUM_ARM_JOINTS].cpu().numpy()
            # Pad to full body size; leg/waist joints keep their current live positions.
            last_robot_action = model_observation["joint_positions"].copy()
            last_robot_action[NUM_ARM_BODY_OFFSET:] = arm_action
            last_left_hand_action = (
                postprocessed_action[NUM_ARM_JOINTS: NUM_ARM_JOINTS + NUM_HAND_JOINTS]
                .cpu()
                .numpy()
            )
            last_right_hand_action = (
                postprocessed_action[
                    NUM_ARM_JOINTS + NUM_HAND_JOINTS: NUM_ARM_JOINTS + 2 * NUM_HAND_JOINTS
                ]
                .cpu()
                .numpy()
            )
        elif action_dim == NUM_WAIST_ARM_ACTION:  # 29: waist + arms + hands, no legs
            waist_arm_action = postprocessed_action[:NUM_WAIST_ARM_JOINTS].cpu().numpy()
            # Pad to full body size; leg joints keep their current live positions.
            last_robot_action = model_observation["joint_positions"].copy()
            last_robot_action[NUM_LEG_JOINTS:] = waist_arm_action
            last_left_hand_action = (
                postprocessed_action[NUM_WAIST_ARM_JOINTS: NUM_WAIST_ARM_JOINTS + NUM_HAND_JOINTS]
                .cpu()
                .numpy()
            )
            last_right_hand_action = (
                postprocessed_action[
                    NUM_WAIST_ARM_JOINTS + NUM_HAND_JOINTS: NUM_WAIST_ARM_JOINTS + 2 * NUM_HAND_JOINTS
                ]
                .cpu()
                .numpy()
            )
        else:
            raise ValueError(
                f"Unexpected action dimension {action_dim}. "
                f"Expected {NUM_FULL_BODY_ACTION} (full body), {NUM_UPPER_BODY_ACTION} (arms+hands), "
                f"or {NUM_WAIST_ARM_ACTION} (waist+arms+hands)."
            )

        left_hand_history.append(last_left_hand_action.copy())
        right_hand_history.append(last_right_hand_action.copy())
        waist_history.append(last_robot_action[NUM_LEG_JOINTS:NUM_LEG_JOINTS + NUM_WAIST_JOINTS].copy())

        # ── Send actions to robot ────────────────────────────────────────────
        if needs_smooth_transition:
            robot_env.move_to_pos(last_robot_action)
            needs_smooth_transition = False
        else:
            robot_env.send_robot_action(last_robot_action)
        inspire_ctrl.ctrl_dual_hand(
            last_left_hand_action.tolist(),
            last_right_hand_action.tolist(),
        )

        # ── Pace the control loop to 50 Hz ───────────────────────────────────
        elapsed = time.time() - step_start
        remaining = control_dt - elapsed
        if remaining > 0:
            time.sleep(remaining)

        t_step += 1


def plot_hand_joint_data(
    left_hand_history: list,
    right_hand_history: list,
    title_prefix: str = "",
    pred_label: str = "pred",
    ref_left_hand_history: list | None = None,
    ref_right_hand_history: list | None = None,
    ref_label: str = "GT",
    save_dir: str = "data/outputs/deploy",
    waist_history: list | None = None,
    ref_waist_history: list | None = None,
):
    """Plot left and right hand joint trajectories over time and save to save_dir."""
    import matplotlib
    matplotlib.use("Agg")  # non-interactive backend — no Qt/display required
    import matplotlib.pyplot as plt
    from datetime import datetime

    steps = np.arange(len(left_hand_history))
    left_data = np.array(left_hand_history)   # (T, 6)
    right_data = np.array(right_hand_history)  # (T, 6)
    has_ref = (
        ref_left_hand_history is not None
        and ref_right_hand_history is not None
        and len(ref_left_hand_history) > 0
    )
    if has_ref:
        ref_left_data = np.array(ref_left_hand_history)   # (T, 6)
        ref_right_data = np.array(ref_right_hand_history)  # (T, 6)
        # Align lengths in case reference series is shorter/longer
        n = min(len(steps), len(ref_left_data))
        steps = steps[:n]
        left_data = left_data[:n]
        right_data = right_data[:n]
        ref_left_data = ref_left_data[:n]
        ref_right_data = ref_right_data[:n]

    # Layout: NUM_HAND_JOINTS rows × 2 columns (left | right)
    fig, axes = plt.subplots(
        NUM_HAND_JOINTS, 2,
        figsize=(14, 3 * NUM_HAND_JOINTS),
        sharex=True,
    )
    prefix = f"{title_prefix} - " if title_prefix else ""
    color_pred = "tab:blue"
    color_ref = "tab:orange"

    for j in range(NUM_HAND_JOINTS):
        ax_l = axes[j, 0]
        ax_r = axes[j, 1]

        ax_l.plot(steps, left_data[:, j], color=color_pred, label=pred_label)
        ax_r.plot(steps, right_data[:, j], color=color_pred, label=pred_label)
        if has_ref:
            ax_l.plot(steps, ref_left_data[:, j], color=color_ref,
                      linestyle="--", alpha=0.8, label=ref_label)
            ax_r.plot(steps, ref_right_data[:, j], color=color_ref,
                      linestyle="--", alpha=0.8, label=ref_label)

        ax_l.set_ylabel(f"J{j}")
        ax_r.set_ylabel(f"J{j}")
        ax_l.grid(True)
        ax_r.grid(True)
        ax_l.legend(loc="upper right", fontsize="x-small")
        ax_r.legend(loc="upper right", fontsize="x-small")

    # Column titles on the top row
    axes[0, 0].set_title(f"{prefix}Left Hand")
    axes[0, 1].set_title(f"{prefix}Right Hand")

    # x-axis label on the bottom row
    axes[-1, 0].set_xlabel("Step")
    axes[-1, 1].set_xlabel("Step")

    plt.tight_layout()

    os.makedirs(save_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_prefix = title_prefix.replace(" ", "_").lower() if title_prefix else "hand_joints"
    save_path = os.path.join(save_dir, f"{safe_prefix}_{timestamp}.png")
    plt.savefig(save_path, dpi=150)
    plt.close(fig)
    print(f"Hand joint plot saved to: {save_path}")

    # ── Waist joint plot ────────────────────────────────────────────────────
    if waist_history and len(waist_history) > 0:
        waist_steps = np.arange(len(waist_history))
        waist_data = np.array(waist_history)            # (T, NUM_WAIST_JOINTS)
        has_waist_ref = ref_waist_history is not None and len(ref_waist_history) > 0
        if has_waist_ref:
            ref_waist_data = np.array(ref_waist_history)
            nw = min(len(waist_steps), len(ref_waist_data))
            waist_steps = waist_steps[:nw]
            waist_data = waist_data[:nw]
            ref_waist_data = ref_waist_data[:nw]
        n_waist = waist_data.shape[1]
        fig_w, axes_w = plt.subplots(
            n_waist, 1,
            figsize=(10, 3 * n_waist),
            sharex=True,
        )
        if n_waist == 1:
            axes_w = [axes_w]
        for j in range(n_waist):
            axes_w[j].plot(waist_steps, waist_data[:, j], color=color_pred, label=pred_label)
            if has_waist_ref:
                axes_w[j].plot(waist_steps, ref_waist_data[:, j], color=color_ref,
                               linestyle="--", alpha=0.8, label=ref_label)
            axes_w[j].set_ylabel(f"W{j}")
            axes_w[j].grid(True)
            axes_w[j].legend(loc="upper right", fontsize="x-small")
        axes_w[0].set_title(f"{prefix}Waist")
        axes_w[-1].set_xlabel("Step")
        plt.tight_layout()
        waist_save_path = os.path.join(
            save_dir,
            f"{safe_prefix}_waist_{timestamp}.png",
        )
        plt.savefig(waist_save_path, dpi=150)
        plt.close(fig_w)
        print(f"Waist joint plot saved to: {waist_save_path}")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run policy inference on the real G1 robot with Inspire hands."
    )
    parser.add_argument(
        "--robot-net",
        default="eno1",
        help="Network interface for G1 robot and Inspire hand communication.",
    )
    parser.add_argument(
        "--robot-config",
        default="configs/g1.yaml",
        help="Path to the robot configuration YAML file.",
    )
    parser.add_argument(
        "--robot-host",
        default="192.168.123.164",
        help="IP address of the robot image server for ZMQ camera streams.",
    )
    parser.add_argument(
        "--robot-request-port",
        type=int,
        default=60000,
        help="ZMQ REQ port for fetching camera configuration from the robot.",
    )
    parser.add_argument(
        "--model-dir",
        default="data/outputs/training/act/checkpoints/last/pretrained_model",
        help="Path to the pretrained model directory.",
    )
    parser.add_argument(
        "--model-type",
        default="act",
        help="Policy model type.",
    )
    parser.add_argument(
        "--model-device",
        default="xpu",
        help="Torch device for policy inference, for example cpu, cuda, or xpu.",
    )
    parser.add_argument(
        "--temporal-ensemble-coeff",
        type=float,
        default=0.0,
        help="Temporal ensembling coefficient for ACT (exp decay weight). Set to 0 to disable.",
    )
    parser.add_argument(
        "--show-images",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Show live head and table camera images in an OpenCV window.",
    )
    parser.add_argument(
        "--image-scale",
        type=float,
        default=0.5,
        help="Scale factor for the OpenCV camera display window.",
    )
    parser.add_argument(
        "--plot",
        action="store_true",
        help="Plot hand joint trajectories on interrupt.",
    )
    parser.add_argument(
        "--real-episode-dir",
        default=None,
        help=(
            "Path to a raw episode directory containing data.json. "
            "When set, the robot is moved to the joint positions recorded in the first frame "
            "before inference begins instead of the default stance."
        ),
    )
    parser.add_argument(
        "--pickup-model-dir",
        default=None,
        help=(
            "Path to the pickup pretrained model directory for dual-model mode. "
            "Must be specified together with --putdown-model-dir. "
            "When both are provided, the robot runs pickup model first and switches "
            "to putdown model on controller button B press (repeating on each press)."
        ),
    )
    parser.add_argument(
        "--putdown-model-dir",
        default=None,
        help=(
            "Path to the putdown pretrained model directory for dual-model mode. "
            "Must be specified together with --pickup-model-dir."
        ),
    )
    return parser.parse_args()


def main():
    args = parse_args()

    from utils.config import Config  # noqa: PLC0415
    from utils.robot import G1RealWorldEnv  # noqa: PLC0415
    from utils.inspire import InspireHandController  # noqa: PLC0415
    from utils.image_client import ImageClient  # noqa: PLC0415

    robot_config = Config(args.robot_config)
    robot_env = G1RealWorldEnv(net=args.robot_net, config=robot_config)

    print("Starting Inspire hand controller ...")
    inspire_ctrl = InspireHandController(
        net=args.robot_net,
        left_hand_ip="192.168.123.210",
        right_hand_ip="192.168.123.211",
        dds_domain_id=0
    )

    print("Starting image client ...")
    image_client = ImageClient(
        host=args.robot_host, request_port=args.robot_request_port
    )

    real_first_frame: dict | None = None
    if args.real_episode_dir is not None:
        print(f"Loading episode init frame from: {args.real_episode_dir}")
        real_episode_data = load_episode_data(args.real_episode_dir)
        real_first_frame = real_episode_data["data"][0]

    # ── Dual-model setup ─────────────────────────────────────────────────────
    dual_models = None
    if args.pickup_model_dir is not None and args.putdown_model_dir is not None:
        print("Dual-model mode: loading pickup model ...")
        pickup_slot = _make_model_slot(
            args.pickup_model_dir, args.model_type, args.model_device,
            args.temporal_ensemble_coeff,
        )
        print("Dual-model mode: loading putdown model ...")
        putdown_slot = _make_model_slot(
            args.putdown_model_dir, args.model_type, args.model_device,
            args.temporal_ensemble_coeff,
        )
        dual_models = [pickup_slot, putdown_slot]
    elif (args.pickup_model_dir is None) != (args.putdown_model_dir is None):
        raise ValueError(
            "Both --pickup-model-dir and --putdown-model-dir must be provided together "
            "to enable dual-model mode."
        )

    hand_history: dict = {}
    try:
        print("Starting policy inferencing ...")
        run_policy_inference_real(
            args,
            robot_env,
            inspire_ctrl,
            image_client,
            hand_history=hand_history,
            first_frame=real_first_frame,
            use_arm_sdk=True,
            dual_models=dual_models,
        )
    except KeyboardInterrupt:
        print("Real robot inference interrupted by user.")
        if args.plot and hand_history.get("left"):
            plot_hand_joint_data(
                hand_history["left"],
                hand_history["right"],
                title_prefix="Real Robot Inference",
                ref_left_hand_history=hand_history.get("obs_left"),
                ref_right_hand_history=hand_history.get("obs_right"),
                ref_label="Observed",
                waist_history=hand_history.get("waist"),
                ref_waist_history=hand_history.get("obs_waist"),
            )
    except Exception as e:
        print(f"Error during real robot inference: {e}")
    finally:
        cv2.destroyAllWindows()
        image_client.close()
        inspire_ctrl.close()
        robot_env.close()

if __name__ == "__main__":
    main()
