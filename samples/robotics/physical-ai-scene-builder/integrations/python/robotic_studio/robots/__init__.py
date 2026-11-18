# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Robot-specific control adapters and task controllers for Physical AI Scene Builder examples.

``bindings`` and ``cli`` are robot-agnostic. Each robot lives in its own subpackage, for example
``robotic_studio.robots.so101``. ``control.ControlTarget`` is the typed surface controllers drive.
"""

from .control import ControlTarget, LocalReplica
from .so101.adapter import SO101, SO101Adapter

__all__ = ["ControlTarget", "LocalReplica", "SO101", "SO101Adapter"]
