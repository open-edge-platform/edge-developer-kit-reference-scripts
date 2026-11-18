# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Real-robot tools (``hardware`` extra).

The simulation SDK never imports this package; hardware drivers are imported lazily inside it so a
missing ``hardware`` extra produces a clear error only when a real-robot command runs.
"""
