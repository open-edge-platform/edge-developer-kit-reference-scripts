# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
from typing import Any, Dict, List
from pydantic import BaseModel, Field

logger = logging.getLogger("dmt_operator_agent.sel_analyzer")

class SELEvent(BaseModel):
    timestamp: str = Field(default="N/A")
    sensor_type: str = Field(default="Generic")
    event_type: str = Field(default="Informational")
    description: str = Field(default="")
    severity: str = Field(default="INFO")

class SELAnalysisResult(BaseModel):
    has_critical_events: bool = Field(default=False)
    critical_count: int = Field(default=0)
    warning_count: int = Field(default=0)
    total_events: int = Field(default=0)
    summary: str = Field(default="No abnormal hardware events detected in SEL.")
    recent_critical_events: List[SELEvent] = Field(default_factory=list)
    raw_events: List[Any] = Field(default_factory=list)

class SELAnalyzer:
    """
    Parser and diagnostic analyzer for Intel AMT System Event Logs (SEL).
    Detects hardware watchdog resets, power anomalies, thermal trips, and OS crash traps.
    """
    CRITICAL_KEYWORDS = [
        "watchdog", "thermal", "trip", "overheat", "power fault", "critical",
        "processor", "bus error", "ecc", "unrecoverable", "fatal", "reset by hardware"
    ]
    WARNING_KEYWORDS = [
        "degraded", "fan", "warning", "voltage", "abnormal", "unexpected"
    ]

    def analyze_logs(self, sel_data: Any) -> SELAnalysisResult:
        events: List[Any] = []

        if isinstance(sel_data, dict):
            if "events" in sel_data and isinstance(sel_data["events"], list):
                events = sel_data["events"]
            elif "records" in sel_data and isinstance(sel_data["records"], list):
                events = sel_data["records"]
            elif "result" in sel_data and isinstance(sel_data["result"], dict):
                sub = sel_data["result"]
                if "records" in sub and isinstance(sub["records"], list):
                    events = sub["records"]
                elif "events" in sub and isinstance(sub["events"], list):
                    events = sub["events"]
        elif isinstance(sel_data, list):
            events = sel_data

        parsed_events: List[SELEvent] = []
        critical_events: List[SELEvent] = []
        critical_count = 0
        warning_count = 0

        for item in events:
            if isinstance(item, dict):
                desc = str(item.get("description", item.get("Event", item.get("message", ""))))
                ts = str(item.get("timestamp", item.get("Time", item.get("EventTime", "N/A"))))
                sensor = str(item.get("sensor_type", item.get("SensorType", item.get("Sensor", "System"))))
                evt_type = str(item.get("event_type", item.get("EventType", "System Event")))
            else:
                desc = str(item)
                ts = "N/A"
                sensor = "System"
                evt_type = "Log Entry"

            desc_lower = desc.lower()
            severity = "INFO"
            if any(k in desc_lower for k in self.CRITICAL_KEYWORDS):
                severity = "CRITICAL"
                critical_count += 1
            elif any(k in desc_lower for k in self.WARNING_KEYWORDS):
                severity = "WARNING"
                warning_count += 1

            event_obj = SELEvent(
                timestamp=ts,
                sensor_type=sensor,
                event_type=evt_type,
                description=desc,
                severity=severity
            )
            parsed_events.append(event_obj)
            if severity == "CRITICAL":
                critical_events.append(event_obj)

        has_critical = critical_count > 0
        if has_critical:
            summary = f"Detected {critical_count} CRITICAL hardware events in AMT System Event Log."
        elif warning_count > 0:
            summary = f"Detected {warning_count} warning event(s) in AMT System Event Log."
        else:
            summary = f"SEL log healthy. {len(parsed_events)} event record(s) checked with 0 hardware faults."

        return SELAnalysisResult(
            has_critical_events=has_critical,
            critical_count=critical_count,
            warning_count=warning_count,
            total_events=len(parsed_events),
            summary=summary,
            recent_critical_events=critical_events[:10],
            raw_events=events
        )
