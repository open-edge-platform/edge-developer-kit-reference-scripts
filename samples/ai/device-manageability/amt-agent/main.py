# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import argparse
import asyncio
import inspect
import sys
from rich.console import Console
from rich.table import Table

from agentic_framework.base import setup_agent_logging
from agentic_framework.registry import agent_registry, discover_agents

console = Console()

def build_agent_kwargs(agent_cls: type, args: argparse.Namespace) -> dict:
    """Forward CLI args to the agent constructor, but only ones it actually accepts."""
    kwargs = {"continuous": args.continuous, "interval": args.interval}
    sig = inspect.signature(agent_cls.__init__)
    accepts_anything = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
    if args.device and (accepts_anything or "target_device" in sig.parameters):
        kwargs["target_device"] = args.device
    return kwargs

def main():
    parser = argparse.ArgumentParser(description="Multi-Agent SRE & Hardware Management Framework")
    parser.add_argument("--agent", "-a", type=str, default="dmt_operator", help="Agent identifier to run (default: dmt_operator)")
    parser.add_argument("--list-agents", "-l", action="store_true", help="List all available registered agents")
    parser.add_argument("--continuous", "-c", action="store_true", help="Run agent in continuous monitoring loop")
    parser.add_argument("--interval", "-i", type=int, default=15, help="Polling interval in seconds")
    parser.add_argument("--device", "-d", type=str, default=None, help="Target specific device hostname or GUID")
    parser.add_argument("--verbose", "-v", action="store_true", default=False, help="Enable verbose debug logging")
    args = parser.parse_args()

    discover_agents()

    if args.list_agents:
        agents = agent_registry.list_agents()
        table = Table(title="Registered Agents in Framework", border_style="cyan")
        table.add_column("Agent Key", style="bold cyan")
        table.add_column("Description", style="white")
        for key, desc in agents.items():
            table.add_row(key, desc)
        console.print(table)
        return

    setup_agent_logging(args.verbose, agent_name=args.agent)

    try:
        agent_cls = agent_registry.get(args.agent)
    except KeyError as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        sys.exit(1)

    agent_kwargs = build_agent_kwargs(agent_cls, args)
    agent = agent_cls(**agent_kwargs)

    try:
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
