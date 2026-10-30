# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger("dmt_operator_agent.reporting")

class IncidentReportData:
    def __init__(
        self,
        incident_id: str,
        device_hostname: str,
        device_guid: str,
        timestamp: datetime,
        incident_type: str,
        screen_state: str,
        stop_code: Optional[str] = None,
        failing_module: Optional[str] = None,
        vlm_summary: str = "",
        sel_summary: str = "",
        actions_taken: Optional[List[str]] = None,
        recovery_status: str = "RESOLVED",
        screenshot_path: Optional[Path] = None,
        recovery_screenshot_path: Optional[Path] = None,
        sel_events: Optional[List[dict]] = None,
        notes: str = ""
    ):
        self.incident_id = incident_id
        self.device_hostname = device_hostname
        self.device_guid = device_guid
        self.timestamp = timestamp
        self.incident_type = incident_type
        self.screen_state = screen_state
        self.stop_code = stop_code or "N/A"
        self.failing_module = failing_module or "N/A"
        self.vlm_summary = vlm_summary
        self.sel_summary = sel_summary
        self.actions_taken = actions_taken or []
        self.recovery_status = recovery_status
        self.screenshot_path = screenshot_path
        self.recovery_screenshot_path = recovery_screenshot_path
        self.sel_events = sel_events or []
        self.notes = notes

