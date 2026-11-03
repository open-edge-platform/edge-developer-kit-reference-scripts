# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
from dataclasses import dataclass
from typing import Optional
from pptx.dml.color import RGBColor
from pptx.util import Pt

logger = logging.getLogger(__name__)


@dataclass
class RunFormatting:
    """Lightweight container for run formatting details."""
    font_name: Optional[str] = None
    font_size: Optional[float] = None
    bold: Optional[bool] = None
    italic: Optional[bool] = None
    underline: Optional[bool] = None
    color: Optional[tuple] = None
    color_type: Optional[str] = None
    theme_color: Optional[int] = None
    brightness: Optional[float] = None
    hyperlink: Optional[str] = None


def extract_run_formatting(run) -> RunFormatting:
    """Extract formatting from a pptx run into a serializable structure."""
    formatting = RunFormatting()
    try:
        if hasattr(run, "font") and run.font:
            formatting.font_name = run.font.name
            formatting.font_size = run.font.size.pt if run.font.size else None
            formatting.bold = run.font.bold
            formatting.italic = run.font.italic
            formatting.underline = run.font.underline

            try:
                if run.font.color:
                    color_obj = run.font.color
                    if hasattr(color_obj, "type") and color_obj.type:
                        from pptx.enum.dml import MSO_COLOR_TYPE
                        if color_obj.type == MSO_COLOR_TYPE.RGB:
                            formatting.color_type = "rgb"
                            if getattr(color_obj, "rgb", None):
                                rgb = color_obj.rgb
                                formatting.color = (rgb[0], rgb[1], rgb[2])
                        elif color_obj.type == MSO_COLOR_TYPE.SCHEME:
                            formatting.color_type = "scheme"
                            if hasattr(color_obj, "theme_color"):
                                formatting.theme_color = color_obj.theme_color
                            if hasattr(color_obj, "brightness"):
                                formatting.brightness = color_obj.brightness
            except Exception as exc:  # pragma: no cover - defensive
                logger.debug(f"Color extraction failed: {exc}")

        if hasattr(run, "hyperlink") and run.hyperlink:
            formatting.hyperlink = run.hyperlink.address

        logger.debug(
            "Extracted formatting | bold=%s italic=%s font=%s size=%s color_type=%s",
            formatting.bold,
            formatting.italic,
            formatting.font_name,
            formatting.font_size,
            formatting.color_type,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(f"Run formatting extraction failed: {exc}")

    return formatting


def apply_run_formatting(run, formatting: RunFormatting, font_adjustment: float, dynamic_settings: dict):
    """Apply stored formatting to a pptx run, respecting font adjustment bounds."""
    if not hasattr(run, "font") or not run.font:
        return

    try:
        if formatting.font_name:
            run.font.name = formatting.font_name
        if formatting.font_size:
            adjusted_size = formatting.font_size * font_adjustment
            adjusted_size = max(adjusted_size, dynamic_settings["min_size"])
            adjusted_size = min(adjusted_size, dynamic_settings["max_size"])
            run.font.size = Pt(adjusted_size)
        if formatting.bold is not None:
            run.font.bold = formatting.bold
        if formatting.italic is not None:
            run.font.italic = formatting.italic
        if formatting.underline is not None:
            run.font.underline = formatting.underline

        try:
            if formatting.color_type == "rgb" and formatting.color:
                run.font.color.rgb = RGBColor(*formatting.color)
            elif formatting.color_type == "scheme" and formatting.theme_color is not None:
                from pptx.enum.dml import MSO_THEME_COLOR

                run.font.color.theme_color = formatting.theme_color
                if formatting.brightness is not None:
                    run.font.color.brightness = formatting.brightness
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug(f"Color apply failed: {exc}")

        if formatting.hyperlink and hasattr(run, "hyperlink"):
            try:
                run.hyperlink.address = formatting.hyperlink
            except Exception as exc:  # pragma: no cover - defensive
                logger.debug(f"Hyperlink apply failed: {exc}")

        logger.debug(
            "Applied formatting | bold=%s italic=%s font=%s size=%s color_type=%s",
            formatting.bold,
            formatting.italic,
            formatting.font_name,
            formatting.font_size,
            formatting.color_type,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(f"Run formatting apply failed: {exc}")