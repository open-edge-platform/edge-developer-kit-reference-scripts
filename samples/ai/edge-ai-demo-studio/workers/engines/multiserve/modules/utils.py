# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os
import subprocess  # nosec - disable B404:import-subprocess check
import json
import platform
import re
import shutil
import socket
import tempfile
import threading
from datetime import datetime
from typing import List
from pathlib import Path
import string
import queue
import time
from typing import Any, Callable, Dict, Iterable, Iterator, Optional, Tuple, TypeVar
from model_downloader import Source as ModelSource  # noqa: F401 - the workers' shared --source enum
from worker_common.paths import thirdparty_dir, workers_root

MAX_PATH_LENGTH = 4096

T = TypeVar("T")


# Model servers listen here; only this engine instance dials them.
LOOPBACK_HOST = "127.0.0.1"


def pick_free_loopback_port() -> int:
    """A TCP port free on 127.0.0.1 right now, for a model server about to start.

    Port 0 yields an ephemeral port (never TIME_WAIT, never in the app's engine-port range). Nothing
    holds it until the server binds, so callers retry when ``loopback_port_is_free`` says it was taken.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((LOOPBACK_HOST, 0))
        return int(sock.getsockname()[1])


def loopback_port_is_free(port: int) -> bool:
    """Whether nothing listens on or holds ``port`` on 127.0.0.1.

    TIME_WAIT leftovers don't count (SO_REUSEADDR), so a server that died while loading is told apart
    from one whose port another process took.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        try:
            probe.connect((LOOPBACK_HOST, port))
            return False
        except OSError:
            pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((LOOPBACK_HOST, port))
        except OSError:
            return False
        return True


class JSONLogger:
    def __init__(self, log_file_path, max_bytes: int = 20 * 1024 * 1024, backup_count: int = 2):
        self.log_file_path = log_file_path
        self.log_file = None
        self.lock = threading.Lock()
        self.max_bytes = max_bytes
        self.backup_count = backup_count
        self.bytes_written = 0

    def open_log_file(self):
        try:
            self.log_file = open(self.log_file_path, "w", encoding="utf-8")
            self.bytes_written = 0
        except OSError as e:
            raise RuntimeError(f"Failed to open log file {self.log_file_path}: {e}")

    def _rotate(self):
        # Called under self.lock, with self.log_file already closed.
        try:
            oldest = f"{self.log_file_path}.{self.backup_count}"
            if os.path.exists(oldest):
                os.remove(oldest)
            for i in range(self.backup_count - 1, 0, -1):
                src = f"{self.log_file_path}.{i}"
                if os.path.exists(src):
                    os.replace(src, f"{self.log_file_path}.{i + 1}")
            if os.path.exists(self.log_file_path):
                os.replace(self.log_file_path, f"{self.log_file_path}.1")
        except OSError:
            pass
        try:
            self.log_file = open(self.log_file_path, "w", encoding="utf-8")
            self.bytes_written = 0
        except OSError:
            self.log_file = None

    def log_message(self, message_type, message):
        if not message.strip():
            return

        timestamp = datetime.now().isoformat()
        log_entry = {
            "timestamp": timestamp,
            "type": message_type,
            "message": message.strip(),
        }

        with self.lock:
            if self.log_file and not self.log_file.closed:
                try:
                    line = json.dumps(log_entry) + "\n"
                    self.log_file.write(line)
                    self.log_file.flush()
                    self.bytes_written += len(line.encode("utf-8"))
                except Exception:
                    pass

                if self.bytes_written >= self.max_bytes:
                    self.log_file.close()
                    self._rotate()

    def close(self):
        with self.lock:
            if self.log_file and not self.log_file.closed:
                self.log_file.close()


#: Last line of every download stream: ``DOWNLOAD_RESULT {"ok": true}`` or ``{"ok": false, "error": ...}``.
#: Readers judge success from it alone (progress text may contain "error"); a stream without it was cut off.
DOWNLOAD_RESULT_PREFIX = "DOWNLOAD_RESULT "

#: Seconds a download may stay silent (hashing, converting, waiting on a lock) before a heartbeat line.
HEARTBEAT_SECONDS = 20.0


