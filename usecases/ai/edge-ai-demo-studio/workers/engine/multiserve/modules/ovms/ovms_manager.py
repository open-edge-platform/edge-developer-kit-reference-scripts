# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import subprocess  # nosec - disable B404:import-subprocess check
import time
import os
import sys

sys.path.append(os.path.dirname(__file__))
import requests
import re
import openvino_genai as ov_genai
from pathlib import Path
from typing import Dict

from modules.utils import get_resource_path, JSONLogger, stream_reader
from .ov_downloader import OVDownloader

import os
import threading


class OVMSManager:
    IS_WINDOWS = os.name == "nt"
    OVMS_EXECUTABLE = (
        os.path.join(".", "engine", "ovms", "ovms.exe")
        if IS_WINDOWS
        else os.path.join(".", "engine", "ovms", "bin", "ovms")
    )
    CONFIG_PATH = os.path.join(".", "models", "OV", "config.json")

    def __init__(
        self,
        ovdownloader: OVDownloader,
        models_dir: str = os.path.join(".", "models", "OV"),
        logs_dir: str = "logs",
        rest_port: int = 9000,
        debug: bool = False,
    ):
        self.LOGS_BASE_DIR = logs_dir
        Path(self.LOGS_BASE_DIR).mkdir(parents=True, exist_ok=True)

        self.debug = debug
        self.downloader = ovdownloader
        self.OVMS_EXECUTABLE = get_resource_path(self.OVMS_EXECUTABLE)
        self.CONFIG_PATH = os.path.join(models_dir, "config.json")
        self.rest_port = str(rest_port + 1)

        self.running_servers = {}
        self.server_process = None
        self.logger = None
        self.command = [
            self.OVMS_EXECUTABLE,
            "--config_path",
            self.CONFIG_PATH,
            "--rest_port",
            self.rest_port,
            "--file_system_poll_wait_seconds",
            "0",
        ]

        self.env = os.environ.copy()
        self._current_process = None
        try:
            ovms_parent_path = os.path.dirname(self.OVMS_EXECUTABLE)
            ovms_parent_path = str(Path(ovms_parent_path))

            if not ovms_parent_path or ovms_parent_path == ".":
                ovms_path_search = self._find_executable_path(self.OVMS_EXECUTABLE)
                if ovms_path_search:
                    ovms_parent_path = os.path.dirname(ovms_path_search)
                else:
                    ovms_parent_path = "."

            path_separator = os.pathsep
            current_path = self.env.get("PATH", "")
            if self.IS_WINDOWS:
                new_path_entries = [
                    os.path.join(ovms_parent_path, "python"),
                    os.path.join(ovms_parent_path, "python", "python312"),
                ]
                self.env["PYTHONHOME"] = new_path_entries[0]
                self.env["PYTHONPATH"] = new_path_entries[1]
                self.env["PATH"] = (
                    path_separator.join(new_path_entries)
                    + path_separator
                    + current_path
                )
            else:
                ovms_root_path = os.path.dirname(ovms_parent_path)
                self.env = {}
                self.env["HF_TOKEN"] = os.getenv("HF_TOKEN", "")
                self.env["HF_ENDPOINT"] = os.getenv("HF_ENDPOINT", "")
                self.env["LD_LIBRARY_PATH"] = os.path.join(ovms_root_path, "lib")
                self.env["PATH"] = f"{os.path.join(ovms_root_path, 'bin')}"
                self.env["PYTHONPATH"] = os.path.join(ovms_root_path, "lib", "python")

        except Exception as e:
            print(f"Error during OVMS environment setup: {e}")

    def __del__(self):
        """Destructor to ensure proper cleanup of resources."""
        self.stop_ovms()

    def _find_executable_path(self, name):
        for part in os.environ["PATH"].split(os.pathsep):
            exe_path = os.path.join(part, name)
            if os.path.exists(exe_path):
                return exe_path

        return None

    def _wait_for_model_availability(self, model_name, timeout=10, poll_interval=0.1):
        status_url = f"http://localhost:{self.rest_port}/v1/config/reload"

        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                response = requests.post(status_url, timeout=1)

                if response.status_code == 200:
                    status_data = response.json().get(model_name)

                    if status_data:
                        if status_data.get("model_version_status"):
                            version_status = status_data["model_version_status"][0]
                            state = version_status["state"]
                            status = version_status.get("status", "unknown")

                            if state == "AVAILABLE":
                                return True
                            elif state == "UNAVAILABLE" or state == "END":
                                return False
                            elif status["error_code"] == "FAILED_PRECONDITION":
                                return False

            except requests.exceptions.ConnectionError:
                pass
            except Exception as e:
                print(
                    f"Warning: Error checking model availability for {model_name}: {e}"
                )

            time.sleep(poll_interval)

        return False

    def _get_model_availablity(self, model_name):
        status_url = f"http://localhost:{self.rest_port}/v1/config"

        try:
            response = requests.post(status_url, timeout=1)

            if response.status_code == 200:
                status_data = response.json().get(model_name)

                if status_data:
                    if status_data.get("model_version_status"):
                        version_status = status_data["model_version_status"][0]
                        state = version_status["state"]

                        return state == "AVAILABLE"

        except requests.exceptions.ConnectionError:
            return False
        except Exception as e:
            print(f"Error checking model availability for {model_name}: {e}")
            return False
        return False

    def _add_model_to_config(self, model_name: str, model_path: str):
        config_command = [
            self.OVMS_EXECUTABLE,
            "--add_to_config",
            "--config_path",
            self.CONFIG_PATH,
            "--model_name",
            model_name,
            "--model_path",
            model_path,
        ]

        try:
            _ = subprocess.run(
                config_command, check=True, capture_output=True, text=True, env=self.env
            )
        except Exception as e:
            print(f"Error adding model {model_name} to config: {e}")
            pass

        return True

    def _remove_model_from_config(self, model_name: str):
        config_command = [
            self.OVMS_EXECUTABLE,
            "--remove_from_config",
            "--config_path",
            self.CONFIG_PATH,
            "--model_name",
            model_name,
        ]

        try:
            _ = subprocess.run(
                config_command, check=True, capture_output=True, text=True, env=self.env
            )
        except Exception as e:
            # print(f"Warning: Error removing model {model_name} from config: {e}")
            pass

        return True

    def get_ovms_version(self):
        try:
            result = subprocess.run(
                [self.OVMS_EXECUTABLE, "--version"],
                capture_output=True,
                text=True,
                check=True,
                env=self.env,
            )
            output = result.stdout
            match = re.search(r"OpenVINO Model Server\s+([\d\.]+[a-z\d]+)", output)

            if match:
                return match.group(1)
            return "unknown"

        except FileNotFoundError:
            return "not found"

    def get_dependencies_versions(self):
        return {"ovms": self.get_ovms_version()}

    def start_ovms(self, startup_delay=5):
        if self.is_running() > 0:
            return True

        log_file_path = Path(self.LOGS_BASE_DIR) / "ovms_server.log"
        self.logger = JSONLogger(log_file_path)
        self.logger.open_log_file()

        try:
            popen_kwargs = {
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
                "env": self.env,
            }

            if self.IS_WINDOWS:
                popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

            self.server_process = subprocess.Popen(self.command, **popen_kwargs)

            stdout_thread = threading.Thread(
                target=stream_reader,
                args=(self.server_process.stdout, self.logger, "out"),
                daemon=True,
            )
            stderr_thread = threading.Thread(
                target=stream_reader,
                args=(self.server_process.stderr, self.logger, "error"),
                daemon=True,
            )

            stdout_thread.start()
            stderr_thread.start()

            time.sleep(startup_delay)
            return True
        except Exception as e:
            print(f"An error occurred during server startup: {e}")
            if self.logger:
                self.logger.close()
                self.logger = None

        return False

    def stop_ovms(self):
        if self.is_running() > 0:
            self.server_process.terminate()
            try:
                self.server_process.wait(timeout=5)
                if self.server_process.poll() is None:
                    self.server_process.kill()
            except subprocess.TimeoutExpired:
                self.server_process.kill()

            if self.logger:
                self.logger.close()
                self.logger = None

            self.server_process = None
        else:
            print("Server process is not currently running.")

    def start_model(
        self,
        model_name: str,
        device: str = "",
        task: str = "",
        extra_params: Dict[str, str] = None,
    ) -> bool:
        if device:
            self.downloader.update_model_device(
                model_name, device=device, task=task, extra_params=extra_params
            )
            self._remove_model_from_config(model_name)

        model_info = self.downloader.get_model_info_for_repo(model_name)
        model_path = str(model_info.get("model_path", "")).replace("\\\\", "/")
        task = model_info.get("task", "UNKNOWN")

        if not self._add_model_to_config(model_name, model_path):
            return False

        if not self.is_running():
            if not self.start_ovms(startup_delay=5):
                return False
        else:
            print(
                "Server already running. Assuming dynamic config will pick up the change..."
            )

        result = self._wait_for_model_availability(model_name, timeout=60)
        self.running_servers[model_name] = {
            "task": task,
            "model_path": model_path,
            "device": device,
        }

        return result

    def stop_model(self, model_name: str) -> bool:
        if not self._remove_model_from_config(model_name):
            return False

        result = not self._get_model_availablity(model_name)
        if model_name in self.running_servers:
            del self.running_servers[model_name]

        return result

    def start_local_model(
        self,
        model_name: str,
        model_path: str,
        task: str = "",
        device: str = "",
        extra_params: Dict[str, str] = None,
    ) -> bool:

        if not Path(model_path).exists():
            raise RuntimeError(f"{model_path} is not a valid folder")

        if device:
            self.downloader.update_model_device(
                model_name,
                device,
                task,
                source_model_path=model_path,
                extra_params=extra_params,
            )
            self._remove_model_from_config(model_name)

        if not self._add_model_to_config(model_name, model_path):
            return False

        if not self.is_running():
            if not self.start_ovms(startup_delay=5):
                return False
        else:
            print(
                "Server already running. Assuming dynamic config will pick up the change..."
            )

        result = self._wait_for_model_availability(model_name, timeout=60)
        self.running_servers[model_name] = {
            "task": task,
            "model_path": model_path,
            "device": device,
        }

        return result

    def stop_local_model(self, model_name: str, model_path: str = "") -> bool:
        if not self._remove_model_from_config(model_name):
            return False

        result = not self._get_model_availablity(model_name)
        if model_name in self.running_servers:
            del self.running_servers[model_name]

        return result

    def is_running(self):
        if self.server_process is not None:
            if self.server_process.poll() is None:
                return self.server_process.pid

        return -1

    def get_server_url(self):
        return f"http://localhost:{self.rest_port}"

    def get_active_servers(self):
        return self.running_servers

    def get_tokenized_inputs(self, model_name, **kwargs) -> ov_genai.TokenizedInputs:
        try:
            model_info = self.downloader.get_model_info_for_repo(model_name)
            model_full_path = (
                Path(model_info["model_base_dir"]) / model_info["model_path"]
            )
            tokenizer = ov_genai.Tokenizer(str(model_full_path))
            input = kwargs.get("content", "")
            add_special = kwargs.get("add_special", True)
            return tokenizer.encode(input, add_special_tokens=add_special)
        except Exception as e:
            print(f"Error getting tokenized inputs for model {model_name}: {e}")
            pass

        return None
