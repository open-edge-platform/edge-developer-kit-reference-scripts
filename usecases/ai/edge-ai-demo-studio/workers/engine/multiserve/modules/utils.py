# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os
import subprocess  # nosec - disable B404:import-subprocess check
import json
import re
import shutil
import threading
from datetime import datetime
from typing import List
from pathlib import Path
import string
from enum import Enum


class ModelSource(Enum):
    HUGGINGFACE = "huggingface"
    MODELSCOPE = "modelscope"

MAX_PATH_LENGTH = 4096


def extract_json_from_output(output: str):
    if not output:
        raise json.JSONDecodeError("Empty output", output or "", 0)
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        start = output.find(start_char)
        if start == -1:
            continue
        end = output.rfind(end_char)
        if end == -1 or end < start:
            continue
        return json.loads(output[start : end + 1])
    raise json.JSONDecodeError("No JSON object or array found in output", output, 0)


class JSONLogger:
    def __init__(self, log_file_path):
        self.log_file_path = log_file_path
        self.log_file = None
        self.lock = threading.Lock()

    def open_log_file(self):
        try:
            self.log_file = open(self.log_file_path, "w", encoding="utf-8")
        except OSError as e:
            raise RuntimeError(f"Failed to open log file {self.log_file_path}: {e}")

    def log_message(self, message_type, message):
        if not message.strip():  # Skip empty messages
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
                    self.log_file.write(json.dumps(log_entry) + "\n")
                    self.log_file.flush()
                except Exception:
                    pass

    def close(self):
        with self.lock:
            if self.log_file and not self.log_file.closed:
                self.log_file.close()


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
XPU_SMI_PATH = (
    (get_resource_path(".\\engine\\xpu-smi\\xpu-smi.exe")) if IS_WINDOWS else "xpu-smi"
)


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


