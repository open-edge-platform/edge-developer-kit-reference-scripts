# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
FastAPI control interface for the DMT Operator Agent.
Exposes device status/audit/remediation endpoints and incident report access
for external tooling.
"""
import json
import logging
import uuid
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from agentic_framework.mcp_client import MCPClient
from dmt_operator_agent.config import dmt_config
from dmt_operator_agent.engine import OperatorEngine, DeviceAuditResult

logger = logging.getLogger("dmt_operator_agent.api")


class AppState:
    mcp: Optional[MCPClient] = None
    engine: Optional[OperatorEngine] = None
    # Cache of the most recent audit per hostname, so status reads don't require a live audit.
    last_results: Dict[str, DeviceAuditResult] = {}
    monitor_task: Optional[asyncio.Task] = None
    monitor_cycles_completed: int = 0


state = AppState()


async def _background_monitor() -> None:
    """Continuously audits every registered device so cached status data stays live
    without requiring a separate CLI agent process."""
    while True:
        try:
            devices = await _get_devices()
            results = await asyncio.gather(
                *(state.engine.audit_device(dev) for dev in devices),
                return_exceptions=True
            )
            for dev, result in zip(devices, results):
                if isinstance(result, Exception):
                    logger.warning("Background audit failed for %s: %s", dev.get("hostname"), result)
                else:
                    state.last_results[dev["hostname"]] = result
            state.monitor_cycles_completed += 1
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("Background monitor cycle failed: %s", e)
        await asyncio.sleep(dmt_config.poll_interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    state.mcp = MCPClient(sse_url=dmt_config.mcp_sse_url, timeout=dmt_config.mcp_timeout)
    await state.mcp.connect()
    state.engine = OperatorEngine(state.mcp)
    logger.info("DMT Operator API connected to MCP server at %s", dmt_config.mcp_sse_url)
    state.monitor_task = asyncio.create_task(_background_monitor())
    try:
        yield
    finally:
        state.monitor_task.cancel()
        try:
            await state.monitor_task
        except asyncio.CancelledError:
            pass
        await state.mcp.close()


app = FastAPI(title="DMT Operator Agent API", lifespan=lifespan)


async def _get_devices(hostname: Optional[str] = None) -> List[Dict[str, Any]]:
    dev_res = await state.mcp.get_all_devices(hostname=hostname)
    if isinstance(dev_res, dict):
        return dev_res.get("devices", dev_res.get("result", {}).get("devices", []))
    return []


def _list_reports() -> List[Dict[str, Any]]:
    reports = []
    for f in sorted(dmt_config.reports_dir.glob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = f.stat()
        summary = None
        sidecar_path = f.with_suffix(".json")
        if sidecar_path.is_file():
            try:
                summary = json.loads(sidecar_path.read_text()).get("summary")
            except Exception as e:
                logger.warning("Failed to read summary sidecar for %s: %s", f.name, e)
        reports.append({
            "filename": f.name,
            "url": f"/reports/{f.name}",
            "size_bytes": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "summary": summary,
        })
    return reports


def _with_report_url(result: DeviceAuditResult) -> Dict[str, Any]:
    """Rewrite the local PDF filesystem path to the API URL where the report is served."""
    d = result.model_dump()
    if d.get("pdf_report_path"):
        d["pdf_report_path"] = f"/reports/{Path(d['pdf_report_path']).name}"
    return d


_REMEDIATION_ACTIONS = {"power_cycle", "reset", "boot_to_bios", "boot_to_pxe", "power_off", "power_on"}


async def _execute_remediation(hostname: str, action: str) -> Dict[str, Any]:
    """Validates and executes an out-of-band power action, marking the device contained on power_off."""
    if action not in _REMEDIATION_ACTIONS:
        raise ValueError(f"Invalid action '{action}'. Valid actions: {', '.join(sorted(_REMEDIATION_ACTIONS))}")
    devices = await _get_devices(hostname=hostname)
    if not devices:
        raise LookupError(f"Device '{hostname}' not found.")
    logger.warning("Remediation requested: action=%s hostname=%s", action, hostname)
    resp = await state.mcp.remediate_device(device=hostname, action=action)
    if action == "power_off" and state.engine is not None:
        # Keep the device out of the operational pool until it's manually cleared/powered back on.
        state.engine.mark_contained(hostname, f"manual-{uuid.uuid4().hex[:6].upper()}")
    return {"hostname": hostname, "action": action, "response": str(resp)}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/reports")
async def list_reports():
    return _list_reports()


@app.get("/reports/{filename}")
async def get_report(filename: str):
    safe_name = Path(filename).name
    report_path = dmt_config.reports_dir / safe_name
    if not report_path.is_file():
        raise HTTPException(status_code=404, detail=f"Report '{filename}' not found.")
    # "inline" so browsers render the PDF in-tab instead of downloading it.
    return FileResponse(report_path, media_type="application/pdf", filename=safe_name, content_disposition_type="inline")


@app.get("/devices")
async def list_devices():
    devices = await _get_devices()
    return {
        "monitor_cycles_completed": state.monitor_cycles_completed,
        "devices": [
            {
                **dev,
                "last_status": _with_report_url(state.last_results[dev["hostname"]])
                if dev.get("hostname") in state.last_results else None,
                "is_contained": state.engine.is_contained(dev["hostname"]) if state.engine else False
            }
            for dev in devices
        ]
    }


@app.get("/devices/{hostname}/status")
async def get_device_status(hostname: str):
    result = state.last_results.get(hostname)
    if not result:
        raise HTTPException(status_code=404, detail=f"No cached audit result for '{hostname}'. Trigger an audit first.")
    return _with_report_url(result)


@app.post("/devices/{hostname}/audit")
async def audit_device(hostname: str, force_remediation: bool = False):
    devices = await _get_devices(hostname=hostname)
    if not devices:
        raise HTTPException(status_code=404, detail=f"Device '{hostname}' not found.")
    result = await state.engine.audit_device(devices[0], force_remediation=force_remediation)
    state.last_results[hostname] = result
    return _with_report_url(result)


@app.post("/devices/{hostname}/clear-containment")
async def clear_containment(hostname: str):
    """Manually lift containment on a device that was powered off (e.g. ransomware), allowing normal audits to resume."""
    devices = await _get_devices(hostname=hostname)
    if not devices:
        raise HTTPException(status_code=404, detail=f"Device '{hostname}' not found.")
    incident_id = state.engine.clear_containment(hostname)
    if incident_id is None:
        raise HTTPException(status_code=409, detail=f"Device '{hostname}' is not currently contained.")
    logger.warning("Containment manually cleared for %s (was incident %s)", hostname, incident_id)
    return {"hostname": hostname, "cleared_incident_id": incident_id}


class RemediateRequest(BaseModel):
    action: str


@app.post("/devices/{hostname}/remediate")
async def remediate_device_endpoint(hostname: str, req: RemediateRequest):
    """Execute an out-of-band Intel AMT power action (power_cycle, reset, boot_to_bios, boot_to_pxe, power_off, power_on)."""
    try:
        return await _execute_remediation(hostname, req.action)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Remediation '{req.action}' on {hostname} failed: {e}")


def run():
    import uvicorn
    uvicorn.run("dmt_operator_agent.api:app", host=dmt_config.api_host, port=dmt_config.api_port)


if __name__ == "__main__":
    run()