def download_result_line(ok: bool, error: Optional[str] = None) -> str:
    payload: Dict[str, Any] = {"ok": ok}
    if not ok:
        payload["error"] = error or "Download failed"
    # Leading newline: the line before may be a "\rProgress" line without one.
    return f"\n{DOWNLOAD_RESULT_PREFIX}{json.dumps(payload)}\n"


def iter_with_heartbeat(
    source: Iterable[T],
    heartbeat: Callable[[float], T],
    interval: float = HEARTBEAT_SECONDS,
) -> Iterator[T]:
    """``source`` plus ``heartbeat(elapsed_seconds)`` after each ``interval`` of silence.

    ``source`` runs on a helper thread so a long silent step can't hold the heartbeat back; its
    exceptions are re-raised here.
    """
    items: "queue.Queue[Tuple[str, Any]]" = queue.Queue()
    stop = threading.Event()

    def pump() -> None:
        iterator = iter(source)
        try:
            for item in iterator:
                items.put(("item", item))
                if stop.is_set():
                    close = getattr(iterator, "close", None)
                    if close is not None:
                        close()
                    return
        except BaseException as exc:  # handed to the consumer
            items.put(("error", exc))
            return
        items.put(("end", None))

    threading.Thread(target=pump, name="iter-with-heartbeat", daemon=True).start()
    started = time.monotonic()
    try:
        while True:
            try:
                kind, value = items.get(timeout=interval)
            except queue.Empty:
                yield heartbeat(time.monotonic() - started)
                continue
            if kind == "item":
                yield value
            elif kind == "error":
                raise value
            else:
                return
    finally:
        stop.set()


# Names that become files or folders. The models directory may be shared with a Windows install, so
# names Windows can't hold are refused up front rather than failing mid-write or being renamed.

_WINDOWS_FORBIDDEN_CHARS = frozenset('<>:"|?*')
_WINDOWS_RESERVED_NAMES = frozenset(
    ["CON", "PRN", "AUX", "NUL"]
    + [f"COM{i}" for i in range(1, 10)]
    + [f"LPT{i}" for i in range(1, 10)]
)
MAX_NAME_LENGTH = 255


def path_name_problem(name: str) -> Optional[str]:
    """Why ``name`` can't be a file or folder name on every supported platform, or ``None``."""
    if not name or name in (".", ".."):
        return "is empty or a relative path marker"
    if len(name) > MAX_NAME_LENGTH:
        return f"is longer than {MAX_NAME_LENGTH} characters"
    bad = sorted(
        {c for c in name if c in _WINDOWS_FORBIDDEN_CHARS or c in "/\\" or ord(c) < 32}
    )
    if bad:
        shown = " ".join(repr(c) if ord(c) >= 32 else f"\\x{ord(c):02x}" for c in bad)
        return f"contains characters not allowed in file names ({shown})"
    if name[-1] in ". ":
        return "ends with a dot or a space, which Windows drops"
    if name.split(".", 1)[0].rstrip(" ").upper() in _WINDOWS_RESERVED_NAMES:
        return "is a reserved device name on Windows"
    return None


def check_path_name(name: str, what: str) -> str:
    """``name`` if it is a valid file or folder name, else ``ValueError``."""
    problem = path_name_problem(name)
    if problem:
        raise ValueError(f"{what} '{name}' {problem}")
    return name


def check_repo_id(
    repo_id: str,
    what: str = "repo_id",
    exact_parts: Optional[int] = 2,
    example: str = "OpenVINO/Qwen3-8B-int4-ov",
) -> str:
    """A ``<Org>/<Model Name>`` id whose parts are each a valid folder name; ``exact_parts=None``
    accepts any number of parts (a hub id without an org)."""
    parts = (repo_id or "").split("/")
    if exact_parts is not None and len(parts) != exact_parts:
        raise ValueError(
            f"{what} must follow the '<Org>/<Model Name>' format (e.g. '{example}')"
        )
    for part in parts:
        check_path_name(part, f"{what} part")
    return repo_id


def stream_reader(stream, logger, message_type):
    try:
        for line in iter(stream.readline, ""):
            if line:
                logger.log_message(message_type, line)
    except Exception:
        pass
    finally:
        stream.close()