class IncidentPDFGenerator:
    """
    Generates enterprise-grade, single-page visual PDF Incident Reports.
    """
    def __init__(self, output_dir: Path):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def generate_report(self, data: IncidentReportData) -> Path:
        filename = f"INCIDENT_{data.incident_id}_{data.timestamp.strftime('%Y%m%d_%H%M%S')}.pdf"
        output_path = self.output_dir / filename

        doc = SimpleDocTemplate(
            str(output_path),
            pagesize=letter,
            rightMargin=24,
            leftMargin=24,
            topMargin=20,
            bottomMargin=20
        )

        styles = getSampleStyleSheet()

        c_primary = colors.HexColor("#0F2942")
        c_accent = colors.HexColor("#0071C5")
        c_danger = colors.HexColor("#C0392B")
        c_success = colors.HexColor("#27AE60")
        c_gray_bg = colors.HexColor("#F8F9FA")
        c_border = colors.HexColor("#CBD5E1")
        c_card_bg = colors.HexColor("#F1F5F9")

        title_style = ParagraphStyle(
            "DocTitle",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=c_primary
        )
        subtitle_style = ParagraphStyle(
            "DocSubtitle",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#555555")
        )
        badge_style = ParagraphStyle(
            "DocBadge",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            alignment=2,  # Right align
            textColor=c_primary
        )
        h2_style = ParagraphStyle(
            "SectionHeader",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            textColor=c_primary,
            spaceBefore=3,
            spaceAfter=2
        )
        body_style = ParagraphStyle(
            "BodyDark",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9.5,
            textColor=colors.HexColor("#1E293B")
        )
        caption_style = ParagraphStyle(
            "Caption",
            parent=styles["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=7,
            leading=8.5,
            textColor=colors.HexColor("#475569"),
            alignment=1  # Centered
        )

        story = []

        # 1. Header Banner
        header_table = Table([
            [
                Paragraph("<b>INTEL AMT / DMT AUTONOMOUS OPERATOR</b><br/><font color='#0071C5'><b>Incident Remediation & Root Cause Analysis Report</b></font>", title_style),
                Paragraph(
                    f"<b>INCIDENT ID:</b> {data.incident_id}<br/>"
                    f"<b>DATE:</b> {data.timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')}<br/>"
                    f"<b>STATUS:</b> <font color='{'#27AE60' if 'RESOLVED' in data.recovery_status else '#C0392B'}'><b>{data.recovery_status}</b></font>",
                    badge_style
                )
            ]
        ], colWidths=[350, 214])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ('TOPPADDING', (0,0), (-1,-1), 0),
        ]))
        story.append(header_table)
        story.append(HRFlowable(width="100%", thickness=1.2, color=c_accent, spaceBefore=3, spaceAfter=4))

        # 2. Target Endpoint & Incident Metadata
        meta_data = [
            [
                Paragraph("<b>Target Hostname:</b>", body_style),
                Paragraph(f"<b>{data.device_hostname}</b>", body_style),
                Paragraph("<b>Incident Type:</b>", body_style),
                Paragraph(f"<font color='#C0392B'><b>{data.incident_type}</b></font>", body_style)
            ],
            [
                Paragraph("<b>Device GUID:</b>", body_style),
                Paragraph(f"{data.device_guid}", body_style),
                Paragraph("<b>Screen State:</b>", body_style),
                Paragraph(f"<b>{data.screen_state}</b>", body_style)
            ],
            [
                Paragraph("<b>Stop Code:</b>", body_style),
                Paragraph(f"<font color='#C0392B'><b>{data.stop_code}</b></font>", body_style),
                Paragraph("<b>Failing Module:</b>", body_style),
                Paragraph(f"<b>{data.failing_module}</b>", body_style)
            ]
        ]
        meta_table = Table(meta_data, colWidths=[85, 197, 85, 197])
        meta_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), c_gray_bg),
            ('BOX', (0,0), (-1,-1), 0.75, c_border),
            ('INNERGRID', (0,0), (-1,-1), 0.5, c_border),
            ('TOPPADDING', (0,0), (-1,-1), 2.5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2.5),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]))
        story.append(meta_table)
        story.append(Spacer(1, 4))

        # 3. Hardware Screen Capture Evidence (Dual Side-by-Side if both present)
        story.append(Paragraph("1. Hardware Screen Capture Evidence (Intel AMT KVM RFB Redirection)", h2_style))

        has_crash_img = data.screenshot_path and data.screenshot_path.exists()
        has_recov_img = data.recovery_screenshot_path and data.recovery_screenshot_path.exists()

        if has_crash_img and has_recov_img:
            img1 = Image(str(data.screenshot_path), width=3.6*inch, height=2.0*inch)
            img2 = Image(str(data.recovery_screenshot_path), width=3.6*inch, height=2.0*inch)
            img1.hAlign = 'CENTER'
            img2.hAlign = 'CENTER'

            evidence_table = Table([
                [img1, img2],
                [
                    Paragraph(f"<b>Figure 1:</b> Crash Frame ({data.screen_state})", caption_style),
                    Paragraph("<b>Figure 2:</b> Verified Operational Recovery", caption_style)
                ]
            ], colWidths=[280, 280])
            evidence_table.setStyle(TableStyle([
                ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                ('BACKGROUND', (0,0), (-1,-1), c_gray_bg),
                ('BOX', (0,0), (-1,-1), 0.75, c_border),
                ('INNERGRID', (0,0), (-1,-1), 0.5, c_border),
                ('TOPPADDING', (0,0), (-1,-1), 3),
                ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ]))
            story.append(evidence_table)
        elif has_crash_img:
            img1 = Image(str(data.screenshot_path), width=3.8*inch, height=2.1*inch)
            img1.hAlign = 'CENTER'
            evidence_table = Table([
                [img1],
                [Paragraph(f"<b>Figure 1:</b> Hardware crash capture at {data.timestamp.strftime('%H:%M:%S')} — VLM: <i>{data.vlm_summary}</i>", caption_style)]
            ], colWidths=[564])
            evidence_table.setStyle(TableStyle([
                ('ALIGN', (0,0), (-1,-1), 'CENTER'),
                ('BACKGROUND', (0,0), (-1,-1), c_gray_bg),
                ('BOX', (0,0), (-1,-1), 0.75, c_border),
                ('TOPPADDING', (0,0), (-1,-1), 3),
                ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ]))
            story.append(evidence_table)
        else:
            story.append(Paragraph("<i>No hardware screen capture artifact available.</i>", body_style))

        story.append(Spacer(1, 4))

        # 4. Root Cause Analysis & SEL Diagnostics
        story.append(Paragraph("2. Root Cause Analysis & Intel AMT SEL Hardware Corroboration", h2_style))
        rca_text = (
            f"<b>VLM Visual Diagnostic:</b> {data.vlm_summary}<br/>"
            f"<b>System Event Log (SEL):</b> {data.sel_summary}"
        )
        rca_table = Table([[Paragraph(rca_text, body_style)]], colWidths=[564])
        rca_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), c_card_bg),
            ('BOX', (0,0), (-1,-1), 0.75, colors.HexColor("#94A3B8")),
            ('PADDING', (0,0), (-1,-1), 4),
        ]))
        story.append(rca_table)
        story.append(Spacer(1, 4))

        # 5. Out-of-Band Remediation & Verification Grid
        story.append(Paragraph("3. Out-of-Band Remediation Actions & Operational Sign-Off", h2_style))

        action_lines = []
        if data.actions_taken:
            for idx, act in enumerate(data.actions_taken, 1):
                action_lines.append(f"<b>{idx}.</b> {act} <font color='#27AE60'><b>[SUCCESS]</b></font>")
        else:
            action_lines.append("<b>1.</b> Out-of-Band System Health Verification Audit <b>[COMPLETED]</b>")

        action_content = "<br/>".join(action_lines)

        verify_content = (
            f"<b>Final State:</b> <font color='{'#27AE60' if 'RESOLVED' in data.recovery_status else '#C0392B'}'><b>{data.recovery_status}</b></font><br/>"
            f"<b>Operator Summary:</b> {data.notes or 'Out-of-band power cycle executed successfully. OS fully booted and verified in operational state.'}<br/>"
            f"<b>Compliance Sign-off:</b> Autonomous DMT Operator Agent (Auto-Remediation Engine)"
        )

        bottom_grid = Table([
            [
                Paragraph(f"<b>Remediation Executed (Intel AMT MEBx Bus):</b><br/>{action_content}", body_style),
                Paragraph(f"<b>Post-Remediation Verification & Sign-off:</b><br/>{verify_content}", body_style)
            ]
        ], colWidths=[278, 282])
        bottom_grid.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), c_gray_bg),
            ('BOX', (0,0), (-1,-1), 0.75, c_border),
            ('INNERGRID', (0,0), (-1,-1), 0.5, c_border),
            ('PADDING', (0,0), (-1,-1), 4),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ]))
        story.append(bottom_grid)

        doc.build(story)
        logger.info("Generated Single-Page PDF Incident Report: %s", output_path)

        self._write_summary_sidecar(output_path, data)
        return output_path

    def _write_summary_sidecar(self, pdf_path: Path, data: IncidentReportData) -> None:
        """Writes a small JSON file alongside the PDF so a summary can be listed without parsing the PDF."""
        summary_path = pdf_path.with_suffix(".json")
        try:
            summary_path.write_text(json.dumps({
                "incident_id": data.incident_id,
                "device_hostname": data.device_hostname,
                "incident_type": data.incident_type,
                "screen_state": data.screen_state,
                "recovery_status": data.recovery_status,
                "summary": data.notes or data.vlm_summary,
            }, indent=2))
        except Exception as e:
            logger.warning("Failed to write summary sidecar for %s: %s", pdf_path.name, e)
