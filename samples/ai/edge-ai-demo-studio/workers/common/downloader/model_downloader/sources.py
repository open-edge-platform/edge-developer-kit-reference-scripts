# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""The hubs a worker can fetch from (``--source``).

The one place that knows how each backend spells a source, so the ModelScope endpoint is not
repeated per worker.
"""

from __future__ import annotations

from enum import Enum
from typing import Any


class Source(str, Enum):
    HUGGINGFACE = "huggingface"
    MODELSCOPE = "modelscope"


#: What OVMS (and anything else that speaks the Hugging Face hub API) must be
#: pointed at to read ModelScope instead.
MODELSCOPE_HF_ENDPOINT = "https://www.modelscope.cn/models"

_ALIASES = {
    "huggingface": Source.HUGGINGFACE,
    "hf": Source.HUGGINGFACE,
    "hugging_face": Source.HUGGINGFACE,
    "modelscope": Source.MODELSCOPE,
    "ms": Source.MODELSCOPE,
}


def normalize_source(source: Any) -> Source:
    """Map a worker ``--source`` value (str, enum, or ``None``) to a :class:`Source`."""
    if isinstance(source, Source):
        return source
    raw = getattr(source, "value", source)
    key = str(raw or Source.HUGGINGFACE.value).strip().lower()
    try:
        return _ALIASES[key]
    except KeyError:
        raise ValueError(
            f"unknown model source {raw!r}; expected one of {sorted(s.value for s in Source)}"
        ) from None


def hub_for_source(source: Any) -> str:
    """The canonical hub name (``huggingface`` / ``modelscope``) for ``source``."""
    return normalize_source(source).value


def hf_endpoint_for_source(source: Any) -> str | None:
    """``HF_ENDPOINT`` to set for a hub-API client to read ``source``.

    ``None`` for Hugging Face itself, so a caller keeps whatever endpoint the
    environment already carries (a mirror, a proxy).
    """
    return MODELSCOPE_HF_ENDPOINT if normalize_source(source) is Source.MODELSCOPE else None
