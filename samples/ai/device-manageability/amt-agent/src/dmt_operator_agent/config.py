# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from pathlib import Path
from pydantic import Field
from agentic_framework.config import FrameworkBaseConfig, framework_config

class DMTOperatorConfig(FrameworkBaseConfig):
    poll_interval_seconds: int = Field(default=15)
    max_remediation_retries: int = Field(default=3)
    capture_max_attempts: int = Field(default=3, description="Screen capture attempts before a device is declared offline")
    capture_retry_delay_seconds: float = Field(default=5.0, description="Base delay between capture attempts (grows linearly per attempt)")
    recovery_initial_settle_seconds: int = Field(default=15, description="Initial settle delay after power action before boot polling starts")
    recovery_poll_interval_seconds: int = Field(default=10, description="Interval between boot state screen checks")
    max_recovery_wait_seconds: int = Field(default=150, description="Maximum seconds to wait for OS to fully boot into desktop or login screen")
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8100)

dmt_config = DMTOperatorConfig()
dmt_config.ensure_directories()
