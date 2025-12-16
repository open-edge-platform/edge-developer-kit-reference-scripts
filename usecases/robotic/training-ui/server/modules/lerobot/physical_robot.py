# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from lerobot.robots.so101_follower import SO101Follower, SO101FollowerConfig
from lerobot.teleoperators.so101_leader import SO101Leader, SO101LeaderConfig
from lerobot.utils.robot_utils import busy_wait
from lerobot.datasets.lerobot_dataset import LeRobotDataset
from lerobot.datasets.utils import hw_to_dataset_features, build_dataset_frame
from lerobot.scripts.lerobot_find_cameras import (
    find_all_opencv_cameras,
    find_all_realsense_cameras,
)
from lerobot.cameras.realsense.configuration_realsense import RealSenseCameraConfig
from lerobot.cameras.opencv.configuration_opencv import OpenCVCameraConfig
from lerobot.cameras.configs import ColorMode, Cv2Rotation
from lerobot.processor import make_default_processors
from lerobot.processor.pipeline import RobotProcessorPipeline

from typing import Dict
import logging
from pathlib import Path
from serial.tools.list_ports import comports
from collections.abc import Iterator
from constants import DATA_DIR
from modules.lerobot.utils import create_dynamic_grid
from modules.lerobot.base_robot import BaseRobotModule

import torch
import torch.utils.data
import shutil
import threading
import time
import tqdm
import numbers
import cv2
import queue
import numpy as np

logger = logging.getLogger(__name__)

ProcessorType = Dict[str, RobotProcessorPipeline]

HF_LEROBOT_DIR = "./data/datasets"


def query_all_cameras():
    cameras = []
    cameras.extend(find_all_opencv_cameras())
    cameras.extend(find_all_realsense_cameras())
    return cameras


def query_all_comports():
    ports = comports()
    ttyACM_ports = [
        {"port": port.device} for port in ports if port.device.startswith("/dev/ttyACM")
    ]
    return ttyACM_ports


def is_scalar(x):
    return (
        isinstance(x, float)
        or isinstance(x, numbers.Real)
        or isinstance(x, (np.integer, np.floating))
        or (isinstance(x, np.ndarray) and x.ndim == 0)
    )


def to_hwc_uint8_numpy(chw_float32_torch: torch.Tensor) -> np.ndarray:
    assert chw_float32_torch.dtype == torch.float32
    assert chw_float32_torch.ndim == 3
    c, h, w = chw_float32_torch.shape
    assert (
        c < h and c < w
    ), f"expect channel first images, but instead {chw_float32_torch.shape}"
    hwc_uint8_numpy = (
        (chw_float32_torch * 255).type(torch.uint8).permute(1, 2, 0).numpy()
    )
    return hwc_uint8_numpy


class EpisodeSampler(torch.utils.data.Sampler):
    def __init__(self, dataset: LeRobotDataset, episode_index: int):
        from_idx = dataset.meta.episodes["dataset_from_index"][episode_index]
        to_idx = dataset.meta.episodes["dataset_to_index"][episode_index]
        self.frame_ids = range(from_idx, to_idx)

    def __iter__(self) -> Iterator:
        return iter(self.frame_ids)

    def __len__(self) -> int:
        return len(self.frame_ids)


