# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os

sys.path.append(os.path.dirname(__file__))
import json
from pathlib import Path
from typing import Generator, List, Any, Dict
import logging

from .ovms_manager import OVMSManager
from .ov_downloader import OVDownloader
from modules.utils import ModelSource


class OVMSManagerCLI:
    def __init__(
        self,
        verified_model_path: str = "verified.yaml",
        models_directory: str = "models",
        logs_dir: str = "logs",
        rest_port: int = 9000,
    ):
        Path(models_directory).mkdir(parents=True, exist_ok=True)

        self.models_directory = models_directory
        self.logs_dir = logs_dir
        self._load_config(True)

        self.downloader = OVDownloader(
            models_base_dir=models_directory, verified_model_file=verified_model_path
        )
        self.ovms_manager = OVMSManager(
            self.downloader,
            models_dir=self.models_directory,
            logs_dir=self.logs_dir,
            rest_port=rest_port,
        )

    def _load_config(self, reset: bool = False) -> Dict[str, Any]:
        default_config = {"model_config_list": []}

        if reset:
            with open(f"{self.models_directory}/config.json", "w") as f:
                f.write(json.dumps(default_config))
            return default_config

        try:
            with open(f"{self.models_directory}/config.json", "r") as f:
                return json.loads(f.read())
        except Exception as e:
            try:
                with open(f"{self.models_directory}/config.json", "w") as f:
                    f.write(json.dumps(default_config))
                return default_config
            except Exception as e:
                print(f"Error loading config: {e}")
                sys.exit(1)

    def get_dependencies_versions(self):
        return self.ovms_manager.get_dependencies_versions()

    def start_server(self) -> bool:
        return self.ovms_manager.start_ovms()

    def stop_servers(self):
        return self.ovms_manager.stop_ovms()

    def get_is_server_ready(self) -> bool:
        if self.ovms_manager.is_running() > 0:
            return True

        return False

    def get_server_url(self) -> str:
        return self.ovms_manager.get_server_url()

    def get_server_status(self) -> List[Any]:
        active_servers = self.ovms_manager.get_active_servers()

        server_status = []

        for repo_id in active_servers:
            task = active_servers[repo_id].get("task")
            device = active_servers[repo_id].get("device")

            server_status.append(
                {
                    "task": task,
                    "repo_id": repo_id,
                    "pid": self.ovms_manager.is_running(),
                    "device": device,
                    "url": "",
                }
            )

        if self.ovms_manager.is_running():
            return server_status

        return []

    def start_model(
        self,
        model_name: str,
        device: str,
        task: str = "",
        extra_params: Dict[str, str] = None,
    ) -> bool:
        return self.ovms_manager.start_model(
            model_name, device, task=task, extra_params=extra_params
        )

    def stop_model(self, model_name: str) -> bool:
        return self.ovms_manager.stop_model(model_name)

    def download_model(
        self, model_name: str, source: ModelSource = ModelSource.HUGGINGFACE
    ) -> Generator[str, None, None]:
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
        self.ovms_manager.stop_model(model_name)
        return self.downloader.delete_downloaded_model(source_model=model_name)

    def start_local_model(
        self,
        repo_id: str,
        task: str,
        context_size: int = 4096,
        device: str = "GPU",
        model_path: str = "",
        extra_params: str = None,
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
