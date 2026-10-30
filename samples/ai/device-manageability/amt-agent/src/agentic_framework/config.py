# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
from pathlib import Path
from pydantic import BaseModel, Field

# Locate workspace root (two levels up from src/agentic_framework)
WORKSPACE_ROOT = Path(__file__).resolve().parent.parent.parent

class FrameworkBaseConfig(BaseModel):
    workspace_root: Path = Field(default=WORKSPACE_ROOT)
    captures_dir: Path = Field(default=WORKSPACE_ROOT / "captures")
    reports_dir: Path = Field(default=WORKSPACE_ROOT / "reports")

    # MCP Defaults
    mcp_sse_url: str = Field(default=os.getenv("MCP_SSE_URL", "http://localhost:8000/sse"))
    mcp_timeout: float = Field(default=30.0)

    # LLM Defaults
    llm_api_base: str = Field(default=os.getenv("LLM_API_BASE", "http://localhost:9931/v1"))
    llm_api_key: str = Field(default=os.getenv("LLM_API_KEY", "dummy-key"))
    llm_model: str = Field(default=os.getenv("LLM_MODEL", "unsloth/gemma-4-26B-A4B-it-GGUF"))
    llm_temperature: float = Field(default=0.1)
    llm_max_tokens: int = Field(default=int(os.getenv("LLM_MAX_TOKENS", "4096")), gt=0)

    def ensure_directories(self):
        self.captures_dir.mkdir(parents=True, exist_ok=True)
        self.reports_dir.mkdir(parents=True, exist_ok=True)

framework_config = FrameworkBaseConfig()
framework_config.ensure_directories()
