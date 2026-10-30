# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#!/usr/bin/env python3
"""
Model Context Protocol (MCP) Server for Intel AMT & DMT Device Management.
Built using the official Model Context Protocol Python SDK (mcp.server.MCPServer).
Reference: https://modelcontextprotocol.io/docs/develop/build-server

Capabilities:
  1. Capture out-of-band screen frames over Intel AMT KVM RFB (returns official ImageContent).
  2. Diagnose BSOD (Blue Screen of Death) stop codes, kernel panics, and failing modules.
  3. Inspect hardware SEL event logs for root cause analysis (thermal, memory, watchdog).
  4. Execute out-of-band remediation (power cycle, boot to BIOS, boot to PXE, reset).
  5. Verify post-remediation device recovery with live display verification.
  6. Log structured compliance incident reports.
"""

import sys
import os
import json
import time
import base64
import argparse
from typing import Dict, Any, List, Optional, Union
from datetime import datetime

import io
from starlette.requests import Request
from starlette.responses import Response

from starlette.middleware.cors import CORSMiddleware

# Official Model Context Protocol Python SDK
from mcp.server import MCPServer
from mcp.types import ImageContent, TextContent

# DMT & Intel AMT Client Core
from dmt_client import (
    DMTClient,
    IntelAMTClient,
    DEFAULT_DMT_URL,
    POWER_ACTIONS,
    POWER_STATE_NAMES,
    HAS_PIL,
    amt_vault,
)

if HAS_PIL:
    from PIL import Image

# Initialize DMT REST API Client & MCP Server instance
_dmt_client = DMTClient(base_url=DEFAULT_DMT_URL)
mcp = MCPServer(
    name="dmt-mcp-server",
    version="2.0.0",
    description="Intel AMT & DMT Device Management and Out-of-Band BSOD Remediation Server"
)

