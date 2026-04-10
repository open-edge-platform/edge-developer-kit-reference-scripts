# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import requests
import subprocess  # nosec - disable B404:import-subprocess check
import time
import os
import threading
import platform
import shutil
import signal

os.environ["no_proxy"] = "localhost,127.0.0.1"
os.environ["NO_PROXY"] = "localhost,127.0.0.1"

import json
import re
import os
import sys

from pathlib import Path
from typing import Optional, Dict, Any, Tuple

from modules.utils import (
    get_resource_path,
    optimize_context_size,
    get_gguf_parser_version,
    get_xpu_version,
    JSONLogger,
    stream_reader,
    check_exe_output
)
from .gguf_downloader import GGUFDownloader
import os

FORCE_LLAMACPP_BACKEND = os.getenv("FORCE_LLAMACPP_BACKEND", "vulkan")
LAYERS_OFFLOAD_PERCENT = os.getenv("LAYERS_OFFLOAD_PERCENT", 1.0)


class LlamaCPPManager:
    IS_WINDOWS = os.name == "nt"
    GGUF_PARSER_EXECUTABLE = (
        ".\\engine\\gguf-parser-windows-amd64.exe"
        if IS_WINDOWS
        else "./engine/gguf-parser"
    )
    BACKEND = "vulkan"

    SERVER_PORTS = {
        "text_generation": 9090,
        "embeddings": 9091,
        "rerank": 9092,
        "multimodal": 9093,
    }

    config_file = None

    def __init__(
        self,
        downloader: GGUFDownloader,
        models_base_dir: str = "models",
        logs_dir: str = "logs",
        server_port: int = 9000,
        backend: str = "vulkan",
    ):
        is_vulkan_exists = False
        for backend in ["vulkan", "sycl"]:
            if is_vulkan_exists:
                break

            executable = (
                f".\\engine\\llama.cpp-{backend}\\llama-server.exe"
                if self.IS_WINDOWS
                else f"./engine/llama.cpp-{backend}/llama-server"
            )
            if Path(get_resource_path(executable)).exists():
                self.SERVER_EXECUTABLE = executable
                self.CUSTOM_SERVER_EXECUTABLE = executable
                self.BACKEND = backend
                is_vulkan_exists = backend == "vulkan"

        if self.BACKEND != FORCE_LLAMACPP_BACKEND:
            executable = (
                f".\\engine\\llama.cpp-{FORCE_LLAMACPP_BACKEND}\\llama-server.exe"
                if self.IS_WINDOWS
                else f"./engine/llama.cpp-{FORCE_LLAMACPP_BACKEND}/llama-server"
            )
            if Path(get_resource_path(executable)).exists():
                self.BACKEND = FORCE_LLAMACPP_BACKEND

        llama_cpp_exe_name = "llama-server.exe" if self.IS_WINDOWS else "llama-server"
        llama_cpp_resolved_path = shutil.which(llama_cpp_exe_name)
        llama_cpp_custom_exe = (
            Path(llama_cpp_resolved_path) if llama_cpp_resolved_path else None
        )

        if not llama_cpp_custom_exe:
            default_dir = (
                Path("C:\\llama.cpp") if self.IS_WINDOWS else Path("/opt/llama.cpp")
            )
            fallback_path = default_dir / llama_cpp_exe_name
            if fallback_path.exists():
                llama_cpp_custom_exe = fallback_path

        if llama_cpp_custom_exe:
            self.CUSTOM_SERVER_EXECUTABLE = llama_cpp_custom_exe
            self.BACKEND = self.get_llama_server_backend_type()

            # Phison Custom Config 
            found, _ = check_exe_output([llama_cpp_custom_exe, "--version"], "aiDAPTIV")
            if found:
                self.config_file = Path(os.path.dirname(llama_cpp_custom_exe)) / "aidaptiv.json"
                if not self.config_file.exists():
                    if getattr(sys, 'frozen', False):
                        current_dir = os.path.dirname(sys.executable)
                    else:
                        current_dir = os.path.dirname(os.path.abspath(__file__))

                    self.config_file = Path(current_dir) / "aidaptiv.json"
                    if not self.config_file.exists():
                        self.config_file = None
        
        print(f"Config File: {str(self.config_file)}")

        self.downloader = downloader
        self.models_base_dir = models_base_dir
        self.LOGS_BASE_DIR = logs_dir
        self.running_servers: Dict[str, Dict[str, Any]] = {}
        Path(self.LOGS_BASE_DIR).mkdir(parents=True, exist_ok=True)
        self.logger = None

        self.SERVER_PORTS = {
            "text_generation": server_port + 1,
            "embeddings": server_port + 2,
            "rerank": server_port + 3,
            "multimodal": server_port + 4,
        }

    def __del__(self):
        self._cleanup_all_loggers()
        self.stop_server()

    def _create_logger(self, task: str) -> JSONLogger:
        """Create and open a logger for a specific task."""
        log_file_path = Path(self.LOGS_BASE_DIR) / f"{task}_server.log"
        logger = JSONLogger(log_file_path)
        logger.open_log_file()
        return logger

    def _cleanup_logger(self, task: str):
        """Clean up logger for a specific task."""
        if task in self.running_servers and "logger" in self.running_servers[task]:
            logger = self.running_servers[task]["logger"]
            if logger:
                logger.close()

    def _cleanup_all_loggers(self):
        """Clean up all loggers."""
        for task in self.running_servers:
            self._cleanup_logger(task)

    def _kill_existing_servers(self):
        try:
            cmd = None

            if platform.system() == "Windows":
                cmd = ["taskkill", "/f", "/im", "llama-server.exe"]
            elif platform.system() == "Linux":
                cmd = ["pkill", "-f", "llama-server"]

            if cmd:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    check=False,
                )

                if result.returncode == 0:
                    return

        except Exception as e:
            pass

    def _wait_for_server(self, server_url: str, timeout: int = 30) -> Dict:
        initial_delay = 3
        time.sleep(initial_delay)

        if timeout < 0:
            timeout = 60 * 60 * 24

        start_time = time.time()
        props_endpoint = f"{server_url}/props"

        while time.time() - start_time < timeout:
            try:
                response = requests.get(props_endpoint, timeout=1)
                if response.status_code == 200:
                    return response.json()

                time.sleep(0.3)
            except requests.exceptions.RequestException:
                time.sleep(initial_delay)
            except Exception:
                time.sleep(initial_delay)

        raise TimeoutError(
            f"Server at {server_url} failed to become ready within the timeout of {timeout}s"
        )

    def _overwrite_args(self, base_args, custom_args):
        base_dict = {}
        i = 0
        while i < len(base_args):
            flag = base_args[i]
            if flag.startswith("-"):
                if i + 1 < len(base_args) and not base_args[i + 1].startswith("-"):
                    base_dict[flag] = base_args[i + 1]
                    i += 2
                else:
                    base_dict[flag] = None
                    i += 1
            else:
                i += 1

        if isinstance(custom_args, list):
            custom_dict = {}
            j = 0
            while j < len(custom_args):
                flag = custom_args[j]
                if flag.startswith("-"):
                    if j + 1 < len(custom_args) and not custom_args[j + 1].startswith(
                        "-"
                    ):
                        custom_dict[flag] = custom_args[j + 1]
                        j += 2
                    else:
                        custom_dict[flag] = None
                        j += 1
                else:
                    j += 1
        elif isinstance(custom_args, dict):
            custom_dict = custom_args
        else:
            raise TypeError("custom_args must be list or dict")

        base_dict.update(custom_dict)
        result = []
        for flag, val in base_dict.items():
            result.append(flag)
            if val is not None:
                result.append(str(val))

        return result

    def _construct_llama_server_cmd(
        self, model_path, mmproj_path, device, task, n_ctx, user_extra_args, skip_oom
    ):
        gguf_metadata = self.get_gguf_metadata(model_path)
        logical_bz = 2048
        physical_bz = 512
        ngl = 0 if device == "CPU" else -1
        model_context_size = 4096

        if gguf_metadata:
            logical_bz = gguf_metadata.get("estimate", {}).get("logicalBatchSize", 2048)
            physical_bz = gguf_metadata.get("estimate", {}).get(
                "physicalBatchSize", 512
            )
            items = gguf_metadata.get("estimate", {}).get("items", [])
            if len(items) > 0 and device != "CPU":
                ngl = int(
                    items[0].get("offloadLayers")
                    * max(0.0, min(float(LAYERS_OFFLOAD_PERCENT), 1.0))
                )
                ngl = min(int(items[0].get("offloadLayers")), ngl)

            model_context_size = gguf_metadata.get("estimate", {}).get(
                "contextSize", 4096
            )

        logical_bz = min(2048, logical_bz)
        physical_bz = min(2048, physical_bz)
        largest_bz = max(logical_bz, physical_bz)

        port = self.SERVER_PORTS[task]
        server_url = f"http://127.0.0.1:{port}"

        if task == "embeddings":
            server_executable = get_resource_path(self.SERVER_EXECUTABLE)
            extra_args = [
                "--embedding",
                "--no-webui",
                "-ub",
                str(largest_bz),
            ]
        elif task == "rerank":
            server_executable = get_resource_path(self.SERVER_EXECUTABLE)
            extra_args = [
                "--reranking",
                "--no-webui",
                "-ub",
                str(largest_bz),
            ]
        elif task == "multimodal":
            server_executable = get_resource_path(self.CUSTOM_SERVER_EXECUTABLE)
            extra_args = [
                "--mmproj",
                mmproj_path,
                "--jinja",
                "--reasoning_format",
                "deepseek",
            ]
            if self.config_file != None:
                extra_args.extend(["--config-file", str(self.config_file)])
        else:
            server_executable = get_resource_path(self.CUSTOM_SERVER_EXECUTABLE)
            extra_args = ["--jinja", "--reasoning_format", "deepseek"]

            if self.config_file != None:
                extra_args.extend(["--config-file", str(self.config_file)])

        chat_template_file = Path(model_path).parent / "chat_template.jinja"
        if chat_template_file.exists():
            extra_args.extend(["--chat-template-file", str(chat_template_file)])

        suggested_ctx_size, oom = optimize_context_size(
            model_path, model_context_size, bypass_oom=skip_oom
        )
        if oom:
            raise RuntimeError(f"Failed to start server for {task}: Out of Memory")

        if n_ctx > -1:
            context_size = n_ctx

            if context_size > 0:
                context_size = min(context_size, suggested_ctx_size)
            else:
                context_size = min(model_context_size, suggested_ctx_size)

            extra_args.extend(["-c", str(context_size)])

        if "-ngl" not in extra_args:
            extra_args.extend(["-ngl", f"{ngl}"])

        if "-fa" not in extra_args:
            extra_args.extend(["-fa", "on"])

        if user_extra_args and len(user_extra_args) > 0:
            extra_args = self._overwrite_args(extra_args, user_extra_args)

        server_args = [
            server_executable,
            "--model",
            model_path,
            "--port",
            str(port),
            *extra_args,
        ]

        return server_args, server_url, largest_bz, largest_bz, ngl, context_size

    def get_llama_server_version(self):
        try:
            result = subprocess.run(
                [get_resource_path(self.SERVER_EXECUTABLE), "--version"],
                capture_output=True,
                text=True,
            )
            output = result.stdout + result.stderr
            match = re.search(r"version:\s+(\d+)\s+\((.*?)\)", output)

            if match:
                return f"{match.group(1)} ({match.group(2)})"

            return "unknown"

        except FileNotFoundError:
            return "not found"

    def get_llama_server_backend_type(self) -> str:
        try:
            llama_cpp_dir = Path(self.SERVER_EXECUTABLE).parent

            for backend in ["vulkan", "sycl"]:
                backend_file_type = (
                    Path(llama_cpp_dir) / f"ggml-{backend}.dll"
                    if self.IS_WINDOWS
                    else Path(llama_cpp_dir) / f"libggml-{backend}.so"
                )
                if backend_file_type.exists():
                    return backend

            return "unknown"

        except:
            return "unknown"

    def get_dependencies_versions(self) -> Dict:
        return {
            "llamacpp": self.get_llama_server_version(),
            "xpu-smi": get_xpu_version(),
            "gguf-parser-go": get_gguf_parser_version(),
            "backend": self.BACKEND,
        }

    def get_gguf_metadata(self, model_path):
        if not os.path.exists(model_path):
            raise RuntimeError("Invalid Model Path")

        command = [
            get_resource_path(self.GGUF_PARSER_EXECUTABLE),
            "-m",
            model_path,
            "-fa",
            "--json",
        ]

        try:
            result = subprocess.run(
                command, capture_output=True, text=True, check=True, encoding="utf-8"
            )
            return json.loads(result.stdout)
        except subprocess.CalledProcessError as e:
            print(f"Error executing tool: {e}")
            return None
        except json.JSONDecodeError:
            print("Error: The tool output was not valid JSON.")
            return None

    def get_model_file_path(self, hf_repo_with_tag: str) -> Tuple[str, str]:
        task = self.downloader.get_model_info_for_repo(
            hf_repo_with_tag=hf_repo_with_tag
        )

        manifest = self.downloader.get_file_manifest(hf_repo_with_tag=hf_repo_with_tag)
        filename = manifest["gguf_file"]
        mmproj_filename = manifest.get("mmproj_file")
        hf_repo = manifest["hf_repo"]

        local_path = Path(self.models_base_dir) / task / hf_repo / filename
        if not local_path.exists():
            raise FileNotFoundError(
                f"Model file not found locally: {local_path}. Please download it first."
            )

        if task == "multimodal":
            mmproj_path = Path(self.models_base_dir) / task / hf_repo / mmproj_filename
            if not mmproj_path.exists():
                raise FileNotFoundError(
                    f"Multimodal projection file not found locally: {mmproj_path}. Please download it first."
                )
        else:
            mmproj_path = ""

        return str(local_path), str(mmproj_path)

    def start_server(self, hf_repo_with_tag: str, **kwargs):
        task = self.downloader.get_model_info_for_repo(
            hf_repo_with_tag=hf_repo_with_tag
        )

        if task not in self.SERVER_PORTS:
            raise ValueError(f"Task type {task} is not configured for a server port.")

        if task in self.running_servers:
            current_repo_id = self.running_servers[task]["repo_id"]
            if current_repo_id == hf_repo_with_tag:
                raise RuntimeError(
                    f"Server for task {task} with model {hf_repo_with_tag} is already running."
                )
            else:
                raise RuntimeError(
                    f"Server for task {task} is already running with model {current_repo_id}. "
                    f"Use swap_model({hf_repo_with_tag}) to change the model."
                )

        model_path, mmproj_path = self.get_model_file_path(hf_repo_with_tag)

        device = kwargs.get("device", "CPU")
        n_ctx = kwargs.get("n_ctx", -1)
        extra_args = kwargs.get("extra_args", [])
        timeout = kwargs.get("timeout", 600)
        skip_oom = kwargs.get("skip_oom", True)

        server_args, server_url, logical_bz, physical_bz, ngl, context_size = (
            self._construct_llama_server_cmd(
                model_path, mmproj_path, device, task, n_ctx, extra_args, skip_oom
            )
        )

        print(" ".join(server_args))

        logger = self._create_logger(task)

        try:
            popen_kwargs = {
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
            }

            if self.IS_WINDOWS:
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

            process = subprocess.Popen(server_args, **popen_kwargs)

            stdout_thread = threading.Thread(
                target=stream_reader, args=(process.stdout, logger, "out"), daemon=True
            )
            stderr_thread = threading.Thread(
                target=stream_reader,
                args=(process.stderr, logger, "error"),
                daemon=True,
            )

            stdout_thread.start()
            stderr_thread.start()

            self.running_servers[task] = {
                "process": process,
                "repo_id": hf_repo_with_tag,
                "url": server_url,
                "logger": logger,
                "stdout_thread": stdout_thread,
                "stderr_thread": stderr_thread,
                "context_size": context_size,
                "batch_size": logical_bz,
                "ubatch_size": physical_bz,
                "ngl": ngl,
            }

            props = self._wait_for_server(server_url, timeout=timeout)
            self.running_servers[task]["context_size"] = props.get(
                "default_generation_settings", {}
            ).get("n_ctx", 0)

        except FileNotFoundError:
            self._cleanup_logger(task)
            if task in self.running_servers:
                del self.running_servers[task]
            logger.close()
            raise RuntimeError(
                f"Error: Server executable not found or model/mmproj file missing. Ensure they are downloaded/present."
            )
        except Exception as e:
            if task in self.running_servers:
                self.stop_server(hf_repo_with_tag=hf_repo_with_tag)
            else:
                logger.close()
            raise RuntimeError(f"Failed to start server for {task}: {e}")

    def swap_model(self, new_hf_repo_with_tag: str, **kwargs):
        new_task = self.downloader.get_model_info_for_repo(
            hf_repo_with_tag=new_hf_repo_with_tag
        )
        current_hf_repo_with_tag = None

        if new_task in self.running_servers:
            current_server_info = self.running_servers[new_task]
            current_hf_repo_with_tag = current_server_info["repo_id"]

            if current_hf_repo_with_tag == new_hf_repo_with_tag:
                return (current_hf_repo_with_tag, current_hf_repo_with_tag)

            process = current_server_info["process"]

            if self.IS_WINDOWS:
                process.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                process.terminate()

            try:
                process.wait(timeout=300)
            except subprocess.TimeoutExpired:
                process.kill()

            if current_server_info.get("logger"):
                current_server_info["logger"].close()

            del self.running_servers[new_task]
        else:
            print(
                f"No existing server found for model {new_hf_repo_with_tag}. Starting new server."
            )

        self.start_server(hf_repo_with_tag=new_hf_repo_with_tag, **kwargs)

        if current_hf_repo_with_tag:
            return (current_hf_repo_with_tag, new_hf_repo_with_tag)
        else:
            return (None, new_hf_repo_with_tag)

    def stop_server(self, hf_repo_with_tag: Optional[str] = None):
        if hf_repo_with_tag:
            try:
                task = self.downloader.get_model_info_for_repo(hf_repo_with_tag)
            except ValueError:
                raise RuntimeError(
                    f"Warning: Model {hf_repo_with_tag} not found. Cannot stop server by model ID."
                )

            if (
                task in self.running_servers
                and self.running_servers[task]["repo_id"] == hf_repo_with_tag
            ):
                servers_to_stop = [task]
            else:
                raise RuntimeError(
                    f"Warning: Server for task {task} is not running with model {hf_repo_with_tag}."
                )

        else:
            servers_to_stop = list(self.running_servers.keys())

        for t in servers_to_stop:
            if t in self.running_servers:
                server_info = self.running_servers[t]
                process = server_info["process"]

                if self.IS_WINDOWS:
                    process.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    process.terminate()

                try:
                    process.wait(timeout=300)
                except subprocess.TimeoutExpired:
                    process.kill()

                self._cleanup_logger(t)

                del self.running_servers[t]

        if servers_to_stop and not self.running_servers and not hf_repo_with_tag:
            print("All servers stopped.")

    def start_server_with_file(self, repo_id: str, task: str, **kwargs):
        if task not in self.SERVER_PORTS:
            raise ValueError(f"Task type {task} is not configured for a server port.")

        if task in self.running_servers:
            current_repo_id = self.running_servers[task]["repo_id"]
            if current_repo_id == repo_id:
                raise RuntimeError(f"{repo_id} is already running.")
            else:
                raise RuntimeError(
                    f"{task} is already running with model {current_repo_id}."
                    "Stop the current model before proceed."
                )

        context_size = 0
        model_path = kwargs.get("model_path", None)
        mmproj_path = kwargs.get("mmproj_path", None)
        device = kwargs.get("device", "CPU")
        n_ctx = kwargs.get("n_ctx", -1)
        extra_args = kwargs.get("extra_args", [])
        timeout = kwargs.get("timeout", 600)
        skip_oom = kwargs.get("skip_oom", True)

        if model_path != None:
            if not Path(model_path).exists():
                raise RuntimeError(f"{model_path} does not exists")

        if mmproj_path != None:
            if not Path(mmproj_path).exists():
                raise RuntimeError(f"{mmproj_path} does not exists")

        server_args, server_url, logical_bz, physical_bz, ngl, context_size = (
            self._construct_llama_server_cmd(
                model_path, mmproj_path, device, task, n_ctx, extra_args, skip_oom
            )
        )
        print(" ".join(server_args))

        logger = self._create_logger(task)

        try:
            popen_kwargs = {
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
            }

            if self.IS_WINDOWS:
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

            process = subprocess.Popen(server_args, **popen_kwargs)

            stdout_thread = threading.Thread(
                target=stream_reader, args=(process.stdout, logger, "out"), daemon=True
            )
            stderr_thread = threading.Thread(
                target=stream_reader,
                args=(process.stderr, logger, "error"),
                daemon=True,
            )

            stdout_thread.start()
            stderr_thread.start()

            self.running_servers[task] = {
                "process": process,
                "repo_id": repo_id,
                "url": server_url,
                "logger": logger,
                "stdout_thread": stdout_thread,
                "stderr_thread": stderr_thread,
                "context_size": context_size,
                "batch_size": logical_bz,
                "ubatch_size": physical_bz,
                "ngl": ngl,
            }

            props = self._wait_for_server(server_url, timeout=timeout)
            context_size = props.get("default_generation_settings", {}).get("n_ctx", 0)
            self.running_servers[task]["context_size"] = context_size

            return props

        except FileNotFoundError:
            self._cleanup_logger(task)
            if task in self.running_servers:
                del self.running_servers[task]
            logger.close()

            raise RuntimeError(
                f"Error: Server executable not found or model/mmproj file missing. Ensure they are downloaded/present."
            )

        except Exception as e:
            if task in self.running_servers:
                self.stop_server_with_file(repo_id=repo_id, task=task)
            else:
                logger.close()

            raise RuntimeError(f"Failed to start server for {task}: {e}")

    def stop_server_with_file(self, repo_id: str, task: str):
        if (
            task in self.running_servers
            and self.running_servers[task]["repo_id"] == repo_id
        ):
            servers_to_stop = [task]
        else:
            raise RuntimeError(
                f"Warning: Server for task {task} is not running with model {repo_id}."
            )

        for t in servers_to_stop:
            if t in self.running_servers:
                server_info = self.running_servers[t]
                process = server_info["process"]

                if self.IS_WINDOWS:
                    process.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    process.terminate()

                try:
                    process.wait(timeout=300)
                except subprocess.TimeoutExpired:
                    process.kill()

                self._cleanup_logger(t)

                del self.running_servers[t]

        if servers_to_stop and not self.running_servers and not repo_id:
            print("All servers stopped.")

    def get_server_status(self, task: str) -> Tuple[str, str]:
        if task not in self.running_servers:
            return ("STOPPED (Not tracked)", -1)

        server_info = self.running_servers[task]
        process = server_info["process"]
        url = server_info["url"]

        if process.poll() is not None:
            del self.running_servers[task]
            return (f"TERMINATED (Exit Code: {process.returncode})", -1)

        try:
            response = requests.get(f"{url}/health", timeout=1)
            if response.status_code == 200:
                return ("RUNNING (Healthy)", process.pid)
            else:
                return (f"RUNNING (API Error: {response.status_code})", process.pid)

        except Exception:
            return ("RUNNING (Unknown Status Error)", process.pid)

    def get_server_info(self) -> Dict:
        return self.running_servers

    def get_current_active_model(self, task: str) -> str:
        if task in self.running_servers:
            server_info = self.running_servers[task]
            process = server_info["process"]

            exit_code = process.poll()
            if exit_code is not None:
                model_name = server_info["repo_id"]
                raise RuntimeError(
                    f"The '{task}' server running '{model_name}' is no longer active. "
                    f"It terminated with exit code: {exit_code}."
                )
            return server_info["repo_id"]

        return ""
