# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import requests
import subprocess  # nosec - disable B404:import-subprocess check
import time
import os
import threading
import shutil
import signal

os.environ["no_proxy"] = "localhost,127.0.0.1"
os.environ["NO_PROXY"] = "localhost,127.0.0.1"

import json
import re
import os
import sys

from pathlib import Path
from typing import Callable, Optional, Dict, Any, Tuple

from modules.utils import (
    get_resource_path,
    optimize_context_size,
    get_gguf_parser_version,
    get_gpu_tool_version,
    GPU_TOOL,
    JSONLogger,
    loopback_port_is_free,
    pick_free_loopback_port,
    stream_reader,
    check_exe_output
)
from modules.extra_args import flags_in, llamacpp_flag, strip_flags
from .gguf_downloader import GGUFDownloader
import os

FORCE_LLAMACPP_BACKEND = os.getenv("FORCE_LLAMACPP_BACKEND", "vulkan")
LAYERS_OFFLOAD_PERCENT = os.getenv("LAYERS_OFFLOAD_PERCENT", 1.0)
# Tokens of context a model gets when none was asked for.
DEFAULT_MAX_CONTEXT = 32768


class ServerExited(RuntimeError):
    """llama-server ended before it answered its first request."""


class LlamaCPPManager:
    IS_WINDOWS = os.name == "nt"
    GGUF_PARSER_EXECUTABLE = (
        ".\\engine\\gguf-parser-windows-amd64.exe"
        if IS_WINDOWS
        else "./engine/gguf-parser"
    )
    BACKEND = "vulkan"

    #: One llama-server per task, each on its own loopback port.
    TASKS = ("text_generation", "embeddings", "rerank", "multimodal")
    #: Another process can take the picked port before llama-server binds it.
    PORT_ATTEMPTS = 3

    config_file = None

    def __init__(
        self,
        downloader: GGUFDownloader,
        models_base_dir: str = "models",
        logs_dir: str = "logs",
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

    def __del__(self):
        self._cleanup_all_loggers()
        self.stop_server()

    def _create_logger(self, task: str) -> JSONLogger:
        log_file_path = Path(self.LOGS_BASE_DIR) / f"{task}_server.log"
        logger = JSONLogger(log_file_path)
        logger.open_log_file()
        return logger

    def _cleanup_logger(self, task: str):
        if task in self.running_servers and "logger" in self.running_servers[task]:
            logger = self.running_servers[task]["logger"]
            if logger:
                logger.close()

    def _cleanup_all_loggers(self):
        for task in self.running_servers:
            self._cleanup_logger(task)

    def _wait_for_server(
        self,
        server_url: str,
        timeout: int = 30,
        process: Optional[subprocess.Popen] = None,
    ) -> Dict:
        initial_delay = 3
        time.sleep(initial_delay)

        if timeout < 0:
            timeout = 60 * 60 * 24

        start_time = time.time()
        props_endpoint = f"{server_url}/props"

        while time.time() - start_time < timeout:
            # A server that died while loading (e.g. a kernel the device
            # cannot build) never answers: report it now, not at the timeout.
            if process is not None and process.poll() is not None:
                raise ServerExited(
                    f"llama-server exited with code {process.returncode} while "
                    f"loading the model; see its log for the reason"
                )
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

    def _construct_llama_server_cmd(
        self, model_path, mmproj_path, device, task, n_ctx, user_extra_args, skip_oom, port
    ):
        """The llama-server command line for ``task`` on ``port`` (picked by ``_launch_server``)."""
        gguf_metadata = self.get_gguf_metadata(model_path)
        logical_bz = 2048
        physical_bz = 512
        ngl = 0 if device == "CPU" else -1
        model_context_size = 0

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
                "contextSize", 0
            )

        logical_bz = min(2048, logical_bz)
        physical_bz = min(2048, physical_bz)
        largest_bz = max(logical_bz, physical_bz)

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
        else:
            server_executable = get_resource_path(self.CUSTOM_SERVER_EXECUTABLE)
            extra_args = ["--jinja", "--reasoning_format", "deepseek"]

            # A GGUF is a VLM because it ships a projector, not by its task folder: load any resolved
            # projector so vision models added as text_generation still see images.
            if mmproj_path:
                extra_args.extend(["--mmproj", str(mmproj_path)])

            if self.config_file != None:
                extra_args.extend(["--config-file", str(self.config_file)])

        chat_template_file = Path(model_path).parent / "chat_template.jinja"
        if chat_template_file.exists():
            extra_args.extend(["--chat-template-file", str(chat_template_file)])

        # No explicit size: the model's own, capped. Without -c, llama-server sizes the context to all
        # free device memory (--fit), starving later services on that GPU.
        if n_ctx <= 0:
            context_size = min(model_context_size or DEFAULT_MAX_CONTEXT, DEFAULT_MAX_CONTEXT)
            extra_args.extend(["-c", str(context_size)])
        else:
            # Without GGUF metadata, cap the search at the requested size, not an invented ceiling.
            suggested_ctx_size, oom = optimize_context_size(
                model_path, model_context_size or n_ctx, bypass_oom=skip_oom
            )
            if oom:
                raise RuntimeError(f"Failed to start server for {task}: Out of Memory")

            context_size = min(n_ctx, suggested_ctx_size) if suggested_ctx_size > 0 else n_ctx
            extra_args.extend(["-c", str(context_size)])

        if "-ngl" not in extra_args:
            extra_args.extend(["-ngl", f"{ngl}"])

        # -ngl 0 keeps weights in RAM, but op offload still runs large batches on any GPU found
        # (the SYCL build always finds one). CPU means no GPU at all.
        if device == "CPU" and "--device" not in extra_args and "-dev" not in extra_args:
            extra_args.extend(["--device", "none"])

        if "-fa" not in extra_args:
            extra_args.extend(["-fa", "on"])

        # The user's flags replace ours (in any spelling); repeatable ones like --lora stay repeated.
        if user_extra_args:
            user_args = list(user_extra_args)
            overridden = flags_in(user_args, llamacpp_flag)
            extra_args = strip_flags(extra_args, overridden, llamacpp_flag) + user_args

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
            GPU_TOOL: get_gpu_tool_version(),
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
        # An uploaded quant is its registered file: no manifest to fetch, no projector.
        upload = self.downloader.find_upload(hf_repo_with_tag)
        if upload is not None:
            task, path = upload
            if task == "multimodal":
                raise FileNotFoundError(
                    f"{hf_repo_with_tag} is an uploaded GGUF without a multimodal "
                    "projection file; it cannot be served as a multimodal model."
                )
            return str(path), ""

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

        mmproj_path = ""
        if mmproj_filename:
            candidate = Path(self.models_base_dir) / task / hf_repo / mmproj_filename
            if candidate.exists():
                mmproj_path = str(candidate)
            elif task == "multimodal":
                raise FileNotFoundError(
                    f"Multimodal projection file not found locally: {candidate}. Please download it first."
                )
        elif task == "multimodal":
            raise FileNotFoundError(
                f"No multimodal projection file is published for {hf_repo_with_tag}. "
                f"This model cannot be served as a multimodal model."
            )

        return str(local_path), mmproj_path

    def _terminate_server(self, task: str) -> None:
        """Stops and forgets the server tracked for ``task``, if any."""
        server_info = self.running_servers.pop(task, None)
        if not server_info:
            return

        process = server_info["process"]
        if process.poll() is None:
            if self.IS_WINDOWS:
                process.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                process.terminate()

            try:
                process.wait(timeout=300)
            except subprocess.TimeoutExpired:
                process.kill()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass

        logger = server_info.get("logger")
        if logger:
            logger.close()

    def _launch_server(
        self,
        task: str,
        repo_id: str,
        build_command: Callable[[int], Tuple],
        timeout: int,
        mmproj_path: str = "",
    ) -> Dict:
        """Starts ``task``'s llama-server on a free loopback port and returns its ``/props``.

        A server that exits before answering because its port got taken is retried on another port, up to
        ``PORT_ATTEMPTS`` times. On failure nothing is left running and a ``RuntimeError`` says why.
        """
        attempt = 0
        while True:
            attempt += 1
            port = pick_free_loopback_port()
            server_args, server_url, logical_bz, physical_bz, ngl, context_size = (
                build_command(port)
            )
            print(" ".join(server_args))

            logger = self._create_logger(task)
            popen_kwargs = {
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
            }
            if self.IS_WINDOWS:
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

            try:
                process = subprocess.Popen(server_args, **popen_kwargs)
            except FileNotFoundError:
                logger.close()
                raise RuntimeError(
                    "Error: Server executable not found or model/mmproj file missing. Ensure they are downloaded/present."
                )
            except Exception as e:
                logger.close()
                raise RuntimeError(f"Failed to start server for {task}: {e}")

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
                "port": port,
                "url": server_url,
                "logger": logger,
                "stdout_thread": stdout_thread,
                "stderr_thread": stderr_thread,
                "context_size": context_size,
                "batch_size": logical_bz,
                "ubatch_size": physical_bz,
                "ngl": ngl,
                "mmproj_path": mmproj_path or "",
            }

            try:
                props = self._wait_for_server(
                    server_url, timeout=timeout, process=process
                )
            except ServerExited as e:
                self._terminate_server(task)
                if attempt < self.PORT_ATTEMPTS and not loopback_port_is_free(port):
                    print(
                        f"Port {port} was taken by another process before llama-server "
                        f"could bind it; starting the {task} server again on another port",
                        file=sys.stderr,
                    )
                    continue
                raise RuntimeError(f"Failed to start server for {task}: {e}")
            except Exception as e:
                self._terminate_server(task)
                raise RuntimeError(f"Failed to start server for {task}: {e}")

            self.running_servers[task]["context_size"] = props.get(
                "default_generation_settings", {}
            ).get("n_ctx", 0)
            return props

    def start_server(self, hf_repo_with_tag: str, **kwargs):
        task = self.downloader.get_model_info_for_repo(
            hf_repo_with_tag=hf_repo_with_tag
        )

        if task not in self.TASKS:
            raise ValueError(f"Task type {task} is not one a server can be started for.")

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

        self._launch_server(
            task,
            hf_repo_with_tag,
            lambda port: self._construct_llama_server_cmd(
                model_path, mmproj_path, device, task, n_ctx, extra_args, skip_oom, port
            ),
            timeout,
            mmproj_path,
        )
        self.running_servers[task]["extra_args"] = list(extra_args or [])

    def swap_model(self, new_hf_repo_with_tag: str, **kwargs):
        new_task = self.downloader.get_model_info_for_repo(
            hf_repo_with_tag=new_hf_repo_with_tag
        )
        current_hf_repo_with_tag = None

        if new_task in self.running_servers:
            current_hf_repo_with_tag = self.running_servers[new_task]["repo_id"]
            same_args = self.running_servers[new_task].get("extra_args", []) == list(
                kwargs.get("extra_args") or []
            )

            if current_hf_repo_with_tag == new_hf_repo_with_tag and same_args:
                return (current_hf_repo_with_tag, current_hf_repo_with_tag)

            self._terminate_server(new_task)
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
            self._terminate_server(t)

        if servers_to_stop and not self.running_servers and not hf_repo_with_tag:
            print("All servers stopped.")

    def start_server_with_file(self, repo_id: str, task: str, **kwargs):
        if task not in self.TASKS:
            raise ValueError(f"Task type {task} is not one a server can be started for.")

        if task in self.running_servers:
            current_repo_id = self.running_servers[task]["repo_id"]
            if current_repo_id == repo_id:
                raise RuntimeError(f"{repo_id} is already running.")
            else:
                raise RuntimeError(
                    f"{task} is already running with model {current_repo_id}."
                    "Stop the current model before proceed."
                )

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

        return self._launch_server(
            task,
            repo_id,
            lambda port: self._construct_llama_server_cmd(
                model_path, mmproj_path, device, task, n_ctx, extra_args, skip_oom, port
            ),
            timeout,
            mmproj_path,
        )

    def stop_server_with_file(self, repo_id: str, task: str):
        if (
            task in self.running_servers
            and self.running_servers[task]["repo_id"] == repo_id
        ):
            self._terminate_server(task)
        else:
            raise RuntimeError(
                f"Warning: Server for task {task} is not running with model {repo_id}."
            )

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

    def has_multimodal_projector(self, task: str) -> bool:
        server_info = self.running_servers.get(task)
        if not server_info:
            return False

        return bool(server_info.get("mmproj_path"))

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