class CrossOriginHeadersMiddleware:
    """Pure ASGI middleware to inject CORP headers without breaking SSE streaming."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        has_started = False

        async def send_wrapper(message):
            nonlocal has_started
            if message["type"] == "http.response.start":
                if not has_started:
                    has_started = True
                    raw_headers = message.get("headers", [])
                    header_names = {k.lower() for k, v in raw_headers}
                    new_headers = list(raw_headers)
                    if b"cross-origin-resource-policy" not in header_names:
                        new_headers.append((b"cross-origin-resource-policy", b"cross-origin"))
                    if b"access-control-allow-origin" not in header_names:
                        new_headers.append((b"access-control-allow-origin", b"*"))
                    message["headers"] = new_headers
                else:
                    return
            await send(message)

        await self.app(scope, receive, send_wrapper)

@mcp.custom_route("/favicon.ico", methods=["GET"])
async def favicon(request: Request) -> Response:
    """Handle browser favicon probe gracefully."""
    return Response(status_code=204)

# =====================================================================
# MCP Server Tools (Decorated with @mcp.tool)
# =====================================================================

@mcp.tool(
    name="dmt_get_all_devices",
    description="Retrieve all registered Intel AMT devices from the DMT Console with optional filtering (tags, hostname, friendly name)."
)
def dmt_get_all_devices(
    top: Optional[int] = None,
    tags: Optional[str] = None,
    hostname: Optional[str] = None,
    friendly_name: Optional[str] = None
) -> Dict[str, Any]:
    """Retrieve all registered Intel AMT endpoints from the DMT Console."""
    devices = _dmt_client.get_all_devices(
        top=top,
        tags=tags,
        hostname=hostname,
        friendly_name=friendly_name
    )
    return {
        "device_count": len(devices),
        "devices": devices
    }


@mcp.tool(
    name="dmt_get_system_info",
    description="Get comprehensive system hardware, firmware version, BIOS information, OS metadata, and live power state for an Intel AMT endpoint."
)
def dmt_get_system_info(device: Optional[str] = None) -> Dict[str, Any]:
    """Get system overview, power state, and firmware details for a given device."""
    dev = _dmt_client.find_device(device)
    guid = dev.get("guid")
    power = _dmt_client.get_power_state(guid)
    overview = _dmt_client.get_system_overview(guid)
    return {
        "device": dev,
        "power_state": power,
        "system_overview": overview
    }

@mcp.tool(
    name="dmt_capture_screen",
    description="Directly capture the out-of-band screen frame from the target Intel AMT device via hardware KVM RFB redirection. Automatically uses credentials from the SQLite database if omitted."
)
def dmt_capture_screen(
    hostname: str,
    username: Optional[str] = None,
    password: Optional[str] = None,
    timeout: float = 10.0
) -> List[Union[ImageContent, TextContent]]:
    """Capture live out-of-band screen frame from Intel AMT device over RFB."""
    if not hostname:
        raise ValueError("Target device identifier/hostname is required.")

    dev_name = hostname
    target_host = hostname
    guid = hostname
    use_tls = True
    port = 16995

    try:
        dev = _dmt_client.find_device(hostname)
        guid = dev.get("guid", hostname)
        target_host = dev.get("hostname") or hostname
        dev_name = dev.get("friendlyName") or guid or target_host
        use_tls = dev.get("useTLS", True)
        port = 16995 if use_tls else 16994
    except Exception:
        pass

    # Resolve credentials: from parameters or from SQLite vault
    user = username
    pwd = password

    if not user or not pwd:
        vault_cred = amt_vault.find_credential(hostname, guid=guid, hostname=target_host, friendly_name=dev_name)
        if vault_cred:
            user = user or vault_cred.get("username")
            pwd = pwd or vault_cred.get("password")
            port = vault_cred.get("port", port)
            use_tls = vault_cred.get("use_tls", use_tls)

    user = user or "admin"

    if not pwd:
        raise ValueError(
            f"Intel AMT password for '{dev_name}' not found.\n"
            f"Please provide 'password' parameter or save it in the SQLite database via dmt_save_amt_credentials."
        )

    amt = IntelAMTClient(
        host=target_host,
        port=port,
        username=user,
        password=pwd,
        use_tls=use_tls,
        timeout=timeout,
    )
    img = amt.capture_screen()

    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    img_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")

    info_summary = (
        f"**Intel AMT Out-of-Band Screen Capture**\n\n"
        f"- **Device / Host**: `{dev_name}` (`{target_host}:{port}`)\n"
        f"- **Resolution**: `{img.width}x{img.height}`\n"
        f"- **Timestamp**: `{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}`"
    )

    return [
        ImageContent(type="image", data=img_b64, mimeType="image/png"),
        TextContent(type="text", text=info_summary),
    ]


@mcp.tool(
    name="dmt_get_event_log",
    description="Retrieve the Intel AMT System Event Log (SEL) to detect hardware crashes, watchdog timeouts, thermal trips, or power anomalies."
)
def dmt_get_event_log(device: str, top: int = 30) -> Dict[str, Any]:
    """Retrieve Intel AMT hardware System Event Log (SEL)."""
    dev = _dmt_client.find_device(device)
    guid = dev.get("guid")
    logs = _dmt_client.get_event_log(guid, top=top)
    return {
        "device": dev.get("friendlyName") or guid,
        "record_count": len(logs) if isinstance(logs, list) else 0,
        "events": logs
    }


@mcp.tool(
    name="dmt_remediate_device",
    description="Perform an out-of-band recovery or power management action on an Intel AMT endpoint (e.g. power_cycle, reset, boot_to_bios, boot_to_pxe, power_on, power_off)."
)
def dmt_remediate_device(device: str, action: str) -> Dict[str, Any]:
    """Execute out-of-band power recovery action."""
    dev = _dmt_client.find_device(device)
    guid = dev.get("guid")
    action_name = action.lower()

    action_map = {
        "power_cycle": 5,
        "reset": 10,
        "boot_to_bios": 100,
        "boot_to_pxe": 401,
        "power_on": 2,
        "power_off": 8,
        "sleep": 4,
        "hibernate": 7
    }
    action_code = action_map.get(action_name, 5)
    res = _dmt_client.send_power_action(guid, action_code)
    return {
        "device": dev.get("friendlyName") or guid,
        "action": action_name,
        "action_code": action_code,
        "response": res,
        "timestamp": datetime.now().isoformat(),
        "status": "REMEDIATION_TRIGGERED"
    }


@mcp.tool(
    name="dmt_log_incident",
    description="Write a formal Incident to disk for enterprise compliance, tracking, and telemetry."
)
def dmt_log_incident(
    device: str,
    incident_type: str,
    recovery_status: str,
    actions_taken: List[str],
    stop_code: Optional[str] = None,
    failing_module: Optional[str] = None,
    notes: str = "",
    report_filename: str = "remediation_incident.json"
) -> Dict[str, Any]:
    """Record a structured incident log report."""
    report = {
        "report_id": f"INC-{int(time.time())}",
        "timestamp": datetime.now().isoformat(),
        "device": device,
        "incident_type": incident_type,
        "stop_code": stop_code,
        "failing_module": failing_module,
        "actions_taken": actions_taken,
        "recovery_status": recovery_status,
        "notes": notes,
    }

    with open(report_filename, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    return {
        "success": True,
        "saved_to": os.path.abspath(report_filename),
        "report": report
    }


# =====================================================================
# Main CLI Entry Point
# =====================================================================

def main():
    parser = argparse.ArgumentParser(description="Intel AMT & DMT Device Management MCP Server (Official MCP SDK)")
    parser.add_argument("--transport", choices=["sse", "stdio", "streamable-http"], default="sse", help="MCP transport protocol (default: sse)")
    parser.add_argument("--host", default=os.environ.get("MCP_HOST", "0.0.0.0"), help="Host for HTTP/SSE server (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("MCP_PORT", 8000)), help="Port for HTTP/SSE server (default: 8000)")
    parser.add_argument("--dmt-url", "--dmt_url", dest="dmt_url", default=os.environ.get("DMT_URL", DEFAULT_DMT_URL), help="DMT Console REST API URL")
    args = parser.parse_args()

    if args.dmt_url:
        os.environ["DMT_URL"] = args.dmt_url
        _dmt_client.base_url = args.dmt_url.rstrip("/")

    print("=" * 68)
    print(" 🚀 INTEL AMT & DMT MCP SERVER (OFFICIAL MCP PYTHON SDK)")
    print("=" * 68)
    print(f" Protocol Version : MCP SDK v2 (2026-07-28)")
    print(f" Transport        : {args.transport.upper()}")
    if args.transport in ["sse", "streamable-http"]:
        print(f" Host & Port      : {args.host}:{args.port}")
        print(f" SSE Endpoint     : http://{args.host}:{args.port}/sse")
        print(f" Messages Endpoint: http://{args.host}:{args.port}/messages/")
    print("=" * 68)

    if args.transport == "stdio":
        mcp.run(transport="stdio")
    elif args.transport == "sse":
        import uvicorn
        import anyio
        starlette_app = mcp.sse_app(host=args.host)
        starlette_app.add_middleware(CrossOriginHeadersMiddleware)
        starlette_app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["*"],
        )
        config = uvicorn.Config(
            starlette_app,
            host=args.host,
            port=args.port,
            log_level="info",
        )
        server = uvicorn.Server(config)
        anyio.run(server.serve)
    elif args.transport == "streamable-http":
        import uvicorn
        import anyio
        starlette_app = mcp.streamable_http_app(host=args.host)
        starlette_app.add_middleware(CrossOriginHeadersMiddleware)
        starlette_app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["*"],
        )
        config = uvicorn.Config(
            starlette_app,
            host=args.host,
            port=args.port,
            log_level="info",
        )
        server = uvicorn.Server(config)
        anyio.run(server.serve)


if __name__ == "__main__":
    main()
