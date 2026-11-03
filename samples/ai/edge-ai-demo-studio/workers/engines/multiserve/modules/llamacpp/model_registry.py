# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from contextlib import contextmanager
from pathlib import Path
import json
import os
from typing import Dict, Iterator, Optional

from worker_common import shared_model_lock


class ModelRegistry:
    """User-uploaded GGUF files: ``{"<org>/<model>:<QUANT>": "<file name>"}``.

    The quant is the one registered at upload, since the file name need not spell it parseably.
    Instances share the models directory, so changes run under a cross-process lock, written atomically.
    """

    #: Changes take milliseconds, so hitting this means a stuck lock, not a queue.
    LOCK_TIMEOUT_SECONDS = 60.0

    def __init__(self, path: Path, lock_path: Optional[Path] = None):
        self.registry_path = Path(path)
        self.lock_path = lock_path or self.registry_path.with_name(
            self.registry_path.name + ".changes"
        )

    def load_upload_record(self) -> Dict[str, str]:
        try:
            with open(self.registry_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return {
                        k: v
                        for k, v in data.items()
                        if isinstance(k, str) and isinstance(v, str)
                    }
                return {}
        except (json.JSONDecodeError, FileNotFoundError, OSError):
            return {}

    def save(self, uploads: Dict[str, str]):
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.registry_path.with_name(self.registry_path.name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(uploads, f, indent=2)
        os.replace(tmp, self.registry_path)

    @contextmanager
    def changing(self) -> Iterator[Dict[str, str]]:
        """The record to modify in place; saved on the way out if changed."""
        with shared_model_lock(self.lock_path, timeout=self.LOCK_TIMEOUT_SECONDS):
            uploads = self.load_upload_record()
            before = dict(uploads)
            yield uploads
            if uploads != before:
                self.save(uploads)

    def add_user_upload_model(self, model_name: str, filename: str):
        with self.changing() as uploads:
            uploads[model_name] = filename

    def remove_user_upload_model(self, model_name: str):
        with self.changing() as uploads:
            uploads.pop(model_name, None)
