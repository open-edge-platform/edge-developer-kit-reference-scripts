# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import shutil
import zipfile
import os
from pathlib import Path
from fastapi import HTTPException, status, UploadFile
from typing import Callable, Optional


def model_name_parser(model_id: str):
    if (
        model_id.startswith("openvino:")
        or model_id.startswith("llamacpp:")
        or model_id.startswith("openai:")
    ):
        parts = model_id.split(":", 1)
        if len(parts) == 2:
            return parts[0], parts[1]
    else:
        return None, model_id


def check_model_exists(
    model_path: Path,
    force_override: bool,
    cleanup_callback: Optional[Callable[[Path], None]] = None,
):
    if model_path.exists():
        if not force_override:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Model at '{model_path}' already exists. Use 'force_override=True' to overwrite.",
            )
        if cleanup_callback:
            cleanup_callback(model_path)


def save_chunk(
    chunk_file: UploadFile, chunk_index: int, total_chunks: int, temp_dir: Path
) -> bool:
    temp_dir.mkdir(parents=True, exist_ok=True)
    chunk_path = temp_dir / f"part_{chunk_index:04d}"

    with chunk_path.open("wb") as buffer:
        shutil.copyfileobj(chunk_file.file, buffer)

    required_chunks = [temp_dir / f"part_{i:04d}" for i in range(total_chunks)]
    return all(p.exists() for p in required_chunks)


def assemble_chunks(temp_dir: Path, total_chunks: int, target_file_path: Path):
    target_file_path.parent.mkdir(parents=True, exist_ok=True)
    required_chunks = [temp_dir / f"part_{i:04d}" for i in range(total_chunks)]

    with target_file_path.open("wb") as dest:
        for p in required_chunks:
            with p.open("rb") as src:
                shutil.copyfileobj(src, dest)

    shutil.rmtree(temp_dir)


def clear_chunks(temp_dir: Path):

    if temp_dir.exists():
        shutil.rmtree(temp_dir)


def extract_and_validate_zip(file_obj, target_dir: Path):
    target_dir.mkdir(parents=True, exist_ok=True)

    temp_extract_dir = target_dir.parent / (
        target_dir.name + "_temp_extract_" + os.urandom(4).hex()
    )

    if temp_extract_dir.exists():
        shutil.rmtree(temp_extract_dir)
    temp_extract_dir.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(file_obj, "r") as zip_ref:
            zip_ref.extractall(temp_extract_dir)

        model_xml_paths = list(temp_extract_dir.rglob("*model.xml"))

        if not model_xml_paths:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The uploaded zip file does not contain a 'model.xml' file.",
            )

        model_xml_paths.sort(key=lambda p: len(p.parts))
        source_dir = model_xml_paths[0].parent

        for item in source_dir.iterdir():
            dest_path = target_dir / item.name
            if dest_path.exists():
                if dest_path.is_dir():
                    shutil.rmtree(dest_path)
                else:
                    dest_path.unlink()
            shutil.move(str(item), str(target_dir))

    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid zip file.",
        )
    finally:
        if temp_extract_dir.exists():
            shutil.rmtree(temp_extract_dir)
