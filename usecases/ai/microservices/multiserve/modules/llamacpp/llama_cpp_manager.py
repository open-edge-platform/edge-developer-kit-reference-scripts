# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import requests
import subprocess  # nosec - disable B404:import-subprocess check
import time
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

from modules.utils import get_resource_path
from .gguf_downloader import GGUFDownloader

class LlamaCPPManager:
    SERVER_EXECUTABLE = ".\\engine\\llama.cpp\\llama-server.exe" 
    LOGS_BASE_DIR = "logs"

    SERVER_PORTS = {
        "text_generation": 8080,
        "embeddings": 8081,
        "rerank": 8082,
        "multimodal": 8083,
    }
    
    def __init__(self, downloader: GGUFDownloader, models_base_dir: str = "models"):
        self.downloader = downloader
        self.models_base_dir = models_base_dir
        self.running_servers: Dict[str, Dict[str, Any]] = {}
        Path(self.LOGS_BASE_DIR).mkdir(parents=True, exist_ok=True)
    
    def __del__(self):
        self.stop_server()

    def _wait_for_server(self, server_url: str, timeout: int = 60):
        initial_delay = 2
        time.sleep(initial_delay)

        start_time = time.time()
        health_endpoint = f"{server_url}/health"
        while time.time() - start_time < timeout:
            try:
                response = requests.get(health_endpoint, timeout=1)
                if response.status_code == 200:
                    return True
            except requests.exceptions.RequestException:
                time.sleep(1)
            except Exception:
                time.sleep(1)
                
        self.stop_server()
        raise TimeoutError(f"Server at {server_url} failed to become ready within the timeout.")

    def get_model_file_path(self, hf_repo_with_tag: str) -> Tuple[str, str]:
        task = self.downloader.get_model_info_for_repo(hf_repo_with_tag=hf_repo_with_tag)
        
        manifest = self.downloader.get_file_manifest(hf_repo_with_tag=hf_repo_with_tag)
        filename = manifest["gguf_file"]
        mmproj_filename = manifest.get("mmproj_file")
        hf_repo = manifest["hf_repo"]
        
        local_path = Path(self.models_base_dir) / task / hf_repo / filename
        if not local_path.exists():
            raise FileNotFoundError(f"Model file not found locally: {local_path}. Please download it first.")

        if task == "multimodal":
            mmproj_path = Path(self.models_base_dir) / task / hf_repo / mmproj_filename
            if not mmproj_path.exists():
                raise FileNotFoundError(f"Multimodal projection file not found locally: {mmproj_path}. Please download it first.")
        else:
            mmproj_path = ""

        return str(local_path), str(mmproj_path)
    
    def start_server(self, hf_repo_with_tag: str, **kwargs):
        task = self.downloader.get_model_info_for_repo(hf_repo_with_tag=hf_repo_with_tag)
        
        if task not in self.SERVER_PORTS:
            raise ValueError(f"Task type {task} is not configured for a server port.")

        if task in self.running_servers:
            current_repo_id = self.running_servers[task]["repo_id"]
            if current_repo_id == hf_repo_with_tag:
                raise RuntimeError(f"Server for task {task} with model {hf_repo_with_tag} is already running.")
            else:
                raise RuntimeError(
                    f"Server for task {task} is already running with model {current_repo_id}. "
                    f"Use swap_model({hf_repo_with_tag}) to change the model."
                )

        model_path, mmproj_path = self.get_model_file_path(hf_repo_with_tag)
        port = self.SERVER_PORTS[task]
        server_url = f"http://127.0.0.1:{port}"
        
        if task == "embeddings":
            extra_args = ["--embedding", "--no-webui", "-kvu"]
        elif task == "rerank":
            extra_args = ["--reranking", "--no-webui", "-kvu"]
        elif task == "multimodal":
            extra_args = ["--mmproj", mmproj_path]
        else:
            extra_args = ["--jinja", "--reasoning_format", "none"]

        if kwargs.get("n_ctx"):
            extra_args.extend(["-c", str(kwargs["n_ctx"])])

        if kwargs.get("n_gpu_layers"):
            extra_args.extend(["-ngl", str(kwargs["n_gpu_layers"])])

        server_args = [
            get_resource_path(self.SERVER_EXECUTABLE),
            "--model", model_path,
            "--port", str(port),
            *extra_args
        ]
                    
        log_file_path = Path(self.LOGS_BASE_DIR) / f"{task}_server.log"
        try:
            log_file = open(log_file_path, "w", encoding="utf-8")
        except OSError as e:
            raise RuntimeError(f"Failed to open log file {log_file_path}: {e}")
        
        try:
            self.running_servers[task] = {
                "process": subprocess.Popen(
                    server_args,
                    stdout=subprocess.PIPE,
                    stderr=log_file,
                    # creationflags=subprocess.CREATE_NEW_CONSOLE,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    text=True
                ),
                "repo_id": hf_repo_with_tag,
                "url": server_url,
                "log_file_handle": log_file
            }
            
            self._wait_for_server(server_url)

        except FileNotFoundError:
            if task in self.running_servers and "log_file_handle" in self.running_servers[task]:
                 self.running_servers[task]["log_file_handle"].close()
            del self.running_servers[task]
            raise RuntimeError(f"Error: Server executable not found or model/mmproj file missing. Ensure they are downloaded/present.")
        except Exception as e:
            if task in self.running_servers:
                self.stop_server(hf_repo_with_tag=hf_repo_with_tag)
            raise RuntimeError(f"Failed to start server for {task}: {e}")

    def swap_model(self, new_hf_repo_with_tag: str, **kwargs):
        new_task = self.downloader.get_model_info_for_repo(hf_repo_with_tag=new_hf_repo_with_tag)
        current_hf_repo_with_tag = None
        
        if new_task in self.running_servers:
            current_server_info = self.running_servers[new_task]
            current_hf_repo_with_tag = current_server_info["repo_id"]

            if current_hf_repo_with_tag == new_hf_repo_with_tag:
                return (current_hf_repo_with_tag, current_hf_repo_with_tag)

            process = current_server_info["process"]
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            
            if current_server_info.get("log_file_handle"):
                current_server_info["log_file_handle"].close()

            del self.running_servers[new_task] 
        else:
            print(f"No existing server found for model {new_hf_repo_with_tag}. Starting new server.")

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
                raise RuntimeError(f"Warning: Model {hf_repo_with_tag} not found. Cannot stop server by model ID.")

            if task in self.running_servers and self.running_servers[task]["repo_id"] == hf_repo_with_tag:
                servers_to_stop = [task]
            else:
                raise RuntimeError(f"Warning: Server for task {task} is not running with model {hf_repo_with_tag}.")

        else:
            servers_to_stop = list(self.running_servers.keys())

        for t in servers_to_stop:
            if t in self.running_servers:
                server_info = self.running_servers[t]
                process = server_info["process"]
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                
                if server_info.get("log_file_handle"):
                    server_info["log_file_handle"].close()
                    
                del self.running_servers[t]
        
        if servers_to_stop and not self.running_servers and not hf_repo_with_tag:
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
        
    def get_current_active_model(self, task: str) -> str:
        if task in self.running_servers:
            current_server_info = self.running_servers[task]
            current_hf_repo_with_tag = current_server_info["repo_id"]
            return current_hf_repo_with_tag
        
        return ""