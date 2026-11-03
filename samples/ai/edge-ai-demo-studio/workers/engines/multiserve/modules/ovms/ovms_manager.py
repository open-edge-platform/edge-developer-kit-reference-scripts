# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""One OpenVINO Model Server for every OpenVINO model the engine serves.

Runs in ``--config_path`` mode on this instance's ``config.json``, edited with ``ovms --add_to_config`` /
``--remove_from_config``. Binary and environment come from the shared ``model_downloader.ovms_env``, so
the engine serves in the same environment ``ovms --pull`` converted in.
"""

import os
import re
import subprocess  # nosec - runs the bundled OVMS binary only
import sys
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

sys.path.append(os.path.dirname(__file__))
import requests
import openvino_genai as ov_genai

from model_downloader import OvmsNotFoundError, ovms_env
from modules.utils import (
    JSONLogger,
    LOOPBACK_HOST,
    get_resource_path,
    loopback_port_is_free,
    pick_free_loopback_port,
)
from worker_common import OvmsServer, startup_timeout
from .ov_downloader import OVDownloader


class OVMSManager:
    IS_WINDOWS = os.name == "nt"
    #: Tokenizers kept loaded for /v1/tokenize, most recently used last.
    TOKENIZER_CACHE_SIZE = 4
    #: Another process can take the picked port before OVMS binds it.
    PORT_ATTEMPTS = 3

    # PyInstaller fallback when the workers/ sentinel is missing: thirdparty/ovms beside the bundle.
    _LEGACY_OVMS_DIR = str(Path(__file__).resolve().parents[4] / "thirdparty" / "ovms")

    def __init__(
        self,
        ovdownloader: OVDownloader,
        models_dir: str = os.path.join(".", "models", "OV"),
        logs_dir: str = "logs",
        debug: bool = False,
        instance_dir: str | None = None,
    ):
        self.LOGS_BASE_DIR = logs_dir
        Path(self.LOGS_BASE_DIR).mkdir(parents=True, exist_ok=True)

        self.debug = debug
        self.downloader = ovdownloader
        # One config.json per instance. OVMS resolves relative base_path entries against this file,
        # so entries are written absolute.
        self.CONFIG_PATH = os.path.join(instance_dir or models_dir, "config.json")
        self.models_dir = models_dir
        # Picked when the server starts (``start_ovms``); None while it isn't running.
        self.rest_port: Optional[int] = None

        self.running_servers = {}
        self.logger: Optional[JSONLogger] = None
        # Resolved on first use, so the engine (llama.cpp only) starts before setup.sh installs OVMS.
        self._ovms = None
        self._server: Optional[OvmsServer] = None
        self._tokenizers: "OrderedDict[str, Tuple[int, ov_genai.Tokenizer]]" = (
            OrderedDict()
        )
        self._tokenizers_lock = threading.Lock()

    def __del__(self):
        self.stop_ovms()

    # OVMS location and environment

    def _ovms_env(self):
        if self._ovms is None:
            try:
                self._ovms = ovms_env()
            except OvmsNotFoundError:
                self._ovms = ovms_env(home=get_resource_path(self._LEGACY_OVMS_DIR))
        return self._ovms

    @property
    def OVMS_EXECUTABLE(self) -> str:
        return str(self._ovms_env().executable)

    @property
    def env(self) -> Dict[str, str]:
        return self._ovms_env().env

    @property
    def server_process(self):
        return self._server.process if self._server is not None else None

    def _run_ovms(self, args, **kwargs):
        ovms = self._ovms_env()
        return subprocess.run(  # nosec
            [str(ovms.executable), *args], env=ovms.env, **kwargs
        )

    # Model availability

    def _rest_url(self, path: str) -> Optional[str]:
        """``path`` on the running server's REST API; None while it is not running."""
        if self.rest_port is None or self.is_running() <= 0:
            return None
        return f"http://{LOOPBACK_HOST}:{self.rest_port}{path}"

    def _wait_for_model_availability(self, model_name, timeout=None, poll_interval=0.1):
        status_url = self._rest_url("/v1/config/reload")
        if status_url is None:
            return False

        if timeout is None:
            timeout = startup_timeout()
        deadline = time.monotonic() + timeout
        while (remaining := deadline - time.monotonic()) > 0:
            if self.is_running() <= 0:
                print(f"Warning: the model server exited while loading {model_name}")
                return False
            try:
                response = requests.post(status_url, timeout=(1, remaining))
                if response.status_code != 200:
                    state = self.get_model_state(model_name)
                    if state != "AVAILABLE":
                        print(
                            f"Error: the model server could not load {model_name} "
                            f"(state {state}): {response.text.strip()}"
                        )
                    return state == "AVAILABLE"

                versions = (response.json().get(model_name) or {}).get(
                    "model_version_status"
                ) or []
                if versions:
                    state = versions[0].get("state")
                    error_code = (versions[0].get("status") or {}).get("error_code")
                    if state == "AVAILABLE":
                        return True
                    if (
                        state in ("UNAVAILABLE", "END")
                        or error_code == "FAILED_PRECONDITION"
                    ):
                        return False

            except requests.exceptions.ConnectionError:
                pass
            except requests.exceptions.Timeout:
                break
            except Exception as e:
                print(
                    f"Warning: Error checking model availability for {model_name}: {e}"
                )

            time.sleep(poll_interval)

        print(f"Warning: {model_name} was not loaded within {timeout}s")
        return False

    def get_model_state(self, model_name: str) -> str:
        """The model's OVMS state (AVAILABLE, LOADING, END, ...), MISSING if the server doesn't know it,
        or UNREACHABLE if the server doesn't answer."""
        status_url = self._rest_url("/v1/config")
        if status_url is None:
            return "UNREACHABLE"
        try:
            response = requests.get(status_url, timeout=1)
            if response.status_code != 200:
                return "UNREACHABLE"
            versions = (response.json().get(model_name) or {}).get(
                "model_version_status"
            ) or []
            return versions[0].get("state", "MISSING") if versions else "MISSING"
        except Exception:
            return "UNREACHABLE"

    def _get_model_availablity(self, model_name):
        status_url = self._rest_url("/v1/config")
        if status_url is None:
            return False

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

    # config.json

    def _absolute_model_path(self, model_path: str) -> str:
        """Config entries must not depend on where config.json lives."""
        if not model_path or os.path.isabs(model_path):
            return model_path
        base = getattr(self.downloader, "models_base_dir", None) or self.models_dir
        return os.path.abspath(os.path.join(base, model_path))

    def _add_model_to_config(self, model_name: str, model_path: str):
        model_path = self._absolute_model_path(model_path)
        try:
            self._run_ovms(
                [
                    "--add_to_config",
                    "--config_path",
                    self.CONFIG_PATH,
                    "--model_name",
                    model_name,
                    "--model_path",
                    model_path,
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        except Exception as e:
            print(f"Error adding model {model_name} to config: {e}")

        return True

    def _remove_model_from_config(self, model_name: str):
        try:
            self._run_ovms(
                [
                    "--remove_from_config",
                    "--config_path",
                    self.CONFIG_PATH,
                    "--model_name",
                    model_name,
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        except Exception:
            # Removing a model that is not in the config is not an error.
            pass

        return True

    def get_ovms_version(self):
        try:
            result = self._run_ovms(
                ["--version"], capture_output=True, text=True, check=True
            )
            match = re.search(
                r"OpenVINO Model Server\s+([\d\.]+[a-z\d]+)", result.stdout
            )
            return match.group(1) if match else "unknown"
        except (FileNotFoundError, OvmsNotFoundError):
            return "not found"
        except subprocess.CalledProcessError:
            return "unknown"

    def get_dependencies_versions(self):
        return {"ovms": self.get_ovms_version()}

    # Server lifecycle

    def start_ovms(self, startup_delay=5):
        """Starts the model server on a free loopback port, loading whatever ``config.json`` lists.

        A server gone after ``startup_delay`` seconds because its port got taken is retried on another
        port, up to ``PORT_ATTEMPTS`` times.
        """
        if self.is_running() > 0:
            return True

        log_file_path = Path(self.LOGS_BASE_DIR) / "ovms_server.log"
        self.logger = JSONLogger(log_file_path)
        self.logger.open_log_file()
        logger = self.logger

        attempt = 0
        while True:
            attempt += 1
            port = pick_free_loopback_port()
            try:
                self._server = OvmsServer(
                    [
                        "--config_path",
                        self.CONFIG_PATH,
                        "--rest_port",
                        str(port),
                        "--rest_bind_address",
                        LOOPBACK_HOST,
                        "--file_system_poll_wait_seconds",
                        "0",
                    ],
                    env=self._ovms_env(),
                    on_output=logger.log_message,
                    name="OVMS",
                )
                self._server.start()
            except Exception as e:
                print(f"An error occurred during server startup: {e}")
                break

            self.rest_port = port
            time.sleep(startup_delay)
            if self._server.running:
                return True

            code = self._server.returncode
            if attempt < self.PORT_ATTEMPTS and not loopback_port_is_free(port):
                print(
                    f"Port {port} was taken by another process before OVMS could "
                    f"bind it; starting it again on another port",
                    file=sys.stderr,
                )
                continue
            print(f"OVMS exited with code {code} during startup; see {log_file_path}")
            break

        self._server = None
        self.rest_port = None
        if self.logger:
            self.logger.close()
            self.logger = None

        return False

    def stop_ovms(self):
        if self.is_running() > 0:
            self._server.stop(timeout=5)
            if self.logger:
                self.logger.close()
                self.logger = None
            self._server = None
        else:
            print("Server process is not currently running.")
        self.rest_port = None

    def start_model(
        self,
        model_name: str,
        device: str = "",
        task: str = "",
        extra_params: Optional[List[str]] = None,
    ) -> bool:
        # Until this server has loaded the graph, no sibling may pull it for another device (serve_lock).
        with self.downloader.serve_lock(model_name, task):
            return self._start_model(model_name, device, task, extra_params)

    def _start_model(
        self,
        model_name: str,
        device: str,
        task: str,
        extra_params: Optional[List[str]],
    ) -> bool:
        if device:
            reload = self.downloader.update_model_device(
                model_name, device=device, task=task, extra_params=extra_params
            )
            self._remove_model_from_config(model_name)
        else:
            reload = self.downloader.ensure_servable(model_name)

        model_info = self.downloader.get_model_info_for_repo(model_name)
        model_path = str(model_info.get("model_path", "")).replace("\\\\", "/")
        if reload:
            # A model loaded before its files were fixed keeps the old ones until unloaded.
            self.unload_model(
                model_name, model_dir=self._absolute_model_path(model_path)
            )
        task = model_info.get("task", "UNKNOWN")

        if not self._add_model_to_config(model_name, model_path):
            return False

        # is_running() is the server's pid, or -1 when none runs.
        if self.is_running() <= 0:
            if not self.start_ovms(startup_delay=5):
                return False
        else:
            print(
                "Server already running. Assuming dynamic config will pick up the change..."
            )

        result = self._wait_for_model_availability(model_name)
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

    #: States in which the model server still has a model's files open.
    _HOLDING_STATES = {"START", "LOADING", "AVAILABLE", "UNLOADING"}

    def unload_model(
        self, model_name: str, model_dir: Optional[str] = None, timeout: float = 60.0
    ) -> bool:
        """Removes ``model_name`` from the config and waits until the server lets go of its files
        (Windows can't delete open files), dropping tokenizers cached from ``model_dir``.

        ``False`` if the server still reports the model after ``timeout``. Blocking.
        """
        self._remove_model_from_config(model_name)
        self.running_servers.pop(model_name, None)
        if model_dir:
            self._forget_tokenizers(Path(model_dir))

        reload_url = self._rest_url("/v1/config/reload")
        if reload_url is None:
            return True

        # The server runs without file system polling, so a config change needs an explicit reload.
        try:
            requests.post(reload_url, timeout=timeout)
        except requests.exceptions.RequestException as e:
            print(f"Warning: config reload to unload {model_name} failed: {e}")

        deadline = time.monotonic() + timeout
        while self.get_model_state(model_name) in self._HOLDING_STATES:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.25)
        return True

    def _forget_tokenizers(self, model_dir: Path) -> None:
        try:
            root = model_dir.resolve()
        except OSError:
            return
        with self._tokenizers_lock:
            for key in list(self._tokenizers):
                path = Path(key)
                if path == root or root in path.parents:
                    del self._tokenizers[key]

    def start_local_model(
        self,
        model_name: str,
        model_path: str,
        task: str = "",
        device: str = "",
        extra_params: Optional[List[str]] = None,
    ) -> bool:

        if not Path(model_path).exists():
            raise RuntimeError(f"{model_path} is not a valid folder")

        # See start_model.
        with self.downloader.serve_lock(model_name, task, source_model_path=model_path):
            return self._start_local_model(
                model_name, model_path, task, device, extra_params
            )

    def _start_local_model(
        self,
        model_name: str,
        model_path: str,
        task: str,
        device: str,
        extra_params: Optional[List[str]],
    ) -> bool:
        if device:
            reload = self.downloader.update_model_device(
                model_name,
                device,
                task,
                source_model_path=model_path,
                extra_params=extra_params,
            )
            self._remove_model_from_config(model_name)
        else:
            reload = self.downloader.ensure_servable(
                model_name, source_model_path=model_path
            )
        if reload:
            # See start_model.
            self.unload_model(model_name, model_dir=model_path)

        if not self._add_model_to_config(model_name, model_path):
            return False

        if self.is_running() <= 0:
            if not self.start_ovms(startup_delay=5):
                return False
        else:
            print(
                "Server already running. Assuming dynamic config will pick up the change..."
            )

        result = self._wait_for_model_availability(model_name)
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
        if self._server is not None and self._server.running:
            return self._server.pid

        return -1

    def get_server_url(self) -> Optional[str]:
        """Base URL of the running model server; None while it is not running."""
        return self._rest_url("")

    def get_active_servers(self):
        return self.running_servers

    def _get_tokenizer(self, model_full_path: Path) -> ov_genai.Tokenizer:
        """The model's tokenizer, cached until its files change (a re-upload or re-download)."""
        tokenizer_file = model_full_path / "openvino_tokenizer.xml"
        stamp_path = tokenizer_file if tokenizer_file.exists() else model_full_path
        stamp = stamp_path.stat().st_mtime_ns
        key = str(model_full_path.resolve())

        with self._tokenizers_lock:
            cached = self._tokenizers.get(key)
            if cached and cached[0] == stamp:
                self._tokenizers.move_to_end(key)
                return cached[1]

        tokenizer = ov_genai.Tokenizer(str(model_full_path))
        with self._tokenizers_lock:
            self._tokenizers[key] = (stamp, tokenizer)
            self._tokenizers.move_to_end(key)
            while len(self._tokenizers) > self.TOKENIZER_CACHE_SIZE:
                self._tokenizers.popitem(last=False)
        return tokenizer

    def get_tokenized_inputs(self, model_name, **kwargs) -> ov_genai.TokenizedInputs:
        """Blocking (loads model files on first use): call off the event loop."""
        try:
            model_info = self.downloader.get_model_info_for_repo(model_name)
            model_full_path = (
                Path(model_info["model_base_dir"]) / model_info["model_path"]
            )
            tokenizer = self._get_tokenizer(model_full_path)
            input = kwargs.get("content", "")
            add_special = kwargs.get("add_special", True)
            return tokenizer.encode(input, add_special_tokens=add_special)
        except Exception as e:
            print(f"Error getting tokenized inputs for model {model_name}: {e}")
            pass

        return None
