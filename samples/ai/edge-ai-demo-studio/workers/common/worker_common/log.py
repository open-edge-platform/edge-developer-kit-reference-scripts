# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Consistent logger setup across workers."""

from __future__ import annotations

import logging
import os
import sys

_FORMAT = "%(asctime)s %(levelname)-8s [%(name)s] %(message)s"
_configured = False


def get_logger(name: str) -> logging.Logger:
    """Return a logger, configuring root output once per process.

    Level comes from LOG_LEVEL (default INFO). Logs go to stderr so data a worker writes on stdout stays
    parseable.
    """
    global _configured
    if not _configured:
        level = os.getenv("LOG_LEVEL", "INFO").upper()
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter(_FORMAT))
        root = logging.getLogger()
        root.setLevel(getattr(logging, level, logging.INFO))
        root.addHandler(handler)
        _configured = True
    return logging.getLogger(name)
