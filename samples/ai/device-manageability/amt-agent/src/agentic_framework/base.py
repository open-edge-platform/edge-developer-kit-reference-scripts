# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from abc import ABC, abstractmethod
import asyncio
import logging
import signal
from typing import Any, Optional
from rich.console import Console
from rich.logging import RichHandler

console = Console()

def setup_agent_logging(verbose: bool = False, agent_name: str = "agent"):
    log_level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(
        level=log_level,
        format="%(message)s",
        datefmt="[%X]",
        handlers=[RichHandler(console=console, rich_tracebacks=True, show_path=False)]
    )
    if not verbose:
        for lib in ["httpx", "httpcore", "openai", "mcp_client", "urllib3", "agentic_framework"]:
            logging.getLogger(lib).setLevel(logging.WARNING)
            logging.getLogger(lib).propagate = False

class BaseAgent(ABC):
    """
    Abstract base class for all agents in the framework.
    Defines common lifecycle methods: setup, audit/step cycle, continuous run, and shutdown.
    """
    def __init__(self, name: str, description: str, continuous: bool = False, interval: int = 15):
        self.name = name
        self.description = description
        self.continuous = continuous
        self.interval = interval
        self.running = True

    @abstractmethod
    async def setup(self) -> None:
        """Initialize connections, tools, and clients before the monitoring loop."""
        pass

    @abstractmethod
    async def step(self, cycle_num: int) -> Any:
        """Execute a single evaluation / audit cycle."""
        pass

    @abstractmethod
    async def shutdown(self) -> None:
        """Gracefully release connections and resources."""
        pass

    def stop(self) -> None:
        console.print(f"\n[yellow]Stopping agent {self.name}...[/yellow]")
        self.running = False

    async def run(self) -> None:
        # Handle termination signals
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, self.stop)
            except NotImplementedError:
                pass

        try:
            await self.setup()
            cycle_count = 0
            while self.running:
                cycle_count += 1
                await self.step(cycle_count)

                if not self.continuous:
                    break

                try:
                    await asyncio.sleep(self.interval)
                except asyncio.CancelledError:
                    break

        finally:
            await self.shutdown()
