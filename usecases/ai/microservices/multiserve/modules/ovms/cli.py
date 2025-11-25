# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os
sys.path.append(os.path.dirname(__file__))
import json
from pathlib import Path
from typing import Generator, List, Any, Dict

from .ovms_manager import OVMSManager 
from .ov_downloader import OVDownloader

class OVMSManagerCLI:
    def __init__(self, verified_model_path: str = "verified.yaml", models_directory: str = "models"):
        Path(models_directory).mkdir(parents=True, exist_ok=True)

        self.models_directory = models_directory
        self._load_config()

        self.downloader = OVDownloader(models_base_dir=models_directory, verified_model_file=verified_model_path)
        self.ovms_manager = OVMSManager(self.downloader)

    def _load_config(self) -> Dict[str, Any]:
        default_config = { "model_config_list": [] }

        try:
            with open(f"{self.models_directory}/config.json", 'r') as f:
                return json.loads(f.read())
        except Exception as e:
            try:
                with open(f"{self.models_directory}/config.json", 'w') as f:
                    f.write(json.dumps(default_config))
                return default_config
            except Exception as e:
                print("Fail to read config.json")
                sys.exit(1)
        

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
        model_config_list = self.ovms_manager.get_running_models()

        server_status = []

        for model_config in model_config_list:
            model = model_config['config']
            task = Path(model['base_path']).parts[0]
            repo_id = model['name']

            model_info = self.downloader.get_model_info_for_repo(repo_id)
            
            server_status.append(
                { "task": task, "repo_id": repo_id, "pid": self.ovms_manager.is_running(), "device": model_info["device"], "url": ""}
            )

        if self.ovms_manager.is_running():
            return server_status
        
        return []

    def start_model(self, model_name: str, device: str) -> bool:
        return self.ovms_manager.start_model(model_name, device)
    
    def stop_model(self, model_name: str) -> bool:
        return self.ovms_manager.stop_model(model_name)
    
    def download_model(self, model_name: str) -> Generator[str, None, None]:
        progress_generator = self.downloader.download_model(model_name)
        for message in progress_generator:
            yield message

    def download_unverified_model(self, model_name: str, task: str) -> Generator[str, None, None]:
        if not self.downloader:
            raise RuntimeError("Downloader not initialized. Call initialize_components first.")
            
        progress_generator = self.downloader.download_unverified_model(
            source_model=model_name,
            task=task
        )
        for message in progress_generator:
            yield message

    def download_model_cancel(self) -> str:
        return self.downloader.cancel_download_model()

    def delete_model(self, model_name: str) -> bool:
        self.ovms_manager.stop_model(model_name)
        return self.downloader.delete_downloaded_model(source_model=model_name)

    def is_active_model(self, model_id: str):
        try:
            _ = self.ovms_manager.get_current_active_model(model_id)
        except:
            raise ValueError(f"{model_id} not the active model. Please start the model first.")

    def list_models(self):
        verified_models = self.downloader.list_verified_models()
        downloaded_models = self.downloader.list_downloaded_models()

        verified_map = {}
        for repo_id, task_type, quantizations in verified_models:
            key = (repo_id, task_type)
            verified_map[key] = quantizations 

        downloaded_map = {}
        for repo_id, task_type, quantizations in downloaded_models:
            key = (repo_id, task_type)
            downloaded_map[key] = quantizations

        all_keys = set(verified_map.keys()) | set(downloaded_map.keys())

        detailed_list = []
        for repo_id, task_type in all_keys:
            detailed_list.append({
                "repo_id": repo_id,
                "task_type": task_type,
                "downloaded": downloaded_map.get((repo_id, task_type), []),
                "verified": verified_map.get((repo_id, task_type), [])
            })

        for model in detailed_list:
            for quant in model.get("downloaded", []):
                repo_id = model['repo_id']
                repo_id_with_tag = f"{repo_id}:{quant}"
                # self.usable_models[repo_id_with_tag] = model

        return detailed_list
    
    def get_tokenized_inputs(self, model_name, **kwargs):
        tokenized_inputs = self.ovms_manager.get_tokenized_inputs(model_name, **kwargs)
        if tokenized_inputs:
            tokens = tokenized_inputs.input_ids.data.flatten().tolist()
            n_tokens = len(tokens)
            return { "tokens": tokens, "n_tokens": n_tokens }
        
        return { "tokens": [], "n_tokens": -1 }