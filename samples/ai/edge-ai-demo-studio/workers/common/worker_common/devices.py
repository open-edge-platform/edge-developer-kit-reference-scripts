# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Device discovery shared by the workers, so they all report devices the same way.

The default OpenVINO device is ``AUTO`` (dGPU, then iGPU, then CPU; an NPU only when named). Workers pass
it through as is: per-device options go through :func:`openvino_compile_config`, and
:func:`openvino_execution_device` reads back the device OpenVINO picked. ``openvino`` and ``torch`` are
imported lazily, so the module imports in an environment with neither.
"""

from __future__ import annotations

import functools
import logging
import platform
from typing import Any

__all__ = [
    "AUTO_DEVICE",
    "OPENVINO_DEVICE_TYPES",
    "default_openvino_device",
    "normalize_openvino_device",
    "openvino_compile_config",
    "openvino_core",
    "openvino_device_type",
    "openvino_devices",
    "openvino_execution_device",
    "openvino_pinned_cpu_config",
    "pinned_cpu_threads",
    "resolve_torch_device",
    "torch_devices",
]

logger = logging.getLogger(__name__)

#: OpenVINO's automatic device selection: OpenVINO picks the device.
AUTO_DEVICE = "AUTO"
#: The entry :func:`openvino_devices` lists for it.
_AUTO_ENTRY = {"name": AUTO_DEVICE, "full_name": "Automatic (OpenVINO selects the device)", "type": "AUTO"}

#: OpenVINO device name prefix -> the type the UI groups by.
OPENVINO_DEVICE_TYPES = {"GPU": "GPU", "NPU": "NPU", "AUTO": "AUTO"}
_DEFAULT_DEVICE_TYPE = "CPU"


# ── OpenVINO ──────────────────────────────────────────────────────────


@functools.lru_cache(maxsize=None)
def openvino_core() -> Any:
    """The process-wide ``openvino.Core``, created on first use (more would only cost plugin load time)."""
    import openvino as ov

    return ov.Core()


def openvino_device_type(name: str) -> str:
    """``GPU``, ``NPU``, ``AUTO`` or ``CPU`` for a device name such as ``GPU.1``."""
    upper = name.upper()
    for prefix, device_type in OPENVINO_DEVICE_TYPES.items():
        if upper.startswith(prefix):
            return device_type
    return _DEFAULT_DEVICE_TYPE


def openvino_devices(*, include_auto: bool = True) -> list[dict[str, Any]]:
    """The OpenVINO devices on this machine (``name``, ``full_name``, ``type``), the virtual ``AUTO`` first.

    When OpenVINO cannot be queried the physical list is a lone CPU entry, so a worker still starts.
    """
    devices = [dict(_AUTO_ENTRY)] if include_auto else []
    try:
        core = openvino_core()
        physical = []
        for name in core.available_devices:
            try:
                full_name = core.get_property(name, "FULL_DEVICE_NAME")
            except Exception:  # noqa: BLE001 - property missing on some plugins
                full_name = name
            physical.append(
                {"name": name, "full_name": str(full_name), "type": openvino_device_type(name)}
            )
        logger.info(
            "[DEVICE] Available: %s",
            ", ".join(f"{d['name']} ({d['full_name']})" for d in physical),
        )
        return devices + physical
    except Exception as exc:  # noqa: BLE001 - no OpenVINO, or a broken driver
        logger.warning("[DEVICE] Could not query OpenVINO devices: %s", exc)
        return devices + [{"name": "CPU", "full_name": "CPU (fallback)", "type": "CPU"}]


def default_openvino_device() -> str:
    """The device an OpenVINO worker uses when the user has not chosen one: ``AUTO``."""
    return AUTO_DEVICE


def normalize_openvino_device(
    device: str | None,
    *,
    supported: tuple[str, ...] = ("AUTO", "CPU", "GPU", "NPU"),
    default: str = "AUTO",
) -> str:
    """Upper-case an OpenVINO device name, keeping any index (``GPU.1``); ValueError if unsupported."""
    if not device or not device.strip():
        return default
    cleaned = device.strip()
    base, dot, index = cleaned.partition(".")
    base = base.upper()
    if base not in supported:
        raise ValueError(
            f"Unsupported device '{device}'. Must be one of {sorted(supported)} "
            "(optionally with an index, e.g. 'GPU.1')."
        )
    return f"{base}.{index}" if dot else base


def _pinned_core_count(process_mask: int, system_mask: int, core_masks: list[int]) -> int | None:
    """Physical cores with a logical CPU in ``process_mask``; ``None`` when the process is not pinned."""
    if not process_mask or process_mask == system_mask:
        return None  # unpinned (a zero mask: threads in several processor groups)
    return sum(1 for mask in core_masks if mask & process_mask) or None


@functools.lru_cache(maxsize=None)
def pinned_cpu_threads() -> int | None:
    """The CPU thread count for OpenVINO when this process is pinned on Windows, else ``None``.

    OpenVINO on Windows sizes its CPU threads from the whole machine and ignores the affinity mask
    (cpuAffinity, run-pinned.ps1): pinned to 8 E-cores of a Core Ultra X7 358H it still ran 4 threads,
    and pinned to 2 it ran 4 on them. On Linux it reads the mask and runs one thread per pinned core.
    """
    if platform.system() != "Windows":
        return None
    import ctypes
    from ctypes import wintypes

    class ProcessorInfo(ctypes.Structure):  # SYSTEM_LOGICAL_PROCESSOR_INFORMATION
        _fields_ = [
            ("mask", ctypes.c_size_t), ("relationship", ctypes.c_int), ("union", ctypes.c_ulonglong * 2)
        ]

    relation_processor_core = 0
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.GetProcessAffinityMask.argtypes = [
        wintypes.HANDLE, ctypes.POINTER(ctypes.c_size_t), ctypes.POINTER(ctypes.c_size_t)
    ]
    process_mask, system_mask, size = ctypes.c_size_t(), ctypes.c_size_t(), wintypes.DWORD(0)
    kernel32.GetLogicalProcessorInformation(None, ctypes.byref(size))
    infos = (ProcessorInfo * (size.value // ctypes.sizeof(ProcessorInfo)))()
    process = kernel32.GetCurrentProcess()
    if not (
        kernel32.GetProcessAffinityMask(process, ctypes.byref(process_mask), ctypes.byref(system_mask))
        and kernel32.GetLogicalProcessorInformation(infos, ctypes.byref(size))
    ):
        error = ctypes.WinError(ctypes.get_last_error())
        logger.warning("[DEVICE] Could not read the CPU affinity: %s", error)
        return None
    threads = _pinned_core_count(
        process_mask.value, system_mask.value,
        [info.mask for info in infos if info.relationship == relation_processor_core],
    )
    if threads:
        logger.info("[DEVICE] Pinned to CPU mask 0x%X: OpenVINO CPU threads %d", process_mask.value, threads)
    return threads


def openvino_pinned_cpu_config() -> dict[str, Any]:
    """:func:`pinned_cpu_threads` as ``DEVICE_PROPERTIES``, ``{}`` when unpinned.

    OpenVINO applies the CPU entry only when it compiles for the CPU, so this suits a compile on any
    device, and an OVMS graph's ``plugin_config``.
    """
    threads = pinned_cpu_threads()
    return {"DEVICE_PROPERTIES": {"CPU": {"INFERENCE_NUM_THREADS": threads}}} if threads else {}


def openvino_compile_config(device: str, gpu: dict[str, Any] | None = None) -> dict[str, Any]:
    """``compile_model`` properties for ``device``, with ``gpu`` for a GPU only.

    A CPU gets one thread per pinned core when the process is pinned on Windows (see
    :func:`pinned_cpu_threads`). ``AUTO`` gets both under ``DEVICE_PROPERTIES`` and its CPU
    fallbacks off: with startup fallback on, the first inferences run on the CPU while the device compiles
    (skewing warm-up timings and :func:`openvino_execution_device`), and with either on a stateful model's
    ``reset_state()`` raises.
    """
    threads = pinned_cpu_threads()
    cpu = {"INFERENCE_NUM_THREADS": threads} if threads else {}
    kind = openvino_device_type(device.split(":", 1)[0])
    if kind == AUTO_DEVICE:
        config: dict[str, Any] = {"ENABLE_STARTUP_FALLBACK": False, "ENABLE_RUNTIME_FALLBACK": False}
        properties = {name: dict(props) for name, props in (("GPU", gpu), ("CPU", cpu)) if props}
        if properties:
            config["DEVICE_PROPERTIES"] = properties
        return config
    if kind == "GPU":
        return dict(gpu) if gpu else {}
    return cpu if device.strip().upper() == "CPU" else {}


def openvino_execution_device(compiled: Any, default: str = "") -> str:
    """The device a compiled model runs on (for ``AUTO``, the one OpenVINO chose), else ``default``."""
    try:
        devices = compiled.get_property("EXECUTION_DEVICES")
        # Most plugins report a list; the NPU (NPUW) reports a plain string.
        if isinstance(devices, str):
            return devices or default
        return ",".join(str(d) for d in devices) or default
    except Exception:  # noqa: BLE001 - a plugin without the property
        return default


# ── torch (XPU) ───────────────────────────────────────────────────────


def _cpu_name() -> str:
    try:
        return str(openvino_core().get_property("CPU", "FULL_DEVICE_NAME"))
    except Exception:  # noqa: BLE001 - no OpenVINO in this environment
        return platform.processor() or "CPU"


def torch_devices() -> list[dict[str, str]]:
    """The devices a torch worker can run on: ``cpu`` plus every ``xpu:N``, with display names."""
    devices = [{"id": "cpu", "name": _cpu_name()}]
    try:
        import torch

        if hasattr(torch, "xpu") and torch.xpu.is_available():
            for index in range(torch.xpu.device_count()):
                devices.append({"id": f"xpu:{index}", "name": torch.xpu.get_device_name(index)})
    except Exception as exc:  # noqa: BLE001 - torch missing or the XPU runtime broken
        logger.warning("[DEVICE] Could not query torch XPU devices: %s", exc)
    return devices


def resolve_torch_device(requested: str | None = "auto") -> str:
    """Turn a ``--device`` value into a torch device; ``auto`` picks ``xpu`` when present, else ``cpu``.

    A missing ``xpu``/``xpu:N`` falls back to ``cpu`` with a warning, so a stale setting never crashes.
    """
    value = (requested or "auto").strip().lower()
    try:
        import torch

        xpu_available = bool(getattr(torch, "xpu", None) and torch.xpu.is_available())
        xpu_count = torch.xpu.device_count() if xpu_available else 0
    except Exception:  # noqa: BLE001
        xpu_available, xpu_count = False, 0

    if value == "auto":
        return "xpu" if xpu_available else "cpu"
    if value.startswith("xpu"):
        if not xpu_available:
            logger.warning("[DEVICE] XPU not available, falling back to CPU")
            return "cpu"
        _, _, index = value.partition(":")
        if index:
            if index.isdigit() and int(index) < xpu_count:
                return f"xpu:{index}"
            logger.warning("[DEVICE] XPU %s not available, falling back to CPU", index)
            return "cpu"
        return "xpu"
    return "cpu"
