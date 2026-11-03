# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import re
import sys
import hashlib
import shutil
import threading
import time
import yaml
from dataclasses import dataclass
from pathlib import Path
from collections import defaultdict
from typing import Optional, Dict, Any, ContextManager, Generator, Tuple, List, DefaultDict
from model_downloader import fetch_file, file_size
from worker_common import shared_model_lock
from .model_registry import ModelRegistry
from modules.utils import (
    HEARTBEAT_SECONDS,
    ModelSource,
    check_path_name,
    check_repo_id,
    download_result_line,
    iter_with_heartbeat,
    path_name_problem,
)


@dataclass(frozen=True)
class GGUFUpload:
    """Where an uploaded GGUF goes and what it is registered as."""

    repo_id: str  # <org>/<model>
    quant: str
    filename: str
    task: str
    target_dir: Path  # <models>/<task>/<org>/<model>, shared with downloads

    @property
    def model_id(self) -> str:
        return f"{self.repo_id}:{self.quant}"


class GGUFDownloader:
    VERIFIED_FILE_NAME = "verified.yaml"
    USER_UPLOAD_REGISTRY_FILE = "user_uploads.json"
    TASKS = ("text_generation", "embeddings", "rerank", "multimodal")
    LOCKS_DIR_NAME = ".locks"

    #: A quantization tag as it appears after the ':' of a model id.
    _TAG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
    #: `-<QUANT>.gguf` suffix for a quant outside KNOWN_QUANTS: upper case with at least one
    #: letter, so a shard number (`-00002.gguf`) or `-8b.gguf` doesn't match.
    _FILENAME_QUANT_RE = re.compile(r"[-.]((?=[A-Z0-9_]*[A-Z])[A-Z0-9_]+)\.gguf$")

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
            Path(models_base_dir) / self.USER_UPLOAD_REGISTRY_FILE,
            lock_path=Path(models_base_dir) / self.LOCKS_DIR_NAME / "user_uploads",
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
        self, hf_repo: str, filename: str, local_path: str, source: ModelSource = ModelSource.HUGGINGFACE
    ) -> Generator[Dict[str, float], None, str]:
        local_dir = str(Path(local_path).parent)
        Path(local_dir).mkdir(parents=True, exist_ok=True)

        exception_holder: List[Exception] = []
        download_done = threading.Event()
        total_bytes: List[int] = [0]
        # What the hub client says has arrived (Hugging Face only).
        received_bytes: List[int] = [0]

        token = (
            self.headers.get("Authorization", "").replace("Bearer ", "").strip() or None
        )

        # 0 when the hub can't say. The tag is a quantization, not a git revision, so it isn't passed.
        total_bytes[0] = file_size(hf_repo, filename, source=source, token=token) or 0

        def _on_progress(received: int, total: Optional[int]) -> None:
            received_bytes[0] = received
            total_bytes[0] = total_bytes[0] or total or 0

        # Wall clock, as file times are; a second early for coarse ones.
        started = time.time() - 1

        def _find_partial_size() -> int:
            """Bytes so far for hubs that don't report progress: the size of the newest file under
            ``local_dir`` since the download began (hubs write a temporary file first)."""
            newest_time, newest_size = started, 0
            for root, _dirs, files in os.walk(local_dir):
                for name in files:
                    try:
                        stat = os.stat(os.path.join(root, name))
                    except OSError:
                        continue
                    if stat.st_mtime >= newest_time:
                        newest_time, newest_size = stat.st_mtime, stat.st_size
            return newest_size

        def _download():
            try:
                fetch_file(
                    hf_repo,
                    filename,
                    local_dir,
                    source=source,
                    token=token,
                    progress=_on_progress,
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
            downloaded = received_bytes[0] or _find_partial_size()
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

    def _calculate_sha256(self, file_path: str) -> Generator[str, None, str]:
        """Returns ``file_path``'s hex digest, yielding status lines so a minutes-long hash isn't silent."""
        sha256_hash = hashlib.sha256()
        label = os.path.basename(file_path)
        try:
            total = os.path.getsize(file_path)
            hashed = 0
            last_status = time.monotonic()
            with open(file_path, "rb") as f:
                for byte_block in iter(lambda: f.read(8 * 1024 * 1024), b""):
                    sha256_hash.update(byte_block)
                    hashed += len(byte_block)
                    if time.monotonic() - last_status >= HEARTBEAT_SECONDS:
                        last_status = time.monotonic()
                        share = hashed * 100 // total if total else 100
                        yield f"Status: Verifying SHA256 of {label}: {share} percent\n"
            return sha256_hash.hexdigest()
        except FileNotFoundError:
            raise RuntimeError(
                f"Checksum verification failed File not found at {file_path}"
            )
        except Exception as e:
            raise RuntimeError(f"Error calculating SHA256 for {file_path} {e}")

    def _download_and_verify(
        self, manifest: Dict[str, str], task: str
    ) -> Generator[str, None, List[Dict[str, str]]]:
        """Which of the manifest's files still need downloading; files on disk are SHA256-checked."""
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
                        yield f"Status: Verifying existing file {filename}...\n"
                        calculated_sha = yield from self._calculate_sha256(local_path)
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
        # Lazy import: list_models.py loads this module before `requests` may be installed.
        import requests

        # Both become path components (manifest cache, download folder).
        check_repo_id(hf_repo, "Model id")
        check_path_name(tag, "Model tag")

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
        # An uploaded quant belongs to the task folder it was uploaded to, even if the repo is in others.
        upload = self.find_upload(hf_repo_with_tag)
        if upload is not None:
            return upload[0]

        hf_repo_id = hf_repo_with_tag.split(":")[0]
        possible_tasks = ["text_generation", "embeddings", "rerank", "multimodal"]

        empty_task_dir = None
        for task in possible_tasks:
            local_path = Path(self.models_base_dir) / task / hf_repo_id
            if not local_path.is_dir():
                continue

            # A leftover directory (a .cache/ but no weights) must not claim the model from the task
            # that actually holds the GGUF.
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

    def _download_files(
        self,
        manifest: Dict[str, Any],
        files_to_download: List[Dict[str, str]],
        source: ModelSource,
        description: str,
    ) -> Generator[str, None, None]:
        total_files = len(files_to_download)

        for i, d_info in enumerate(files_to_download):
            filename = d_info["filename"]
            local_path = d_info["local_path"]
            expected_sha = d_info["expected_sha"]

            yield f"Status: Starting download of {description.format(index=i + 1, total=total_files, filename=filename)}...\n"

            progress_generator = self._download_and_stream_progress(
                hf_repo=manifest["hf_repo"],
                filename=filename,
                local_path=local_path,
                source=source,
            )

            for progress in progress_generator:
                yield f"\rProgress ({i+1}/{total_files} {filename}): {progress['downloaded_gb']:.2f} GB / {progress['total_gb']:.2f} GB ({progress['progress_pct']:.2f}%)"

            yield f"\nStatus: Download of {filename} complete. Verifying SHA256...\n"

            if not expected_sha:
                yield f"Warning: SHA256 missing for {filename}. Verification skipped.\n"
                continue

            calculated_sha = yield from self._calculate_sha256(local_path)

            if calculated_sha == expected_sha:
                yield f"Status: Verification SUCCESSFUL for {filename}.\n"
            else:
                os.remove(local_path)
                yield f"Error: Verification FAILED for {filename}! Hashes do not match. File removed.\n"
                raise RuntimeError(
                    f"Verification FAILED for {filename}! Hashes do not match. File removed."
                )

    def _download_stream(
        self,
        body: Generator[str, None, None],
    ) -> Generator[str, None, None]:
        """Runs ``body``, reporting a failure as a line, and ends with the result line (DOWNLOAD_RESULT_PREFIX)."""
        ok, error = False, None
        try:
            yield from body
            ok = True
        except RuntimeError as e:
            if "cancelled" in str(e):
                yield "Error: Download cancelled successfully. Partial file removed.\n"
                error = "Download cancelled"
            else:
                yield f"Error: Execution Stopped {e}\n"
                error = str(e)
        except Exception as e:
            yield f"Error: An unexpected error occurred {e}\n"
            error = f"An unexpected error occurred: {e}"
        finally:
            self.cancellation_flag = False
        yield download_result_line(ok, error)

    def _repo_lock(self, task: str, hf_repo: str) -> ContextManager[None]:
        """Held from checking a repo's files to verifying the last download, since instances share the
        folder and one could otherwise remove a file another is hashing or loading."""
        repo_dir = Path(self.models_base_dir) / task / hf_repo
        return shared_model_lock(repo_dir / ".cache" / "edge-ai-studio" / "verify")

    def _locked_stream(
        self, hf_repo_with_tag: str, body: Generator[str, None, None]
    ) -> Generator[str, None, None]:
        """``_download_stream`` with heartbeat lines, so waiting on a sibling's download doesn't look stalled."""
        yield from self._download_stream(
            iter_with_heartbeat(
                body,
                lambda elapsed: f"Status: still working on {hf_repo_with_tag} ({elapsed:.0f} s)\n",
            )
        )

    def download_model(self, hf_repo_with_tag: str, source: ModelSource = ModelSource.HUGGINGFACE) -> Generator[str, None, None]:
        def body():
            task = self.get_model_info_for_repo(hf_repo_with_tag=hf_repo_with_tag)
            manifest = self.get_file_manifest(hf_repo_with_tag=hf_repo_with_tag)
            with self._repo_lock(task, manifest["hf_repo"]):
                files_to_download = yield from self._download_and_verify(manifest, task=task)

                if not files_to_download:
                    yield f"Status: Model {hf_repo_with_tag} is already downloaded and verified.\n"
                    return

                yield from self._download_files(
                    manifest, files_to_download, source, "file {index}/{total}: {filename}"
                )
            yield f"Status: All {len(files_to_download)} model files downloaded and verified successfully.\n"

        yield from self._locked_stream(hf_repo_with_tag, body())

    def download_unverified_model(
        self, hf_repo_with_tag: str, task: str, source: ModelSource = ModelSource.HUGGINGFACE
    ) -> Generator[str, None, None]:
        if task not in ["text_generation", "embeddings", "rerank", "multimodal"]:
            message = f"Invalid task '{task}'. Must be one of: text_generation, embeddings, rerank, multimodal."
            yield f"Error: {message}\n"
            yield download_result_line(False, message)
            return

        def body():
            manifest = self.get_file_manifest(hf_repo_with_tag=hf_repo_with_tag)
            with self._repo_lock(task, manifest["hf_repo"]):
                files_to_download = yield from self._download_and_verify(manifest, task=task)

                if not files_to_download:
                    yield f"Status: Model {hf_repo_with_tag} is already downloaded and verified in task folder '{task}'.\n"
                    return

                yield from self._download_files(
                    manifest,
                    files_to_download,
                    source,
                    "UNVERIFIED file {index}/{total}: {filename} (Task: " + task + ")",
                )
            yield f"Status: All {len(files_to_download)} unverified model files downloaded and verified successfully.\n"

        yield from self._locked_stream(hf_repo_with_tag, body())

    def add_user_upload_model(self, model_name: str, filename: str) -> str:
        self.user_upload_registry.add_user_upload_model(model_name, filename)
        return f"Status: Model {model_name} added to user upload registry.\n"

    # Uploaded GGUF files: stored as `<task>/<org>/<model>/<file name>` like downloads. The quant is
    # only in the model id (`<org>/<model>:<QUANT>`, in the registry): Windows allows no ':' in paths.

    @classmethod
    def split_model_id(
        cls, model_id: str, what: str = "Model name"
    ) -> Tuple[str, Optional[str]]:
        """``(<org>/<model>, quant or None)`` of ``<org>/<model>[:<QUANT>]``;
        ``ValueError`` when either part cannot be a folder name or a tag."""
        repo_id, sep, tag = (model_id or "").partition(":")
        check_repo_id(repo_id, what, example="ggml-org/Qwen3-8B-GGUF:Q4_K_M")
        if not sep:
            return repo_id, None
        if not cls._TAG_RE.match(tag) or path_name_problem(tag):
            raise ValueError(
                f"{what} quantization '{tag}' must be letters, digits, '_', '.' "
                "or '-' (e.g. 'Q4_K_M')"
            )
        return repo_id, tag

    def quant_from_filename(self, filename: str) -> Optional[str]:
        known = self.extract_quant_from_filename(filename)
        if known != "N/A":
            return known
        match = self._FILENAME_QUANT_RE.search(filename or "")
        return match.group(1) if match else None

    def plan_upload(self, model_id: str, task: str, filename: str) -> GGUFUpload:
        """Checks a GGUF upload before any byte is written; ``ValueError`` says what is wrong.

        Without ``:<QUANT>`` in ``model_id`` the file name gives the quant; if both do and disagree, it's refused.
        """
        if task not in self.TASKS:
            raise ValueError(f"task must be one of: {', '.join(sorted(self.TASKS))}")

        filename = os.path.basename((filename or "").replace("\\", "/"))
        check_path_name(filename, "File name")
        if not filename.lower().endswith(".gguf"):
            raise ValueError(
                f"'{filename}' is not a GGUF file: a llama.cpp model is uploaded as one .gguf file"
            )
        if "mmproj" in filename.lower():
            raise ValueError(
                f"'{filename}' is a multimodal projector; it cannot be uploaded as a model"
            )

        repo_id, name_quant = self.split_model_id(model_id)
        file_quant = self.quant_from_filename(filename)
        if name_quant and file_quant and name_quant.upper() != file_quant.upper():
            raise ValueError(
                f"The model name says quantization '{name_quant}' but the file "
                f"'{filename}' is '{file_quant}'. Correct the one that is wrong, "
                f"or leave ':{name_quant}' off the name to use the file's."
            )
        quant = name_quant or file_quant
        if not quant:
            raise ValueError(
                f"Cannot tell the quantization of '{filename}': add it to the model "
                f"name ('{repo_id}:Q4_K_M') or end the file name with it "
                "('model-Q4_K_M.gguf')."
            )
        return GGUFUpload(
            repo_id=repo_id,
            quant=quant,
            filename=filename,
            task=task,
            target_dir=Path(self.models_base_dir) / task / repo_id,
        )

    def upload_conflict(self, upload: GGUFUpload) -> Optional[str]:
        """Why ``upload`` would take over an id already uploaded as a different file, or ``None``.
        (A same-name file is the upload receiver's own check.)"""
        current = self.user_upload_registry.load_upload_record().get(upload.model_id)
        if (
            current
            and current != upload.filename
            and (upload.target_dir / current).is_file()
        ):
            return (
                f"'{upload.model_id}' is already uploaded as '{current}'. Delete it "
                "first, or upload with force_override to replace it."
            )
        return None

    def register_upload(self, upload: GGUFUpload) -> None:
        """Records a committed upload under its id, deleting the file an earlier upload of that id left
        and dropping ids that named the file it overwrote. Idempotent, for a retried final chunk."""
        with self.user_upload_registry.changing() as uploads:
            previous = uploads.get(upload.model_id)
            for model_id, filename in list(uploads.items()):
                if (
                    model_id != upload.model_id
                    and filename == upload.filename
                    and model_id.partition(":")[0] == upload.repo_id
                ):
                    del uploads[model_id]
            uploads[upload.model_id] = upload.filename

        if previous and previous != upload.filename:
            try:
                (upload.target_dir / previous).unlink(missing_ok=True)
            except OSError as e:
                print(
                    f"Warning: could not remove '{previous}', replaced by "
                    f"'{upload.filename}' as {upload.model_id}: {e}",
                    file=sys.stderr,
                )

    def find_upload(self, model_id: str) -> Optional[Tuple[str, Path]]:
        """``(task, file)`` of an uploaded model id whose file is on disk."""
        if ":" not in (model_id or ""):
            return None
        filename = self.user_upload_registry.load_upload_record().get(model_id)
        if not filename:
            return None
        repo_id = model_id.partition(":")[0]
        for task in self.TASKS:
            path = Path(self.models_base_dir) / task / repo_id / filename
            if path.is_file():
                return task, path
        return None

    def _repo_has_gguf(self, repo_id: str) -> bool:
        base = Path(self.models_base_dir)
        return any(self._model_ggufs(base / task / repo_id) for task in self.TASKS)

    @classmethod
    def _drop_repo_dir_without_weights(cls, repo_dir: Path) -> None:
        # Drop the repo dir once no weights remain (a projector alone is none): a leftover .cache/
        # would make this task shadow the one the model is later downloaded into.
        if repo_dir.is_dir() and not cls._model_ggufs(repo_dir):
            shutil.rmtree(repo_dir, ignore_errors=True)

    def migrate_legacy_upload_folders(self) -> None:
        """Moves uploads out of legacy `<task>/<org>/<model>:<QUANT>/` folders (invalid on Windows) into
        the download layout, never overwriting. Idempotent and locked across instances; blocking, so run
        it before the server starts. Never raises.
        """
        try:
            if not self._legacy_upload_folders():
                return
            lock = Path(self.models_base_dir) / self.LOCKS_DIR_NAME / "gguf-upload-layout"
            with shared_model_lock(lock, timeout=600):
                for folder in self._legacy_upload_folders():
                    self._migrate_legacy_upload_folder(folder)
        except Exception as e:
            print(f"Warning: GGUF upload folder migration stopped: {e}", file=sys.stderr)

    def _legacy_upload_folders(self) -> List[Path]:
        folders = []
        for task in self.TASKS:
            task_dir = Path(self.models_base_dir) / task
            if not task_dir.is_dir():
                continue
            for org_dir in task_dir.iterdir():
                if not org_dir.is_dir():
                    continue
                folders.extend(
                    d for d in org_dir.iterdir() if d.is_dir() and ":" in d.name
                )
        return sorted(folders)

    def _migrate_legacy_upload_folder(self, folder: Path) -> None:
        model_name, _, quant = folder.name.partition(":")
        org = folder.parent.name
        if (
            path_name_problem(model_name)
            or path_name_problem(org)
            or not self._TAG_RE.match(quant)
            or path_name_problem(quant)
        ):
            print(
                f"Warning: not migrating '{folder}': '{org}/{folder.name}' is not "
                "an <org>/<model>:<QUANT> id",
                file=sys.stderr,
            )
            return

        model_id = f"{org}/{model_name}:{quant}"
        target_dir = folder.parent / model_name
        registered = False
        for src in sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".gguf"):
            dest = target_dir / src.name
            if dest.exists():
                print(
                    f"Warning: not moving '{src}': '{dest}' already exists",
                    file=sys.stderr,
                )
                continue
            try:
                target_dir.mkdir(parents=True, exist_ok=True)
                os.replace(src, dest)
            except OSError as e:
                print(f"Warning: could not move '{src}' to '{dest}': {e}", file=sys.stderr)
                continue
            print(f"Moved uploaded model file '{src}' to '{dest}'")

            if registered or "mmproj" in src.name.lower():
                continue
            with self.user_upload_registry.changing() as uploads:
                current = uploads.get(model_id)
                if current and current != src.name and (target_dir / current).is_file():
                    print(
                        f"Warning: '{model_id}' already names '{current}'; "
                        f"'{src.name}' is listed by its file name instead",
                        file=sys.stderr,
                    )
                else:
                    uploads[model_id] = src.name
            registered = True

        try:
            folder.rmdir()
        except OSError:
            left = sorted(p.name for p in folder.iterdir())
            print(
                f"Warning: left '{folder}' in place, it still holds: {', '.join(left)}",
                file=sys.stderr,
            )

    def cancel_download_model(self) -> str:
        self.cancellation_flag = True
        return "Download cancellation requested."

    def delete_downloaded_model(self, hf_repo_with_tag: str) -> bool:
        """Deletes a model's weights from disk; ``True`` if any file went.

        ``<org>/<model>:<QUANT>`` deletes that quant: its upload, else its cached manifest's files, else
        local GGUFs named for it, else the hub manifest's files; a projector another quant needs stays.
        ``<org>/<model>`` deletes every upload and cached-manifest download, then the hub ``latest``
        manifest's files if GGUFs remain.
        """
        repo_id, _, tag = hf_repo_with_tag.partition(":")
        uploads = self.user_upload_registry.load_upload_record()
        if tag:
            upload_ids = [hf_repo_with_tag] if hf_repo_with_tag in uploads else []
        else:
            upload_ids = [i for i in uploads if i.partition(":")[0] == repo_id]

        removed = False
        for model_id in upload_ids:
            found = self.find_upload(model_id)
            if found is not None:
                _, path = found
                try:
                    path.unlink(missing_ok=True)
                except OSError as e:
                    # Still on disk (in use, on Windows): keep it registered.
                    print(f"Error: could not delete '{path}': {e}", file=sys.stderr)
                    return False
                removed = True
                self._drop_repo_dir_without_weights(path.parent)
            self.user_upload_registry.remove_user_upload_model(model_id)

        if tag:
            if removed:
                return True
            manifest = self._cached_manifest(repo_id, tag)
            if manifest is not None and self._delete_manifest_files(
                manifest, keep_shared_projector=True
            ):
                return True
            if self._delete_files_named_for_quant(repo_id, tag):
                return True
            return self._delete_hub_manifest_files(
                hf_repo_with_tag, keep_shared_projector=True
            )

        for manifest in self.list_all_cached_manifests():
            if manifest.get("hf_repo") == repo_id and self._delete_manifest_files(
                manifest, keep_shared_projector=False
            ):
                removed = True
        if removed and not self._repo_has_gguf(repo_id):
            return True
        return (
            self._delete_hub_manifest_files(hf_repo_with_tag, keep_shared_projector=False)
            or removed
        )

    @staticmethod
    def _model_ggufs(repo_dir: Path) -> List[Path]:
        """The model weights in a repo folder: its GGUFs but projectors."""
        return [p for p in repo_dir.glob("*.gguf") if "mmproj" not in p.name.lower()]

    def _task_holding(self, repo_id: str) -> Optional[str]:
        """The task folder whose copy of the repo holds weights, as get_model_info_for_repo picks it."""
        base = Path(self.models_base_dir)
        for task in self.TASKS:
            if any((base / task / repo_id).glob("*.gguf")):
                return task
        return None

    def _cached_manifest(self, repo_id: str, tag: str) -> Optional[Dict[str, Any]]:
        if any(path_name_problem(part) for part in [*repo_id.split("/"), tag]):
            return None
        path = self.manifest_cache_dir / repo_id / f"{tag}.json"
        try:
            with open(path, "r") as f:
                manifest = json.load(f)
        except (OSError, ValueError):
            return None
        return manifest if isinstance(manifest, dict) and manifest.get("gguf_file") else None

    def _remove_files(self, paths: List[Path]) -> bool:
        removed = False
        for path in paths:
            try:
                if path.is_file():
                    path.unlink()
                    removed = True
            except OSError as e:
                print(f"Error: could not delete '{path}': {e}", file=sys.stderr)
        return removed

    def _delete_manifest_files(
        self, manifest: Dict[str, Any], keep_shared_projector: bool
    ) -> bool:
        repo_id = manifest.get("hf_repo") or ""
        task = self._task_holding(repo_id)
        if task is None or not manifest.get("gguf_file"):
            return False
        repo_dir = Path(self.models_base_dir) / task / repo_id
        removed = self._remove_files([repo_dir / manifest["gguf_file"]])
        if not removed:
            return False
        mmproj = manifest.get("mmproj_file")
        if mmproj and not (keep_shared_projector and self._model_ggufs(repo_dir)):
            self._remove_files([repo_dir / mmproj])
        self._drop_repo_dir_without_weights(repo_dir)
        return True

    def _delete_files_named_for_quant(self, repo_id: str, tag: str) -> bool:
        """Local GGUFs of the repo whose file name alone gives ``tag`` (no cached manifest or upload)."""
        task = self._task_holding(repo_id)
        if task is None:
            return False
        repo_dir = Path(self.models_base_dir) / task / repo_id
        uploaded = {
            filename
            for model_id, filename in self.user_upload_registry.load_upload_record().items()
            if model_id.partition(":")[0] == repo_id
        }
        matches = [
            p
            for p in self._model_ggufs(repo_dir)
            if p.name not in uploaded
            and (self.quant_from_filename(p.name) or "").upper() == tag.upper()
        ]
        if not self._remove_files(matches):
            return False
        self._drop_repo_dir_without_weights(repo_dir)
        return True

    def _delete_hub_manifest_files(
        self, hf_repo_with_tag: str, keep_shared_projector: bool
    ) -> bool:
        try:
            manifest = self.get_file_manifest(hf_repo_with_tag=hf_repo_with_tag)
        except ValueError:
            print(
                f"Error: Model {hf_repo_with_tag} not found for deletion.",
                file=sys.stderr,
            )
            return False
        except Exception as e:
            print(
                f"Error: could not look up the files of {hf_repo_with_tag} to delete: {e}",
                file=sys.stderr,
            )
            return False
        return self._delete_manifest_files(manifest, keep_shared_projector)

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

        # Uploads are listed under their registered quant.
        upload_quants: Dict[Tuple[str, str], str] = {}
        for model_id, filename in self.user_upload_registry.load_upload_record().items():
            upload_repo, _, upload_quant = model_id.partition(":")
            if upload_quant:
                upload_quants[(upload_repo, filename)] = upload_quant

        possible_tasks = ["text_generation", "embeddings", "rerank", "multimodal"]
        for task in possible_tasks:
            task_dir = base_dir / task
            for gguf_file in task_dir.rglob("*.gguf"):
                if "mmproj" in str(gguf_file):
                    continue

                # A `<model>:<QUANT>/` folder is a not-yet-migrated upload (migrate_legacy_upload_folders).
                model_name, _, folder_quant = gguf_file.parent.name.partition(":")
                repo_id = f"{gguf_file.parent.parent.name}/{model_name}"
                quant_value = (
                    folder_quant
                    or upload_quants.get((repo_id, gguf_file.name))
                    or self.extract_quant_from_filename(str(gguf_file))
                )
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
