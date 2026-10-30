# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
from datetime import datetime, timezone
import json
import logging
import re
from pathlib import Path
import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from agentic_framework.mcp_client import MCPClient
from dmt_operator_agent.vlm import VLMAnalyzer, ScreenAnalysisResult
from dmt_operator_agent.reporting import IncidentPDFGenerator, IncidentReportData
from dmt_operator_agent.config import dmt_config
from dmt_operator_agent.sel_analyzer import SELAnalyzer, SELAnalysisResult

logger = logging.getLogger("dmt_operator_agent.engine")

class DeviceAuditResult(BaseModel):
    hostname: str
    guid: str
    friendly_name: str
    is_healthy: bool
    screen_state: str
    vlm_summary: str
    sel_summary: str
    incident_occurred: bool = False
    remediation_applied: Optional[str] = None
    pdf_report_path: Optional[str] = None
    timestamp: str

class ActiveRecoveryContext:
    def __init__(
        self,
        incident_id: str,
        hostname: str,
        guid: str,
        friendly_name: str,
        start_time: datetime,
        action_taken: str,
        crash_screen_path: Path,
        vlm_crash_res: ScreenAnalysisResult,
        sel_res: SELAnalysisResult,
        actions_taken: List[str]
    ):
        self.incident_id = incident_id
        self.hostname = hostname
        self.guid = guid
        self.friendly_name = friendly_name
        self.start_time = start_time
        self.action_taken = action_taken
        self.crash_screen_path = crash_screen_path
        self.vlm_crash_res = vlm_crash_res
        self.sel_res = sel_res
        self.actions_taken = actions_taken
        self.checks_count = 0

