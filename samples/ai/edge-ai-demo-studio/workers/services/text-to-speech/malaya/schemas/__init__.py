# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from typing import Literal, Optional
from pydantic import BaseModel, Field


class NormalizationOptions(BaseModel):
    """Options for the normalization system"""

    normalize: bool = Field(
        default=True,
        description="Normalizes input text to make it easier for the model to say",
    )
    unit_normalization: bool = Field(
        default=False, description="Transforms units like 10KB to 10 kilobytes"
    )
    url_normalization: bool = Field(
        default=True,
        description="Changes urls so they can be properly pronounced by kokoro",
    )
    email_normalization: bool = Field(
        default=True,
        description="Changes emails so they can be properly pronounced by kokoro",
    )
    optional_pluralization_normalization: bool = Field(
        default=True,
        description="Replaces (s) with s so some words get pronounced correctly",
    )
    phone_normalization: bool = Field(
        default=True,
        description="Changes phone numbers so they can be properly pronounced by kokoro",
    )


class OpenAISpeechRequest(BaseModel):
    """Request schema for OpenAI-compatible speech endpoint using Malaya TTS"""

    model: str = Field(
        default="malaya",
        description="The model to use for generation. Supported models: malaya-tts",
    )
    input: str = Field(..., description="The text to generate audio for")
    voice: str = Field(
        default="Shafiqah Idayu",
        description="The voice to use for generation. Available voices: Husein, Shafiqah Idayu, Anwar Ibrahim",
    )
    response_format: Literal["mp3", "opus", "aac", "flac", "wav", "pcm"] = Field(
        default="mp3",
        description=(
            "The format to return audio in. All six OpenAI formats are "
            "supported: mp3, opus, aac, flac, wav, pcm."
        ),
    )
    stream: bool = Field(
        default=True,
        description=(
            "Whether to send the audio sentence by sentence as it is synthesized "
            "(wav with unknown-length sizes, raw pcm, mp3/aac per sentence; "
            "opus/flac once complete) or return it all at once."
        ),
    )
    stream_format: Literal["audio", "sse"] = Field(
        default="audio",
        description=(
            "'audio' sends the audio bytes; 'sse' sends OpenAI's "
            "speech.audio.delta events (base64 audio) and a final "
            "speech.audio.done, streamed regardless of 'stream'."
        ),
    )
    speed: float = Field(
        default=1.0,
        ge=0.25,
        le=4.0,
        description="The speed of the generated audio. Select a value from 0.25 to 4.0.",
    )
    instructions: Optional[str] = Field(
        default=None,
        description=(
            "Accepted for OpenAI compatibility and ignored: this model has no "
            "prompt-steerable delivery, so tone and pacing come from the voice "
            "and 'speed' instead."
        ),
    )

    # Unused fields kept for compatibility
    download_format: Optional[Literal["mp3", "opus", "aac", "flac", "wav", "pcm"]] = (
        Field(
            default=None,
            description="Optional different format for the final download. If not provided, uses response_format.",
        )
    )
    return_download_link: bool = Field(
        default=False,
        description="If true, returns a download link in X-Download-Path header after streaming completes",
    )
    lang_code: Optional[str] = Field(
        default=None,
        description="Optional language code to use for text processing. If not provided, will use first letter of voice name.",
    )
    normalization_options: Optional[NormalizationOptions] = Field(
        default=NormalizationOptions(),
        description="Options for the normalization system",
    )
