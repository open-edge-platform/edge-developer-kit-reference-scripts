# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Hugging Face (and any other upstream plugin) through the OEP model-download microservice.

The only subpackage that imports the upstream checkout (found by ``_upstream.py``).
"""

from ._upstream import (
    AUTO_CLONE_ENV,
    CATALOG_WORKER,
    HOME_ENV,
    REF_ENV,
    UPSTREAM_REPO,
    bootstrap,
    clone_upstream,
    ensure_upstream,
    upstream_info,
    upstream_root,
    upstream_tag,
)
from .api import download, file, manager, registry, snapshot

__all__ = [
    "AUTO_CLONE_ENV",
    "CATALOG_WORKER",
    "HOME_ENV",
    "REF_ENV",
    "UPSTREAM_REPO",
    "bootstrap",
    "clone_upstream",
    "download",
    "ensure_upstream",
    "file",
    "manager",
    "registry",
    "snapshot",
    "upstream_info",
    "upstream_root",
    "upstream_tag",
]