def get_resource_path(relative_path: str) -> str:
    if getattr(sys, "frozen", False):
        base_path = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    else:
        base_path = os.path.abspath(".")

    return str(Path(base_path) / relative_path)


IS_WINDOWS = os.name == "nt"
GGUF_PARSER = get_resource_path(
    ".\\engine\\gguf-parser-windows-amd64.exe" if IS_WINDOWS else "./engine/gguf-parser"
)
# Reads GPU memory: the GPU performance counters (workers/scripts/gpu-*.ps1) on Windows, qmassa
# (built by setup_thirdparty.sh) on Linux.
GPU_TOOL = "windows-performance-counters" if IS_WINDOWS else "qmassa"
# A GPU with this much memory of its own is discrete; an iGPU has a small carve-out at most.
DISCRETE_MIN_DEDICATED_BYTES = 1024**3


def qmassa_path() -> str | None:
    bundled = thirdparty_dir("qmassa", "bin", "qmassa")
    if bundled.is_file() and os.access(bundled, os.X_OK):
        return str(bundled)
    return shutil.which("qmassa")


def read_qmassa_devices() -> list[dict]:
    """The GPUs in one qmassa sample, as its JSON states them."""
    qmassa = qmassa_path()
    if not qmassa:
        raise FileNotFoundError("qmassa not found; setup_thirdparty.sh builds it.")
    with tempfile.TemporaryDirectory(prefix="qmassa-") as tmp:
        json_path = os.path.join(tmp, "stats.json")
        subprocess.run(
            [qmassa, "--no-tui", "--nr-iterations", "1", "--ms-interval", "0",
             "--to-json", json_path],
            capture_output=True, text=True, check=True, timeout=30,
        )
        with open(json_path, encoding="utf-8") as json_file:
            lines = json_file.read().splitlines()
    # A version line, an arguments line, then one state per sample.
    state = json.loads(lines[-1]) if len(lines) > 2 else {}
    return [dev for dev in state.get("devs_state", []) if isinstance(dev, dict)]


def _last_sample(series) -> dict:
    """The newest entry of a qmassa series (each keeps its last 40)."""
    return series[-1] if isinstance(series, list) and series else {}


def _mem_available_bytes() -> int:
    if IS_WINDOWS:
        import ctypes

        class MemoryStatus(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [
                (name, ctypes.c_ulonglong)
                for name in ("ullTotalPhys", "ullAvailPhys", "ullTotalPageFile", "ullAvailPageFile",
                             "ullTotalVirtual", "ullAvailVirtual", "ullAvailExtendedVirtual")
            ]

        status = MemoryStatus(dwLength=ctypes.sizeof(MemoryStatus))
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return 0
        return status.ullAvailPhys
    with open("/proc/meminfo", encoding="utf-8") as meminfo:
        for line in meminfo:
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) * 1024
    return 0


def _qmassa_clients_bytes(dev: dict, key: str) -> int:
    """What this user's processes, the ones qmassa can see, hold on `dev`."""
    return sum(
        int(_last_sample(client.get("mem_info")).get(key, 0))
        for client in dev.get("clis_stats", [])
    )


def _qmassa_memory_bytes(pci_dev: str) -> Tuple[int, int]:
    """Free and used memory, in bytes, of the GPU at PCI slot `pci_dev`."""
    dev = next((d for d in read_qmassa_devices() if d.get("pci_dev") == pci_dev), None)
    if dev is None:
        raise RuntimeError(f"qmassa did not report GPU {pci_dev}")
    mem = _last_sample(dev.get("dev_stats", {}).get("mem_info"))
    dev_type = dev.get("dev_type")
    if isinstance(dev_type, dict) and "Discrete" in dev_type:
        total = int(mem.get("vram_total", 0))
        # xe before Linux 6.18, and i915, tell only root the VRAM in use.
        used = int(mem.get("vram_used", 0)) or _qmassa_clients_bytes(dev, "vram_used")
        return max(total - used, 0), used
    # An iGPU has no VRAM: its buffers are in system RAM. i915 reports only
    # each process's share.
    used = int(mem.get("smem_used", 0)) or _qmassa_clients_bytes(dev, "smem_used")
    return _mem_available_bytes(), used


