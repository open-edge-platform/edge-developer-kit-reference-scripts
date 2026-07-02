# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from typing import Literal, Optional
from pydantic import BaseModel, Field


class OpenAISpeechRequest(BaseModel):
    """Request schema for the OpenAI-compatible speech endpoint using Piper TTS."""

    model: str = Field(
        default="piper",
        description="The model to use for generation.",
    )
    input: str = Field(..., description="The text to generate audio for")
    voice: str = Field(
        default="en_US-lessac-medium",
        description=(
            "The Piper voice code to use, e.g. 'en_US-lessac-medium' or "
            "'vi_VN-vais1000-medium'. Any rhasspy/piper-voices code is accepted "
            "and downloaded on demand."
        ),
    )
    response_format: Literal["mp3", "wav", "flac", "opus", "pcm"] = Field(
        default="mp3",
        description="The format to return audio in. Supported: mp3, wav, flac, opus, pcm",
    )
    stream: bool = Field(
        default=True,
        description="Whether to stream the audio response in chunks or return it all at once.",
    )
    speed: float = Field(
        default=1.0,
        ge=0.25,
        le=4.0,
        description="The speed of the generated audio. Select a value from 0.25 to 4.0.",
    )
    volume_multiplier: float = Field(
        default=1.0,
        gt=0.0,
        description="A volume multiplier applied to the output audio.",
    )

    # Unused fields kept for OpenAI client compatibility
    download_format: Optional[Literal["mp3", "opus", "aac", "flac", "wav", "pcm"]] = (
        Field(
            default=None,
            description="Optional different format for the final download. If not provided, uses response_format.",
        )
    )
    return_download_link: bool = Field(
        default=False,
        description="If true, returns a download link in X-Download-Path header.",
    )
    lang_code: Optional[str] = Field(
        default=None,
        description="Optional language code (unused; the voice already encodes the language).",
    )
