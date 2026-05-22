# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import re
import uuid
import time
import shutil
import logging

import chromadb
from chromadb.config import Settings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import (
    TextLoader,
    PyPDFLoader,
    UnstructuredHTMLLoader,
    UnstructuredPowerPointLoader,
)
from langchain_community.embeddings import OpenVINOBgeEmbeddings
from langchain_community.document_compressors.openvino_rerank import OpenVINOReranker
from langchain.retrievers import ContextualCompressionRetriever
from langchain_chroma import Chroma


class ChromaClient:
    def __init__(self, db_dir, embedding_device="CPU", reranker_device="CPU") -> None:
        self.logger = logging.getLogger('uvicorn.error')

        if not os.path.isdir(db_dir):
            self.logger.warning(
                f"No chromaDB is found in {db_dir}. Creating a directory to store all the embeddings.")
            os.makedirs(db_dir, exist_ok=True)

        self.db_dir = db_dir

        self.text_embedding_model_id = "BAAI/bge-large-en-v1.5"
        self.text_embedding_model_dir = "./data/models/embeddings/bge-large-en-v1.5"
        self.vector_search_top_k = 4
        self.text_embedding = self._verify_text_embedding_model_exists(embedding_device)

        self.reranker_model_id = "BAAI/bge-reranker-large"
        self.reranker_model_dir = "./data/models/reranker/bge-reranker-large"
        self.vector_rerank_top_n = 3
        self.reranker = self._verify_reranker_model_exists(reranker_device)

        self.collection_name = "text-embeddings"
        self.client = chromadb.PersistentClient(self.db_dir, settings=Settings(anonymized_telemetry=False))
        self.client.get_or_create_collection(
            self.collection_name,
            metadata={"hnsw:space": "cosine"},
        )
        self.text_vector_store = Chroma(
            client=self.client,
            collection_name=self.collection_name,
            embedding_function=self.text_embedding,
        )

        text_search_kwargs = {"k": 3, "score_threshold": 0.01}
        self.text_retriever = self.text_vector_store.as_retriever(
            search_kwargs=text_search_kwargs, search_type="similarity_score_threshold")
        self.text_retriever = ContextualCompressionRetriever(
            base_compressor=self.reranker, base_retriever=self.text_retriever)

    def _download_model(self, model_id, model_dir):
        from huggingface_hub import snapshot_download
        isModel = os.path.isdir(model_dir)
        if not isModel:
            self.logger.info(
                f"{model_id} not found in {model_dir}. Downloading from Hugging Face. Please ensure you have network connection")
            try:
                snapshot_download(
                    model_id,
                    revision="main",
                    resume_download=True
                )
            except Exception as error:
                raise RuntimeError(
                    f"Failed to download model: {model_id}. Error: {error}")
            return True
        else:
            self.logger.info(f"{model_id} available in {model_dir}")
            return False

    def _verify_text_embedding_model_exists(self, device="CPU"):
        isDownloaded = self._download_model(self.text_embedding_model_id, self.text_embedding_model_dir)
        embedding_model_kwargs = {"device": device}
        encode_kwargs = {
            "mean_pooling": False,
            "normalize_embeddings": True,
            "batch_size": 1 if device == "NPU" else 4
        }
        self.logger.info(
            f"Loading text embedding: {self.text_embedding_model_id} in OV format on device: {device}")
        text_embedding = OpenVINOBgeEmbeddings(
            model_name_or_path=self.text_embedding_model_id if isDownloaded else self.text_embedding_model_dir,
            model_kwargs=embedding_model_kwargs,
            encode_kwargs=encode_kwargs,
        )
        if isDownloaded:
            self.logger.info(
                f"Saving embedding model in {self.text_embedding_model_dir}")
            text_embedding.save_model(self.text_embedding_model_dir)
        text_embedding.ov_model.compile()
        return text_embedding

    def _verify_reranker_model_exists(self, device="CPU"):
        isDownloaded = self._download_model(
            self.reranker_model_id, self.reranker_model_dir)
        rerank_model_kwargs = {"device": device}
        self.logger.info(
            f"Loading reranker: {self.reranker_model_id} in OV format on device: {device}")
        reranker = OpenVINOReranker(
            model_name_or_path=self.reranker_model_id if isDownloaded else self.reranker_model_dir,
            model_kwargs=rerank_model_kwargs,
            top_n=self.vector_rerank_top_n
        )
        if isDownloaded:
            self.logger.info(
                f"Saving embedding model in {self.reranker_model_dir}")
            reranker.save_model(self.reranker_model_dir)
        reranker.ov_model.compile()
        return reranker

    def _read_file(self, file_path):
        if not os.path.isfile(file_path):
            raise FileNotFoundError(
                f"Unable to find file at path: {file_path}")
        if file_path.endswith(".txt"):
            loader = TextLoader(file_path)
        elif file_path.endswith(".pdf"):
            loader = PyPDFLoader(str(file_path))
        else:
            raise NotImplementedError(
                f"No loader implemented for {file_path}.")
        documents = loader.load()
        return documents

    def _create_text_embeddings(self, texts):
        if len(texts) == 0:
            raise RuntimeError("No text chunks available.")

        for i, doc in enumerate(texts):
            self.logger.info(f"Processing text chunk: {i+1}")
            if hasattr(doc, 'page_content'):
                doc.page_content = re.sub(
                    r'\s+', ' ', doc.page_content.replace("\n", " ")).strip()
                if hasattr(doc, 'metadata'):
                    if 'source' in doc.metadata:
                        doc.metadata['source'] = doc.metadata['source'].split(
                            "/")[-1]
                        doc.page_content += doc.page_content + \
                            '\n' + 'Source: ' + doc.metadata['source']
                    if 'page' in doc.metadata:
                        doc_page = doc.metadata['page']
                        doc.page_content += f" (Page {doc_page})"

    def _save_text_embeddings(self, text_chunks):
        try:
            ids = [str(uuid.uuid4()) for _ in text_chunks]
            self.text_vector_store.add_documents(
                documents=text_chunks, ids=ids)
            return True
        except Exception as error:
            self.logger.error(
                f"Failed to save embeddings from vector db. Error: {error}")
            return False

    def get_num_embeddings(self):
        try:
            collection = self.client.get_or_create_collection(
                name=self.collection_name
            )
            data = collection.get()
            return len(data["ids"])
        except Exception as error:
            self.logger.error(
                f"Failed to get number of total embeddings from vector db. Error: {error}")

    def get_all_collection_data(self, page, pageSize, source):
        try:
            collection = self.client.get_or_create_collection(
                name=self.collection_name
            )
            if source:
                data = collection.get(where={"source": source})
            else:
                data = collection.get()
            num_embeddings = len(data["ids"])
            doc_chunk_list = [
                {
                    "ids": data["ids"][x],
                    "chunk": data["documents"][x],
                    "source": data["metadatas"][x]["source"].split("/")[-1],
                    "page": data["metadatas"][x]["page"],
                }
                for x in range(num_embeddings)
            ]
            doc_chunk_list = sorted(doc_chunk_list, key=lambda x: x['page'])
            start_index = (page - 1) * pageSize
            end_index = start_index + pageSize
            paginated_data = doc_chunk_list[start_index:end_index]
            data = {
                "num_embeddings": num_embeddings,
                "doc_chunks": paginated_data,
                "current_page": page,
                "total_pages": (num_embeddings + pageSize - 1) // pageSize,
            }
            return data
        except Exception as error:
            self.logger.error(
                f"Failed to retrieve get collection data from vector db. Error: {error}")
            return {
                "num_embeddings": num_embeddings,
                "doc_chunks": {
                    "ids": [],
                    "chunk": [],
                    "source": [],
                    "page": [],
                },
                "current_page": page,
                "total_pages": (num_embeddings + pageSize - 1) // pageSize,
            }

    def get_all_sources(self):
        try:
            collection = self.client.get_or_create_collection(
                name=self.collection_name,
            )
            data = collection.get()
            num_data = len(data["ids"])
            sources_list = [data["metadatas"][x]["source"].split(
                "/")[-1] for x in range(num_data)]
            unique_source_list = list(set(sources_list))
            return unique_source_list
        except Exception as error:
            self.logger.error(
                f"Failed to retrieve all the data sources from vector db. Error: {error}")
            return []

    def query_data(self, query):
        try:
            self.logger.info("Querying vectordb and reranking ...")
            start_time = time.time()
            relevant_docs = self.text_retriever.invoke(query)
            self.logger.info(
                f"Elapsed time for vector & reranker: {round((time.time() - start_time), 2)} secs")
            reranked_results = []
            for docs in relevant_docs:
                data = {
                    "document": docs.page_content,
                    "score": docs.metadata['relevance_score'],
                }
                reranked_results.append(data)
            return reranked_results

        except Exception as error:
            self.logger.error(
                f"Failed to get embeddings and reranked results from vector db. Error: {error}")
            return []

    def create_collection_data(self, processed_list, chunk_size, chunk_overlap):
        for file_name in processed_list:
            try:
                file_path = f"{self.db_dir}/documents/{file_name}"
                documents = self._read_file(file_path)
                text_splitter = RecursiveCharacterTextSplitter(
                    chunk_size=int(chunk_size),
                    chunk_overlap=int(chunk_overlap),
                    length_function=len,
                    is_separator_regex=False
                )
                text_chunks = text_splitter.split_documents(documents)
                self._create_text_embeddings(text_chunks)
                self._save_text_embeddings(text_chunks)
                self.logger.info(
                    f"Text embeddings created saved in {self.db_dir}")
            except Exception as error:
                self.logger.error(
                    f"Failed to create collection data. Error: {error}")
                return None
        self.logger.info(
            f"Text embeddings created successfully.")
        return True

    def delete_data(self, uuid):
        try:
            collection = self.client.get_collection(
                name=self.collection_name,
            )
            collection.delete(
                ids=[str(uuid)]
            )
            return True
        except Exception as error:
            self.logger.error(
                f"Failed to delete data: {uuid} from vector db. Error: {error}")
            return False

    def delete_data_by_source(self, source):
        try:
            collection = self.client.get_collection(
                name=self.collection_name,
            )
            response = collection.get(
                where={"source": source},
            )
            doc_ids = [doc_id for doc_id in response["ids"]]
            collection.delete(ids=doc_ids)
            return True
        except Exception as error:
            self.logger.error(
                f"Failed to delete data source: {source} from vector db. Error: {error}")
            return False

    def delete_collection(self):
        if not os.path.isdir(self.db_dir):
            self.logger.warning(f"Unable to find {self.db_dir}")
            return False
        shutil.rmtree(self.db_dir)
        return True
