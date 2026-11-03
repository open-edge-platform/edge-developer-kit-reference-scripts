# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Model fetching shared by every Demo Studio worker.

Backends: :mod:`.oep` (Hugging Face and other upstream plugins, through the OEP model-download
microservice used as a module), :mod:`.modelscope`, :mod:`.http` (single HTTPS files and Open Model
Zoo IR pairs) and :mod:`.ovms` (``ovms --pull``). ``source`` is ``huggingface`` or ``modelscope``
(a string or an enum); every helper is idempotent and returns the local path.
"""

from . import http, modelscope, oep, ovms
from .api import fetch_file, fetch_snapshot, file_size
from .errors import (
    ModelDownloadError,
    OvmsBusyError,
    OvmsError,
    OvmsNotFoundError,
    UpstreamMissingError,
)
from .http import OMZ_STORAGE_URL, fetch_omz_ir, fetch_url
from .oep import (
    AUTO_CLONE_ENV,
    HOME_ENV,
    REF_ENV,
    UPSTREAM_REPO,
    bootstrap,
    clone_upstream,
    download,
    ensure_upstream,
    manager,
    registry,
    upstream_info,
    upstream_root,
    upstream_tag,
)
from .ovms import OvmsEnv, OvmsPuller, ovms_env
from .ovms import pull as ovms_pull
from .sources import Source, hf_endpoint_for_source, hub_for_source, normalize_source

__version__ = "0.1.0"

__all__ = [
    "AUTO_CLONE_ENV",
    "HOME_ENV",
    "OMZ_STORAGE_URL",
    "REF_ENV",
    "UPSTREAM_REPO",
    "ModelDownloadError",
    "OvmsBusyError",
    "OvmsEnv",
    "OvmsError",
    "OvmsNotFoundError",
    "OvmsPuller",
    "Source",
    "UpstreamMissingError",
    "bootstrap",
    "clone_upstream",
    "download",
    "ensure_upstream",
    "fetch_file",
    "fetch_omz_ir",
    "fetch_snapshot",
    "fetch_url",
    "file_size",
    "hf_endpoint_for_source",
    "http",
    "hub_for_source",
    "manager",
    "modelscope",
    "normalize_source",
    "oep",
    "ovms",
    "ovms_env",
    "ovms_pull",
    "registry",
    "upstream_info",
    "upstream_root",
    "upstream_tag",
]
