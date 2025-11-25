# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import subprocess # nosec - disable B404:import-subprocess check
import time
import os
import sys
sys.path.append(os.path.dirname(__file__))
import requests
import json
import openvino_genai as ov_genai
from pathlib import Path
from urllib.parse import quote

from modules.utils import get_resource_path
from .ov_downloader import OVDownloader

class OVMSManager:
    OVMS_EXECUTABLE = "./engine/ovms/ovms.exe"
    CONFIG_PATH = "./models/OV/config.json"
    REST_PORT = "9000"
    LOGS_BASE_DIR = "logs"

    def __init__(self, ovdownloader : OVDownloader, debug: bool = False):
        Path(self.LOGS_BASE_DIR).mkdir(parents=True, exist_ok=True)
        
        self.debug = debug
        self.downloader = ovdownloader
        self.OVMS_EXECUTABLE = get_resource_path(self.OVMS_EXECUTABLE)
        self.CONFIG_PATH = self.CONFIG_PATH

        self.server_process = None
        self.command = [self.OVMS_EXECUTABLE, "--config_path", self.CONFIG_PATH, "--rest_port", self.REST_PORT]

        self.env = os.environ.copy()
        self._current_process = None
        try:
            ovms_parent_path = os.path.dirname(self.OVMS_EXECUTABLE)
            ovms_parent_path = str(Path(ovms_parent_path))

            if not ovms_parent_path or ovms_parent_path == '.':
                ovms_path_search = self._find_executable_path(self.OVMS_EXECUTABLE)
                if ovms_path_search:
                    ovms_parent_path = os.path.dirname(ovms_path_search)
                else:
                    ovms_parent_path = "."
            
            path_separator = os.pathsep
            current_path = self.env.get('PATH', '')
            new_path_entries = [
                os.path.join(ovms_parent_path, "python"),
                os.path.join(ovms_parent_path, "python", "python312")
            ]
            
            self.env["PYTHONHOME"] = new_path_entries[0]
            self.env["PYTHONPATH"] = new_path_entries[1]
            self.env['PATH'] = path_separator.join(new_path_entries) + path_separator + current_path

        except Exception as e:
            print(e)

    def _find_executable_path(self, name):
        for part in os.environ["PATH"].split(os.pathsep):
            exe_path = os.path.join(part, name)
            if os.path.exists(exe_path):
                return exe_path
            
        return None
    
    def _wait_for_model_availability(self, model_name, timeout=60, poll_interval=2):
        encoded_model_name = quote(model_name, safe='')
        status_url = f"http://localhost:{self.REST_PORT}/v1/models/{encoded_model_name}"

        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                response = requests.get(status_url, timeout=1) 
                
                if response.status_code == 200:
                    status_data = response.json()
                    
                    if status_data.get('model_version_status'):
                        version_status = status_data['model_version_status'][0]
                        state = version_status['state']
                        
                        if state == "AVAILABLE":
                            return True
                        elif state == "UNAVAILABLE" or state == "END":
                            return False
                    
            except requests.exceptions.ConnectionError:
                pass 
            except Exception:
                pass 
            
            time.sleep(poll_interval)

        return False
    
    def _add_model_to_config(self, model_name):
        model_info = self.downloader.get_model_info_for_repo(model_name)
        model_path = str(model_info["model_path"]).replace("\\\\", "/")

        config_command = [
            self.OVMS_EXECUTABLE,
            "--add_to_config",
            "--config_path", self.CONFIG_PATH,
            "--model_name", model_name,
            "--model_path", model_path
        ]

        try:
            _ = subprocess.run(
                config_command, 
                check=True, 
                capture_output=True, 
                text=True,
                env=self.env
            )
        except Exception as e:
            pass

        return True

    def _remove_model_from_config(self, model_name):
        config_command = [
            self.OVMS_EXECUTABLE,
            "--remove_from_config", 
            "--config_path", self.CONFIG_PATH,
            "--model_name", model_name
        ]

        try:
            _ = subprocess.run(
                config_command, 
                check=True,
                capture_output=True, 
                text=True,
                env=self.env
            )
        except Exception as e:
            pass

        return True

    def start_ovms(self, startup_delay=5):
        if self.is_running() > 0:
            return True
        
        try:
            log_handle = open(f"{self.LOGS_BASE_DIR}/ovms.log", "w")
            self.server_process = subprocess.Popen(
                self.command,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                env=self.env,
                creationflags=subprocess.CREATE_NEW_CONSOLE if self.debug else subprocess.CREATE_NO_WINDOW
            )
            time.sleep(startup_delay)
            return True
        except Exception as e:
            print(f"An error occurred during server startup: {e}")
        
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
            self.server_process = None
        else:
            print("Server process is not currently running.")


    def start_model(self, model_name: str, device: str = "") -> bool:
        if device:
            self.downloader.update_model_device(model_name, device)
            self._remove_model_from_config(model_name)

        if not self._add_model_to_config(model_name):
            return False

        if not self.is_running():
             if not self.start_ovms(startup_delay=5):
                 return False
        else:
            print("Server already running. Assuming dynamic config will pick up the change...")

        return self._wait_for_model_availability(model_name, timeout=60)
    
    def stop_model(self, model_name: str) -> bool:
        if not self._remove_model_from_config(model_name):
            return False
        
        return not self._wait_for_model_availability(model_name, timeout=60)


    def is_running(self):
        if self.server_process is not None:
            if self.server_process.poll() is None:
                return self.server_process.pid
        
        return -1

    def get_current_active_model(self, model_name: str):
        model_info = self.downloader.get_model_info_for_repo(model_name)
    
    def get_server_url(self):
        return f"http://localhost:{self.REST_PORT}"

    def get_running_models(self):
        with open(self.CONFIG_PATH, "r") as rfile:
            config = rfile.read()

        json_cfg = json.loads(config)
        model_config_list = json_cfg.get("model_config_list", [])
    
        return model_config_list
    
    def get_tokenized_inputs(self, model_name, **kwargs) -> ov_genai.TokenizedInputs:
        try:
            model_info = self.downloader.get_model_info_for_repo(model_name)
            model_full_path = Path(model_info["model_base_dir"]) / model_info["model_path"]
            tokenizer = ov_genai.Tokenizer(str(model_full_path))
            input = kwargs.get("content", "")
            add_special = kwargs.get("add_special", True)
            return tokenizer.encode(input, add_special_tokens=add_special)
        except:
            pass

        return None