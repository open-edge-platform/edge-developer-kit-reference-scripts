# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import subprocess  # nosec - disable B404:import-subprocess check
import os
import signal
import yaml
import stat
import re
import shutil
import requests
from pathlib import Path
from collections import defaultdict
from typing import Generator, Dict, List, Tuple, DefaultDict
import glob
from enum import Enum

from modules.utils import get_resource_path


class ModelSource(Enum):
    HUGGINGFACE = "huggingface"
    MODELSCOPE = "modelscope"


class OVDownloader:
    IS_WINDOWS = os.name == "nt"
    OVMS_EXECUTABLE = (
        os.path.join(".", "engine", "ovms", "ovms.exe")
        if IS_WINDOWS
        else os.path.join(".", "engine", "ovms", "bin", "ovms")
    )
    OPTIMUM_CLI_PATH = os.path.join(".", "engine", "optimum_export_model")
    OPTIMUM_CLI_VENV_PATH = os.path.join(OPTIMUM_CLI_PATH, ".venv")
    OPTIMUM_CLI_SCRIPT = os.path.join(OPTIMUM_CLI_PATH, "export_model.py")

    UV_EXECUTABLE = os.environ.get("UV_EXE", "uv")

    VERIFIED_FILE_NAME = "verified.yaml"
    KNOWN_QUANTS = {"int4", "int8", "fp16", "fp32"}

    TASK_MAP = {
        "text_generation": "text_generation",
        "embeddings": "embeddings",
        "rerank": "rerank",
    }

    def __init__(
        self,
        models_base_dir: str = os.path.join(".", "models", "OV"),
        verified_model_file: str = VERIFIED_FILE_NAME,
    ):
        if self.IS_WINDOWS:
            self._termination_signal = signal.SIGTERM

        self.OVMS_EXECUTABLE = get_resource_path(self.OVMS_EXECUTABLE)
        self.models_base_dir = models_base_dir
        self.verified_models = self.read_verified_models(verified_model_file)

        self.env = os.environ.copy()
        self._current_process = None
        self._current_model = None
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
                    os.path.join(ovms_parent_path, "python", "Scripts"),
                ]
                self.env["PYTHONHOME"] = new_path_entries[0]
                self.env["OVMS_DIR"] = ovms_parent_path
                self.env["PATH"] = (
                    f"{path_separator.join(new_path_entries)};{ovms_parent_path};{current_path}"
                )
            else:
                optimum_cli_venv_site_packages = glob.glob(
                    os.path.join(
                        self.OPTIMUM_CLI_VENV_PATH, "lib", "python*", "site-packages"
                    )
                    if not self.IS_WINDOWS
                    else os.path.join(
                        self.OPTIMUM_CLI_VENV_PATH, "Lib", "site-packages"
                    )
                )[0]
                optimum_cli_venv_executables = os.path.join(
                    self.OPTIMUM_CLI_VENV_PATH, "Scripts" if self.IS_WINDOWS else "bin"
                )
                ovms_root_path = os.path.dirname(ovms_parent_path)
                self.env["LD_LIBRARY_PATH"] = os.path.join(ovms_root_path, "lib")
                self.env["PATH"] = (
                    f"{optimum_cli_venv_executables}:{os.path.join(ovms_root_path, 'bin')}:{current_path}"
                )
                self.env["PYTHONPATH"] = (
                    f"{optimum_cli_venv_site_packages}:{os.path.join(ovms_root_path, 'lib', 'python')}"
                )
        except Exception as e:
            import traceback

            traceback.print_exc()
            print(e)

    def _find_executable_path(self, name):
        for part in os.environ["PATH"].split(os.pathsep):
            exe_path = os.path.join(part, name)
            if os.path.exists(exe_path):
                return exe_path
        return None

    def _remove_readonly(self, func, path, exc_info):
        if exc_info[0] is PermissionError or exc_info[0].winerror == 5:
            try:
                os.chmod(path, stat.S_IWUSR | stat.S_IWRITE)
                func(path)
            except Exception as inner_exc:
                raise exc_info[1]
        else:
            raise exc_info[1]

    def _download_from_modelscope(self, source_model: str, model_repository_path: str):
        command = [
            self.UV_EXECUTABLE,
            "run",
            "--python",
            os.path.join(
                self.OPTIMUM_CLI_VENV_PATH,
                "bin/python" if not self.IS_WINDOWS else "Scripts/python.exe",
            ),
            "modelscope",
            "download",
            "--local_dir",
            model_repository_path,
            "--model",
            source_model,
        ]

        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                env=self.env,
            )
            self._current_process = process

            for line in process.stdout:
                stripped_line = line.strip()
                print(stripped_line)
                yield stripped_line + "\n"

            process.wait()

            if process.returncode != 0:
                raise subprocess.CalledProcessError(process.returncode, process.args)

            yield f"Model {source_model} download complete. \n"
            return True

        except subprocess.CalledProcessError as e:
            if self._current_process and self._current_process.returncode in (
                -signal.SIGTERM,
                -signal.SIGINT,
            ):
                print(e)
                yield "Download manually canceled. \n"
                return False
            else:
                yield f"OVDownloader failed with exit code {e.returncode} \n"
                return False
        except FileNotFoundError:
            yield "Please ensure UV is installed \n"
            return False
        except Exception as e:
            yield f"An unexpected error occurred: {e} \n"
            return False
        finally:
            self._current_process = None

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

    def get_model_info_for_repo(self, source_model: str) -> Dict:
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

        if model_path != "" or model_info:
            return {
                "task": found_task,
                "model_base_dir": self.models_base_dir,
                "model_path": model_path,
                "device": target_device_value,
                "tool_parser": model_info.get("tool_parser", ""),
                "chat_template": model_info.get("chat_template"),
            }

        return {}

    def update_model_device(
        self, source_model: str, device: str, extra_params: str = None
    ):
        model_info = self.get_model_info_for_repo(source_model=source_model)

        task = model_info["task"]
        task_cli_name = self.TASK_MAP.get(task.lower())

        if not task_cli_name:
            raise ValueError("not a valid model")

        model_repository_path = os.path.join(self.models_base_dir, task_cli_name)

        command = [
            self.OVMS_EXECUTABLE,
            "--pull",
            "--model_repository_path",
            model_repository_path,
            "--source_model",
            source_model,
            "--task",
            task_cli_name,
            "--target_device",
            device,
        ]

        if extra_params:
            command.extend(extra_params.split())

        if model_info.get("tool_parser", "") != "":
            tool_parser = model_info.get("tool_parser", "")
            command.extend(["--tool_parser", tool_parser])

        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                env=self.env,
            )

            for line in process.stdout:
                stripped_line = line.strip()
                if stripped_line.startswith(
                    "Downloading lfs size"
                ) or stripped_line.startswith("Progress:"):
                    print(stripped_line)

            process.wait()

            if process.returncode != 0:
                raise subprocess.CalledProcessError(process.returncode, process.args)

        except Exception as e:
            print(f"An unexpected error occurred: {e}")
            return False

        return True

    def extract_quant_from_foldername(self, model_name: str) -> str:
        for quant in self.KNOWN_QUANTS:
            if quant in model_name:
                return quant

        return ""

    def download_model(
        self, source_model: str, source: ModelSource = ModelSource.HUGGINGFACE
    ) -> Generator[str, None, None]:
        if self._current_process and self._current_process.poll() is None:
            yield "Another download is already running. Please cancel it first."
            return

        model_info = self.get_model_info_for_repo(source_model=source_model)
        task = model_info["task"]

        task_cli_name = self.TASK_MAP.get(task.lower())
        if not task_cli_name:
            yield f"{source_model} not a supported model"
            return

        model_repository_path = os.path.join(self.models_base_dir, task_cli_name)
        command = [
            self.OVMS_EXECUTABLE,
            "--pull",
            "--model_repository_path",
            model_repository_path,
            "--source_model",
            source_model,
            "--task",
            task_cli_name,
        ]

        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                env=self.env,
            )
            self._current_process = process
            self._current_model = source_model

            for line in process.stdout:
                stripped_line = line.strip()
                if stripped_line.startswith(
                    "Downloading lfs size"
                ) or stripped_line.startswith("Progress:"):
                    yield stripped_line + "\n"

            process.wait()

            if process.returncode != 0:
                raise subprocess.CalledProcessError(process.returncode, process.args)

            if model_info.get("chat_template", "") != "":
                chat_template_url = model_info.get("chat_template")
                response = requests.get(chat_template_url, allow_redirects=True)
                chat_template_path = (
                    Path(model_repository_path) / source_model / "chat_template.jinja"
                )
                with open(str(chat_template_path), "wb") as f:
                    f.write(response.content)

            yield f"Model {source_model} download complete. \n"

        except subprocess.CalledProcessError as e:
            if self._current_process and self._current_process.returncode in (
                -signal.SIGTERM,
                -signal.SIGINT,
            ):
                yield "Download manually canceled. \n"
            else:
                yield f"OVDownloader failed with exit code {e.returncode} \n"
        except FileNotFoundError:
            yield "Please ensure OVMS is installed and in your system's PATH, or provide the full path to the executable. \n"
        except Exception as e:
            yield f"An unexpected error occurred: {e} \n"
        finally:
            self._current_process = None

    def download_unverified_model(
        self,
        source_model: str,
        task: str,
        target_device: str = "",
        extra_params: str = None,
        source: ModelSource = ModelSource.HUGGINGFACE,
    ) -> Generator[str, None, None]:
        if task not in ["text_generation", "embeddings", "rerank", "multimodal"]:
            yield f"Invalid task '{task}'. Must be one of: text_generation, embeddings, rerank, multimodal.\n"
            return

        model_repository_path = os.path.join(self.models_base_dir, task)

        if source == ModelSource.MODELSCOPE:
            success = yield from self._download_from_modelscope(
                source_model, model_repository_path
            )
            if not success:
                return
            command = [self.UV_EXECUTABLE, "run", self.OPTIMUM_CLI_SCRIPT, task]
        else:
            command = [
                self.OVMS_EXECUTABLE,
                "--pull",
                "--task",
                task,
            ]

        command.extend(
            [
                "--model_repository_path",
                model_repository_path,
                "--source_model",
                source_model,
            ]
        )

        if extra_params:
            command.extend(extra_params.split())

        if target_device == "NPU":
            command.extend(["--target_device", target_device])

        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                env=self.env,
            )
            self._current_process = process
            self._current_model = source_model

            for line in process.stdout:
                stripped_line = line.strip()
                print(stripped_line)
                if stripped_line.startswith(
                    "Downloading lfs size"
                ) or stripped_line.startswith("Progress:"):
                    yield stripped_line + "\n"

            process.wait()

            if process.returncode != 0:
                raise subprocess.CalledProcessError(process.returncode, process.args)

            yield f"Model {source_model} download complete. \n"

        except subprocess.CalledProcessError as e:
            if self._current_process and self._current_process.returncode in (
                -signal.SIGTERM,
                -signal.SIGINT,
            ):
                print(e)
                yield "Download manually canceled. \n"
            else:
                yield f"OVDownloader failed with exit code {e.returncode} \n"
        except FileNotFoundError:
            yield "Please ensure OVMS is installed and in your system's PATH, or provide the full path to the executable. \n"
        except Exception as e:
            yield f"An unexpected error occurred: {e} \n"
        finally:
            self._current_process = None

    def cancel_download_model(self):
        if self._current_process and self._current_process.poll() is None:
            try:
                self._current_process.send_signal(self._termination_signal)
                self._current_process.wait(timeout=5)
                return True
            except subprocess.TimeoutExpired:
                self._current_process.kill()
                return True
            except Exception as e:
                print(f"{e}")
                return False
        else:
            return False

    def delete_downloaded_model(self, source_model: str) -> bool:
        model_info = self.get_model_info_for_repo(source_model=source_model)
        print(model_info)

        task = model_info["task"]
        task_cli_name = self.TASK_MAP.get(task.lower())

        if not task_cli_name:
            raise ValueError("not a valid model")

        model_repository_path = os.path.join(self.models_base_dir, task_cli_name)
        model_dir = os.path.join(model_repository_path, source_model)

        if os.path.exists(model_dir):
            try:
                shutil.rmtree(model_dir, onerror=self._remove_readonly)
                print(f"Model '{source_model}' successfully deleted from: {model_dir}")
                return True
            except Exception as e:
                print(
                    f"ERROR: Failed to delete model directory {model_dir}. Reason: {e}"
                )
                return False
        else:
            print(f"Model directory not found: {model_dir}")
            return False

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
