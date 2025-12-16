# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from lerobot.datasets.lerobot_dataset import LeRobotDataset
from pathlib import Path

HF_LEROBOT_DIR = "./data/datasets"

def get_num_episodes_from_dataset(dataset_name: str):
    if Path(f"{HF_LEROBOT_DIR}/{dataset_name}/meta/tasks.parquet").exists():
        dataset = LeRobotDataset(
            repo_id=f"{dataset_name}",
            root=f"{HF_LEROBOT_DIR}/{dataset_name}",
            video_backend="pyav"
        )
        return dataset.num_episodes

    return -1
