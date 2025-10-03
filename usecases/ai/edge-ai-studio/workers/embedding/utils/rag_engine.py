# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
from typing import List
from glob import glob

from langchain_openai import OpenAIEmbeddings
from langchain.retrievers.contextual_compression import ContextualCompressionRetriever
from langchain.text_splitter import (
    CharacterTextSplitter,
    RecursiveCharacterTextSplitter,
    MarkdownTextSplitter,
)
from langchain_community.document_loaders import (
    CSVLoader,
    EverNoteLoader,
    PDFMinerLoader,
    TextLoader,
    UnstructuredEPubLoader,
    UnstructuredHTMLLoader,
    UnstructuredMarkdownLoader,
    UnstructuredODTLoader,
    UnstructuredPowerPointLoader,
    UnstructuredWordDocumentLoader,
)

from langchain_community.vectorstores import FAISS
from langchain.docstore.document import Document
from langchain_cohere import CohereRerank
import cohere

TEXT_SPLITERS = {
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
    ".md": (UnstructuredMarkdownLoader, {}),
    ".odt": (UnstructuredODTLoader, {}),
    ".pdf": (PDFMinerLoader, {}),
    ".ppt": (UnstructuredPowerPointLoader, {}),
    ".pptx": (UnstructuredPowerPointLoader, {}),
    ".txt": (TextLoader, {"encoding": "utf8"}),
}

# Global variables to store configuration - will be initialized by configure_rag_engine()
COHERE_CLIENT = None
EMBEDDINGS = None
CONFIG = None


def configure_rag_engine(ovms_port: int, embedding_model: str, rerank_model: str):
    """Configure the RAG engine with the specified parameters."""
    global COHERE_CLIENT, EMBEDDINGS, CONFIG

    ovms_api_url = f"http://localhost:{ovms_port}/v3"

    CONFIG = {
        "ovms_api_url": ovms_api_url,
        "embedding_model": embedding_model,
        "rerank_model": rerank_model,
    }

    COHERE_CLIENT = cohere.ClientV2(
        api_key="-",
        base_url=ovms_api_url,
    )

    EMBEDDINGS = OpenAIEmbeddings(
        model=embedding_model,
        api_key="-",
        tiktoken_enabled=False,
        base_url=ovms_api_url,
        embedding_ctx_length=8190,
    )


def load_single_document(file_path: str) -> List[Document]:
    ext = "." + file_path.rsplit(".", 1)[-1]
    if ext in LOADERS:
        loader_class, loader_args = LOADERS[ext]
        loader = loader_class(file_path, **loader_args)
        return loader.load()
    raise ValueError(f"File does not exist '{ext}'")


def create_data_embedding(kb_id, input_path: str):
    if EMBEDDINGS is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )

    documents = []
    for file in glob(f"{input_path}/*"):
        if os.path.isfile(file):
            print(f"Reading document {file}...", flush=True)
            documents.extend(load_single_document(file))

    spliter_name = "RecursiveCharacter"
    chunk_size = 1000
    chunk_overlap = 200
    text_splitter = TEXT_SPLITERS[spliter_name](
        chunk_size=chunk_size, chunk_overlap=chunk_overlap
    )
    texts = text_splitter.split_documents(documents)

    db = FAISS.from_documents(texts, EMBEDDINGS)
    db.save_local(f"./data/{kb_id}/faissdb")

    return True


def search_information(kb_id, query: str):
    if EMBEDDINGS is None or COHERE_CLIENT is None or CONFIG is None:
        raise RuntimeError(
            "RAG engine not configured. Call configure_rag_engine() first."
        )

    try:
        db = FAISS.load_local(
            f"./data/{kb_id}/faissdb", EMBEDDINGS, allow_dangerous_deserialization=True
        )

        vector_search_top_k = 5
        retriever = db.as_retriever(search_kwargs={"k": vector_search_top_k})
        compressor = CohereRerank(
            model=CONFIG["rerank_model"], client=COHERE_CLIENT, top_n=3
        )
        compression_retriever = ContextualCompressionRetriever(
            base_compressor=compressor, base_retriever=retriever
        )

        result = compression_retriever.invoke(query)
    except Exception as err:
        print(err)
        result = []

    return result
