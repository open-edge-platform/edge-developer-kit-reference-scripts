# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Configuration module for wake word detection service."""

import os
from dataclasses import dataclass
import json


@dataclass
class AudioConfig:
    """Audio configuration constants."""

    CHUNK_SIZE: int = 1280  # 80ms at 16kHz
    SAMPLE_RATE: int = 16000
    CHANNELS: int = 1


@dataclass
class ServerConfig:
    """Server configuration."""

    host: str
    port: int
    allowed_cors: list[str]

    @classmethod
    def from_env(cls, default_port: int = 5007) -> "ServerConfig":
        """Create server config from environment variables."""
        return cls(
            host=os.getenv("SERVER_HOST", "127.0.0.1"),
            port=int(os.getenv("SERVER_PORT", default_port)),
            allowed_cors=json.loads(os.getenv("ALLOWED_CORS", '["http://localhost"]')),
        )


@dataclass
class DetectionState:
    """Global detection state."""

    active: bool = False
    selected_device_id: int = -1
    default_device_id: int = -1
    vad_threshold: float = 0.2
    detection_threshold: float = 0.5

    def reset(self):
        """Reset detection state."""
        self.active = False
