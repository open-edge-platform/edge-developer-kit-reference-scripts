#!/usr/bin/env python3
# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
# This is a script to convert TWIST dataset to LeRobot dataset format.

import os
import cv2
import json
import argparse
from pathlib import Path
import numpy as np

from lerobot.datasets.lerobot_dataset import LeRobotDataset

IMAGE_SHAPE = (480, 640, 3)

# G1 body joint layout (29 DOF, indices relative to the 29-DOF body slice):
#   0-11  : legs  (left leg 0-5, right leg 6-11)
#   12-14 : waist
#   15-28 : arms  (left arm 15-21, right arm 22-28)
# state_body has 34 elements: [5 non-joint] + [29 joints]
# action_body has 35 elements: [6 non-joint] + [29 joints]
STATE_BODY_JOINT_OFFSET = 5
ACTION_BODY_JOINT_OFFSET = 6
NUM_HAND_DOF = 6  # per hand


def compute_joint_indices(use_legs: bool, use_waist: bool) -> list:
    indices = []
    if use_legs:
        indices += list(range(0, 12))   # left leg (0-5) + right leg (6-11)
    if use_waist:
        indices += list(range(12, 15))  # waist
    indices += list(range(15, 29))      # arms always included
    return indices


def create_empty_lerobot_dataset(repo_id, root, state_action_dim: int, use_videos: bool = True, use_head_image: bool = False, use_table_image: bool = False) -> LeRobotDataset:
    if os.path.exists(root + "/meta/info.json"):
        print(f"LeRobot dataset already exists at {root}. Skipping creation.")
        return LeRobotDataset(repo_id, root)

    features = {
        "observation.state": {
            "dtype": "float32",
            "shape": (state_action_dim,),
            "names": [i for i in range(state_action_dim)],
        },
        "action": {
            "dtype": "float32",
            "shape": (state_action_dim,),
            "names": {
                "motors": [i for i in range(state_action_dim)],
            }
        },
    }
    if use_head_image or use_table_image:
        image_dtype = "video" if use_videos else "image"
        if use_head_image:
            features["observation.images.head_image"] = {
                "dtype": image_dtype,
                "shape": (IMAGE_SHAPE[2], IMAGE_SHAPE[0], IMAGE_SHAPE[1]),
                "names": ["channels", "height", "width"],
            }
        if use_table_image:
            features["observation.images.table_image"] = {
                "dtype": image_dtype,
                "shape": (IMAGE_SHAPE[2], IMAGE_SHAPE[0], IMAGE_SHAPE[1]),
                "names": ["channels", "height", "width"],
            }

    return LeRobotDataset.create(
        repo_id=repo_id,
        root=root,
        robot_type="unitree-g1",
        fps=50,
        features=features,
        image_writer_threads=5,
        image_writer_processes=10,
        use_videos=use_videos,
        video_backend="pyav",
    )


def get_episode_dirs(dataset_path):
    episode_dirs = [f"{dataset_path}/{d}" for d in os.listdir(
        dataset_path) if os.path.isdir(os.path.join(dataset_path, d))]
    print(f"Episode directories: {episode_dirs}")
    return episode_dirs


def read_data_in_episode(episode_dir):
    with open(os.path.join(episode_dir, "data.json"), "r") as f:
        data = json.load(f)
    print(f"Read {len(data)} data points from {episode_dir}")
    return data


