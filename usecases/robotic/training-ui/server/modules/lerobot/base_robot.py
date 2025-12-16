# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from lerobot.datasets.lerobot_dataset import LeRobotDataset
from abc import ABC, abstractmethod
import threading

class BaseRobotModule(threading.Thread, ABC):
    def __init__(self, group = None, target = None, name = None, args = ..., kwargs = None, *, daemon = None):
        super().__init__(group, target, name, args, kwargs, daemon=daemon)
        self.dataset : LeRobotDataset = None
    
    @abstractmethod
    def start_episode(self):
        pass

    @abstractmethod
    def stop_episode(self):
        pass

    @abstractmethod
    def reset_episode(self):
        pass

    @abstractmethod
    def replay_episode(self):
        pass

    @abstractmethod
    def get_dataset_metadata(self):
        pass
    
