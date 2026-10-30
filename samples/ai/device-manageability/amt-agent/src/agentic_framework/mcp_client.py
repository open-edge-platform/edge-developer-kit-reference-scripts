# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import base64
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx

logger = logging.getLogger("agentic_framework.mcp_client")

class MCPClientError(Exception):
    pass

class MCPClient:
    """
    Robust asynchronous SSE client for Model Context Protocol (MCP) servers.
    """
    def __init__(self, sse_url: str = "http://localhost:8000/sse", timeout: float = 30.0):
        self.sse_url = sse_url
        self.timeout = timeout
        self.client: Optional[httpx.AsyncClient] = None
        self.post_url: Optional[str] = None
        self._request_id = 0
        self._pending_requests: Dict[int, asyncio.Future] = {}
        self._sse_task: Optional[asyncio.Task] = None
        self._connected = asyncio.Event()
        self._closed = False

    async def connect(self):
        """Connect to the SSE stream, obtain the message post endpoint, and initialize."""
        if self._connected.is_set():
            return

        self.client = httpx.AsyncClient(timeout=self.timeout)
        self._sse_task = asyncio.create_task(self._sse_listener())

        try:
            await asyncio.wait_for(self._connected.wait(), timeout=self.timeout)
        except asyncio.TimeoutError:
            raise MCPClientError(f"Timed out waiting for SSE endpoint connection to {self.sse_url}")

        # Initialize protocol
        init_res = await self._send_request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "agentic-framework", "version": "1.0.0"}
            }
        )
        logger.debug("MCP Initialized: %s", init_res)

        # Send notifications/initialized
        await self._send_notification("notifications/initialized")
        logger.info("Successfully connected and initialized MCP server at %s", self.sse_url)

    async def _sse_listener(self):
        """Background listener task for SSE stream."""
        try:
            async with self.client.stream("GET", self.sse_url, timeout=None) as response:
                if response.status_code != 200:
                    logger.error("SSE stream error status: %d", response.status_code)
                    return

                async for line in response.aiter_lines():
                    if self._closed:
                        break
                    line = line.strip()
                    if not line:
                        continue

                    if line.startswith("event:"):
                        continue

                    if line.startswith("data:"):
                        data_content = line[5:].strip()
                        if not self.post_url:
                            if data_content.startswith("/") or data_content.startswith("http"):
                                if data_content.startswith("/"):
                                    base_origin = str(response.url).split("/sse")[0]
                                    self.post_url = f"{base_origin}{data_content}"
                                else:
                                    self.post_url = data_content
                                self._connected.set()
                                logger.debug("Discovered MCP POST endpoint: %s", self.post_url)
                                continue

                        try:
                            msg = json.loads(data_content)
                            self._handle_incoming_message(msg)
                        except json.JSONDecodeError:
                            logger.warning("Failed to decode SSE message: %s", data_content)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Error in SSE listener: %s", e)
            if not self._connected.is_set():
                self._connected.set()

    def _handle_incoming_message(self, msg: Dict[str, Any]):
        msg_id = msg.get("id")
        if msg_id is not None and msg_id in self._pending_requests:
            future = self._pending_requests.pop(msg_id)
            if not future.done():
                if "error" in msg:
                    future.set_exception(MCPClientError(msg["error"].get("message", "MCP error")))
                else:
                    future.set_result(msg.get("result"))

    async def _send_request(self, method: str, params: Optional[Dict[str, Any]] = None, request_timeout: Optional[float] = None) -> Any:
        if not self.post_url:
            raise MCPClientError("MCP post URL not available. Ensure client is connected.")

        self._request_id += 1
        req_id = self._request_id
        future = asyncio.get_running_loop().create_future()
        self._pending_requests[req_id] = future

        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params or {}
        }

        # Allow callers to wait longer than the client default (e.g. a tool-side
        # timeout arg was passed in params) so we don't race the server's own timeout.
        wait_timeout = max(self.timeout, request_timeout) if request_timeout is not None else self.timeout

        resp = await self.client.post(self.post_url, json=payload, timeout=wait_timeout)
        if resp.status_code not in (200, 202):
            self._pending_requests.pop(req_id, None)
            raise MCPClientError(f"HTTP error {resp.status_code} sending request: {resp.text}")

        try:
            return await asyncio.wait_for(future, timeout=wait_timeout)
        except asyncio.TimeoutError:
            self._pending_requests.pop(req_id, None)
            raise MCPClientError(f"Timed out waiting for response to method {method} (id={req_id})")

    async def _send_notification(self, method: str, params: Optional[Dict[str, Any]] = None):
        if not self.post_url:
            raise MCPClientError("MCP post URL not available.")

        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {}
        }
        await self.client.post(self.post_url, json=payload, timeout=self.timeout)

    async def call_tool(self, tool_name: str, arguments: Optional[Dict[str, Any]] = None, request_timeout: Optional[float] = None) -> Any:
        """Call a specific tool on the MCP server and return parsed structured or text output."""
        result = await self._send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments or {}
        }, request_timeout=request_timeout)

        if isinstance(result, dict):
            if "structuredContent" in result and result["structuredContent"]:
                return result["structuredContent"]
            if "content" in result and isinstance(result["content"], list):
                texts = []
                for item in result["content"]:
                    if isinstance(item, dict) and "text" in item:
                        text_val = item["text"]
                        try:
                            parsed = json.loads(text_val)
                            return parsed
                        except Exception:
                            texts.append(text_val)
                if texts:
                    return "\n".join(texts)
        return result

    async def list_tools(self) -> List[Dict[str, Any]]:
        """Return the raw tool definitions (name, description, inputSchema) advertised by the MCP server."""
        result = await self._send_request("tools/list", {})
        if isinstance(result, dict):
            return result.get("tools", [])
        return result or []

    # --- DMT & Endpoint Helpers ---

    async def get_all_devices(self, tags: Optional[str] = None, hostname: Optional[str] = None, friendly_name: Optional[str] = None, top: Optional[int] = None) -> Dict[str, Any]:
        args = {}
        if tags: args["tags"] = tags
        if hostname: args["hostname"] = hostname
        if friendly_name: args["friendly_name"] = friendly_name
        if top is not None: args["top"] = top
        return await self.call_tool("dmt_get_all_devices", args)

    async def get_system_info(self, device: Optional[str] = None) -> Dict[str, Any]:
        args = {}
        if device: args["device"] = device
        return await self.call_tool("dmt_get_system_info", args)

    async def capture_screen(self, hostname: str, output_filename: Optional[str] = None, username: Optional[str] = None, password: Optional[str] = None, timeout: float = 15.0) -> Any:
        args = {"hostname": hostname, "timeout": timeout}
        if username: args["username"] = username
        if password: args["password"] = password

        # The server waits up to `timeout` seconds for the capture itself, plus
        # connection/AMT-session overhead - give the client extra headroom so it
        # doesn't give up before the server responds.
        result = await self._send_request(
            "tools/call",
            {"name": "dmt_capture_screen", "arguments": args},
            request_timeout=timeout + 20.0,
        )

        content = result.get("content", []) if isinstance(result, dict) else []
        texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]

        if isinstance(result, dict) and result.get("isError"):
            raise MCPClientError(f"dmt_capture_screen failed: {' '.join(texts) or result}")

        if output_filename:
            image_b64 = next(
                (c.get("data") for c in content if isinstance(c, dict) and c.get("type") == "image" and c.get("data")),
                None,
            )
            if not image_b64:
                raise MCPClientError(f"dmt_capture_screen returned no image data: {' '.join(texts) or result}")
            dest_path = Path(output_filename)
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            dest_path.write_bytes(base64.b64decode(image_b64))

        return "\n".join(texts)

    async def get_event_log(self, device: str, top: int = 30) -> Dict[str, Any]:
        return await self.call_tool("dmt_get_event_log", {"device": device, "top": top})

    async def remediate_device(self, device: str, action: str) -> Dict[str, Any]:
        return await self.call_tool("dmt_remediate_device", {"device": device, "action": action})

    async def log_incident(
        self,
        device: str,
        incident_type: str,
        recovery_status: str,
        actions_taken: List[str],
        stop_code: Optional[str] = None,
        failing_module: Optional[str] = None,
        notes: str = "",
        report_filename: str = "remediation_incident.json"
    ) -> Dict[str, Any]:
        return await self.call_tool("dmt_log_incident", {
            "device": device,
            "incident_type": incident_type,
            "recovery_status": recovery_status,
            "actions_taken": actions_taken,
            "stop_code": stop_code,
            "failing_module": failing_module,
            "notes": notes,
            "report_filename": report_filename
        })

    async def close(self):
        self._closed = True
        if self._sse_task and not self._sse_task.done():
            self._sse_task.cancel()
        if self.client:
            await self.client.aclose()