def get_gguf_parser_version():
    try:
        result = subprocess.run(
            [get_resource_path(GGUF_PARSER), "--version"],
            capture_output=True,
            text=True,
            check=True,
        )
        output = result.stdout.strip()
        match = re.search(r"v\d+\.\d+\.\d+", output)

        if match:
            return match.group(0)
        return "unknown"

    except FileNotFoundError:
        return "not found"


def get_gpu_tool_version():
    if IS_WINDOWS:
        # The counters come with Windows.
        return platform.version()
    qmassa = qmassa_path()
    if not qmassa:
        return "not found"
    try:
        result = subprocess.run(
            [qmassa, "--version"], capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    # "qmassa 2.2.0"
    return result.stdout.strip().removeprefix("qmassa ") or "unknown"


def _run_gpu_script(name: str, timeout: int):
    """The JSON that workers/scripts/<name> prints."""
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
         "-File", str(workers_root() / "scripts" / name)],
        capture_output=True, text=True, check=True, timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return json.loads(result.stdout or "null")


def _as_list(value) -> list:
    """ConvertTo-Json writes a lone item without its array."""
    if isinstance(value, list):
        return value
    return [] if value is None else [value]


def read_windows_adapters() -> list[dict]:
    """The GPUs and NPUs Windows lists, as workers/scripts/gpu-adapters.ps1 prints them."""
    adapters = _as_list(_run_gpu_script("gpu-adapters.ps1", timeout=60))
    return [a for a in adapters if isinstance(a, dict) and a.get("luid")]


_ADAPTER_MEMORY_INSTANCE = re.compile(r"^luid_(0x[0-9a-f]{8}_0x[0-9a-f]{8})_phys_\d+$", re.IGNORECASE)


def _windows_memory_bytes(luid: str) -> Optional[Tuple[int, int]]:
    """Free and used memory, in bytes, of the GPU with adapter LUID `luid`; None when Windows
    gives no memory sizes (PowerShell in constrained language mode)."""
    adapter = next((a for a in read_windows_adapters() if str(a["luid"]).lower() == luid), None)
    if adapter is None:
        raise RuntimeError(f"Windows lists no GPU {luid}")
    dedicated, shared = adapter.get("dedicatedBytes"), adapter.get("sharedBytes")
    if dedicated is None or shared is None:
        return None
    counters = _run_gpu_script("gpu-counters.ps1", timeout=30) or {}
    dedicated_used = shared_used = 0
    for item in _as_list(counters.get("adapters")):
        match = _ADAPTER_MEMORY_INSTANCE.match(str(item.get("name", "")))
        # A linked adapter has one instance per physical GPU.
        if match and match.group(1).lower() == luid:
            dedicated_used += int(item.get("dedicated") or 0)
            shared_used += int(item.get("shared") or 0)
    if dedicated >= DISCRETE_MIN_DEDICATED_BYTES:
        return max(dedicated - dedicated_used, 0), dedicated_used
    # An iGPU's buffers are in system RAM, up to the shared GPU memory Windows allows it.
    used = dedicated_used + shared_used
    free = dedicated + shared - used
    available_ram = _mem_available_bytes()
    if available_ram:
        free = min(free, available_ram)
    return max(free, 0), used


