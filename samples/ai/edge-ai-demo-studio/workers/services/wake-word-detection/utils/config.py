# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from dataclasses import dataclass


@dataclass
class AudioConfig:
    CHUNK_SIZE: int = 1280  # 80ms at 16kHz
    SAMPLE_RATE: int = 16000
    CHANNELS: int = 1


@dataclass
class DetectionState:
    active: bool = False
    selected_device_id: int = -1
    default_device_id: int = -1
    vad_threshold: float = 0.2
    detection_threshold: float = 0.5

    def reset(self):
        self.active = False
