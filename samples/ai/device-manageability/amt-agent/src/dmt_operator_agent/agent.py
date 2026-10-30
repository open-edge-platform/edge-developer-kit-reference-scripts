# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import quote
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from agentic_framework.base import BaseAgent, setup_agent_logging
from agentic_framework.mcp_client import MCPClient
from agentic_framework.registry import register_agent
from dmt_operator_agent.config import dmt_config
from dmt_operator_agent.engine import OperatorEngine, DeviceAuditResult

console = Console()

async def _stdin_lines() -> asyncio.StreamReader:
    """Wraps stdin in an asyncio StreamReader so the TUI can accept commands without blocking the monitor loop."""
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)
    return reader

def _link(path: str) -> str:
    """Renders a filesystem path as a clickable OSC-8 hyperlink (opens in the OS default app) in supporting terminals."""
    abs_path = Path(path).resolve()
    uri = f"file://{quote(str(abs_path))}"
    return f"[link={uri}][underline cyan]{abs_path.name}[/underline cyan][/link]"

@register_agent("dmt_operator")
class DMTOperatorAgent(BaseAgent):
    """
    Intel AMT & DMT Out-of-Band Autonomous Operator Agent.
    Monitors endpoints, diagnoses BSODs/anomalies with VLM, analyzes SEL logs,
    executes out-of-band power recovery, and publishes PDF incident reports.
    """
    def __init__(
        self,
        continuous: bool = False,
        interval: int = dmt_config.poll_interval_seconds,
        target_device: Optional[str] = None
    ):
        super().__init__(
            name="dmt_operator",
            description="Intel AMT / DMT System Reliability Operator Agent",
            continuous=continuous,
            interval=interval
        )
        self.target_device = target_device
        self.mcp = MCPClient(sse_url=dmt_config.mcp_sse_url, timeout=dmt_config.mcp_timeout)
        self.engine = OperatorEngine(self.mcp)
        self._command_task: Optional[asyncio.Task] = None

    async def setup(self) -> None:
        console.print(Panel.fit(
            "[bold cyan]INTEL AMT / DMT AUTONOMOUS OPERATOR AGENT[/bold cyan]\n"
            "[dim]Active System Monitoring, Multimodal Screen Vision, SEL Diagnostics & PDF Incident Reporting[/dim]\n"
            "[dim]Type 'clear <hostname>' + Enter to lift containment on a device, or 'help' for commands.[/dim]",
            border_style="cyan"
        ))
        console.print("[yellow]Connecting to DMT MCP Server at[/yellow]", dmt_config.mcp_sse_url)
        await self.mcp.connect()
        console.print("[green]Connected successfully to MCP Server.[/green]\n")
        self._command_task = asyncio.create_task(self._listen_for_commands())

    async def step(self, cycle_num: int) -> None:
        console.print(f"[bold blue]>>> Starting Audit Cycle #{cycle_num} ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})[/bold blue]")

        dev_res = await self.mcp.get_all_devices(hostname=self.target_device)
        devices = []
        if isinstance(dev_res, dict):
            devices = dev_res.get("devices", dev_res.get("result", {}).get("devices", []))

        if not devices:
            console.print("[yellow]No registered Intel AMT devices found matching criteria.[/yellow]")
            return

        console.print(f"Discovered [bold green]{len(devices)}[/bold green] registered Intel AMT device(s).")

        results: list[DeviceAuditResult] = await asyncio.gather(
            *(self.engine.audit_device(dev) for dev in devices)
        )

        # Render Summary Table
        table = Table(title="DMT Operational Status Report", border_style="blue")
        table.add_column("Hostname", style="cyan", no_wrap=True)
        table.add_column("Friendly Name", style="white")
        table.add_column("Screen State", style="magenta")
        table.add_column("Health Status", justify="center")
        table.add_column("Remediation", style="yellow")
        table.add_column("PDF Incident Report", style="dim")

        for r in results:
            if r.is_healthy:
                health_str = "[bold green]OPERATIONAL[/bold green]"
            elif r.screen_state == "OFFLINE":
                health_str = "[bold red]OFFLINE[/bold red]"
            elif r.remediation_applied and "CONTAINED" in r.remediation_applied:
                health_str = "[bold red]CONTAINED (POWERED OFF)[/bold red]"
            elif r.remediation_applied and ("BOOTING" in r.remediation_applied or "INITIATED" in r.remediation_applied):
                health_str = "[bold yellow]REBOOTING (Boot Stage)[/bold yellow]"
            elif r.remediation_applied and "RESOLVED" in r.remediation_applied:
                health_str = "[bold green]RESOLVED (Fully Booted)[/bold green]"
            elif r.incident_occurred:
                health_str = "[bold red]ANOMALY DETECTED[/bold red]"
            else:
                health_str = "[bold red]FAULT[/bold red]"

            rem_str = r.remediation_applied.upper() if r.remediation_applied else "[dim]None[/dim]"
            pdf_str = _link(r.pdf_report_path) if r.pdf_report_path else "[dim]N/A[/dim]"
            table.add_row(r.hostname, r.friendly_name, r.screen_state, health_str, rem_str, pdf_str)

        console.print(table)
        console.print()

        if self.continuous and self.running:
            console.print(f"[dim]Next monitoring cycle in {self.interval}s... (Press Ctrl+C to stop)[/dim]\n")

    async def shutdown(self) -> None:
        if self._command_task is not None:
            self._command_task.cancel()
        await self.mcp.close()
        console.print("[green]Operator agent shutdown complete.[/green]")

    async def _listen_for_commands(self) -> None:
        """Background task: reads operator commands typed into the TUI without blocking the monitor loop."""
        try:
            reader = await _stdin_lines()
        except (RuntimeError, OSError):
            # stdin isn't a readable pipe/tty (e.g. running under a non-interactive supervisor) - skip.
            return
        while self.running:
            line = await reader.readline()
            if not line:
                break
            await self._handle_command(line.decode().strip())

    async def _handle_command(self, command: str) -> None:
        if not command:
            return
        parts = command.split(maxsplit=1)
        verb = parts[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ""

        if verb == "help":
            console.print("[cyan]Commands:[/cyan] clear <hostname>  |  contained  |  help")
        elif verb == "contained":
            hosts = list(self.engine.list_contained().keys())
            if not hosts:
                console.print("[green]No devices are currently contained.[/green]")
            else:
                console.print(f"[yellow]Contained devices:[/yellow] {', '.join(hosts)}")
        elif verb == "clear":
            if not arg:
                console.print("[red]Usage: clear <hostname>[/red]")
                return
            incident_id = self.engine.clear_containment(arg)
            if incident_id is None:
                console.print(f"[yellow]'{arg}' is not currently contained.[/yellow]")
            else:
                console.print(f"[bold green]Containment cleared for '{arg}'[/bold green] (was incident {incident_id}). It will resume normal audits next cycle.")
        else:
            console.print(f"[red]Unknown command '{verb}'.[/red] Type 'help' for a list of commands.")

def main():
    parser = argparse.ArgumentParser(description="Autonomous Intel AMT/DMT System Operator Agent")
    parser.add_argument("--continuous", "-c", action="store_true", help="Run in continuous monitoring loop")
    parser.add_argument("--interval", "-i", type=int, default=dmt_config.poll_interval_seconds, help="Polling interval in seconds")
    parser.add_argument("--device", "-d", type=str, default=None, help="Target specific device hostname or GUID")
    parser.add_argument("--verbose", "-v", action="store_true", default=False, help="Enable verbose debug logging")
    args = parser.parse_args()

    setup_agent_logging(args.verbose, agent_name="dmt_operator")
    agent = DMTOperatorAgent(
        continuous=args.continuous,
        interval=args.interval,
        target_device=args.device
    )

    try:
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
