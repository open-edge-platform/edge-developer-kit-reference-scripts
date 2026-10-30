# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Agentic Framework Core
Shared components for multi-agent systems including MCP, VLM, PDF reporting, and base agent lifecycles.
"""

from agentic_framework.base import BaseAgent
from agentic_framework.mcp_client import MCPClient, MCPClientError
from agentic_framework.registry import agent_registry, register_agent

__all__ = [
    "BaseAgent",
    "MCPClient",
    "MCPClientError",
    "agent_registry",
    "register_agent",
]
