# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os

sys.path.append(os.path.dirname(__file__))
import json
from pathlib import Path
from typing import Generator, List, Any, Dict, Optional
import logging
import re

from worker_common import shared_model_lock

from .ovms_manager import OVMSManager
from .ov_downloader import OVDownloader
from modules.utils import ModelSource, check_repo_id


class OVMSManagerCLI:
    def __init__(
        self,
        verified_model_path: str = "verified.yaml",
        models_directory: str = "models",
        logs_dir: str = "logs",
        instance_dir: str | None = None,
    ):
        Path(models_directory).mkdir(parents=True, exist_ok=True)

        self.models_directory = models_directory
        # Weights are shared between instances; each keeps its own live OVMS config.json here.
        self.instance_dir = instance_dir or models_directory
        Path(self.instance_dir).mkdir(parents=True, exist_ok=True)
        self.config_path = os.path.join(self.instance_dir, "config.json")
        self.logs_dir = logs_dir
        self.is_server_ready = False
        self._load_config(True)

        self.downloader = OVDownloader(
            models_base_dir=models_directory,
            verified_model_file=verified_model_path,
            config_dir=self.instance_dir,
        )
        self.ovms_manager = OVMSManager(
            self.downloader,
            models_dir=self.models_directory,
            logs_dir=self.logs_dir,
            instance_dir=self.instance_dir,
        )

    def _load_config(self, reset: bool = False) -> Dict[str, Any]:
        default_config = {"model_config_list": []}

        if reset:
            with open(self.config_path, "w") as f:
                f.write(json.dumps(default_config))
            return default_config

        try:
            with open(self.config_path, "r") as f:
                return json.loads(f.read())
        except Exception as e:
            try:
                with open(self.config_path, "w") as f:
                    f.write(json.dumps(default_config))
                return default_config
            except Exception as e:
                print(f"Error loading config: {e}")
                sys.exit(1)

    def get_dependencies_versions(self):
        return self.ovms_manager.get_dependencies_versions()

    def _download_lock(self, model_name: str):
        """Serialises download/conversion of one model across instances sharing the models directory."""
        locks_dir = os.path.join(self.models_directory, ".locks")
        os.makedirs(locks_dir, exist_ok=True)
        safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", model_name)
        return shared_model_lock(os.path.join(locks_dir, safe_name))

    def start_server(self) -> bool:
        """Marks the backend ready; OVMS itself starts with the first model, on a free loopback port."""
        self.is_server_ready = True
        return True

    def stop_servers(self):
        return self.ovms_manager.stop_ovms()

    def get_is_server_ready(self) -> bool:
        return self.is_server_ready

    def get_server_url(self) -> Optional[str]:
        """Base URL of the model server; None while no model has started it."""
        return self.ovms_manager.get_server_url()

    # Model states that mean "the model server holds (or is loading) it".
    _SERVED_STATES = {"AVAILABLE", "LOADING", "START"}

    def get_server_status(self) -> List[Any]:
        """Models this engine serves, verified against the model server so health checks see a lost one."""
        if self.ovms_manager.is_running() <= 0:
            return []

        active_servers = self.ovms_manager.get_active_servers()
        server_status = []

        for repo_id in list(active_servers):
            state = self.ovms_manager.get_model_state(repo_id)
            if state not in self._SERVED_STATES:
                logging.warning(
                    f"{repo_id} is listed as running but the model server reports {state}"
                )
                continue
            task = active_servers[repo_id].get("task")
            device = active_servers[repo_id].get("device")
            server_status.append(
                {
                    "task": task,
                    "repo_id": repo_id,
                    "pid": self.ovms_manager.is_running(),
                    "device": device,
                    "url": "",
                    "state": state,
                }
            )

        return server_status

    def start_model(
        self,
        model_name: str,
        device: str,
        task: str = "",
        extra_params: Optional[List[str]] = None,
    ) -> bool:
        return self.ovms_manager.start_model(
            model_name, device, task=task, extra_params=extra_params
        )

    def stop_model(self, model_name: str) -> bool:
        return self.ovms_manager.stop_model(model_name)

    def download_model(
        self, model_name: str, source: ModelSource = ModelSource.HUGGINGFACE
    ) -> Generator[str, None, None]:
        with self._download_lock(model_name):
            progress_generator = self.downloader.download_model(model_name, source)
            for message in progress_generator:
                logging.info(message)
                yield message

    def download_unverified_model(
        self,
        model_name: str,
        task: str,
        target_device: str = "",
        extra_params: str = None,
        source: ModelSource = ModelSource.HUGGINGFACE,
    ) -> Generator[str, None, None]:
        if not self.downloader:
            raise RuntimeError(
                "Downloader not initialized. Call initialize_components first."
            )

        with self._download_lock(model_name):
            progress_generator = self.downloader.download_unverified_model(
                source_model=model_name,
                task=task,
                target_device=target_device,
                extra_params=extra_params,
                source=source,
            )
            for message in progress_generator:
                logging.info(message)
                yield message

    def download_model_cancel(self) -> str:
        return self.downloader.cancel_download_model()

    def delete_model(self, model_name: str) -> bool:
        # Windows can't delete files the model server (or a cached tokenizer) holds open: unload first.
        check_repo_id(model_name, "Model id", exact_parts=None)
        model_info = self.downloader.get_model_info_for_repo(source_model=model_name)
        model_dir = (
            os.path.join(model_info["model_base_dir"], model_info["model_path"])
            if model_info.get("model_path")
            else None
        )
        if not self.ovms_manager.unload_model(model_name, model_dir=model_dir):
            logging.warning(
                f"{model_name} is still loaded by the model server; deleting it anyway"
            )
        return self.downloader.delete_downloaded_model(
            source_model=model_name,
            task=model_info.get("task", ""),
        )

    def start_local_model(
        self,
        repo_id: str,
        task: str,
        context_size: int = 4096,
        device: str = "GPU",
        model_path: str = "",
        extra_params: Optional[List[str]] = None,
    ):
        return self.ovms_manager.start_local_model(
            repo_id, model_path, task, device, extra_params
        )

    def list_models(self):
        return self.downloader.list_models()

    def list_active_models(self):
        active_servers = self.ovms_manager.get_active_servers()

        detailed_list = []
        for repo_id in active_servers:
            detailed_list.append(
                {"repo_id": repo_id, "task": active_servers[repo_id].get("task", "")}
            )

        return detailed_list

    def get_model_dir(self):
        return self.downloader.get_model_dir()

    def get_tokenized_inputs(self, model_name, **kwargs):
        tokenized_inputs = self.ovms_manager.get_tokenized_inputs(model_name, **kwargs)
        if tokenized_inputs:
            tokens = tokenized_inputs.input_ids.data.flatten().tolist()
            n_tokens = len(tokens)
            return {"tokens": tokens, "n_tokens": n_tokens}

        return {"tokens": [], "n_tokens": -1}