class LeRobotModule(BaseRobotModule):
    def __init__(
        self,
        name: str,
        cameras,
        fps,
        robots,
        instruction,
        num_of_episodes,
        clear_dataset=False,
    ):
        super().__init__()
        self.robot_project_name = name
        self.fps = fps
        self.cameras = cameras
        self.robots = robots
        self.instruction = instruction
        self.num_of_episodes = num_of_episodes
        self.dataset_root = Path(HF_LEROBOT_DIR) / self.robot_project_name

        self.is_robot_disconnected = threading.Event()
        self.is_robot_disconnected.set()
        self.is_not_recording = threading.Event()
        self.is_not_recording.set()
        self.is_episode_operation_in_progress = threading.Event()

        self.stop_event = threading.Event()
        self.max_queue_size = 1
        self.frame_queue = queue.Queue(maxsize=self.max_queue_size)

        (
            self.teleop_action_processor,
            self.robot_action_processor,
            self.robot_observation_processor,
        ) = make_default_processors()

        self.camera_configs = {}

        for cam in cameras:
            cam_type = cam["type"]
            cam_tag = cam["tag"]
            if cam_type == "RealSense":
                config = RealSenseCameraConfig(
                    serial_number_or_name=cam["id"],
                    fps=cam["fps"],
                    width=640,
                    height=480,
                    color_mode=ColorMode.RGB,
                    use_depth=True,
                    rotation=Cv2Rotation.NO_ROTATION,
                )
                self.camera_configs[cam_tag] = config
            elif cam_type == "OpenCV":
                config = OpenCVCameraConfig(
                    index_or_path=cam["id"],
                    fps=cam["fps"],
                    width=640,
                    height=480,
                    color_mode=ColorMode.RGB,
                    rotation=Cv2Rotation.NO_ROTATION,
                )
                self.camera_configs[cam_tag] = config

        self.robot_config = SO101FollowerConfig(
            port=self.robots["robot"], id="my_follower_arm", cameras=self.camera_configs
        )
        self.teleop_config = SO101LeaderConfig(
            port=self.robots["teleop"], id="my_leader_arm"
        )

        self.robot = SO101Follower(self.robot_config)
        self.teleoper = SO101Leader(self.teleop_config)

        action_features = hw_to_dataset_features(self.robot.action_features, "action")
        obs_features = hw_to_dataset_features(
            self.robot.observation_features, "observation"
        )
        dataset_features = {**action_features, **obs_features}

        if clear_dataset:
            try:
                shutil.rmtree(self.dataset_root)
            except:
                pass

        if not self.dataset_root.exists():
            self.dataset = LeRobotDataset.create(
                repo_id=f"{self.robot_project_name}",
                root=str(self.dataset_root),
                fps=fps,
                features=dataset_features,
                robot_type=self.robot.name,
                use_videos=True,
                image_writer_threads=4,
                video_backend="pyav",
            )
        else:
            if (self.dataset_root / "meta" / "tasks.parquet").exists():
                self.dataset = LeRobotDataset(
                    repo_id=f"{self.robot_project_name}",
                    root=str(self.dataset_root),
                    video_backend="pyav",
                )
            else:
                shutil.rmtree(self.dataset_root)
                self.dataset = LeRobotDataset.create(
                    repo_id=f"{self.robot_project_name}",
                    root=str(self.dataset_root),
                    fps=fps,
                    features=dataset_features,
                    robot_type=self.robot.name,
                    use_videos=True,
                    image_writer_threads=4,
                    video_backend="pyav",
                )

        self.start()

    def run(self):
        while not self.stop_event.is_set():
            if self.is_episode_operation_in_progress.is_set():
                time.sleep(0.05)
                continue

            start_loop_t = time.perf_counter()

            if not self.is_robot_disconnected.is_set():
                try:
                    obs = self.robot.get_observation()
                except TimeoutError:
                    logger.warning(
                        "Timed out waiting for camera frame; skipping iteration."
                    )
                    continue
                except Exception as exc:
                    logger.exception("Failed to fetch robot observation: %s", exc)
                    time.sleep(0.05)
                    continue
                obs_processed = self.robot_observation_processor(obs)

                cv_images = []
                for k, v in obs_processed.items():
                    key = k if str(k).startswith("observation.") else f"observation.{k}"
                    if is_scalar(v):
                        pass
                    elif isinstance(v, np.ndarray):
                        cv_image = cv2.cvtColor(v, cv2.COLOR_BGR2RGB)
                        cv_images.append(cv_image)

                try:
                    act = self.teleoper.get_action()
                    act_processed_teleop = self.teleop_action_processor((act, obs))
                    robot_action_to_send = self.robot_action_processor(
                        (act_processed_teleop, obs)
                    )
                    _sent_action = self.robot.send_action(robot_action_to_send)
                except:
                    pass

                try:
                    if self.frame_queue.full():
                        self.frame_queue.get_nowait()
                    grided_images = create_dynamic_grid(cv_images)
                    self.frame_queue.put_nowait(grided_images)
                except:
                    pass

                if self.dataset is not None and not self.is_not_recording.is_set():
                    observation_frame = build_dataset_frame(
                        self.dataset.features, obs_processed, prefix="observation"
                    )
                    action_frame = build_dataset_frame(
                        self.dataset.features, act_processed_teleop, prefix="action"
                    )
                    frame = {
                        **observation_frame,
                        **action_frame,
                        "task": self.instruction,
                    }
                    self.dataset.add_frame(frame)

                dt_s = time.perf_counter() - start_loop_t
                busy_wait(1 / self.fps - dt_s)
            else:
                time.sleep(1)

    def live_stream(self):
        if self.is_robot_disconnected.is_set():
            yield b""
            return

        while not self.is_robot_disconnected.is_set():
            try:
                frame = self.frame_queue.get(timeout=1)
            except queue.Empty:
                continue

            ret, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if not ret:
                continue

            frame_bytes = buffer.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
            )

    def connect(self):
        try:
            self.robot.connect(calibrate=False)
            self.teleoper.connect(calibrate=False)
        except:
            pass

        self.is_robot_disconnected.clear()

    def disconnect(self):
        self.is_robot_disconnected.set()

        try:
            if self.robot.is_connected:
                self.robot.disconnect()
            if self.teleoper.is_connected:
                self.teleoper.disconnect()
        except:
            pass

    def stop(self):
        self.is_robot_disconnected.set()
        self.stop_event.set()

    def start_episode(self):
        if self.num_of_episodes < self.dataset.num_episodes:
            return False, self.dataset.num_episodes
        self.is_not_recording.clear()
        return True, self.dataset.num_episodes

    def stop_episode(self):
        self.is_not_recording.set()
        return True, self.dataset.num_episodes

    def save_episode(self):
        if self.is_episode_operation_in_progress.is_set():
            logger.warning(
                "Episode operation already in progress; save request ignored."
            )
            current_episodes = self.dataset.num_episodes if self.dataset else 0
            return False, current_episodes

        self.is_episode_operation_in_progress.set()
        try:
            if self.dataset is None:
                return False, 0

            if self.num_of_episodes < self.dataset.num_episodes:
                return False, self.dataset.num_episodes

            self.is_not_recording.set()
            self.dataset.save_episode()
            self.dataset.finalize()
            self.dataset = LeRobotDataset(
                repo_id=f"{self.robot_project_name}",
                root=str(self.dataset_root),
                video_backend="pyav",
            )
            return True, self.dataset.num_episodes
        finally:
            self.is_episode_operation_in_progress.clear()

    def reset_episode(self):
        self.dataset.clear_episode_buffer()
        return True, self.dataset.num_episodes

    def replay_episode(self, episode_index):
        if episode_index < 0:
            episode_index = 0

        dataset = LeRobotDataset(
            repo_id=f"{self.robot_project_name}",
            root=str(self.dataset_root),
            video_backend="pyav",
        )

        episode_sampler = EpisodeSampler(dataset, episode_index)
        dataloader = torch.utils.data.DataLoader(
            dataset,
            num_workers=4,
            batch_size=1,
            sampler=episode_sampler,
        )

        for batch in tqdm.tqdm(dataloader, total=len(dataloader)):
            start_loop_t = time.perf_counter()
            for i in range(len(batch["index"])):
                cv_images = []
                for key in self.dataset.meta.camera_keys:
                    frame = to_hwc_uint8_numpy(batch[key][i])
                    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

                    cv_images.append(frame)

                grided_image = create_dynamic_grid(cv_images)
                ret, buffer = cv2.imencode(
                    ".jpg", grided_image, [cv2.IMWRITE_JPEG_QUALITY, 90]
                )
                if not ret:
                    continue

                frame_bytes = buffer.tobytes()
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
                )

            dt_s = time.perf_counter() - start_loop_t
            busy_wait(1 / self.fps - dt_s)

    def get_dataset_metadata(self):
        return self.dataset.num_episodes