def main(args):
    if not os.path.exists(args.dataset_path):
        raise FileNotFoundError(
            f"Dataset path {args.dataset_path} does not exist.")

    joint_indices = compute_joint_indices(
        use_legs=args.use_legs, use_waist=args.use_waist)
    state_action_dim = len(joint_indices) + NUM_HAND_DOF * 2
    print(
        f"USE_LEGS={args.use_legs}, USE_WAIST={args.use_waist} "
        f"-> body DOF={len(joint_indices)}, total state/action dim={state_action_dim}"
    )

    # check how many episodes
    episode_dirs = get_episode_dirs(args.dataset_path)
    num_episodes = len(episode_dirs)
    if num_episodes == 0:
        raise ValueError(
            f"No episodes found in dataset path {args.dataset_path}.")
    print(f"Found {num_episodes} episodes in the dataset.")

    raw_output = Path(args.output_path)
    if ".." in raw_output.parts:
        raise ValueError(
            f"Invalid output path (directory traversal detected): {args.output_path}")
    
    output_path = raw_output.resolve()
    # Guard against catastrophic deletion of system-critical paths
    dangerous_roots = {Path(p) for p in ("/", "/home", "/usr", "/etc", "/var", "/tmp", "/bin", "/sbin", "/lib")}
    if output_path in dangerous_roots or output_path == Path.home():
        raise ValueError(
            f"Refusing to use a system-critical directory as output path: {output_path}")
    
    if output_path.exists():
        raise SystemExit(
            f"Output path already exists: {output_path}\n"
            "Please remove it manually and re-run the script."
        )

    dataset = None
    use_head_image = False
    use_table_image = False

    for ep, episode_dir in enumerate(episode_dirs):
        twist_data = read_data_in_episode(episode_dir)
        task = twist_data['text']['goal']
        for i, data in enumerate(twist_data['data']):
            print(
                f"[EP {ep}] Converting data point {i} / {len(twist_data['data'])}")

            # Read images unconditionally if present in data
            forehead_image = None
            if 'forehead_rgb' in data:
                forehead_rgb_path = os.path.join(episode_dir, data['forehead_rgb'])
                forehead_image = cv2.imread(forehead_rgb_path)
                if forehead_image is None:
                    raise FileNotFoundError(f"Failed to read image: {forehead_rgb_path}")
                forehead_image = cv2.cvtColor(forehead_image, cv2.COLOR_BGR2RGB)
                if forehead_image.shape != IMAGE_SHAPE:
                    raise ValueError(
                        f"Image shape mismatch: expected {IMAGE_SHAPE}, got {forehead_image.shape}"
                    )

            table_image = None
            if 'table_rgb' in data:
                table_rgb_path = os.path.join(episode_dir, data['table_rgb'])
                table_image = cv2.imread(table_rgb_path)
                if table_image is None:
                    raise FileNotFoundError(f"Failed to read image: {table_rgb_path}")
                table_image = cv2.cvtColor(table_image, cv2.COLOR_BGR2RGB)
                if table_image.shape != IMAGE_SHAPE:
                    raise ValueError(
                        f"Image shape mismatch: expected {IMAGE_SHAPE}, got {table_image.shape}"
                    )

            # Validate hand data ranges
            for hand_key in ("state_hand_left", "state_hand_right", "action_hand_left", "action_hand_right"):
                hand_vals = np.array(data[hand_key], dtype=np.float32)
                if not np.all((hand_vals >= 0.0) & (hand_vals <= 1.0)):
                    raise ValueError(
                        f"[EP {ep}] Frame {i}: '{hand_key}' values out of [0.0, 1.0] range: {hand_vals}"
                    )

            # Body joints: state_body[STATE_BODY_JOINT_OFFSET:] gives 29 joint values
            state_body_joints = data['state_body'][STATE_BODY_JOINT_OFFSET:]
            state = [state_body_joints[j] for j in joint_indices] + \
                data['state_hand_left'] + data['state_hand_right']
            state = np.array(state, dtype=np.float32)

            # Body joints: action_body is now fixed to match state_body layout (34 elements),
            # so use STATE_BODY_JOINT_OFFSET (5) instead of ACTION_BODY_JOINT_OFFSET (6).
            action_body_joints = data['action_body'][STATE_BODY_JOINT_OFFSET:]
            action = [action_body_joints[j] for j in joint_indices] + \
                data['action_hand_left'] + data['action_hand_right']
            action = np.array(action, dtype=np.float32)

            if dataset is None:
                # Determine which image keys are present based on the first frame
                use_head_image = forehead_image is not None
                use_table_image = table_image is not None
                dataset = create_empty_lerobot_dataset(
                    repo_id="lerobot/twist-dataset",
                    root=str(output_path),
                    state_action_dim=state_action_dim,
                    use_videos=True,
                    use_head_image=use_head_image,
                    use_table_image=use_table_image,
                )

            frame = {
                "observation.state": state,
                "action": action,
                "task": task,
            }

            if use_head_image and forehead_image is not None:
                frame.update({"observation.images.head_image": forehead_image})

            if use_table_image and table_image is not None:
                frame.update({"observation.images.table_image": table_image})

            dataset.add_frame(
                frame
            )
        dataset.save_episode()
    dataset.finalize()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convert TWIST dataset to LeRobot dataset format.")
    parser.add_argument(
        "--dataset_path",
        type=str,
        help="Path to the TWIST dataset directory."
    )
    parser.add_argument(
        "--output_path",
        type=str,
        help="Path to save the converted LeRobot dataset.",
        default="./data/outputs/lerobot_twist_dataset"
    )
    parser.add_argument(
        "--use-legs",
        dest="use_legs",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Include leg joints (12 DOF) in state/action. USE_LEGS=True by default."
    )
    parser.add_argument(
        "--use-waist",
        dest="use_waist",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Include waist joints (3 DOF) in state/action. USE_WAIST=True by default."
    )
    args = parser.parse_args()
    main(args)