def optimize_context_size(
    model_path: str,
    model_max_context_size: int = 131072,
    context_steps: List[int] = [
        512,
        1024,
        2048,
        4096,
        8192,
        16384,
        32768,
        40960,
        65536,
        131072,
        262144,
        524288,
    ],
    bypass_oom: bool = False,
):
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found: {model_path}")

    if not IS_WINDOWS and not qmassa_path():
        # qmassa's build is optional: start with the context asked for.
        print("qmassa not found: context size not checked against free GPU memory.")
        return 0, False

    if os.sep in GGUF_PARSER and not os.path.exists(GGUF_PARSER):
        raise FileNotFoundError(f"Parser executable not found: {GGUF_PARSER}")

    print("-" * 65)
    print(f"Analyzing Model: {os.path.basename(model_path)}")
    print("-" * 65)
    try:
        devices = get_gpu_mapping()
        if not devices or devices[0].get("tool_id") is None:
            return 4096, False

        tool_id = str(devices[0]["tool_id"])
        if not tool_id:
            raise RuntimeError("No PCI address found for the first GPU device.")
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise RuntimeError(f"Failed to get GPU mapping: {e}")

    if IS_WINDOWS:
        try:
            memory = _windows_memory_bytes(tool_id)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Reading GPU memory from Windows failed: {e.stderr.strip()}")
        except Exception as e:
            raise RuntimeError(f"Unexpected error reading GPU memory from Windows: {e}")
        if memory is None:
            print("Windows gave no GPU memory size: context size not checked against free GPU memory.")
            return 0, False
        free_bytes, used_bytes = memory
    else:
        try:
            free_bytes, used_bytes = _qmassa_memory_bytes(tool_id)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"qmassa failed: {e.stderr.strip()}")
        except Exception as e:
            raise RuntimeError(f"Unexpected error reading GPU memory with qmassa: {e}")

    safety_buffer = 256 * 1024 * 1024
    available_bytes = free_bytes - safety_buffer
    if available_bytes < 0:
        available_bytes = 0

    print(f"Available Limit: {available_bytes / (1024**3):.2f} GiB")
    print(f"Currently Used:  {used_bytes / (1024**3):.2f} GiB")
    print("-" * 65)
    print(f"{'Context':<10} | {'Required (GiB)':<15} | {'Status'}")
    print("-" * 65)

    oom = True
    best_context = 0
    startupinfo = None
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

    for ctx in context_steps:
        if ctx > model_max_context_size:
            break

        cmd = [GGUF_PARSER, "-m", model_path, "--estimate", "--json", "-c", str(ctx)]

        try:
            res = subprocess.run(
                cmd, capture_output=True, text=True, check=True, startupinfo=startupinfo
            )
            data = json.loads(res.stdout)

            try:
                req_bytes = data["estimate"]["items"][0]["vrams"][0]["nonuma"]
            except (KeyError, IndexError):
                raise RuntimeError(
                    f"Parser JSON output missing expected fields for context {ctx}."
                )

            req_gib = req_bytes / (1024**3)

            if req_bytes <= available_bytes:
                status = "PASS"
                best_context = ctx
                oom = False
            else:
                if bypass_oom:
                    status = "SKIP OOM CHECK"
                    oom = False
                else:
                    status = "FAIL (OOM)"
                    oom = True

            print(f"{ctx:<10} | {req_gib:<15.2f} | {status}")

        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"GGUF Parser crashed for context {ctx}: {e.stderr.strip()}"
            )
        except json.JSONDecodeError:
            raise ValueError(f"GGUF Parser returned invalid JSON for context {ctx}.")
        except Exception as e:
            raise RuntimeError(
                f"Unexpected error during parsing for context {ctx}: {e}"
            )

    print("-" * 65)

    if best_context > 0:
        print(f"Recommended: {best_context}")
    else:
        print("Recommended: None (Model too large)")

    return best_context, oom


def validate_and_sanitize_dir(cache_dir: str) -> str:
    if not cache_dir or not isinstance(cache_dir, str):
        raise ValueError("Invalid model cache directory: must be a valid string path")
    try:
        cache_dir = os.path.expanduser(cache_dir)
        cache_dir = os.path.abspath(cache_dir)

        cache_path = Path(cache_dir).resolve()
        cache_dir = str(cache_path)
    except (OSError, ValueError) as e:
        raise ValueError(f"Invalid model cache directory path: {e}")

    if ".." in cache_dir:
        raise ValueError(
            "Model cache directory cannot contain '..' (directory traversal)"
        )

    if len(cache_dir) > MAX_PATH_LENGTH:
        raise ValueError("Model cache directory path is too long (>4096 characters)")

    valid_chars = string.ascii_letters + string.digits + "/-._~" + os.sep
    if os.name == "nt":
        valid_chars += ":"
    if not all(c in valid_chars for c in cache_dir):
        raise ValueError("Model cache directory contains invalid characters")

    return cache_dir