class OperatorEngine:
    """
    Operator Decision Engine for Intel AMT / DMT system monitoring, anomaly diagnosis,
    out-of-band remediation, and incident compliance reporting.
    
    Tracks recovery asynchronously across monitoring cycles without relying on fixed wait times.
    """
    def __init__(self, mcp: MCPClient):
        self.mcp = mcp
        self.vlm = VLMAnalyzer()
        self.sel = SELAnalyzer()
        self.pdf = IncidentPDFGenerator(dmt_config.reports_dir)
        self._active_recoveries: Dict[str, ActiveRecoveryContext] = {}
        # Devices intentionally powered off (e.g. ransomware containment) - never operational until cleared manually.
        self._contained_devices: Dict[str, str] = {}

    def is_contained(self, hostname: str) -> bool:
        return hostname in self._contained_devices

    def mark_contained(self, hostname: str, incident_id: str) -> None:
        self._contained_devices[hostname] = incident_id

    def clear_containment(self, hostname: str) -> Optional[str]:
        """Manually lift containment on a device (e.g. after forensic review). Returns the cleared incident id, if any."""
        return self._contained_devices.pop(hostname, None)

    def list_contained(self) -> Dict[str, str]:
        return dict(self._contained_devices)

    async def _capture_with_retry(self, hostname: str, path: Path) -> bool:
        """Capture the screen, retrying transient failures. Returns True if a frame was saved."""
        attempts = max(1, dmt_config.capture_max_attempts)
        for attempt in range(1, attempts + 1):
            try:
                await self.mcp.capture_screen(hostname=hostname, output_filename=str(path), timeout=15.0)
            except Exception as e:
                logger.warning(f"Screen capture attempt {attempt}/{attempts} failed for {hostname}: {e}")
            if path.exists():
                return True
            if attempt < attempts:
                await asyncio.sleep(dmt_config.capture_retry_delay_seconds * attempt)
        return False

    async def _probe_power_state(self, device_identifier: str) -> Optional[bool]:
        """Best-effort AMT power state check. Returns True if on, False if off, None if undeterminable."""
        try:
            info = await self.mcp.get_system_info(device=device_identifier)
        except Exception as e:
            logger.warning(f"Failed to query system info for power state check: {e}")
            return None
        text = info if isinstance(info, str) else json.dumps(info)
        if re.search(r"\boff\b", text, re.IGNORECASE):
            return False
        if re.search(r"\bon\b", text, re.IGNORECASE):
            return True
        return None

    async def audit_device(self, device_record: Dict[str, Any], force_remediation: bool = False) -> DeviceAuditResult:
        hostname = device_record.get("hostname", "unknown")
        guid = device_record.get("guid", str(uuid.uuid4()))
        friendly_name = device_record.get("friendlyName", hostname)
        device_identifier = hostname

        now = datetime.now(timezone.utc)
        timestamp_str = now.isoformat()

        # =========================================================================
        # CASE 0: Device was deliberately powered off for containment - stays non-operational
        # =========================================================================
        if hostname in self._contained_devices:
            logger.warning(f"{friendly_name} ({hostname}) is contained (powered off) since incident {self._contained_devices[hostname]}. Skipping audit.")
            return DeviceAuditResult(
                hostname=hostname,
                guid=guid,
                friendly_name=friendly_name,
                is_healthy=False,
                screen_state="CONTAINED (POWERED OFF)",
                vlm_summary="Device was deliberately powered off for containment and has not been manually cleared.",
                sel_summary="Skipped - device intentionally powered off.",
                incident_occurred=True,
                remediation_applied=f"CONTAINED (POWER_OFF) - incident {self._contained_devices[hostname]}",
                pdf_report_path=None,
                timestamp=timestamp_str
            )

        # =========================================================================
        # CASE 1: Device is currently in an active reboot / recovery sequence
        # =========================================================================
        if hostname in self._active_recoveries:
            ctx = self._active_recoveries[hostname]
            ctx.checks_count += 1
            elapsed_sec = int((now - ctx.start_time).total_seconds())

            logger.info(f"Checking boot progress for {friendly_name} ({hostname}) [Recovery in progress for {elapsed_sec}s, Check #{ctx.checks_count}]...")

            # Capture current screen frame
            check_screen_filename = f"{hostname.replace('.', '_')}_bootcheck_{now.strftime('%Y%m%d_%H%M%S')}.png"
            check_screen_path = dmt_config.captures_dir / check_screen_filename

            captured = await self._capture_with_retry(hostname, check_screen_path)

            vlm_res: ScreenAnalysisResult
            if captured:
                vlm_res = await self.vlm.analyze_screen(check_screen_path)
            else:
                vlm_res = ScreenAnalysisResult(
                    is_anomaly=False,
                    screen_state="UNKNOWN",
                    is_fully_booted=False,
                    summary="No screen frame returned during boot check.",
                    recommended_action="none"
                )

            logger.info(f"[{friendly_name} +{elapsed_sec}s] State: {vlm_res.screen_state} | Fully Booted: {vlm_res.is_fully_booted} — {vlm_res.summary}")

            # SUBCASE 1A: OS has fully booted into Desktop or Login Screen
            if vlm_res.is_fully_booted or vlm_res.screen_state in ("NORMAL_DESKTOP", "LOGIN_SCREEN"):
                logger.info(f"VERIFIED: {friendly_name} successfully reached FULLY BOOTED state ({vlm_res.screen_state}) after {elapsed_sec}s.")

                # Rename verified capture as the official recovery proof
                recov_screen_filename = f"{hostname.replace('.', '_')}_recovered_{now.strftime('%Y%m%d_%H%M%S')}.png"
                recov_screen_path = dmt_config.captures_dir / recov_screen_filename
                if check_screen_path.exists():
                    check_screen_path.rename(recov_screen_path)

                notes = (
                    f"Autonomous Operator remediated {ctx.vlm_crash_res.screen_state} via out-of-band {ctx.action_taken}. "
                    f"OS boot sequence actively tracked and verified fully operational ({vlm_res.screen_state}) after {elapsed_sec} seconds."
                )

                # Generate official PDF Incident Report
                report_data = IncidentReportData(
                    incident_id=ctx.incident_id,
                    device_hostname=hostname,
                    device_guid=guid,
                    timestamp=ctx.start_time,
                    incident_type=f"Out-of-Band {ctx.vlm_crash_res.screen_state}",
                    screen_state=ctx.vlm_crash_res.screen_state,
                    stop_code=ctx.vlm_crash_res.stop_code,
                    failing_module=ctx.vlm_crash_res.failing_module,
                    vlm_summary=ctx.vlm_crash_res.summary,
                    sel_summary=ctx.sel_res.summary,
                    actions_taken=ctx.actions_taken,
                    recovery_status="RESOLVED",
                    screenshot_path=ctx.crash_screen_path if ctx.crash_screen_path.exists() else None,
                    recovery_screenshot_path=recov_screen_path if recov_screen_path.exists() else None,
                    sel_events=[e.dict() for e in ctx.sel_res.recent_critical_events],
                    notes=notes
                )

                pdf_file = self.pdf.generate_report(report_data)
                pdf_path_str = str(pdf_file)

                # Captures are only needed to build the PDF evidence - don't retain them locally afterward.
                ctx.crash_screen_path.unlink(missing_ok=True)
                recov_screen_path.unlink(missing_ok=True)

                # Log incident to MCP server
                try:
                    await self.mcp.log_incident(
                        device=device_identifier,
                        incident_type=f"CRASH_{ctx.vlm_crash_res.screen_state}",
                        recovery_status="RESOLVED",
                        actions_taken=ctx.actions_taken,
                        stop_code=ctx.vlm_crash_res.stop_code,
                        failing_module=ctx.vlm_crash_res.failing_module,
                        notes=notes,
                        report_filename=f"{ctx.incident_id}.json"
                    )
                    logger.info(f"Recorded resolved incident {ctx.incident_id} to DMT MCP Server.")
                except Exception as ex:
                    logger.warning(f"Failed to log incident: {ex}")

                # Clear active recovery tracking
                self._active_recoveries.pop(hostname, None)

                return DeviceAuditResult(
                    hostname=hostname,
                    guid=guid,
                    friendly_name=friendly_name,
                    is_healthy=True,
                    screen_state=vlm_res.screen_state,
                    vlm_summary=f"OS fully booted into {vlm_res.screen_state} (Boot time: {elapsed_sec}s)",
                    sel_summary=ctx.sel_res.summary,
                    incident_occurred=False,
                    remediation_applied=f"RESOLVED ({ctx.action_taken.upper()})",
                    pdf_report_path=pdf_path_str,
                    timestamp=timestamp_str
                )

            # SUBCASE 1B: Re-occurred crash during boot
            elif vlm_res.screen_state in ("BSOD_CRASH", "RECOVERY_SCREEN"):
                logger.warning(f"ALERT: Secondary crash detected on {friendly_name} during boot ({elapsed_sec}s): {vlm_res.summary}")
                # Clean up intermediate frame
                if check_screen_path.exists():
                    check_screen_path.unlink(missing_ok=True)

                return DeviceAuditResult(
                    hostname=hostname,
                    guid=guid,
                    friendly_name=friendly_name,
                    is_healthy=False,
                    screen_state=vlm_res.screen_state,
                    vlm_summary=f"Secondary crash during boot: {vlm_res.summary}",
                    sel_summary=ctx.sel_res.summary,
                    incident_occurred=True,
                    remediation_applied="CRASH_RECURRED",
                    pdf_report_path=None,
                    timestamp=timestamp_str
                )

            # SUBCASE 1C: System still booting (BIOS, spinning dots, Windows Update, loading screen)
            else:
                logger.info(f"{friendly_name} is actively booting ({vlm_res.screen_state}: {vlm_res.summary}). Continuing to track without timeout...")
                # Delete temporary intermediate capture to avoid disk clutter
                if check_screen_path.exists():
                    check_screen_path.unlink(missing_ok=True)

                return DeviceAuditResult(
                    hostname=hostname,
                    guid=guid,
                    friendly_name=friendly_name,
                    is_healthy=False,
                    screen_state=f"BOOTING ({vlm_res.screen_state})",
                    vlm_summary=f"Booting in progress ({elapsed_sec}s): {vlm_res.summary}",
                    sel_summary="Monitoring boot sequence...",
                    incident_occurred=True,
                    remediation_applied=f"BOOTING ({ctx.action_taken.upper()})",
                    pdf_report_path=None,
                    timestamp=timestamp_str
                )

        # =========================================================================
        # CASE 2: Normal Device Audit (No Ongoing Recovery)
        # =========================================================================
        logger.debug(f"Auditing device: {friendly_name} ({hostname}) [GUID: {guid}]")

        # 1. Capture Screen via MCP
        screen_filename = f"{hostname.replace('.', '_')}_{now.strftime('%Y%m%d_%H%M%S')}.png"
        screen_path = dmt_config.captures_dir / screen_filename

        captured = await self._capture_with_retry(hostname, screen_path)

        # 2. Analyze screen via VLM
        vlm_res: ScreenAnalysisResult
        if captured:
            vlm_res = await self.vlm.analyze_screen(screen_path)
        else:
            # No frame retrieved means the device is unreachable/offline - never assume healthy here.
            logger.warning(f"No screen frame captured for {friendly_name} ({hostname}); device appears offline or unreachable.")
            vlm_res = ScreenAnalysisResult(
                is_anomaly=True,
                screen_state="OFFLINE",
                is_fully_booted=False,
                confidence=0.5,
                summary="Screen capture not retrieved; device appears offline or unreachable.",
                recommended_action="none"
            )

        # 2b. BLACK_SCREEN is ambiguous - probe actual AMT power state to tell "powered off" from "hung"
        if vlm_res.screen_state == "BLACK_SCREEN":
            powered_on = await self._probe_power_state(device_identifier)
            if powered_on is False:
                vlm_res.screen_state = "BLACK_SCREEN (POWERED OFF)"
                vlm_res.summary = f"{vlm_res.summary} AMT reports the device is powered off."
            elif powered_on is True:
                vlm_res.screen_state = "BLACK_SCREEN (HUNG)"
                vlm_res.summary = f"{vlm_res.summary} AMT reports the device is powered on but unresponsive."

        # 3. Retrieve and parse SEL logs
        sel_res: SELAnalysisResult
        try:
            raw_sel = await self.mcp.get_event_log(device=device_identifier, top=30)
            sel_res = self.sel.analyze_logs(raw_sel)
        except Exception as e:
            logger.warning(f"Failed to retrieve SEL logs: {e}")
            sel_res = SELAnalysisResult(summary=f"SEL retrieval skipped: {e}")

        # 4. Evaluate Anomaly Condition
        # A black screen outside an active recovery sequence means the device isn't operational,
        # even though the VLM treats it as a non-anomaly during expected reboot transitions.
        is_anomaly = vlm_res.is_anomaly or sel_res.has_critical_events or force_remediation or vlm_res.screen_state.startswith("BLACK_SCREEN")
        is_healthy = not is_anomaly and vlm_res.screen_state != "UNKNOWN"

        # Device is unreachable out-of-band - a power action can't be delivered, so skip remediation entirely.
        if vlm_res.screen_state == "OFFLINE" or vlm_res.screen_state == "BLACK_SCREEN (POWERED OFF)":
            logger.warning(f"{friendly_name} ({hostname}) is offline/powered-off. Skipping remediation attempt.")
            return DeviceAuditResult(
                hostname=hostname,
                guid=guid,
                friendly_name=friendly_name,
                is_healthy=False,
                screen_state=vlm_res.screen_state,
                vlm_summary=vlm_res.summary,
                sel_summary=sel_res.summary,
                incident_occurred=False,
                remediation_applied="SKIPPED (DEVICE OFFLINE)" if vlm_res.screen_state == "OFFLINE" else "SKIPPED (DEVICE POWERED OFF)",
                pdf_report_path=None,
                timestamp=timestamp_str
            )

        if is_anomaly:
            incident_id = f"INC-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
            logger.warning(f"ALERT: Anomaly detected on {friendly_name}! State: {vlm_res.screen_state}, SEL: {sel_res.summary}")

            # Determine remediation action
            # Ransomware must be power-cut immediately, never rebooted - a reboot can trigger/complete encryption.
            if vlm_res.screen_state == "RANSOMWARE":
                action = "power_off"
            elif vlm_res.recommended_action and vlm_res.recommended_action != "none":
                action = vlm_res.recommended_action
            elif "BSOD" in vlm_res.screen_state or "CRASH" in vlm_res.screen_state:
                action = "power_cycle"
            elif sel_res.has_critical_events:
                action = "reset"
            else:
                action = "power_cycle"

            actions_taken = [f"Automated Out-of-Band {action.upper()} via Intel AMT"]

            logger.info(f"Executing Out-of-Band Remediation: {action} on {device_identifier}")
            try:
                rem_resp = await self.mcp.remediate_device(device=device_identifier, action=action)
                logger.info(f"Remediation response: {rem_resp}")
            except Exception as e:
                logger.error(f"Remediation failed: {e}")
                actions_taken.append(f"Remediation call error: {e}")

            # Ransomware containment stays powered off - there's no reboot to track, so finalize immediately.
            if action == "power_off":
                self.mark_contained(hostname, incident_id)
                notes = (
                    f"Autonomous Operator detected {vlm_res.screen_state} and immediately powered off the device "
                    f"out-of-band via Intel AMT to halt further encryption/propagation. The device is intentionally "
                    f"left powered down pending manual forensic review."
                )

                report_data = IncidentReportData(
                    incident_id=incident_id,
                    device_hostname=hostname,
                    device_guid=guid,
                    timestamp=now,
                    incident_type=f"Out-of-Band {vlm_res.screen_state}",
                    screen_state=vlm_res.screen_state,
                    stop_code=vlm_res.stop_code,
                    failing_module=vlm_res.failing_module,
                    vlm_summary=vlm_res.summary,
                    sel_summary=sel_res.summary,
                    actions_taken=actions_taken,
                    recovery_status="CONTAINED (POWERED OFF)",
                    screenshot_path=screen_path if screen_path.exists() else None,
                    sel_events=[e.dict() for e in sel_res.recent_critical_events],
                    notes=notes
                )
                pdf_file = self.pdf.generate_report(report_data)
                pdf_path_str = str(pdf_file)
                screen_path.unlink(missing_ok=True)

                try:
                    await self.mcp.log_incident(
                        device=device_identifier,
                        incident_type=f"RANSOMWARE_{vlm_res.screen_state}",
                        recovery_status="CONTAINED (POWERED OFF)",
                        actions_taken=actions_taken,
                        stop_code=vlm_res.stop_code,
                        failing_module=vlm_res.failing_module,
                        notes=notes,
                        report_filename=f"{incident_id}.json"
                    )
                    logger.info(f"Recorded contained ransomware incident {incident_id} to DMT MCP Server.")
                except Exception as ex:
                    logger.warning(f"Failed to log incident: {ex}")

                return DeviceAuditResult(
                    hostname=hostname,
                    guid=guid,
                    friendly_name=friendly_name,
                    is_healthy=False,
                    screen_state=vlm_res.screen_state,
                    vlm_summary=vlm_res.summary,
                    sel_summary=sel_res.summary,
                    incident_occurred=True,
                    remediation_applied="CONTAINED (POWER_OFF)",
                    pdf_report_path=pdf_path_str,
                    timestamp=timestamp_str
                )

            # Register active recovery tracking for this device
            self._active_recoveries[hostname] = ActiveRecoveryContext(
                incident_id=incident_id,
                hostname=hostname,
                guid=guid,
                friendly_name=friendly_name,
                start_time=now,
                action_taken=action,
                crash_screen_path=screen_path,
                vlm_crash_res=vlm_res,
                sel_res=sel_res,
                actions_taken=actions_taken
            )

            return DeviceAuditResult(
                hostname=hostname,
                guid=guid,
                friendly_name=friendly_name,
                is_healthy=False,
                screen_state=vlm_res.screen_state,
                vlm_summary=vlm_res.summary,
                sel_summary=sel_res.summary,
                incident_occurred=True,
                remediation_applied=f"INITIATED ({action.upper()})",
                pdf_report_path=None,
                timestamp=timestamp_str
            )
        else:
            # Clean up routine capture file since no incident occurred
            if screen_path and screen_path.exists():
                try:
                    screen_path.unlink(missing_ok=True)
                    logger.debug(f"Removed routine capture (no incident): {screen_path.name}")
                except Exception as ex:
                    logger.warning(f"Failed to remove routine capture {screen_path}: {ex}")

            return DeviceAuditResult(
                hostname=hostname,
                guid=guid,
                friendly_name=friendly_name,
                is_healthy=is_healthy,
                screen_state=vlm_res.screen_state,
                vlm_summary=vlm_res.summary,
                sel_summary=sel_res.summary,
                incident_occurred=False,
                remediation_applied=None,
                pdf_report_path=None,
                timestamp=timestamp_str
            )
