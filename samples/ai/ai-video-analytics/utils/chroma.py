# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import uuid
import chromadb
from chromadb.config import Settings
from langchain_chroma import Chroma
from langchain_community.embeddings import OpenVINOBgeEmbeddings

from chromadb.utils import embedding_functions

class Documents:
    def __init__(self, page_content, metadata) -> None:
        self.page_content = page_content
        self.metadata = metadata

class chromaClient:
    def __init__(self, collection_name="video_llm") -> None:
        self.collection_name = collection_name
        if not os.path.isdir("./data/chroma/"+self.collection_name):
            os.makedirs("./data/chroma/"+self.collection_name, exist_ok=True)

        self.text_embedding_model_id = "BAAI/bge-large-en-v1.5"
        self.text_embedding_model_dir = "./data/model/embeddings/bge-large-en-v1.5"
        self.vector_search_top_k = 4
        self.text_embedding = None
        self.client = chromadb.PersistentClient("./data/chroma/"+self.collection_name, settings=Settings(anonymized_telemetry=False))
        
        if self.collection_name == "video_llm":

            self.collection = self.client.get_or_create_collection(
                self.collection_name,
                metadata={"hnsw:space": "cosine"},
            )  
            self.text_embedding = self._verify_text_embedding_model_exists("CPU")
            self.text_vector_store = Chroma(
                client=self.client,
                collection_name=collection_name,
                embedding_function=self.text_embedding,
            )
        if self.collection_name == "face_llm":
            self.collection = self.client.get_or_create_collection(
            self.collection_name,
            metadata={"hnsw:space": "cosine","hnsw:M":1024},
        )
    
    def _download_model(self, model_id, model_dir):
        from huggingface_hub import snapshot_download
        isModel = os.path.isdir(model_dir)
        if not isModel:
            print(
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
            print(f"{model_id} available in {model_dir}")
            return False
        
    def _verify_text_embedding_model_exists(self, device="CPU"):
        isDownloaded = self._download_model(self.text_embedding_model_id, self.text_embedding_model_dir)
        embedding_model_kwargs = {"device": device}
        encode_kwargs = {
            "mean_pooling": False,
            "normalize_embeddings": True,
            "batch_size": 1 if device == "NPU" else 4
        }
        print(
            f"Loading text embedding: {self.text_embedding_model_id} in OV format")
        text_embedding = OpenVINOBgeEmbeddings(
            model_name_or_path=self.text_embedding_model_id if isDownloaded else self.text_embedding_model_dir,
            model_kwargs=embedding_model_kwargs,
            encode_kwargs=encode_kwargs,
        )
        if isDownloaded:
            print(
                f"Saving embedding model in {self.text_embedding_model_dir}")
            text_embedding.save_model(self.text_embedding_model_dir)
        text_embedding.ov_model.compile()
        return text_embedding

    def _get_all_data_ids(self):
        data = self.collection.get()
        return data['ids']

    def add_data(self, frame_data: object):
        id = str(uuid.uuid4())
        data = Documents(frame_data['captions'], frame_data['metadatas'])
        self.text_vector_store.add_documents(
            documents=[data],
            ids=[id]
        )
 
    def add_face_data(self,frame_data: object):
        id = str(uuid.uuid4())
        face_landmark = frame_data['face_landmarks']

        metadata = {
            "video_path":frame_data["metadatas"]["video_path"],
            "timestamp": frame_data["metadatas"]["timestamp"]
        }

        self.collection.add(ids=id,metadatas=[metadata],embeddings=face_landmark)

    def query_data(self, query: str, top_k=3, threshold=0.5):
        try:
            retriever = self.text_vector_store.as_retriever(
                search_type="similarity_score_threshold", 
                search_kwargs={
                    "k": top_k,
                    "score_threshold": threshold
                }
            )
            return retriever.invoke(query)
        except Exception as error:
            print(f"Error: {error}")
            return []
        
    def query_face_data(self, query, top_k=3, distance=0.5):

        results = self.collection.query(
            query_embeddings=query,
            n_results=top_k,
            include=['embeddings','metadatas','distances']
        )

        filtered_results = [(meta, dist) for meta, dist in zip(results['metadatas'][0], results['distances'][0]) if dist < distance]

        return filtered_results
    
    def peek_data(self):
        print(self.collection.peek())

    def reset_database(self):
        data_ids = self._get_all_data_ids()
        if len(data_ids) == 0:
            return False
        
        self.collection.delete(
            ids=data_ids
        )
        return True
