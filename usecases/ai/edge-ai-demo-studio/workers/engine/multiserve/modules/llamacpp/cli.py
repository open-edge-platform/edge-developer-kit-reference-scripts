# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import yaml
import sys
import os
from typing import Dict, Any, List, Generator

sys.path.append(os.path.dirname(__file__))

from .llama_cpp_manager import LlamaCPPManager
from .gguf_downloader import GGUFDownloader


class LlamaManagerCLI:
    def __init__(
        self,
        config_path: str = "config.yaml",
        verified_model_path: str = "verified.yaml",
        models_directory: str = "models",
        logs_dir: str = "logs",
        port: int = 9090,
        backend: str = "vulkan",
    ):
        self.config_path = config_path
        self.verified_model_path = verified_model_path
        self.models_directory = models_directory
        self.logs_dir = logs_dir
        self.usable_models = {}

        self.config = self._load_config()

        self.is_server_ready = False

        self.downloader = GGUFDownloader(
            base_url=self.config.get("model_hub_endpoint", "https://huggingface.co/"),
            models_base_dir=self.models_directory,
            verified_model_file=self.verified_model_path,
        )
        self.manager = LlamaCPPManager(
            models_base_dir=self.models_directory,
            logs_dir=self.logs_dir,
            downloader=self.downloader,
            server_port=port,
            backend=backend,
        )

        _ = self.list_models()

    def _load_config(self) -> Dict[str, Any]:
        default_config = {
            "active_models": {
                "text_generation": {
                    "repo_id": None,
                    "n_ctx": 4096,
                    "n_gpu_layers": 35,
                    "model_path": None,
                    "mmproj_path": None,
                },
                "embeddings": {
                    "repo_id": None,
                    "n_ctx": 4096,
                    "n_gpu_layers": 35,
                    "model_path": None,
                    "mmproj_path": None,
                },
                "rerank": {
                    "repo_id": None,
                    "n_ctx": 4096,
                    "n_gpu_layers": 35,
                    "model_path": None,
                    "mmproj_path": None,
                },
                "multimodal": {
                    "repo_id": None,
                    "n_ctx": 4096,
                    "n_gpu_layers": 35,
                    "model_path": None,
                    "mmproj_path": None,
                },
            },
            "model_hub_endpoint": "https://huggingface.co/",
        }

        try:
            with open(self.config_path, "r") as f:
                return yaml.safe_load(f)
        except FileNotFoundError:
            try:
                with open(self.config_path, "w") as f:
                    yaml.dump(default_config, f, sort_keys=False)
                return default_config
            except Exception as e:
                print(
                    f"Error: Failed to create default config file {self.config_path}: {e}",
                    file=sys.stderr,
                )
                sys.exit(1)
        except yaml.YAMLError as e:
            print(
                f"Error: Failed to parse YAML file {self.config_path}: {e}",
                file=sys.stderr,
            )
            sys.exit(1)
        except Exception as e:
            print(
                f"Error: Unexpected error while loading config file {self.config_path}: {e}",
                file=sys.stderr,
            )
            sys.exit(1)

    def _update_active_model_in_config(
        self,
        new_hf_repo_with_tag: str,
        task: str,
        model_path: str = "",
        mmproj_path: str = "",
        **kwargs,
    ):
        active_models = self.config.get("active_models", {})

        if task not in active_models:
            print(
                f"Warning: Task '{task}' not found in config.yaml. Skipping config update.",
                file=sys.stderr,
            )
            return

        self.config["active_models"][task]["repo_id"] = new_hf_repo_with_tag
        self.config["active_models"][task]["model_path"] = model_path
        self.config["active_models"][task]["mmproj_path"] = mmproj_path
        self.config["active_models"][task]["n_ctx"] = kwargs.get("n_ctx")
        self.config["active_models"][task]["n_gpu_layers"] = kwargs.get("n_gpu_layers")

        try:
            with open(self.config_path, "w") as f:
                yaml.dump(self.config, f, sort_keys=False)
        except Exception as e:
            print(f"Failed to write updated config.yaml: {e}")

    def _get_active_model_kwargs(self, task_type):
        active_models: Dict[str, Dict[str, Any]] = self.config.get("active_models", {})
        if not active_models:
            return None

        for task, params in active_models.items():
            if task_type == task:
                return params

        return None

    def get_dependencies_versions(self) -> Dict[str, str]:
        return self.manager.get_dependencies_versions()

    def get_is_server_ready(self) -> bool:
        return self.is_server_ready

    def get_model_task(self, hf_repo_with_tag: str) -> Dict[str, str]:
        servers = self.manager.get_server_info()
        for task in servers:
            if servers[task]["repo_id"] == hf_repo_with_tag:
                return task

        if hf_repo_with_tag in self.usable_models.keys():
            return self.downloader.get_model_info_for_repo(hf_repo_with_tag)

        raise ValueError(f"{hf_repo_with_tag} is not a valid model.")

    def get_task_metadata(self, task: str) -> int:
        return self.manager.get_server_info()[task]

    def download_active_models(self):
        if not self.downloader:
            raise RuntimeError(
                "Downloader not initialized. Call initialize_components first."
            )

        active_models_config: Dict[str, Dict[str, Any]] = self.config.get(
            "active_models", {}
        )
        if not active_models_config:
            return

        for task, params in active_models_config.items():
            hf_repo_with_tag = params.get("repo_id")

            if not hf_repo_with_tag:
                continue

            try:
                progress_generator = self.downloader.download_model(
                    hf_repo_with_tag=hf_repo_with_tag
                )

                for message in progress_generator:
                    if message.startswith("\rProgress"):
                        sys.stdout.write(message)
                        sys.stdout.flush()

            except Exception as e:
                print(
                    f"Critical error during download of {hf_repo_with_tag}: {e}",
                    file=sys.stderr,
                )

    def download_model(self, hf_repo_with_tag: str) -> Generator[str, None, None]:
        progress_generator = self.downloader.download_model(
            hf_repo_with_tag=hf_repo_with_tag
        )
        for message in progress_generator:
            yield message

    def download_unverified_model(
        self, hf_repo_with_tag: str, task: str
    ) -> Generator[str, None, None]:
        if not self.downloader:
            raise RuntimeError(
                "Downloader not initialized. Call initialize_components first."
            )

        progress_generator = self.downloader.download_unverified_model(
            hf_repo_with_tag=hf_repo_with_tag, task=task
        )
        for message in progress_generator:
            yield message

    def download_model_cancel(self) -> str:
        return self.downloader.cancel_download_model()

    def delete_model(self, hf_repo_with_tag: str) -> bool:
        params = self._get_active_model_kwargs(hf_repo_with_tag)

        if not params:
            if self.downloader.delete_downloaded_model(
                hf_repo_with_tag=hf_repo_with_tag
            ):
                return True
        else:
            self.stop_model(hf_repo_with_tag)
            if self.downloader.delete_downloaded_model(
                hf_repo_with_tag=hf_repo_with_tag
            ):
                return True

        return False

    def list_models(self):
        verified_models = self.downloader.list_verified_models()
        downloaded_models = self.downloader.list_downloaded_models()

        verified_map = {}
        for repo_id, task_type, quantizations, sources in verified_models:
            key = (repo_id, task_type)
            verified_map[key] = (quantizations, sources)

        downloaded_map = {}
        for repo_id, task_type, quantizations in downloaded_models:
            key = (repo_id, task_type)
            downloaded_map[key] = quantizations

        all_keys = set(verified_map.keys()) | set(downloaded_map.keys())

        detailed_list = []
        for repo_id, task_type in all_keys:
            verified_quant, sources = verified_map.get((repo_id, task_type), ([], []))
            detailed_list.append(
                {
                    "repo_id": repo_id,
                    "task_type": task_type,
                    "downloaded": downloaded_map.get((repo_id, task_type), []),
                    "verified": verified_quant,
                    "sources": sources,
                }
            )

        for model in detailed_list:
            for quant in model.get("downloaded", []):
                repo_id = model["repo_id"]
                repo_id_with_tag = f"{repo_id}:{quant}"
                self.usable_models[repo_id_with_tag] = model

        return detailed_list

    def start_server(self) -> None:
        self.is_server_ready = True

    def start_or_swap_model(
        self, hf_repo_with_tag, device: str = "GPU", timeout: int = 30
    ) -> bool:
        try:
            _, _ = self.manager.get_model_file_path(hf_repo_with_tag)
            model_task = self.downloader.get_model_info_for_repo(hf_repo_with_tag)
            found_repo = self._get_active_model_kwargs(model_task)

            if found_repo:
                params = {key: found_repo[key] for key in ["n_ctx", "n_gpu_layers"]}
                params["device"] = device
                params["timeout"] = timeout

                (_, new_repo_name) = self.manager.swap_model(hf_repo_with_tag, **params)
                self._update_active_model_in_config(new_repo_name, model_task, **params)

                return True

        except Exception as e:
            print(f"Error during start_or_swap_model: {e}")
            return False

    def stop_model(self, hf_repo_with_tag) -> bool:
        try:
            model_task = self.downloader.get_model_info_for_repo(hf_repo_with_tag)
        except ValueError:
            print(
                f"Warning: Model {hf_repo_with_tag} not found in verified list. Attempting to stop server anyway."
            )
            model_task = None

        self.manager.stop_server(hf_repo_with_tag=hf_repo_with_tag)
        if model_task:
            current_config = self._get_active_model_kwargs(model_task)
            n_ctx = current_config.get("n_ctx") if current_config else None
            n_gpu_layers = (
                current_config.get("n_gpu_layers") if current_config else None
            )
            self._update_active_model_in_config(
                new_hf_repo_with_tag=None,
                task=model_task,
                n_ctx=n_ctx,
                n_gpu_layers=n_gpu_layers,
            )
            return True

        return False

    def start_local_model(
        self,
        repo_id,
        task,
        context_size: int = 4096,
        device: str = "GPU",
        model_path: str = "",
        mmproj_path: str = "",
        extra_args: List[str] = [],
        timeout: int = 120,
    ) -> int:
        params = {
            "n_ctx": context_size,
            "model_path": model_path,
            "mmproj_path": mmproj_path,
            "device": device,
            "extra_args": extra_args,
            "timeout": timeout,
        }

        server_props = self.manager.start_server_with_file(repo_id, task, **params)
        recommended_ctx = server_props.get("default_generation_settings", {}).get(
            "n_ctx", 0
        )
        params["n_ctx"] = recommended_ctx
        self._update_active_model_in_config(repo_id, task, **params)

        return recommended_ctx

    def stop_local_model(self, repo_id, task):
        try:
            self.manager.stop_server_with_file(repo_id=repo_id, task=task)

            if task:
                current_config = self._get_active_model_kwargs(task)
                n_ctx = current_config.get("n_ctx") if current_config else None
                n_gpu_layers = (
                    current_config.get("n_gpu_layers") if current_config else None
                )
                self._update_active_model_in_config(
                    new_hf_repo_with_tag=None,
                    task=task,
                    n_ctx=n_ctx,
                    n_gpu_layers=n_gpu_layers,
                )

                return True

        except Exception as e:
            print(f"Error during stop_local_model: {e}")
            return False

        return False

    def is_active_model(self, task, model_id: str):
        current_model = self.manager.get_current_active_model(task)
        if model_id != current_model:
            raise ValueError(
                f"{model_id} not the active model. Please start the model first."
            )

    def get_server_url(self, task) -> str:
        if task not in self.manager.running_servers:
            return None

        return self.manager.running_servers[task]["url"]

    def get_server_status(self) -> List[Any]:
        server_status = []

        for task in self.manager.running_servers:
            params = self.manager.running_servers[task]
            try:
                (_, pid) = self.manager.get_server_status(task)
            except:
                pid = -1

            server_status.append(
                {
                    "task": task,
                    "repo_id": params.get("repo_id"),
                    "pid": pid,
                    "device": "GPU" if params.get("ngl", 0) > 0 else "CPU",
                    "url": self.get_server_url(task),
                }
            )

        return server_status

    def stop_servers(self):
        self.manager.stop_server()

    def get_model_dir(self):
        return self.downloader.get_model_dir()