def _get_command_output(command):
    try:
        use_shell = sys.platform == "win32"
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="ignore",
            shell=use_shell,
        )
        return result.stdout
    except Exception:
        return None


def normalize_id(id_str):
    s = id_str.strip().lower()
    if s.startswith("0x"):
        return s.replace("0x", "")
    if s.isdigit():
        try:
            return f"{int(s):x}"
        except:
            pass
    return s


def get_vulkan_devices_ordered():
    cmd = ["vulkaninfo"]
    out = _get_command_output(cmd)
    if not out and sys.platform == "win32":
        sdk_path = r"C:\VulkanSDK\Bin\vulkaninfo.exe"
        if os.path.exists(sdk_path):
            out = _get_command_output([sdk_path])

    if not out:
        return []

    devices = []
    current_device = {}

    for line in out.splitlines():
        line = line.strip()

        if line.startswith("deviceName"):
            val = line.split("=")[1].strip()
            if "name" in current_device:
                devices.append(current_device)
                current_device = {}

            current_device["name"] = val

        elif line.startswith("deviceID"):
            val = line.split("=")[1].strip()

            if "id_hex" in current_device:
                devices.append(current_device)
                current_device = {}

            current_device["id_hex"] = normalize_id(val)

    if current_device:
        devices.append(current_device)

    valid_devices = []
    idx_counter = 0
    for d in devices:
        if "name" in d or "id_hex" in d:
            d["physical_index"] = idx_counter
            valid_devices.append(d)
            idx_counter += 1

    return valid_devices


def get_windows_gpu_map():
    """PCI device ID -> adapter LUID, e.g. "e20b" -> "0x00000000_0x00009c2b"."""
    try:
        adapters = read_windows_adapters()
    except (OSError, subprocess.SubprocessError, ValueError, RuntimeError):
        return {}
    return {
        normalize_id(f"0x{adapter['pciDeviceId']}"): str(adapter["luid"]).lower()
        for adapter in adapters
        if adapter.get("kind") == "gpu" and adapter.get("pciDeviceId")
    }


def get_qmassa_map():
    """PCI device ID -> PCI slot, e.g. "e211" -> "0000:04:00.0"."""
    try:
        devices = read_qmassa_devices()
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}
    mapping = {}
    for dev in devices:
        # "8086:E211"; 0x so normalize_id reads an all-digit ID as hex.
        _, _, device_id = str(dev.get("pci_id", "")).partition(":")
        if device_id and dev.get("pci_dev"):
            mapping[normalize_id(f"0x{device_id}")] = dev["pci_dev"]
    return mapping


def get_gpu_mapping():
    vk_devices = get_vulkan_devices_ordered()
    tool_map = get_windows_gpu_map() if IS_WINDOWS else get_qmassa_map()

    visible_env = os.environ.get("GGML_VK_VISIBLE_DEVICES", "")
    final_vk_list = []

    if visible_env.strip():
        try:
            visible_indices = [
                int(x.strip()) for x in visible_env.split(",") if x.strip().isdigit()
            ]
            for filtered_idx in visible_indices:
                if filtered_idx < len(vk_devices):
                    final_vk_list.append(vk_devices[filtered_idx])
        except ValueError:
            final_vk_list = vk_devices
    else:
        final_vk_list = vk_devices

    output_list = []

    for llama_idx, vk_dev in enumerate(final_vk_list):
        hex_id = vk_dev.get("id_hex", "")
        # The GPU tool's ID: the adapter LUID on Windows, qmassa's PCI slot on Linux.
        tool_id = tool_map.get(hex_id)

        output_list.append(
            {
                "llama_index": llama_idx,
                "gpu_name": vk_dev.get("name", "Unknown"),
                "device_id_hex": f"0x{hex_id}",
                "tool_id": tool_id,
                "supported": (tool_id is not None),
            }
        )

    return output_list

def check_exe_output(args, keyword):
    try:
        result = subprocess.run(args, capture_output=True, text=True, check=True)
        output = result.stdout + result.stderr
        
        if keyword in output:
            return True, output.strip()
        return False, output.strip()
    
    except subprocess.CalledProcessError as e:
        return False, f"Error running exe: {e}"
