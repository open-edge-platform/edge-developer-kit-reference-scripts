# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Stand-in for upstream ``src.utils.logging``.

Upstream logs through structlog with keyword context, which stdlib ``logging`` rejects; this
adapter folds the keywords into the message, so workers get upstream's lines in their own format
without depending on structlog.
"""

from __future__ import annotations

import logging
import types
from typing import Any

LOGGER_NAME = "model_downloader.upstream"


class StructlogCompatLogger:
    """Minimal subset of the structlog BoundLogger API over ``logging``."""

    def __init__(self, base: logging.Logger, context: dict[str, Any] | None = None):
        self._base = base
        self._context = dict(context or {})

    # structlog-style context management
    def bind(self, **new_values: Any) -> "StructlogCompatLogger":
        merged = dict(self._context)
        merged.update(new_values)
        return StructlogCompatLogger(self._base, merged)

    def unbind(self, *keys: str) -> "StructlogCompatLogger":
        remaining = {k: v for k, v in self._context.items() if k not in keys}
        return StructlogCompatLogger(self._base, remaining)

    def new(self, **new_values: Any) -> "StructlogCompatLogger":
        return StructlogCompatLogger(self._base, new_values)

    # emission
    def _emit(self, level: int, event: Any, *args: Any, **kwargs: Any) -> None:
        exc_info = kwargs.pop("exc_info", None)
        message = str(event)
        if args:
            try:
                message = message % args
            except (TypeError, ValueError):
                message = " ".join([message, *map(str, args)])
        context = dict(self._context)
        context.update(kwargs)
        if context:
            message = message + " " + " ".join(f"{k}={v!r}" for k, v in context.items())
        self._base.log(level, message, exc_info=exc_info)

    def debug(self, event: Any, *args: Any, **kwargs: Any) -> None:
        self._emit(logging.DEBUG, event, *args, **kwargs)

    def info(self, event: Any, *args: Any, **kwargs: Any) -> None:
        self._emit(logging.INFO, event, *args, **kwargs)

    def warning(self, event: Any, *args: Any, **kwargs: Any) -> None:
        self._emit(logging.WARNING, event, *args, **kwargs)

    warn = warning

    def error(self, event: Any, *args: Any, **kwargs: Any) -> None:
        self._emit(logging.ERROR, event, *args, **kwargs)

    def exception(self, event: Any, *args: Any, **kwargs: Any) -> None:
        kwargs.setdefault("exc_info", True)
        self._emit(logging.ERROR, event, *args, **kwargs)

    def critical(self, event: Any, *args: Any, **kwargs: Any) -> None:
        self._emit(logging.CRITICAL, event, *args, **kwargs)

    fatal = critical

    def log(self, level: int, event: Any, *args: Any, **kwargs: Any) -> None:
        self._emit(level, event, *args, **kwargs)


def make_logging_module(name: str) -> types.ModuleType:
    """Build a module exposing the same names as upstream ``src/utils/logging.py``."""
    module = types.ModuleType(name)
    module.__doc__ = "Demo Studio adapter for the upstream structlog logger."
    logger = StructlogCompatLogger(logging.getLogger(LOGGER_NAME))
    module.logger = logger  # type: ignore[attr-defined]
    module.USE_COLORS = False  # type: ignore[attr-defined]
    module.get_colored_message = lambda message, _color: message  # type: ignore[attr-defined]
    module.log_info = logger.info  # type: ignore[attr-defined]
    module.log_error = logger.error  # type: ignore[attr-defined]
    module.log_warning = logger.warning  # type: ignore[attr-defined]
    return module