def get_xpu_version():
    try:
        result = subprocess.run(
            [XPU_SMI_PATH, "--version"], capture_output=True, text=True, check=True
        )
        output = result.stdout
        pattern = r"CLI:\s+Version:\s+(?P<version>[\d\.]+)\s+Build ID:\s+(?P<build>\w+)"

        match = re.search(pattern, output, re.MULTILINE)

        if match:
            return f"{match.group("version")}-{match.group("build")}"
        return "unknown"

    except FileNotFoundError:
        return "not found"


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

    if not shutil.which(XPU_SMI_PATH):
        raise FileNotFoundError("Intel 'xpu-smi' tool not found in PATH.")

    if os.sep in GGUF_PARSER and not os.path.exists(GGUF_PARSER):
        raise FileNotFoundError(f"Parser executable not found: {GGUF_PARSER}")

    def find_key(obj, target_key):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == target_key:
                    return v
                found = find_key(v, target_key)
                if found is not None:
                    return found
        elif isinstance(obj, list):
            for item in obj:
                found = find_key(item, target_key)
                if found is not None:
                    return found
        return None

    print("-" * 65)
    print(f"Analyzing Model: {os.path.basename(model_path)}")
    print("-" * 65)
    try:
        devices = get_gpu_mapping()
        if not devices or devices[0].get("xpu_id") is None:
            return 4096, False
            # raise RuntimeError("No valid XPU device found for memory usage check.")

        xpu_id = str(devices[0]["xpu_id"])
        if not xpu_id:
            raise RuntimeError("No PCI address found for the first GPU device.")
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise RuntimeError(f"Failed to get GPU mapping: {e}")

    try:

        res = subprocess.run(
            [XPU_SMI_PATH, "discovery", "-d", xpu_id, "-j"],
            capture_output=True,
            text=True,
            check=True,
        )
        discovery_data = extract_json_from_output(res.stdout)

        val = find_key(discovery_data, "memory_free_size_byte")
        if val is None:
            raise RuntimeError(
                "xpu-smi discovery did not return 'memory_free_size_byte'"  # max_mem_alloc_size_byte does not work for ARL/MTL
            )
        free_bytes = int(val)

    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"xpu-smi discovery failed: {e.stderr.strip()}")
    except json.JSONDecodeError:
        raise ValueError("Failed to parse xpu-smi discovery JSON output.")
    except Exception as e:
        raise RuntimeError(f"Unexpected error during xpu-smi discovery: {e}")

    used_bytes = 0
    try:
        res = subprocess.run(
            [XPU_SMI_PATH, "stats", "-d", xpu_id, "-j"],
            capture_output=True,
            text=True,
            check=True,
        )
        stats_data = extract_json_from_output(res.stdout)
        device_level = (
            stats_data.get("device_level", [])
            if isinstance(stats_data, dict)
            else stats_data[0].get("device_level", [])
        )

        found_metric = False
        for metric in device_level:
            if metric.get("metrics_type") == "XPUM_STATS_MEMORY_USED":
                used_bytes = int(metric.get("value", 0) * 1024 * 1024)
                found_metric = True
                break

        if not found_metric:
            raise RuntimeError(
                "Could not find 'XPUM_STATS_MEMORY_USED' in xpu-smi output."
            )

    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"xpu-smi stats failed: {e.stderr.strip()}")
    except json.JSONDecodeError:
        raise ValueError("Failed to parse xpu-smi stats JSON output.")
    except Exception as e:
        raise RuntimeError(f"Unexpected error during xpu-smi stats: {e}")

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

    allowed_base_dirs = [
        os.path.expanduser("~"),
        "/tmp",
        "/var/cache",
        "/opt",
        "/mnt",
    ]

    path_is_allowed = False
    for allowed_base in allowed_base_dirs:
        try:
            allowed_resolved = Path(allowed_base).resolve()
            try:
                if Path(cache_dir).resolve().is_relative_to(allowed_resolved):
                    path_is_allowed = True
                    break
            except AttributeError:  # Fallback for Python < 3.9
                if str(allowed_resolved) in str(Path(cache_dir).resolve()):
                    if (
                        Path(cache_dir).resolve().parts[: len(allowed_resolved.parts)]
                        == allowed_resolved.parts
                    ):
                        path_is_allowed = True
                        break
        except (OSError, ValueError):
            continue

    if not path_is_allowed:
        raise ValueError(
            f"Model cache directory must be within allowed locations: {allowed_base_dirs}. "
            f"Attempted path: {cache_dir}"
        )

    sensitive_paths = [
        "/etc",
        "/usr",
        "/bin",
        "/sbin",
        "/boot",
        "/sys",
        "/proc",
        "/dev",
        "/root",
    ]
    if any(cache_dir.startswith(sensitive) for sensitive in sensitive_paths):
        raise ValueError(
            f"Invalid model cache directory: {cache_dir} points to a sensitive system directory"
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


def get_xpu_smi_map():
    """Parses xpu-smi JSON output."""
    cmd = ["xpu-smi", "discovery", "-j"]
    out = _get_command_output(cmd)

    if not out or "device_list" not in out:
        if sys.platform == "win32":
            local_path = get_resource_path(r".\engine\xpu-smi\xpu-smi.exe")
            if os.path.exists(local_path):
                out = _get_command_output([local_path, "discovery", "-j"])

    mapping = {}
    if out:
        try:
            data = extract_json_from_output(out)
            if "device_list" in data:
                for dev in data["device_list"]:
                    # map "0xe20b" -> 1
                    raw_hex = dev.get("pci_device_id", "")
                    xpu_target = dev.get("device_id")

                    if raw_hex and xpu_target is not None:
                        norm = normalize_id(str(raw_hex))
                        mapping[norm] = int(xpu_target)
        except:
            pass
    return mapping


def get_gpu_mapping():
    vk_devices = get_vulkan_devices_ordered()
    xpu_map = get_xpu_smi_map()

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
        xpu_id = xpu_map.get(hex_id)

        output_list.append(
            {
                "llama_index": llama_idx,
                "gpu_name": vk_dev.get("name", "Unknown"),
                "device_id_hex": f"0x{hex_id}",
                "xpu_id": xpu_id,
                "supported": (xpu_id is not None),
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
