# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Shared runtime helpers for Edge AI Studio workers.

Owns the skeleton every worker repeats (FastAPI app with CORS, lifespan, /healthcheck, argparse,
uvicorn.run honouring SERVER_HOST/SERVER_PORT), so a worker's main.py only describes what differs.
"""

from worker_common.app import cors_origins, create_app
from worker_common.audio import (
    add_ffmpeg_to_path,
    configure_pydub,
    ffmpeg_bin_dir,
    ffmpeg_binary,
    ffprobe_binary,
    transcode_wav,
)
from worker_common.cancel import CANCELLED, CancelToken, JobCancelled
from worker_common.cli import SOURCES, base_parser, serve
from worker_common.devices import (
    AUTO_DEVICE,
    default_openvino_device,
    normalize_openvino_device,
    openvino_compile_config,
    openvino_core,
    openvino_devices,
    openvino_execution_device,
    openvino_pinned_cpu_config,
    pinned_cpu_threads,
    resolve_torch_device,
    torch_devices,
)
from worker_common.instance import (
    add_instance_args,
    async_shared_model_lock,
    instance_data_dir,
    instance_id,
    instance_key,
    resolve_service_address,
    service_base_url,
    shared_model_lock,
    staged_model_file,
    studio_address,
    studio_url,
    with_instance_header,
)
from worker_common.log import get_logger
from worker_common.net import lan_origins, local_ip
from worker_common.openai_compat import (
    SPEECH_RESPONSE_FORMATS,
    install_models_routes,
    install_openai_errors,
    model_object,
    openai_error_body,
    override_api_route,
    pydub_export_kwargs,
    speech_media_type,
)
from worker_common.ovms import OvmsServer, model_ready_url, startup_timeout
from worker_common.perf import server_timing, timed
from worker_common.proxy import ensure_loopback_no_proxy, loopback_opener
from worker_common.sse import sse_event, sse_response, watch_status
from worker_common.paths import (
    hf_home,
    migrate_legacy_models_dir,
    models_dir,
    project_root,
    thirdparty_dir,
    use_shared_hf_cache,
    workers_root,
    workers_thirdparty_dir,
)

# Before any HTTP client reads the environment, so loopback calls never go through http_proxy.
ensure_loopback_no_proxy()

__all__ = [
    "add_ffmpeg_to_path",
    "add_instance_args",
    "async_shared_model_lock",
    "AUTO_DEVICE",
    "base_parser",
    "CANCELLED",
    "CancelToken",
    "configure_pydub",
    "cors_origins",
    "create_app",
    "default_openvino_device",
    "ensure_loopback_no_proxy",
    "ffmpeg_bin_dir",
    "ffmpeg_binary",
    "ffprobe_binary",
    "JobCancelled",
    "get_logger",
    "hf_home",
    "install_models_routes",
    "install_openai_errors",
    "instance_data_dir",
    "instance_id",
    "instance_key",
    "lan_origins",
    "local_ip",
    "loopback_opener",
    "migrate_legacy_models_dir",
    "model_object",
    "model_ready_url",
    "models_dir",
    "normalize_openvino_device",
    "openai_error_body",
    "openvino_compile_config",
    "openvino_core",
    "openvino_devices",
    "openvino_execution_device",
    "openvino_pinned_cpu_config",
    "override_api_route",
    "OvmsServer",
    "pinned_cpu_threads",
    "project_root",
    "pydub_export_kwargs",
    "resolve_service_address",
    "resolve_torch_device",
    "serve",
    "startup_timeout",
    "server_timing",
    "service_base_url",
    "shared_model_lock",
    "SOURCES",
    "staged_model_file",
    "speech_media_type",
    "SPEECH_RESPONSE_FORMATS",
    "sse_event",
    "sse_response",
    "studio_address",
    "studio_url",
    "thirdparty_dir",
    "timed",
    "torch_devices",
    "transcode_wav",
    "use_shared_hf_cache",
    "watch_status",
    "with_instance_header",
    "workers_root",
    "workers_thirdparty_dir",
]
