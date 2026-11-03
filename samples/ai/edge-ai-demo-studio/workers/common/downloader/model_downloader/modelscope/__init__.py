# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""ModelScope (modelscope.cn) through the ``modelscope`` SDK. See :mod:`.api`."""

from .api import file, snapshot

__all__ = ["file", "snapshot"]
from .api import file_size  # noqa: E402,F401
