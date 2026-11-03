# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""File loaders and text splitters shared by every storage backend."""

from __future__ import annotations

import json
from typing import List

from langchain_community.document_loaders import (
    CSVLoader,
    EverNoteLoader,
    PyPDFLoader,
    TextLoader,
    UnstructuredEPubLoader,
    UnstructuredHTMLLoader,
    UnstructuredMarkdownLoader,
    UnstructuredODTLoader,
    UnstructuredPowerPointLoader,
    UnstructuredWordDocumentLoader,
)
from langchain_core.documents import Document
from langchain_text_splitters import (
    CharacterTextSplitter,
    MarkdownTextSplitter,
    RecursiveCharacterTextSplitter,
)

TEXT_SPLITTERS = {
    "Character": CharacterTextSplitter,
    "RecursiveCharacter": RecursiveCharacterTextSplitter,
    "Markdown": MarkdownTextSplitter,
}

LOADERS = {
    ".csv": (CSVLoader, {}),
    ".doc": (UnstructuredWordDocumentLoader, {}),
    ".docx": (UnstructuredWordDocumentLoader, {}),
    ".enex": (EverNoteLoader, {}),
    ".epub": (UnstructuredEPubLoader, {}),
    ".html": (UnstructuredHTMLLoader, {}),
    ".json": ("JSONLoader", {}),  # Custom handler
    ".md": (UnstructuredMarkdownLoader, {}),
    ".odt": (UnstructuredODTLoader, {}),
    ".pdf": (PyPDFLoader, {}),
    ".ppt": (UnstructuredPowerPointLoader, {}),
    ".pptx": (UnstructuredPowerPointLoader, {}),
    ".txt": (TextLoader, {"encoding": "utf8"}),
}


def load_json_documents(file_path: str) -> List[Document]:
    """One document per element of a top-level JSON array, or one for any other JSON value."""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    documents = []

    if isinstance(data, list):
        for idx, obj in enumerate(data):
            content = json.dumps(obj, indent=2, ensure_ascii=False)
            metadata = {
                "source": file_path,
                "json_index": idx,
                "object_type": type(obj).__name__,
            }
            documents.append(Document(page_content=content, metadata=metadata))
    else:
        content = json.dumps(data, indent=2, ensure_ascii=False)
        metadata = {
            "source": file_path,
            "json_index": 0,
            "object_type": type(data).__name__,
        }
        documents.append(Document(page_content=content, metadata=metadata))

    return documents


def load_single_document(file_path: str) -> List[Document]:
    ext = "." + file_path.rsplit(".", 1)[-1]
    if ext in LOADERS:
        loader_class, loader_args = LOADERS[ext]

        if loader_class == "JSONLoader":
            return load_json_documents(file_path)

        loader = loader_class(file_path, **loader_args)
        return loader.load()
    raise ValueError(f"File does not exist '{ext}'")


def split_documents(
    documents: List[Document],
    splitter_name: str,
    chunk_size: int,
    chunk_overlap: int,
) -> List[Document]:
    if splitter_name not in TEXT_SPLITTERS:
        raise ValueError(
            f"Invalid splitter_name. Must be one of: {list(TEXT_SPLITTERS.keys())}"
        )
    splitter = TEXT_SPLITTERS[splitter_name](
        chunk_size=chunk_size, chunk_overlap=chunk_overlap
    )
    return splitter.split_documents(documents)
