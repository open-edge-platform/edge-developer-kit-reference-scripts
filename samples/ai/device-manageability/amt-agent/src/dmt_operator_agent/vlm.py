# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import base64
import json
import logging
from pathlib import Path
from typing import Optional
from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel, Field

from agentic_framework.config import framework_config

logger = logging.getLogger("dmt_operator_agent.vlm")

class ScreenAnalysisResult(BaseModel):
    is_anomaly: bool = Field(description="True if an operational anomaly, crash, freeze, or error is visible.")
    screen_state: str = Field(description="One of: NORMAL_DESKTOP, LOGIN_SCREEN, BOOTING_STAGE, BIOS_POST, BLACK_SCREEN, BSOD_CRASH, RECOVERY_SCREEN, RANSOMWARE, UNKNOWN")
    is_fully_booted: bool = Field(default=True, description="True ONLY if Windows desktop, interactive app, or user login screen is fully loaded. False if black screen, BIOS, OEM splash, or OS boot loading dots.")
    confidence: float = Field(default=0.9, description="Confidence score between 0.0 and 1.0")
    stop_code: Optional[str] = Field(default=None, description="Windows BSOD Stop Code if visible (e.g. CRITICAL_PROCESS_DIED)")
    failing_module: Optional[str] = Field(default=None, description="Failing driver/module if visible (e.g. nvlddmkm.sys)")
    summary: str = Field(description="Human readable description of the screen contents.")
    recommended_action: str = Field(default="none", description="Operator recommendation: power_cycle, reset, boot_to_bios, boot_to_pxe, power_off, or none")

class VLMAnalyzer:
    """
    Multimodal Vision-Language Model analyzer for screen diagnostics.
    """
    def __init__(self, api_base: Optional[str] = None, api_key: Optional[str] = None, model: Optional[str] = None):
        self.client = AsyncOpenAI(
            base_url=api_base or framework_config.llm_api_base,
            api_key=api_key or framework_config.llm_api_key
        )
        self.model = model or framework_config.llm_model

    def encode_image(self, image_path: Path) -> str:
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode("utf-8")

    async def analyze_screen(self, image_path: Path) -> ScreenAnalysisResult:
        if not image_path.exists():
            logger.error("Screenshot path does not exist: %s", image_path)
            return ScreenAnalysisResult(
                is_anomaly=True,
                screen_state="UNKNOWN",
                is_fully_booted=False,
                confidence=0.5,
                summary=f"Screenshot file missing at {image_path}",
                recommended_action="none"
            )

        prompt = (
            "You are an expert IT Systems Operator and Site Reliability Engineer monitoring an Intel AMT enterprise computer screen.\n"
            "Analyze this captured screen image carefully and determine its operational and boot state.\n\n"
            "State Categories:\n"
            "1. 'NORMAL_DESKTOP': Fully booted OS desktop with taskbar/icons/running applications. (is_fully_booted: true, is_anomaly: false)\n"
            "2. 'LOGIN_SCREEN': Fully booted Windows/Linux login screen waiting for credentials. (is_fully_booted: true, is_anomaly: false)\n"
            "3. 'BOOTING_STAGE': Transitional boot stage (e.g. Windows spinning dots, 'Please wait', 'Starting Windows', loading logo). (is_fully_booted: false, is_anomaly: false)\n"
            "4. 'BIOS_POST': BIOS setup screen, UEFI firmware, or OEM manufacturer splash logo. (is_fully_booted: false, is_anomaly: false)\n"
            "5. 'BLACK_SCREEN': Blank/unpowered or no display output during reboot cycle. (is_fully_booted: false, is_anomaly: false)\n"
            "6. 'BSOD_CRASH': Blue Screen of Death, kernel panic, stop code, or fatal driver error. (is_fully_booted: false, is_anomaly: true)\n"
            "7. 'RECOVERY_SCREEN': Windows Recovery Environment / Startup Repair prompt. (is_fully_booted: false, is_anomaly: true)\n"
            "8. 'RANSOMWARE': Ransom note, file-encryption warning, extortion message, or any lock screen demanding payment to restore access/files. (is_fully_booted: false, is_anomaly: true, recommended_action: power_off)\n\n"
            "IMPORTANT: If the screen shows RANSOMWARE, you MUST set recommended_action to 'power_off' - never recommend a reboot/power_cycle/reset "
            "for ransomware, since rebooting the host can allow encryption to continue or complete. The device must be cut off immediately.\n\n"
            "Respond ONLY with a JSON object strictly matching this schema:\n"
            "{\n"
            '  "is_anomaly": true | false,\n'
            '  "screen_state": "NORMAL_DESKTOP" | "LOGIN_SCREEN" | "BOOTING_STAGE" | "BIOS_POST" | "BLACK_SCREEN" | "BSOD_CRASH" | "RECOVERY_SCREEN" | "RANSOMWARE" | "UNKNOWN",\n'
            '  "is_fully_booted": true | false,\n'
            '  "confidence": 0.0 to 1.0,\n'
            '  "stop_code": "STOP_CODE_HERE" or null,\n'
            '  "failing_module": "MODULE_NAME.SYS" or null,\n'
            '  "summary": "Detailed description of what is displayed",\n'
            '  "recommended_action": "power_cycle" | "reset" | "boot_to_bios" | "boot_to_pxe" | "power_off" | "none"\n'
            "}"
        )

        try:
            base64_image = self.encode_image(image_path)
            response = await self.client.chat.completions.create(
                model=self.model,
                temperature=framework_config.llm_temperature,
                response_format={"type": "json_object"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{base64_image}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=framework_config.llm_max_tokens
            )

            if not response.choices:
                raise ValueError("Vision endpoint returned no completion choices")
            choice = response.choices[0]
            raw_content = choice.message.content
            logger.debug(
                "VLM response: model=%s finish_reason=%s content_chars=%d usage=%s",
                self.model, choice.finish_reason, len(raw_content or ""), response.usage,
            )
            if choice.finish_reason == "length":
                raise ValueError(
                    f"Vision response reached LLM_MAX_TOKENS={framework_config.llm_max_tokens}; "
                    "increase LLM_MAX_TOKENS or reduce reasoning in the model server"
                )
            if choice.message.refusal:
                raise ValueError("Vision model refused the screen analysis request")
            if choice.finish_reason == "content_filter":
                raise ValueError("Vision response was blocked by the endpoint's content filter")
            if not raw_content or not raw_content.strip():
                raise ValueError(
                    f"Vision endpoint returned empty content (finish_reason={choice.finish_reason}); "
                    "check the model server's vision support and reasoning/chat-template settings"
                )
            content = raw_content.strip()
            if content.startswith("```json"):
                content = content[7:]
            elif content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

            return ScreenAnalysisResult.model_validate(json.loads(content))

        except (OpenAIError, OSError, ValueError) as e:
            logger.warning("VLM analysis failed (model=%s): %s", self.model, e)
            return ScreenAnalysisResult(
                is_anomaly=False,
                screen_state="UNKNOWN",
                is_fully_booted=False,
                confidence=0.0,
                summary=f"Screen analysis unavailable: {e}",
                recommended_action="none"
            )
