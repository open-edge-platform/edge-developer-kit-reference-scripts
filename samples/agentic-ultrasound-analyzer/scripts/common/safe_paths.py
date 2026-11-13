# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Helpers for building file paths from untrusted names and settings."""

from __future__ import annotations

from pathlib import Path

_SAFE_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_."


def safe_component(text: str, fallback: str, max_len: int = 64) -> str:
    """Return ``text`` reduced to a single safe file-name component."""
    cleaned = "".join(_SAFE_CHARS[_SAFE_CHARS.index(ch)] for ch in str(text)[:max_len] if ch in _SAFE_CHARS)
    cleaned = cleaned.strip(".")
    return cleaned or fallback


def resolve_within(base: Path | str, raw: Path | str) -> Path | None:
    """Resolve ``raw`` against ``base``; return None if it escapes ``base``."""
    base_path = Path(base).resolve()
    candidate = (base_path / raw).resolve()
    if not candidate.is_relative_to(base_path):
        return None
    sanitized = base_path.joinpath(*(safe_component(part, "_") for part in candidate.relative_to(base_path).parts))
    final_path = sanitized.resolve()
    if not final_path.is_relative_to(base_path):
        return None
    return final_path
