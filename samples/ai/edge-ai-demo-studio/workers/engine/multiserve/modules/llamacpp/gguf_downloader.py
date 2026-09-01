# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import requests
import sys
import hashlib
import shutil
import threading
import yaml
from pathlib import Path
from collections import defaultdict
from typing import Optional, Dict, Any, Generator, Tuple, List, DefaultDict
from huggingface_hub import hf_hub_download, hf_hub_url, get_hf_file_metadata
from .model_registry import ModelRegistry
from modules.utils import ModelSource


class GGUFDownloader:
    VERIFIED_FILE_NAME = "verified.yaml"
    USER_UPLOAD_REGISTRY_FILE = "user_uploads.json"

    KNOWN_QUANTS = {
        "Q2_K",
        "Q2_K_L",
        "Q3_K_M",
        "Q3_K_S",
        "Q4_0",
        "Q4_1",
        "Q4_K_M",
        "Q4_K_S",
        "Q5_K_M",
        "Q5_K_S",
        "Q6_K",
        "Q8_0",
        "UD-Q8_K_L",
        "mxfp4",
        "f16",
    }

    def __init__(
        self,
        base_url: str = "https://huggingface.co/",
        models_base_dir: str = "models",
        verified_model_file: str = VERIFIED_FILE_NAME,
        token: Optional[str] = None,
    ):
        self.base_url = base_url if base_url.endswith("/") else base_url + "/"
        self.download_endpoint = self.base_url

        self.models_base_dir = models_base_dir
        self.cancellation_flag = False

        self.verified_models = self.read_verified_models(verified_model_file)
        self.user_upload_registry = ModelRegistry(
            Path(models_base_dir) / self.USER_UPLOAD_REGISTRY_FILE
        )
        self.manifest_cache_dir = Path(models_base_dir) / ".manifest_cache"

        self.headers = {
            "Accept": "application/json",
            "User-Agent": "llama-cpp",
        }

        if token:
            self.headers["Authorization"] = f"Bearer {token}"

    def _get_manifest_url(self, hf_repo: str, tag: str) -> str:
        return f"{self.base_url}v2/{hf_repo}/manifests/{tag}"

    def _download_and_stream_progress(
        self, hf_repo: str, filename: str, local_path: str, tag: str = "main", source: ModelSource = ModelSource.HUGGINGFACE
    ) -> Generator[Dict[str, float], None, str]:
        local_dir = str(Path(local_path).parent)
        Path(local_dir).mkdir(parents=True, exist_ok=True)

        exception_holder: List[Exception] = []
        download_done = threading.Event()
        total_bytes: List[int] = [0]

        token = (
            self.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
        )

        if not source==ModelSource.MODELSCOPE:
            try:
                url = hf_hub_url(repo_id=hf_repo, filename=filename, revision=tag)
                metadata = get_hf_file_metadata(url=url, token=token)
                total_bytes[0] = metadata.size or 0
            except Exception:
                total_bytes[0] = 0

        def _find_partial_size() -> int:
            """Return best-effort bytes written so far."""
            dest = Path(local_path)
            if dest.exists():
                return dest.stat().st_size
            try:
                largest = 0
                for p in Path(local_dir).iterdir():
                    if p.is_file():
                        try:
                            size = p.stat().st_size
                            if size > largest:
                                largest = size
                        except OSError:
                            pass
                return largest
            except OSError:
                return 0

        def _download():
            try:
                if source == ModelSource.MODELSCOPE:
                    print("modelscope download")
                    from modelscope.hub.file_download import model_file_download

                    model_file_download(
                        model_id=hf_repo,
                        file_path=filename,
                        local_dir=local_dir,
                    )
                else:
                    hf_hub_download(
                        repo_id=hf_repo,
                        filename=filename,
                        token=token,
                        local_dir=local_dir,
                    )
            except Exception as e:
                exception_holder.append(e)
            finally:
                download_done.set()

        thread = threading.Thread(target=_download, daemon=True)
        thread.start()

        while not download_done.wait(timeout=0.5):
            if self.cancellation_flag:
                self.cancellation_flag = False
                thread.join(timeout=5)
                raise RuntimeError("Download cancelled by user.")

            total = total_bytes[0]
            downloaded = _find_partial_size()
            yield {
                "downloaded_gb": downloaded / (1024**3),
                "total_gb": total / (1024**3),
                "progress_pct": min((downloaded / total) * 100, 100.0) if total > 0 else 0.0,
            }

        thread.join()

        if self.cancellation_flag:
            self.cancellation_flag = False
            raise RuntimeError("Download cancelled by user.")

        if exception_holder:
            self.cancellation_flag = False
            raise RuntimeError(f"Error during streaming download {exception_holder[0]}")

    def _calculate_sha256(self, file_path: str) -> str:
        sha256_hash = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                for byte_block in iter(lambda: f.read(4096), b""):
                    sha256_hash.update(byte_block)
            return sha256_hash.hexdigest()
        except FileNotFoundError:
            raise RuntimeError(
                f"Checksum verification failed File not found at {file_path}"
            )
        except Exception as e:
            raise RuntimeError(f"Error calculating SHA256 for {file_path} {e}")

    def _download_and_verify(
        self, manifest: Dict[str, str], task: str
    ) -> List[Dict[str, str]]:
        self.cancellation_flag = False
        files_to_download = []

        files_to_check = [
            (manifest["gguf_file"], "gguf_sha256"),
            (manifest.get("mmproj_file"), None),
        ]

        for filename, expected_sha_key in files_to_check:
            if not filename:
                continue

            local_path = str(
                Path(self.models_base_dir) / task / manifest["hf_repo"] / filename
            )
            expected_sha = (
                manifest.get(expected_sha_key, "") if expected_sha_key else ""
            )

            is_valid = False
            if os.path.exists(local_path):
                if not expected_sha:
                    is_valid = True
                else:
                    try:
                        calculated_sha = self._calculate_sha256(local_path)
                        if calculated_sha == expected_sha:
                            is_valid = True
                        else:
                            os.remove(local_path)
                    except RuntimeError:
                        pass

            if not is_valid:
                files_to_download.append(
                    {
                        "filename": filename,
                        "local_path": local_path,
                        "expected_sha": expected_sha,
                    }
                )

        return files_to_download

    @staticmethod
    def read_verified_models(file_path: str) -> Dict[str, str]:
        try:
            with open(file_path, "r") as f:
                data = yaml.safe_load(f)

            if not data or "models" not in data:
                return {}

            verified_models = {
                repo_id: details
                for repo_id, details in data["models"].items()
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

    def get_file_manifest(self, hf_repo_with_tag: str) -> Dict[str, str]:
        parts = hf_repo_with_tag.split(":")
        tag = parts[1] if len(parts) > 1 else "latest"
        hf_repo = parts[0]

        if len(hf_repo.split("/")) != 2:
            raise ValueError("Error Invalid HF repo format expected user/model:tag")

        repo_cache_dir = self.manifest_cache_dir / hf_repo
        repo_cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = repo_cache_dir / f"{tag}.json"

        if cache_path.exists():
            try:
                with open(cache_path, "r") as f:
                    manifest_data = json.load(f)
                return manifest_data
            except Exception as cache_e:
                print(
                    f"Warning: Failed to load manifest from cache: {cache_e}. Attempting online retrieval."
                )

        try:
            manifest_url = self._get_manifest_url(hf_repo, tag)
            response = requests.get(manifest_url, headers=self.headers, timeout=30)
            response.raise_for_status()
            j = response.json()

            gguf_file_data = j.get("ggufFile", {})
            gguf_file = gguf_file_data.get("rfilename", "")
            gguf_sha256 = gguf_file_data.get("blobId", "").replace("sha256:", "")
            mmproj_file = j.get("mmprojFile", {}).get("rfilename", "")

            if not gguf_file:
                raise RuntimeError(
                    "Error Model manifest does not contain a ggufFile entry"
                )

            manifest_result = {
                "hf_repo": hf_repo,
                "gguf_file": gguf_file,
                "gguf_sha256": gguf_sha256,
                "mmproj_file": mmproj_file,
                "tag": tag,
            }

            try:
                with open(cache_path, "w") as f:
                    json.dump(manifest_result, f, indent=4)
                print(
                    f"Status: Manifest successfully cached to {cache_path}",
                    file=sys.stdout,
                )
            except Exception as e:
                print(
                    f"Warning: Failed to write manifest to cache: {e}", file=sys.stderr
                )

            return manifest_result

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 401:
                raise RuntimeError(
                    "Error 401 Unauthorized Did you provide a valid HF token"
                )
            raise RuntimeError(
                f"HTTP Error {e.response.status_code} {e.response.text.strip()}"
            )
        except Exception as e:
            raise RuntimeError(
                f"An unexpected error occurred during manifest retrieval: {e}"
            )

    def list_all_cached_manifests(self) -> List[Dict[str, Any]]:
        all_manifests = []
        base_dir = Path(self.manifest_cache_dir)

        if not base_dir.exists():
            return []

        for manifest_path in base_dir.rglob("*.json"):
            if not manifest_path.is_file():
                continue

            try:
                with open(manifest_path, "r") as f:
                    manifest_data = json.load(f)
                    all_manifests.append(manifest_data)

            except json.JSONDecodeError:
                print(
                    f"Warning: Skipping corrupted manifest file: {manifest_path}. Invalid JSON format.",
                    file=sys.stderr,
                )
            except Exception as e:
                print(
                    f"Warning: Skipping manifest file {manifest_path} due to unexpected error: {e}",
                    file=sys.stderr,
                )

        return all_manifests

    def get_model_info_for_repo(self, hf_repo_with_tag: str) -> str:
        hf_repo_id = hf_repo_with_tag.split(":")[0]
        possible_tasks = ["text_generation", "embeddings", "rerank", "multimodal"]

        empty_task_dir = None
        for task in possible_tasks:
            local_path = Path(self.models_base_dir) / task / hf_repo_id
            if not local_path.is_dir():
                continue

            # A directory left behind by a deleted model or an interrupted
            # download (it keeps a .cache/ but no weights) must not claim the
            # model, or it hijacks the lookup from the task that actually
            # holds the GGUF.
            if any(local_path.glob("*.gguf")):
                return task

            if empty_task_dir is None:
                empty_task_dir = task

        if hf_repo_with_tag in self.verified_models:
            return self.verified_models[hf_repo_with_tag].get("task", None)

        if hf_repo_id in self.verified_models.keys():
            return self.verified_models[hf_repo_id].get("task", None)

        if empty_task_dir:
            return empty_task_dir

        raise ValueError(
            f"Model {hf_repo_with_tag} not found locally or in the verified list."
        )

    def download_model(self, hf_repo_with_tag: str, source: ModelSource = ModelSource.HUGGINGFACE) -> Generator[str, None, None]:
        try:
            task = self.get_model_info_for_repo(hf_repo_with_tag=hf_repo_with_tag)
            manifest = self.get_file_manifest(hf_repo_with_tag=hf_repo_with_tag)
            files_to_download = self._download_and_verify(manifest, task=task)

            if not files_to_download:
                yield f"Status: Model {hf_repo_with_tag} is already downloaded and verified.\n"
                return

            downloaded_files_count = 0
            total_files = len(files_to_download)

            for i, d_info in enumerate(files_to_download):
                filename = d_info["filename"]
                local_path = d_info["local_path"]
                expected_sha = d_info["expected_sha"]

                yield f"Status: Starting download of file {i+1}/{total_files}: {filename}...\n"

                progress_generator = self._download_and_stream_progress(
                    hf_repo=manifest["hf_repo"],
                    filename=filename,
                    local_path=local_path,
                    tag=manifest["tag"],
                    source=source
                )

                for progress in progress_generator:
                    yield f"\rProgress ({i+1}/{total_files} {filename}): {progress['downloaded_gb']:.2f} GB / {progress['total_gb']:.2f} GB ({progress['progress_pct']:.2f}%)"

                yield f"\nStatus: Download of {filename} complete. Verifying SHA256...\n"

                if not expected_sha:
                    yield f"Warning: SHA256 missing for {filename}. Verification skipped.\n"
                    downloaded_files_count += 1
                else:
                    calculated_sha = self._calculate_sha256(local_path)

                    if calculated_sha == expected_sha:
                        yield f"Status: Verification SUCCESSFUL for {filename}.\n"
                        downloaded_files_count += 1
                    else:
                        os.remove(local_path)
                        yield f"Error: Verification FAILED for {filename}! Hashes do not match. File removed.\n"
                        raise RuntimeError(
                            f"Verification FAILED for {filename}! Hashes do not match. File removed."
                        )

            if downloaded_files_count == total_files:
                yield f"Status: All {total_files} model files downloaded and verified successfully.\n"

        except RuntimeError as e:
            if "cancelled" in str(e):
                yield "Error: Download cancelled successfully. Partial file removed.\n"
            else:
                yield f"Error: Execution Stopped {e}\n"
        except Exception as e:
            yield f"Error: An unexpected error occurred {e}\n"
        finally:
            self.cancellation_flag = False

    def download_unverified_model(
        self, hf_repo_with_tag: str, task: str, source: ModelSource = ModelSource.HUGGINGFACE
    ) -> Generator[str, None, None]:
        if task not in ["text_generation", "embeddings", "rerank", "multimodal"]:
            yield f"Error: Invalid task '{task}'. Must be one of: text_generation, embeddings, rerank, multimodal.\n"
            return

        try:
            manifest = self.get_file_manifest(hf_repo_with_tag=hf_repo_with_tag)
            files_to_download = self._download_and_verify(manifest, task=task)

            if not files_to_download:
                yield f"Status: Model {hf_repo_with_tag} is already downloaded and verified in task folder '{task}'.\n"
                return

            downloaded_files_count = 0
            total_files = len(files_to_download)

            for i, d_info in enumerate(files_to_download):
                filename = d_info["filename"]
                local_path = d_info["local_path"]
                expected_sha = d_info["expected_sha"]

                yield f"Status: Starting download of UNVERIFIED file {i+1}/{total_files}: {filename} (Task: {task})...\n"

                progress_generator = self._download_and_stream_progress(
                    hf_repo=manifest["hf_repo"],
                    filename=filename,
                    local_path=local_path,
                    tag=manifest["tag"],
                    source=source
                )

                for progress in progress_generator:
                    yield f"\rProgress ({i+1}/{total_files} {filename}): {progress['downloaded_gb']:.2f} GB / {progress['total_gb']:.2f} GB ({progress['progress_pct']:.2f}%)"

                yield f"\nStatus: Download of {filename} complete. Verifying SHA256...\n"

                if not expected_sha:
                    yield f"Warning: SHA256 missing for {filename}. Verification skipped.\n"
                    downloaded_files_count += 1
                else:
                    calculated_sha = self._calculate_sha256(local_path)

                    if calculated_sha == expected_sha:
                        yield f"Status: Verification SUCCESSFUL for {filename}.\n"
                        downloaded_files_count += 1
                    else:
                        os.remove(local_path)
                        yield f"Error: Verification FAILED for {filename}! Hashes do not match. File removed.\n"
                        raise RuntimeError(
                            f"Verification FAILED for {filename}! Hashes do not match. File removed."
                        )

            if downloaded_files_count == total_files:
                yield f"Status: All {total_files} unverified model files downloaded and verified successfully.\n"

        except RuntimeError as e:
            if "cancelled" in str(e):
                yield "Error: Download cancelled successfully. Partial file removed.\n"
            else:
                yield f"Error: Execution Stopped {e}\n"
        except Exception as e:
            yield f"Error: An unexpected error occurred {e}"
        finally:
            self.cancellation_flag = False

    def add_user_upload_model(self, model_name: str, filename: str) -> str:
        self.user_upload_registry.add_user_upload_model(model_name, filename)
        return f"Status: Model {model_name} added to user upload registry.\n"

    def cancel_download_model(self) -> str:
        self.cancellation_flag = True
        return "Download cancellation requested."

    def delete_downloaded_model(self, hf_repo_with_tag: str) -> bool:
        task = self.get_model_info_for_repo(hf_repo_with_tag=hf_repo_with_tag)

        try:
            uploads = self.user_upload_registry.load_upload_record()
            manifest = {}
            if not hf_repo_with_tag in uploads:
                manifest = self.get_file_manifest(hf_repo_with_tag=hf_repo_with_tag)
                files_to_delete = [manifest["gguf_file"], manifest.get("mmproj_file")]
            else:
                files_to_delete = [
                    uploads[hf_repo_with_tag],
                ]
                manifest["hf_repo"] = (
                    hf_repo_with_tag
                    if not ":" in hf_repo_with_tag
                    else hf_repo_with_tag.split(":")[0]
                )
                self.user_upload_registry.remove_user_upload_model(hf_repo_with_tag)

            files_removed = False
            for filename in files_to_delete:
                if not filename:
                    continue

                local_path = (
                    Path(self.models_base_dir) / task / manifest["hf_repo"] / filename
                )
                if local_path.exists():
                    os.remove(local_path)
                    files_removed = True
                else:
                    print(f"File {local_path.name} not found at {local_path}")

            if files_removed:
                repo_dir = Path(self.models_base_dir) / task / manifest["hf_repo"]
                try:
                    # Drop the whole repo dir once no weights remain. Leaving it
                    # for the sake of huggingface_hub's .cache/ would make this
                    # task shadow the one the model is later downloaded into.
                    if not any(repo_dir.glob("*.gguf")):
                        shutil.rmtree(repo_dir, ignore_errors=True)
                    return True
                except OSError:
                    return False
            else:
                return False
        except FileNotFoundError:
            print(
                f"Error: Model {hf_repo_with_tag} not found for deletion.",
                file=sys.stderr,
            )
            return False
        except Exception as e:
            import traceback

            traceback.print_exc()
            print(f"An unexpected error occurred during deletion {e}", file=sys.stderr)
            return False

    def extract_quant_from_filename(self, gguf_filename: str) -> str:
        if not gguf_filename or not gguf_filename.lower().endswith(".gguf"):
            return "N/A"

        best_match = None
        filename_lower = gguf_filename.lower()

        for known_quant in self.KNOWN_QUANTS:
            check_string = known_quant.lower()

            if (
                f".{check_string}.gguf" in filename_lower
                or f"-{check_string}.gguf" in filename_lower
            ):

                if best_match is None or len(known_quant) > len(best_match):
                    best_match = known_quant

            elif filename_lower.endswith(f"-{check_string}.gguf"):
                if best_match is None or len(known_quant) > len(best_match):
                    best_match = known_quant

        return best_match if best_match else "N/A"

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

        cached_manifests = self.list_all_cached_manifests()
        FALLBACK_TAGS = {"latest", "unknown", "main", "master", ""}

        for manifest in cached_manifests:
            repo_id = manifest.get("hf_repo")
            gguf_file = manifest.get("gguf_file")
            mmproj_file = manifest.get("mmproj_file")

            if not repo_id or not gguf_file or "mmproj" in gguf_file:
                continue

            tag_value = manifest.get("tag", "").strip()
            quant_value = tag_value

            if tag_value.lower() in FALLBACK_TAGS or not tag_value:
                quant_value = self.extract_quant_from_filename(gguf_file)

            if quant_value == "N/A":
                quant_value = "Unknown Quant"

            try:
                org, model_name = repo_id.split("/", 1)
                possible_tasks = [
                    "text_generation",
                    "embeddings",
                    "rerank",
                    "multimodal",
                ]

                for task in possible_tasks:
                    repo_dir = base_dir / task / org / model_name

                    if repo_dir.is_dir():
                        expected_files = [gguf_file]
                        if mmproj_file:
                            expected_files.append(mmproj_file)

                        all_files_present = True
                        for filename in expected_files:
                            if not (repo_dir / filename).exists():
                                all_files_present = False
                                break

                        if all_files_present:
                            key = (repo_id, task)
                            if quant_value not in consolidated_models[key]:
                                consolidated_models[key].append(quant_value)
                            break

            except Exception as e:
                print(
                    f"Warning: Skipping cached model {repo_id} due to file checking error: {e}",
                    file=sys.stderr,
                )
                continue

        possible_tasks = ["text_generation", "embeddings", "rerank", "multimodal"]
        for task in possible_tasks:
            task_dir = base_dir / task
            for gguf_file in task_dir.rglob("*.gguf"):
                if "mmproj" in str(gguf_file):
                    continue

                quant_value = self.extract_quant_from_filename(str(gguf_file))
                repo_id = f"{gguf_file.parent.parent.name}/{gguf_file.parent.name}"
                key = (repo_id, task)
                if quant_value not in consolidated_models[key]:
                    consolidated_models[key].append(quant_value)

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
