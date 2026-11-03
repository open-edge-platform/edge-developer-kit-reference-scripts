# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import yaml
import stat
import re
import shutil
import json
from contextlib import closing, nullcontext
from pathlib import Path
from collections import defaultdict
from typing import ContextManager, Generator, Dict, List, Optional, Tuple, DefaultDict
from model_downloader import ModelDownloadError, OvmsError, OvmsPuller, fetch_url
from model_downloader.ovms import (
    embeddings_pooling,
    repair_rerank_tokenizer,
    serve_lock_path,
)
from worker_common import shared_model_lock
from modules.extra_args import ExtraArgs, flags_in, normalize_extra_args, ovms_flag
from modules.utils import (
    ModelSource,
    check_repo_id,
    download_result_line,
    iter_with_heartbeat,
)


class OVDownloader:
    VERIFIED_FILE_NAME = "verified.yaml"
    KNOWN_QUANTS = {"int4", "int8", "fp16", "fp32"}

    #: OVMS's NPU plugin can't load Qwen3 embedding/reranking models with context over 8k tokens; the
    #: documented workaround lowers `max_position_embeddings` in config.json until upstream fixes it.
    NPU_MAX_POSITION_EMBEDDINGS = 8192
    NPU_CONTEXT_BACKUP = ".npu_context_backup.json"

    TASK_MAP = {
        "text_generation": "text_generation",
        "embeddings": "embeddings",
        "rerank": "rerank",
        "multimodal": "text_generation",
    }

    def __init__(
        self,
        models_base_dir: str = os.path.join(".", "models", "OV"),
        verified_model_file: str = VERIFIED_FILE_NAME,
        config_dir: str | None = None,
    ):
        self.models_base_dir = models_base_dir
        self.config_dir = config_dir or models_base_dir
        self.verified_models = self.read_verified_models(verified_model_file)
        # Resolves OVMS on the first pull, so the engine can start before workers/setup.sh has run.
        self._puller = OvmsPuller()

    def _remove_readonly(self, func, path, exc_info):
        if exc_info[0] is PermissionError or exc_info[0].winerror == 5:
            try:
                os.chmod(path, stat.S_IWUSR | stat.S_IWRITE)
                func(path)
            except Exception as inner_exc:
                raise exc_info[1]
        else:
            raise exc_info[1]

    def _get_base_path_by_name(self, config_path: str, model_name: str):
        try:
            with open(config_path, "r") as rfile:
                config_json = json.loads(rfile.read())

            config_list = config_json.get("model_config_list", [])
            for item in config_list:
                inner_config = item.get("config", {})
                if inner_config.get("name") == model_name:
                    return inner_config.get("base_path")

            return ""
        except Exception as e:
            print(f"{e}")

    @staticmethod
    def read_verified_models(file_path: str) -> Dict[str, str]:
        try:
            with open(file_path, "r") as f:
                data = yaml.safe_load(f)

            if not data or "ov_models" not in data:
                return {}

            verified_models = {
                repo_id: details
                for repo_id, details in data["ov_models"].items()
                if "task" in details
            }

            return verified_models

        except FileNotFoundError:
            raise FileNotFoundError(
                f"Error Verified models file not found at {file_path}"
            )
        except yaml.YAMLError as e:
            raise RuntimeError(f"Error parsing YAML file {file_path} {e}")

    def get_model_dir(self):
        return self.models_base_dir

    def get_model_info_for_repo(
        self, source_model: str, source_model_path: str = ""
    ) -> Dict:
        possible_tasks = ["text_generation", "embeddings", "rerank", "multimodal"]

        model_info = {}
        model_path = ""
        found_task = ""
        target_device_value = ""

        model_info = self.verified_models.get(source_model, {})
        if model_info:
            found_task = model_info.get("task", "")

        for task in possible_tasks:
            local_path = Path(self.models_base_dir) / task / source_model
            if local_path.is_dir():
                model_path = str(Path(task) / source_model)
                found_task = task
                break

        if model_path != "":
            graphpbtxt = Path(self.models_base_dir) / model_path / "graph.pbtxt"
            try:
                with open(str(graphpbtxt), "r") as rfile:
                    graphpb = rfile.read()
                pattern = re.compile(r'device: "(.*?)"')
                match = pattern.search(graphpb)
                if match:
                    target_device_value = match.group(1)
            except Exception as e:
                print(f"{e}")
        else:
            config_path = Path(self.config_dir) / "config.json"
            model_path = self._get_base_path_by_name(config_path, source_model)
            model_path = source_model_path if model_path == "" else model_path
            if model_path != "":
                graphpbtxt = Path(model_path) / "graph.pbtxt"
                try:
                    with open(str(graphpbtxt), "r") as rfile:
                        graphpb = rfile.read()
                    pattern = re.compile(r'device: "(.*?)"')
                    match = pattern.search(graphpb)
                    if match:
                        target_device_value = match.group(1)
                except Exception as e:
                    print(f"{e}")
                    model_path = ""

        if model_path != "" or model_info:
            return {
                "task": found_task,
                "model_base_dir": self.models_base_dir,
                "model_path": model_path,
                "device": target_device_value,
                "tool_parser": model_info.get("tool_parser", ""),
                "chat_template": model_info.get("chat_template"),
                "parameters": model_info.get("parameters", {}),
            }

        return {}

    def _model_config_path(self, model_repository_path: str, source_model: str) -> Path:
        return Path(model_repository_path) / source_model / "config.json"

    def _apply_npu_context_limit(
        self, model_repository_path: str, source_model: str
    ) -> None:
        """Clamp the model's context to what the NPU plugin can load.

        The original is backed up beside config.json so a start on another device restores it.
        """
        config_path = self._model_config_path(model_repository_path, source_model)
        config = self._read_json(config_path)
        if config is None:
            return

        current = config.get("max_position_embeddings")
        if not isinstance(current, int) or current <= self.NPU_MAX_POSITION_EMBEDDINGS:
            return

        backup_path = config_path.parent / self.NPU_CONTEXT_BACKUP
        if not backup_path.exists():
            self._write_json(backup_path, {"max_position_embeddings": current})

        config["max_position_embeddings"] = self.NPU_MAX_POSITION_EMBEDDINGS
        if self._write_json(config_path, config):
            print(
                f"NPU: lowered max_position_embeddings {current} -> "
                f"{self.NPU_MAX_POSITION_EMBEDDINGS} for {source_model}"
            )

    def _restore_context_limit(
        self, model_repository_path: str, source_model: str
    ) -> None:
        """Undo `_apply_npu_context_limit` when the model moves off the NPU."""
        config_path = self._model_config_path(model_repository_path, source_model)
        backup_path = config_path.parent / self.NPU_CONTEXT_BACKUP
        if not backup_path.is_file():
            return

        backup = self._read_json(backup_path)
        config = self._read_json(config_path)
        if backup is None or config is None:
            return

        original = backup.get("max_position_embeddings")
        if not isinstance(original, int):
            return

        if config.get("max_position_embeddings") != original:
            config["max_position_embeddings"] = original
            if not self._write_json(config_path, config):
                return
            print(f"Restored max_position_embeddings {original} for {source_model}")
        backup_path.unlink(missing_ok=True)

    @staticmethod
    def _read_json(path: Path) -> Dict | None:
        if not path.is_file():
            return None
        try:
            with open(path, encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, json.JSONDecodeError) as e:
            print(f"Could not read {path}: {e}")
            return None

    @staticmethod
    def _write_json(path: Path, payload: Dict) -> bool:
        try:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2)
            return True
        except OSError as e:
            print(f"Could not write {path}: {e}")
            return False

    def _repository_path(
        self, source_model: str, task: str = "", source_model_path: str = ""
    ) -> str:
        """The model repository ``source_model`` is pulled into: the task's folder, or a local model's."""
        if source_model_path != "":
            return str(Path(source_model_path).parent.parent.absolute())
        if not task:
            task = self.get_model_info_for_repo(source_model=source_model).get("task", "")
        return os.path.join(self.models_base_dir, task)

    def serve_lock(
        self,
        source_model: str,
        task: str = "",
        source_model_path: str = "",
        timeout: float = 14400.0,
    ) -> ContextManager[None]:
        """Held from a pull of ``source_model`` until a server has loaded it, and by a download or delete.

        Instances share the folder and a pull rewrites ``graph.pbtxt`` for its device, so no other
        instance may pull or delete until this one's server has read the graph."""
        repository = self._repository_path(source_model, task, source_model_path)
        return shared_model_lock(serve_lock_path(repository, source_model), timeout=timeout)

    def update_model_device(
        self,
        source_model: str,
        device: str,
        task: str,
        source_model_path: str = "",
        extra_params: ExtraArgs = None,
    ) -> bool:
        """Pull the model again for `device`, which rewrites its graph (with ``extra_params``' options).

        Returns whether files changed that a loaded server only rereads on reload (a repaired rerank
        tokenizer); the server reloads a changed graph by itself. A pull that fails over
        ``extra_params`` raises ``RuntimeError``; otherwise the old graph is served.
        """
        model_info = self.get_model_info_for_repo(
            source_model=source_model, source_model_path=source_model_path
        )

        model_task = model_info.get("task", "")
        model_task = task if model_task == "" else model_task
        task_cli_name = self.TASK_MAP.get(model_task.lower())
        if not task_cli_name:
            raise ValueError("not a valid task")

        if source_model_path != "":
            model_repository_path = str(
                Path(source_model_path).parent.parent.absolute()
            )
        else:
            model_repository_path = os.path.join(self.models_base_dir, task)

        model_dir = Path(model_repository_path) / source_model

        user_args = normalize_extra_args(extra_params)
        given = flags_in(user_args, ovms_flag)
        extra_args = list(user_args)
        # `--tool_parser` isn't among build_pull_command's fixed arguments, so it rides with extra params.
        if model_info.get("tool_parser", "") != "" and "--tool_parser" not in given:
            extra_args.extend(["--tool_parser", model_info["tool_parser"]])
        if task_cli_name == "embeddings" and "--pooling" not in given:
            pooling = embeddings_pooling(model_dir)
            if pooling:
                extra_args.extend(["--pooling", pooling])
        pipeline_type = None
        if "--pipeline_type" not in given:
            pipeline_type = model_info.get("parameters", {}).get("pipeline_type", "") or None

        try:
            # `progress_only` keeps only the "Downloading lfs size" and "Progress:" lines.
            for line in self._puller.iter_pull(
                source_model,
                model_repository_path=model_repository_path,
                task=task_cli_name,
                target_device=device,
                pipeline_type=pipeline_type,
                extra_args=extra_args,
                progress_only=True,
            ):
                print(line)

        except Exception as e:
            print(f"An unexpected error occurred: {e}")
            if user_args:
                raise RuntimeError(
                    f"OVMS could not apply the extra arguments {' '.join(user_args)}: {e}"
                ) from e
            return False

        # `ovms --pull` rewrites config.json, so the NPU clamp goes on after the pull.
        if (device or "").split(".", 1)[0].upper() == "NPU":
            self._apply_npu_context_limit(model_repository_path, source_model)
        else:
            self._restore_context_limit(model_repository_path, source_model)

        if task_cli_name == "rerank":
            return repair_rerank_tokenizer(model_dir, self._puller.env_for(source_model))
        return False

    def ensure_servable(self, source_model: str, source_model_path: str = "") -> bool:
        """Fix what a model served without a device change needs (`update_model_device`'s pull does the same).

        Returns, like `update_model_device`, whether files changed that a loaded server only rereads on reload.
        """
        model_info = self.get_model_info_for_repo(
            source_model=source_model, source_model_path=source_model_path
        )
        task = model_info.get("task", "")
        if source_model_path:
            model_dir = Path(source_model_path)
        elif model_info.get("model_path"):
            model_dir = Path(self.models_base_dir) / model_info["model_path"]
        else:
            return False

        if task == "rerank":
            return repair_rerank_tokenizer(model_dir, self._puller.env_for(source_model))
        if task == "embeddings" and embeddings_pooling(model_dir):
            graph = model_dir / "graph.pbtxt"
            try:
                has_pooling = "pooling:" in graph.read_text(encoding="utf-8")
            except OSError:
                has_pooling = False
            if not has_pooling:
                # A re-pull keeps the files and writes a graph with pooling; the server reloads it.
                self.update_model_device(
                    source_model,
                    model_info.get("device", ""),
                    task,
                    source_model_path=source_model_path,
                )
        return False

    def extract_quant_from_foldername(self, model_name: str) -> str:
        for quant in self.KNOWN_QUANTS:
            if quant in model_name:
                return quant

        return ""

    def _stream_pull(
        self,
        source_model: str,
        lock: Optional[ContextManager[None]] = None,
        **pull_kwargs,
    ) -> Generator[str, None, Tuple[bool, Optional[str]]]:
        """Run one pull, yielding the UI's progress lines, and return ``(ok, error)``.

        Heartbeat lines cover conversions (silent under ``progress_only``) and the wait for ``lock``."""

        def pull_lines():
            with lock or nullcontext():
                yield from self._puller.iter_pull(
                    source_model, progress_only=True, **pull_kwargs
                )

        lines = iter_with_heartbeat(
            pull_lines(),
            lambda elapsed: f"Status: still working on {source_model} ({elapsed:.0f} s)",
        )
        try:
            with closing(lines):
                for line in lines:
                    yield line + "\n"
        except OvmsError as e:
            if e.cancelled:
                yield "Download manually canceled. \n"
                return False, "Download cancelled"
            yield f"OVDownloader failed: {e} \n"
            return False, str(e)
        except Exception as e:
            yield f"An unexpected error occurred: {e} \n"
            return False, f"An unexpected error occurred: {e}"
        yield f"Model {source_model} download complete. \n"
        return True, None

    def download_model(
        self, source_model: str, source: ModelSource = ModelSource.HUGGINGFACE
    ) -> Generator[str, None, None]:
        """Download stream ending with the result line (DOWNLOAD_RESULT_PREFIX)."""
        if self._puller.is_running:
            message = "Another download is already running. Please cancel it first."
            yield message + "\n"
            yield download_result_line(False, message)
            return

        model_info = self.get_model_info_for_repo(source_model=source_model)
        task = model_info.get("task", "")

        task_cli_name = self.TASK_MAP.get(task.lower())
        if not task_cli_name:
            message = f"{source_model} not a supported model"
            yield message + "\n"
            yield download_result_line(False, message)
            return

        model_repository_path = os.path.join(self.models_base_dir, task)
        pipeline_type = model_info.get("parameters", {}).get("pipeline_type", "") or None

        ok, error = yield from self._stream_pull(
            source_model,
            lock=self.serve_lock(source_model, task),
            model_repository_path=model_repository_path,
            task=task_cli_name,
            source=source,
            pipeline_type=pipeline_type,
        )
        if ok and model_info.get("chat_template", ""):
            try:
                fetch_url(
                    model_info["chat_template"],
                    Path(model_repository_path) / source_model / "chat_template.jinja",
                    force=True,
                )
            except (ModelDownloadError, ValueError) as e:
                yield f"Could not fetch chat template: {e} \n"
        yield download_result_line(ok, error)

    def download_unverified_model(
        self,
        source_model: str,
        task: str,
        target_device: str = "",
        extra_params: str = None,
        source: ModelSource = ModelSource.HUGGINGFACE,
    ) -> Generator[str, None, None]:
        """Download stream ending with the result line (DOWNLOAD_RESULT_PREFIX)."""
        task_cli_name = self.TASK_MAP.get(task.lower()) if task else None
        if task not in ["text_generation", "embeddings", "rerank", "multimodal"] or not task_cli_name:
            message = f"Invalid task '{task}'. Must be one of: text_generation, embeddings, rerank, multimodal."
            yield message + "\n"
            yield download_result_line(False, message)
            return

        if self._puller.is_running:
            message = "Another download is already running. Please cancel it first."
            yield message + "\n"
            yield download_result_line(False, message)
            return

        try:
            extra_args = normalize_extra_args(extra_params)
        except ValueError as e:
            message = f"Could not read the extra parameters {extra_params!r}: {e}"
            yield message + "\n"
            yield download_result_line(False, message)
            return

        model_repository_path = os.path.join(self.models_base_dir, task)
        ok, error = yield from self._stream_pull(
            source_model,
            lock=self.serve_lock(source_model, task),
            model_repository_path=model_repository_path,
            task=task_cli_name,
            source=source,
            target_device=target_device if target_device == "NPU" else None,
            extra_args=extra_args,
            log_level="DEBUG",
        )
        yield download_result_line(ok, error)

    def cancel_download_model(self):
        return self._puller.cancel(timeout=5)

    def delete_downloaded_model(self, source_model: str, task: str = "") -> bool:
        # The id is joined into the removed folder's path, so it must stay inside the models directory.
        check_repo_id(source_model, "Model id", exact_parts=None)
        model_info = self.get_model_info_for_repo(source_model=source_model)

        task = task or model_info.get("task", "")
        task_cli_name = self.TASK_MAP.get(task.lower())

        if not task_cli_name:
            print(f"Unable to determine the task for model '{source_model}'")
            return False

        model_repository_path = os.path.join(self.models_base_dir, task)
        model_dir = os.path.join(model_repository_path, source_model)

        if not os.path.exists(model_dir):
            print(f"Model directory not found: {model_dir}")
            return False
        # Not while a sibling instance pulls or loads this model: it would be left with half a folder.
        try:
            with self.serve_lock(source_model, task, timeout=10):
                shutil.rmtree(model_dir, onerror=self._remove_readonly)
        except TimeoutError:
            print(
                f"ERROR: Model '{source_model}' is being downloaded or loaded by "
                f"another instance; try again once it is done."
            )
            return False
        except Exception as e:
            print(f"ERROR: Failed to delete model directory {model_dir}. Reason: {e}")
            return False
        print(f"Model '{source_model}' successfully deleted from: {model_dir}")
        return True

    def list_verified_models(self) -> Dict[str, str]:
        verified_models = []

        for repo_id_with_tag, detail in self.verified_models.items():
            verified_models.append(
                (repo_id_with_tag, detail["task"], detail["quant"], detail["source"])
            )

        return verified_models

    def list_downloaded_models(self) -> List[Tuple[str, str, List[str]]]:
        consolidated_models: DefaultDict[Tuple[str, str], List[str]] = defaultdict(list)

        base_dir = Path(self.models_base_dir)
        if not base_dir.exists():
            return []

        for ov_file in base_dir.rglob("*model.xml"):
            task = ov_file.parent.parent.parent.name
            org = ov_file.parent.parent.name
            model_name = ov_file.parent.name

            repo_id = f"{org}/{model_name}"
            quant_value = self.extract_quant_from_foldername(model_name)

            if quant_value:
                key = (repo_id, task)
                if quant_value not in consolidated_models[key]:
                    consolidated_models[key].append(quant_value)
            else:
                key = (repo_id, task)
                consolidated_models[key].append("")
        final_list = []
        for (repo_id, task), quants in consolidated_models.items():
            final_list.append((repo_id, task, sorted(quants)))

        return final_list

    def list_models(self):
        verified_models = self.list_verified_models()
        downloaded_models = self.list_downloaded_models()

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

        return detailed_list
