# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Model asset download helpers (plain files and OpenVINO IR pairs)."""

from __future__ import annotations

import logging
from pathlib import Path

import requests
from tqdm import tqdm

logger = logging.getLogger(__name__)

_CHUNK = 1 << 20  # 1 MiB


def download_file(url: str, dest: Path) -> Path:
    """Stream ``url`` into ``dest`` (idempotent, .part temp + progress bar)."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    logger.info(f"Downloading {url} -> {dest}")
    with requests.get(url, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0)) or None
        with (
            open(part, "wb") as fh,
            tqdm(total=total, unit="B", unit_scale=True, desc=dest.name) as bar,
        ):
            for chunk in resp.iter_content(chunk_size=_CHUNK):
                fh.write(chunk)
                bar.update(len(chunk))
    part.rename(dest)
    return dest


def download_ir(xml_url: str, root: Path) -> Path:
    """Fetch an OpenVINO IR pair (``.xml`` + ``.bin``) and return the ``.xml``.

    ``xml_url`` is an Open Model Zoo storage URL of the form
    ``.../<model-name>/<precision>/<model-name>.xml``; the weights live next to
    it. Files are mirrored under ``root/<model-name>/<precision>/``.
    """
    parts = xml_url.rstrip("/").split("/")
    if len(parts) < 3 or not parts[-1].endswith(".xml"):
        raise ValueError(f"Not an OpenVINO IR url: {xml_url}")
    model_name, precision, filename = parts[-3], parts[-2], parts[-1]
    dest_dir = root / model_name / precision

    xml_path = download_file(xml_url, dest_dir / filename)
    download_file(
        xml_url[: -len(".xml")] + ".bin", dest_dir / f"{filename[:-4]}.bin"
    )
    return xml_path
