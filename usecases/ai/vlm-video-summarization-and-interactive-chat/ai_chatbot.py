# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

import os
import chromadb
from dotenv import load_dotenv
from llama_index.llms.openai_like import OpenAILike
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core import VectorStoreIndex, Settings, StorageContext, PromptTemplate
from llama_index.core.postprocessor import MetadataReplacementPostProcessor, SentenceTransformerRerank, SimilarityPostprocessor

load_dotenv()
host_ip = os.getenv("HOST_IP")

CHROMA_DATA_PATH = './chroma_db'

query_engine = None

try:
    Settings.llm = OpenAILike(
        api_base="http://127.0.0.1:5778/v1",
        api_key="dummy",
        model="dummy",
        is_chat_model=True,
        is_function_calling_model=False,
    )
    
    chroma_client = chromadb.PersistentClient(
        path=CHROMA_DATA_PATH, 
        settings=chromadb.config.Settings(anonymized_telemetry=False)
    )
    
except Exception as e:
    print(f"Failed to configure LLM: {e}")
    raise


def setup_query_engine(collection_name: str ='traffic', video_path: str ='assets/traffic-intersection.mp4') -> None:
    global query_engine

    try:
        chroma_collection = chroma_client.get_or_create_collection(collection_name)
        
        embed_model = HuggingFaceEmbedding(model_name="BAAI/bge-small-en-v1.5")
        vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        
        index = VectorStoreIndex.from_vector_store(
            vector_store=vector_store,
            storage_context=storage_context, 
            embed_model=embed_model, 
            show_progress=True 
        )

        timestamp_format = f'[Month Day, Year at Time](http://{host_ip}:5999/gradio_api/file={video_path}#t=timestamp_second)'

        postproc = MetadataReplacementPostProcessor(target_metadata_key="window")
        rerank = SentenceTransformerRerank(top_n=1, model="BAAI/bge-reranker-base")
        postprocessor = SimilarityPostprocessor(similarity_cutoff=0)

        query_engine = index.as_query_engine(
            llm=Settings.llm,
            similarity_top_k=6,
            node_postprocessors=[postprocessor, postproc, rerank],
        )

        updated_prompt_template = (
            "Context information is below.\n"
            "---------------------\n"
            "{context_str}\n"
            "---------------------\n"
            "Given the context information and not prior knowledge, answer the query.\n"
            "Here are some rules to follow:\n"
            "1. Never directly reference the context in your answer.\n"
            "2. Do not try to make up an answer.\n"
            "3. If the question is not related to the context, politely respond that you are not able to help.\n"
            f"4. Always include related video timestamps in your answer if related to the context, formatted in HTML anchor tags like {timestamp_format}.\n"
            "5. If Month Day, Year at Time is not available, use the June 15, 2024 at 12:00:timestamp_second.\n"
            "6. If the answer is No, exclude the timestamps.\n"
            "7. Avoid statements like 'Based on the provided context' or 'According to the context'.\n"
            "8. Be human-like in tone.\n"
            "\n"
            "Query: {query_str}\n"
            "Answer: "
        )
        
        prompt_template = PromptTemplate(updated_prompt_template)
        query_engine.update_prompts(
            {"response_synthesizer:text_qa_template": prompt_template}
        )
    
    except Exception as e:
        print(f"Failed to set up query engine: {e}")
        raise

def get_response(message: str) -> str:
    if query_engine is None:
        raise RuntimeError("Query engine is not initialized.")
    
    if not message:
        return "Please enter a valid message."
    
    try:
        response = query_engine.query(message)
        return response
    
    except Exception as e:
        print(f"Failed to process query: {e}")
        return "An error occurred while processing your request. Please try again."