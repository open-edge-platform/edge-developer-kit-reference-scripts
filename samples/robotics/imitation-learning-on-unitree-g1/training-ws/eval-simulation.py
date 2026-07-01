# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import cv2
import csv
import json
import time
import logging
import argparse
from pathlib import Path
import numpy as np
from datetime import datetime
try:
    import mujoco
    from mujoco.viewer import launch_passive
    _MUJOCO_AVAILABLE = True
except ImportError:
    _MUJOCO_AVAILABLE = False

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
BODY_QPOS_START = 7
BODY_QVEL_START = 6
CAMERA_WINDOW_NAME = "Dataset cameras"

ACTION_SCALE = np.array([
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    0.5, 0.5, 0.5,
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
], dtype=np.float32)
STIFFNESS = np.array([
    100, 100, 100, 150, 40, 40,
    100, 100, 100, 150, 40, 40,
    150, 150, 150,
    40, 40, 40, 40, 4.0, 4.0, 4.0,
    40, 40, 40, 40, 4.0, 4.0, 4.0,
], dtype=np.float32)
DAMPING = np.array([
    2, 2, 2, 4, 2, 2,
    2, 2, 2, 4, 2, 2,
    4, 4, 4,
    5, 5, 5, 5, 0.2, 0.2, 0.2,
    5, 5, 5, 5, 0.2, 0.2, 0.2,
], dtype=np.float32)
TORQUE_LIMITS = np.array([
    100, 100, 100, 150, 40, 40,
    100, 100, 100, 150, 40, 40,
    150, 150, 150,
    40, 40, 40, 40, 4.0, 4.0, 4.0,
    40, 40, 40, 40, 4.0, 4.0, 4.0,
], dtype=np.float32)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


def create_simulation_viewer(xml_file_path: str):
    sim_model = mujoco.MjModel.from_xml_path(xml_file_path)
    sim_data = mujoco.MjData(sim_model)
    viewer = launch_passive(
        model=sim_model, data=sim_data, show_left_ui=False, show_right_ui=False
    )
    viewer.opt.flags[mujoco.mjtVisFlag.mjVIS_PERTFORCE] = 0
    viewer.opt.flags[mujoco.mjtVisFlag.mjVIS_CONTACTPOINT] = 0
    viewer.opt.flags[mujoco.mjtVisFlag.mjVIS_TRANSPARENT] = 0
    viewer.opt.flags[mujoco.mjtVisFlag.mjVIS_COM] = 0
    viewer.cam.distance = 2.0

    return viewer, sim_model, sim_data


def get_observation(sim_model: mujoco.MjModel, sim_data: mujoco.MjData):
    mujoco.mj_forward(sim_model, sim_data)
    joint_positions = sim_data.qpos[
        BODY_QPOS_START: BODY_QPOS_START + NUM_BODY_JOINTS
    ].copy()
    joint_velocities = sim_data.qvel[
        BODY_QVEL_START: BODY_QVEL_START + NUM_BODY_JOINTS
    ].copy()
    observation_state = {
        "joint_positions": joint_positions,
        "joint_velocities": joint_velocities,
    }
    return observation_state


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


def get_episode_image_paths(
    episode_dir: str, episode_data: dict
) -> tuple[list[str], list[str]]:
    head_image_paths = []
    table_image_paths = []
    for frame in episode_data["data"]:
        head_image_paths.append(os.path.join(
            episode_dir, frame["forehead_rgb"]))
        table_image_paths.append(os.path.join(episode_dir, frame["table_rgb"]))
    return head_image_paths, table_image_paths


def set_viewer_camera(viewer, sim_model: mujoco.MjModel, sim_data: mujoco.MjData):
    print("Updating viewpoint ...")
    pelvis_pos = sim_data.xpos[sim_model.body("pelvis").id]
    viewer.cam.lookat = pelvis_pos
    viewer.sync()


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


def run_policy_inference(
    args,
    viewer,
    sim_model: mujoco.MjModel,
    sim_data: mujoco.MjData,
    episode_data: dict,
    head_image_paths: list[str],
    table_image_paths: list[str],
):
    model_device_type = configure_torch_device(args.model_device)
    num_images = min(len(head_image_paths), len(table_image_paths))
    if num_images == 0:
        raise ValueError(
            f"No image pairs found in episode directory: {args.episode_dir}"
        )
    print(f"Loaded {num_images} image pairs from dataset.")

    # Initialise simulation from the first episode frame so the robot starts in
    # a stable recorded pose rather than the all-zeros configuration (which is
    # not a valid standing pose and immediately falls under gravity).
    first_frame = episode_data["data"][0]
    first_body_joints = np.array(
        first_frame["state_body"][BODY_STATE_OFFSET:], dtype=np.float32
    )
    sim_data.qpos[BODY_QPOS_START: BODY_QPOS_START +
                  NUM_BODY_JOINTS] = first_body_joints
    sim_data.qvel[BODY_QVEL_START: BODY_QVEL_START + NUM_BODY_JOINTS] = 0.0
    sim_data.ctrl[:NUM_BODY_JOINTS] = first_body_joints
    mujoco.mj_forward(sim_model, sim_data)
    viewer.sync()

    # Number of MuJoCo substeps per control step.
    # Dataset is 50 Hz (20 ms/frame); MuJoCo default dt is 2 ms → 10 substeps.
    control_dt = 1.0 / 50.0
    n_substeps = max(1, round(control_dt / sim_model.opt.timestep))
    print(
        f"MuJoCo timestep: {sim_model.opt.timestep*1000:.2f} ms, substeps per control step: {n_substeps}")

    model, preprocess, postprocess, expected_action_dim = load_policy_model(
        args.model_dir,
        args.model_type,
        args.model_device,
        temporal_ensemble_coeff=args.temporal_ensemble_coeff,
    )

    model.reset()
    preprocess.reset()
    postprocess.reset()

    action_history: list[np.ndarray] = []
    left_hand_history: list[np.ndarray] = []
    right_hand_history: list[np.ndarray] = []
    waist_history: list[np.ndarray] = []
    gt_left_hand_history: list[np.ndarray] = []
    gt_right_hand_history: list[np.ndarray] = []
    gt_waist_history: list[np.ndarray] = []
    # Tracks the last predicted hand action for closed-loop feedback
    # (used when --no-use-dataset-hand; initialised from first frame GT).
    first_frame_hand_l = np.array(
        episode_data["data"][0]["state_hand_left"], dtype=np.float32
    )
    first_frame_hand_r = np.array(
        episode_data["data"][0]["state_hand_right"], dtype=np.float32
    )
    last_left_hand_pred: np.ndarray = first_frame_hand_l.copy()
    last_right_hand_pred: np.ndarray = first_frame_hand_r.copy()
    for t_step in range(num_images):
        # Build the observation state.
        # "sim"     – uses live simulation joint positions + last predicted hand actions.
        #             After 100 open-loop steps the sim state may drift from the GT
        #             trajectory, producing an out-of-distribution observation when ACT
        #             re-runs inference at step n_action_steps.
        # "dataset" – uses the recorded GT state directly from the episode data at every
        #             step.  This keeps the model in the same distribution as training and
        #             isolates model quality from state-feedback drift.  Use this to check
        #             whether repeating output is a model issue or a feedback issue.
        if args.obs_source == "dataset":
            state_frame = episode_data["data"][t_step]
            gt_state_body = np.array(
                state_frame["state_body"][BODY_STATE_OFFSET:], dtype=np.float32)  # (29,)
            gt_state_hand_l = np.array(
                state_frame["state_hand_left"], dtype=np.float32)   # (6,)
            gt_state_hand_r = np.array(
                state_frame["state_hand_right"], dtype=np.float32)  # (6,)
            if expected_action_dim == NUM_UPPER_BODY_ACTION:
                observation_state = np.concatenate(
                    [gt_state_body[NUM_ARM_BODY_OFFSET:],
                        gt_state_hand_l, gt_state_hand_r]
                ).astype(np.float32)
            elif expected_action_dim == NUM_WAIST_ARM_ACTION:
                # 29-dim model: waist + arms + hands (no legs)
                observation_state = np.concatenate(
                    [gt_state_body[NUM_LEG_JOINTS:], gt_state_hand_l, gt_state_hand_r]
                ).astype(np.float32)
            else:
                observation_state = np.concatenate(
                    [gt_state_body, gt_state_hand_l, gt_state_hand_r]
                ).astype(np.float32)
        else:  # "sim" (default)
            state_frame = episode_data["data"][t_step]
            model_observation = get_observation(sim_model, sim_data)
            # Hand state for the observation: either GT from dataset (stable, in-distribution)
            # or last predicted hand action (closed-loop, mirrors real deployment).
            if args.use_dataset_hand:
                obs_hand_l = np.array(
                    state_frame["state_hand_left"], dtype=np.float32)   # (6,)
                obs_hand_r = np.array(
                    state_frame["state_hand_right"], dtype=np.float32)  # (6,)
            else:
                obs_hand_l = last_left_hand_pred
                obs_hand_r = last_right_hand_pred
                obs_hand_l = np.round(np.clip(obs_hand_l, 0.0, 1.0), 3)
                obs_hand_r = np.round(np.clip(obs_hand_r, 0.0, 1.0), 3)
            if expected_action_dim == NUM_UPPER_BODY_ACTION:
                # 26-dim model: arm joints + hands only (14 + 6 + 6 = 26)
                observation_state = np.concatenate(
                    [
                        model_observation["joint_positions"][NUM_ARM_BODY_OFFSET:],
                        obs_hand_l,
                        obs_hand_r,
                    ]
                ).astype(np.float32)
            elif expected_action_dim == NUM_WAIST_ARM_ACTION:
                # 29-dim model: waist + arms + hands (no legs)
                observation_state = np.concatenate(
                    [
                        model_observation["joint_positions"][NUM_LEG_JOINTS:],
                        obs_hand_l,
                        obs_hand_r,
                    ]
                ).astype(np.float32)
            else:
                # 41-dim model (or unknown): full body joints with actual values
                observation_state = np.concatenate(
                    [
                        model_observation["joint_positions"],
                        obs_hand_l,
                        obs_hand_r,
                    ]
                ).astype(np.float32)

        if t_step % 100 == 0:
            print(f"Step {t_step:03d} | observation_state: {observation_state}")

        img_idx = t_step
        head_image_bgr = load_image_bgr(head_image_paths[img_idx])
        table_image_bgr = load_image_bgr(table_image_paths[img_idx])
        if args.show_images:
            show_camera_images(
                head_image_bgr, table_image_bgr, args.image_scale)

        head_image = convert_bgr_image_to_tensor(
            head_image_bgr).astype(np.float32) / 255.0
        table_image = convert_bgr_image_to_tensor(
            table_image_bgr).astype(np.float32) / 255.0

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

        # Compare predicted action against ground-truth recorded action to verify
        # the model is outputting the correct trajectory.
        frame = episode_data["data"][t_step]
        gt_body = np.array(
            frame["action_body"][BODY_ACTION_OFFSET:], dtype=np.float32)    # (29,)
        gt_hand_l = np.array(frame["action_hand_left"],
                             dtype=np.float32)                  # (6,)
        gt_hand_r = np.array(frame["action_hand_right"],
                             dtype=np.float32)                 # (6,)
        gt_left_hand_history.append(gt_hand_l.copy())
        gt_right_hand_history.append(gt_hand_r.copy())
        gt_waist_history.append(gt_body[NUM_LEG_JOINTS:NUM_LEG_JOINTS + NUM_WAIST_JOINTS].copy())
        if action_dim == NUM_FULL_BODY_ACTION:
            gt_action = np.concatenate(
                [gt_body, gt_hand_l, gt_hand_r])                        # (41,)
        elif action_dim == NUM_WAIST_ARM_ACTION:
            gt_action = np.concatenate(
                [gt_body[NUM_LEG_JOINTS:], gt_hand_l, gt_hand_r])       # (29,)
        else:  # 26-dim: arms only
            gt_action = np.concatenate(
                [gt_body[NUM_ARM_BODY_OFFSET:], gt_hand_l, gt_hand_r])  # (26,)
        pred_np = postprocessed_action.cpu().numpy()
        if pred_np.shape == gt_action.shape:
            mae = np.abs(pred_np - gt_action).mean()
            max_err = np.abs(pred_np - gt_action).max()
        else:
            mae = float("nan")
            max_err = float("nan")
            if t_step == 0:
                print(
                    f"[WARN] pred shape {pred_np.shape} != gt shape {gt_action.shape} — "
                    "skipping MAE computation (dataset action_body joint count mismatch)"
                )

        # Accumulate history and check for repeated (stuck) outputs every 100 steps.
        action_history.append(pred_np.copy())
        if (t_step + 1) % 100 == 0:
            window = np.stack(action_history[-100:])
            std_per_dim = window.std(axis=0)
            mean_std = float(std_per_dim.mean())
            max_std = float(std_per_dim.max())
            # A truly stuck/collapsed model has both mean_std and max_std near zero
            # (floating-point noise level). Low mean_std alone is expected when temporal
            # ensembling is active (it blends overlapping predictions, reducing variance
            # by design) or when the robot is in a near-static hold phase.
            if max_std < 1e-5:
                print(
                    f"[WARN] Step {t_step:03d} | Model output appears STUCK/REPEATING over last 100 steps "
                    f"(mean_std={mean_std:.6f}, max_std={max_std:.6f}) — likely collapsed policy or frozen input"
                )
            elif mean_std < 1e-3:
                print(
                    f"[INFO] Step {t_step:03d} | Low output variance over last 100 steps "
                    f"(mean_std={mean_std:.6f}, max_std={max_std:.6f}) — likely temporal ensembling smoothing or slow/static motion phase"
                )
            else:
                print(
                    f"[INFO] Step {t_step:03d} | Output diversity check (last 100 steps): "
                    f"mean_std={mean_std:.6f}, max_std={max_std:.6f}"
                )

        if action_dim == NUM_FULL_BODY_ACTION:  # 41: full body + hands
            last_robot_action = postprocessed_action[:NUM_BODY_JOINTS].cpu().numpy()
            last_left_hand_action = (
                postprocessed_action[NUM_BODY_JOINTS: NUM_BODY_JOINTS +
                                     NUM_HAND_JOINTS]
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
        # 26: arms + hands only (no legs/waist)
        elif action_dim == NUM_UPPER_BODY_ACTION:
            arm_action = postprocessed_action[:NUM_ARM_JOINTS].cpu().numpy()
            # Pad to full body size; leg/waist joints keep their current sim positions.
            last_robot_action = sim_data.qpos[BODY_QPOS_START: BODY_QPOS_START + NUM_BODY_JOINTS].copy()
            last_robot_action[NUM_ARM_BODY_OFFSET:] = arm_action
            last_left_hand_action = (
                postprocessed_action[NUM_ARM_JOINTS: NUM_ARM_JOINTS +
                                     NUM_HAND_JOINTS]
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
            # Pad to full body size; leg joints keep their current sim positions.
            last_robot_action = sim_data.qpos[BODY_QPOS_START: BODY_QPOS_START + NUM_BODY_JOINTS].copy()
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

        # Update closed-loop hand feedback for next step.
        last_left_hand_pred = last_left_hand_action.copy()
        last_right_hand_pred = last_right_hand_action.copy()

        # Apply action to simulation.  Choose between:
        #   position : directly set qpos (bypasses physics, always stable)
        #   torque   : PD torque control via mj_step (physics-accurate)
        if args.control_mode == "position":
            sim_data.qpos[BODY_QPOS_START: BODY_QPOS_START +
                          NUM_BODY_JOINTS] = last_robot_action
            sim_data.qvel[BODY_QVEL_START: BODY_QVEL_START +
                          NUM_BODY_JOINTS] = 0.0
            mujoco.mj_forward(sim_model, sim_data)
        else:  # torque
            # The XML uses <motor> actuators with ctrlrange="-1 1", so torques must be
            # normalised by TORQUE_LIMITS before writing to ctrl.
            # Run n_substeps per control step to match the 50 Hz dataset control rate.
            q_current = sim_data.qpos[BODY_QPOS_START:
                                      BODY_QPOS_START + NUM_BODY_JOINTS]
            qd_current = sim_data.qvel[BODY_QVEL_START:
                                       BODY_QVEL_START + NUM_BODY_JOINTS]
            torque = STIFFNESS * (last_robot_action -
                                  q_current) - DAMPING * qd_current
            torque = np.clip(torque, -TORQUE_LIMITS, TORQUE_LIMITS)
            # scale to [-1, 1] for motor actuators
            normalized_torque = torque / TORQUE_LIMITS
            sim_data.ctrl[:NUM_BODY_JOINTS] = normalized_torque
            for _ in range(n_substeps):
                mujoco.mj_step(sim_model, sim_data)
        viewer.sync()

    print(f"Inference finished after one pass over {num_images} image pairs.")

    # Save per-step hand diff (pred − GT) to CSV for offline analysis.
    if gt_left_hand_history and left_hand_history:
        n = min(len(left_hand_history), len(gt_left_hand_history))
        save_dir = "data/outputs/deploy"
        os.makedirs(save_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        csv_path = os.path.join(save_dir, f"hand_diff_{timestamp}.csv")
        left_arr  = np.array(left_hand_history[:n])   # (T, 6) pred
        right_arr = np.array(right_hand_history[:n])
        gt_l_arr  = np.array(gt_left_hand_history[:n])  # (T, 6) GT
        gt_r_arr  = np.array(gt_right_hand_history[:n])
        diff_l    = left_arr  - gt_l_arr  # signed diff
        diff_r    = right_arr - gt_r_arr
        with open(csv_path, "w", newline="") as fh:
            writer = csv.writer(fh)
            header = (
                ["step"]
                + [f"pred_L{j}" for j in range(NUM_HAND_JOINTS)]
                + [f"gt_L{j}"   for j in range(NUM_HAND_JOINTS)]
                + [f"diff_L{j}" for j in range(NUM_HAND_JOINTS)]
                + [f"pred_R{j}" for j in range(NUM_HAND_JOINTS)]
                + [f"gt_R{j}"   for j in range(NUM_HAND_JOINTS)]
                + [f"diff_R{j}" for j in range(NUM_HAND_JOINTS)]
                + ["mae_L", "mae_R"]
            )
            writer.writerow(header)
            for t in range(n):
                row = (
                    [t]
                    + left_arr[t].tolist()
                    + gt_l_arr[t].tolist()
                    + diff_l[t].tolist()
                    + right_arr[t].tolist()
                    + gt_r_arr[t].tolist()
                    + diff_r[t].tolist()
                    + [float(np.abs(diff_l[t]).mean()), float(np.abs(diff_r[t]).mean())]
                )
                writer.writerow(row)
        print(f"Hand diff CSV saved to: {csv_path}")
        # Summary statistics
        print(
            f"Hand diff summary over {n} steps | "
            f"mean MAE  L={float(np.abs(diff_l).mean()):.4f}  R={float(np.abs(diff_r).mean()):.4f} | "
            f"max  MAE  L={float(np.abs(diff_l).max()):.4f}   R={float(np.abs(diff_r).max()):.4f}"
        )

    if args.plot and left_hand_history:
        plot_hand_joint_data(
            left_hand_history,
            right_hand_history,
            title_prefix="Sim Inference",
            ref_left_hand_history=gt_left_hand_history,
            ref_right_hand_history=gt_right_hand_history,
            ref_label="GT",
            waist_history=waist_history,
            ref_waist_history=gt_waist_history,
        )


def extract_body_joint_values(frame: dict, playback_source: str) -> np.ndarray:
    if playback_source == "state":
        joint_values = frame["state_body"][BODY_STATE_OFFSET:]
    elif playback_source == "action":
        joint_values = frame["action_body"][BODY_ACTION_OFFSET:]
    else:
        raise ValueError(f"Unsupported playback source: {playback_source}")

    joint_values = np.asarray(joint_values, dtype=np.float32)
    if joint_values.shape[0] != NUM_BODY_JOINTS:
        raise ValueError(
            f"Expected {NUM_BODY_JOINTS} joint values for playback, got {joint_values.shape[0]}"
        )
    return joint_values


def get_playback_fps(args, episode_data: dict) -> float:
    if args.playback_fps is not None:
        return args.playback_fps
    return float(episode_data.get("info", {}).get("image", {}).get("fps", 30.0))


def run_dataset_playback(
    args,
    viewer,
    sim_model: mujoco.MjModel,
    sim_data: mujoco.MjData,
    episode_data: dict,
    head_image_paths: list[str],
    table_image_paths: list[str],
):
    frames = episode_data["data"]
    playback_fps = get_playback_fps(args, episode_data)
    frame_interval = 1.0 / playback_fps if playback_fps > 0 else 0.0
    print(
        f"Playing back {len(frames)} frames from dataset using {args.playback_source} joint values at {playback_fps:.2f} FPS."
    )

    # Histories collected from the first playback pass for optional plotting.
    primary_left_hand: list[np.ndarray] = []
    primary_right_hand: list[np.ndarray] = []
    primary_waist: list[np.ndarray] = []
    ref_left_hand: list[np.ndarray] = []
    ref_right_hand: list[np.ndarray] = []
    ref_waist: list[np.ndarray] = []

    def _do_plot():
        if args.plot and primary_left_hand:
            plot_hand_joint_data(
                primary_left_hand,
                primary_right_hand,
                title_prefix=f"Playback ({args.playback_source})",
                pred_label=args.playback_source,
                ref_left_hand_history=ref_left_hand if ref_left_hand else None,
                ref_right_hand_history=ref_right_hand if ref_right_hand else None,
                ref_label="action" if args.playback_source == "state" else "state",
                waist_history=primary_waist if primary_waist else None,
                ref_waist_history=ref_waist if ref_waist else None,
            )

    playback_pass = 0
    try:
        while True:
            for frame_idx, frame in enumerate(frames):
                step_start = time.time()
                joint_values = extract_body_joint_values(
                    frame, args.playback_source)
                if args.show_images:
                    head_image_bgr = load_image_bgr(head_image_paths[frame_idx])
                    table_image_bgr = load_image_bgr(table_image_paths[frame_idx])
                    show_camera_images(
                        head_image_bgr, table_image_bgr, args.image_scale)

                if args.playback_source == "state":
                    sim_data.qpos[BODY_QPOS_START: BODY_QPOS_START + NUM_BODY_JOINTS] = (
                        joint_values
                    )
                    sim_data.qvel[BODY_QVEL_START: BODY_QVEL_START +
                                  NUM_BODY_JOINTS] = 0.0
                    sim_data.ctrl[:] = joint_values
                    mujoco.mj_forward(sim_model, sim_data)
                else:
                    sim_data.ctrl[:] = joint_values
                    mujoco.mj_step(sim_model, sim_data)

                viewer.sync()
                print(
                    f"Playback pass {playback_pass}, frame {frame_idx}, joint values: {joint_values}"
                )

                # Collect hand and waist data only on the first pass.
                if playback_pass == 0 and args.plot:
                    state_body = np.array(
                        frame["state_body"][BODY_STATE_OFFSET:], dtype=np.float32
                    )
                    action_body = np.array(
                        frame["action_body"][BODY_ACTION_OFFSET:], dtype=np.float32
                    )
                    state_hand_l = np.array(frame["state_hand_left"], dtype=np.float32)
                    state_hand_r = np.array(frame["state_hand_right"], dtype=np.float32)
                    action_hand_l = np.array(frame["action_hand_left"], dtype=np.float32)
                    action_hand_r = np.array(frame["action_hand_right"], dtype=np.float32)
                    if args.playback_source == "state":
                        primary_left_hand.append(state_hand_l)
                        primary_right_hand.append(state_hand_r)
                        primary_waist.append(
                            state_body[NUM_LEG_JOINTS: NUM_LEG_JOINTS + NUM_WAIST_JOINTS]
                        )
                        ref_left_hand.append(action_hand_l)
                        ref_right_hand.append(action_hand_r)
                        ref_waist.append(
                            action_body[NUM_LEG_JOINTS: NUM_LEG_JOINTS + NUM_WAIST_JOINTS]
                        )
                    else:
                        primary_left_hand.append(action_hand_l)
                        primary_right_hand.append(action_hand_r)
                        primary_waist.append(
                            action_body[NUM_LEG_JOINTS: NUM_LEG_JOINTS + NUM_WAIST_JOINTS]
                        )
                        ref_left_hand.append(state_hand_l)
                        ref_right_hand.append(state_hand_r)
                        ref_waist.append(
                            state_body[NUM_LEG_JOINTS: NUM_LEG_JOINTS + NUM_WAIST_JOINTS]
                        )

                if frame_interval > 0:
                    elapsed = time.time() - step_start
                    remaining = frame_interval - elapsed
                    if remaining > 0:
                        time.sleep(remaining)

            if not args.loop_playback:
                break
            playback_pass += 1
    except KeyboardInterrupt:
        _do_plot()
        raise

    _do_plot()


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
        description="Run policy inference or dataset playback in MuJoCo simulation."
    )
    parser.add_argument(
        "--mode",
        choices=["inference", "playback"],
        default="inference",
        help="Choose whether to run model inference or play back recorded dataset joints.",
    )
    parser.add_argument(
        "--xml-file-path",
        default="./assets/g1/g1_mocap_29dof.xml",
        help="Path to the MuJoCo XML model.",
    )
    parser.add_argument(
        "--episode-dir",
        default="./dataset-v1/episode_0000",
        help="Path to the raw episode directory containing data.json and images.",
    )
    parser.add_argument(
        "--dataset-dir",
        default="./data/outputs/lerobot_twist_dataset",
        help="Path to the converted LeRobot dataset used for inference preprocessing.",
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
        "--control-mode",
        choices=["position", "torque"],
        default="position",
        help="position: directly set qpos (stable, no physics); torque: PD torque via mj_step (physics-accurate).",
    )
    parser.add_argument(
        "--temporal-ensemble-coeff",
        type=float,
        default=0.0,
        help="Temporal ensembling coefficient for ACT (exp decay weight). Set to 0 to disable.",
    )
    parser.add_argument(
        "--obs-source",
        choices=["sim", "dataset"],
        default="sim",
        help=(
            "Observation state source for policy inference. "
            "'sim': live simulation state + last predicted hand actions (default). "
            "'dataset': GT recorded state from episode data at each step."
        ),
    )
    parser.add_argument(
        "--playback-source",
        choices=["state", "action"],
        default="state",
        help="Use recorded joint state or action values during dataset playback.",
    )
    parser.add_argument(
        "--playback-fps",
        type=float,
        default=None,
        help="Playback FPS override. Defaults to the episode metadata FPS.",
    )
    parser.add_argument(
        "--loop-playback",
        action="store_true",
        help="Loop dataset playback continuously.",
    )
    parser.add_argument(
        "--show-images",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Show the recorded head and table images in an OpenCV window.",
    )
    parser.add_argument(
        "--image-scale",
        type=float,
        default=0.5,
        help="Scale factor for the OpenCV camera display window.",
    )
    parser.add_argument(
        "--use-dataset-hand",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "Use GT hand state from the dataset as the hand observation (default, in-distribution). "
            "Pass --no-use-dataset-hand to feed back the last predicted hand action instead."
        ),
    )
    parser.add_argument(
        "--plot",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Plot hand joint trajectories at the end of inference or on interrupt.",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    if not _MUJOCO_AVAILABLE:
        raise RuntimeError(
            "MuJoCo is not installed. Install it to run in simulation mode."
        )

    episode_data = load_episode_data(args.episode_dir)
    head_image_paths, table_image_paths = get_episode_image_paths(
        args.episode_dir, episode_data
    )
    viewer, sim_model, sim_data = create_simulation_viewer(args.xml_file_path)
    try:
        set_viewer_camera(viewer, sim_model, sim_data)
        if args.mode == "inference":
            run_policy_inference(
                args,
                viewer,
                sim_model,
                sim_data,
                episode_data,
                head_image_paths,
                table_image_paths,
            )
        else:
            run_dataset_playback(
                args,
                viewer,
                sim_model,
                sim_data,
                episode_data,
                head_image_paths,
                table_image_paths,
            )
    except KeyboardInterrupt:
        print("Simulation interrupted by user.")
    finally:
        try:
            cv2.destroyAllWindows()
        except Exception:
            pass
        viewer.close()


if __name__ == "__main__":
    main()
