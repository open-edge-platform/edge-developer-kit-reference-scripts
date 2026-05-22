# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
os.environ['HF_HOME'] = "./data/huggingface"

import json
import magic
import logging
import requests
import numpy as np
import multiprocessing
from contextlib import asynccontextmanager
from typing_extensions import TypedDict, Required
from typing import List, Union, Optional

from openai import OpenAI

import uvicorn
from pydantic import BaseModel
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from starlette.background import BackgroundTasks

from utils.prompt import RAG_PROMPT, NO_CONTEXT_FOUND_PROMPT, QUERY_REWRITE_PROMPT
from utils.chroma_client import ChromaClient

logger = logging.getLogger('uvicorn.error')

OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "http://localhost:8012/v1")
CHROMA_CLIENT = None
VECTORDB_DIR = "./data/embeddings"
DOCSTORE_DIR = "./data/embeddings/documents"
client = OpenAI(
    api_key=os.environ.get("OPENAI_API_KEY", "-"),
    base_url=OPENAI_BASE_URL
)

class ICreateChatCompletions(TypedDict, total=False):
    messages: Required[List]
    model: str
    rag: bool = False
    endpoint: str
    suffix: str
    max_tokens: int = 16
    temperature: Union[int, float] = 1
    top_p: Union[int, float] = 1
    n: int = 1
    stream: bool = False
    logprobs: int
    echo: bool = False
    stop: Union[str, List[str]]
    presence_penalty: float = 0
    frequency_penalty: float = 0
    best_of: int
    logit_bias: dict[str, float]
    user: str
    top_k: int = -1
    ignore_eos: bool = False
    use_beam_search: bool = False
    stop_token_ids: List[int]
    skip_special_tokens: bool = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    global CHROMA_CLIENT
    logger.info("Initializing server services ...")
    embedding_device = os.environ.get('EMBEDDING_DEVICE', "CPU")
    reranker_device = os.environ.get('RERANKER_DEVICE', "CPU")
    CHROMA_CLIENT = ChromaClient(VECTORDB_DIR, embedding_device, reranker_device)
    yield
    logger.info("Stopping server services ...")


app = FastAPI(lifespan=lifespan)
allowed_cors = json.loads(os.getenv("ALLOWED_CORS", '["http://localhost:8010"]'))
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_cors,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.get('/healthcheck', status_code=200)
def get_healthcheck():
    return 'OK'


@app.get("/v1/models", status_code=200)
async def get_available_model():
    model_list = client.models.list()
    return model_list


# RAG Routes
@app.get("/v1/rag/text_embeddings", status_code=200)
async def get_text_embeddings(page: Optional[int] = 1, pageSize: Optional[int] = 5, source: Optional[str] = ""):
    global CHROMA_CLIENT
    data = CHROMA_CLIENT.get_all_collection_data(page, pageSize, source)
    result = {"status": True, "data": data}
    return JSONResponse(content=jsonable_encoder(result))


@app.get("/v1/rag/text_embedding_sources", status_code=200)
async def get_text_embedding_sources():
    global CHROMA_CLIENT
    data = CHROMA_CLIENT.get_all_sources()
    result = {"status": True, "data": data}
    return JSONResponse(content=jsonable_encoder(result))


@app.delete("/v1/rag/text_embeddings/{uuid}", status_code=200)
async def delete_text_embeddings(uuid: str):
    global CHROMA_CLIENT
    data = CHROMA_CLIENT.delete_data(uuid)
    result = {"status": True, "data": data}
    return JSONResponse(content=jsonable_encoder(result))


@app.delete("/v1/rag/text_embeddings/source/{source}", status_code=200)
async def delete_text_embeddings(source: str):
    global CHROMA_CLIENT
    source_path = f"../data/embeddings/documents/{source}"
    try:
        if os.path.isfile(source_path):
            logger.info(f"Removing the source file: {source_path}")
            os.remove(source_path)
        data = CHROMA_CLIENT.delete_data_by_source(source)
        result = {"status": True, "data": data}
    except Exception as error:
        result = {"status": False, "data": None, "detail": error}
    return JSONResponse(content=jsonable_encoder(result))


@app.post("/v1/rag/text_embeddings", status_code=200)
async def upload_rag_doc(chunk_size: int, chunk_overlap: int, files: List[UploadFile] = [UploadFile(...)]):
    global CHROMA_CLIENT
    ALLOWED_EXTENSIONS = ['.pdf', '.txt']
    ALLOWED_MIME_TYPES = {
        'application/pdf': '.pdf',
        'text/plain': '.txt',
        'text/x-python': '.txt',  # Sometimes plain text files are detected as Python
        'application/octet-stream': None  # Will need additional validation
    }
    
    file_list = []
    processed_list = []
    
    for file in files:
        # Read file content for validation
        file_content = await file.read()
        
        # Reset file pointer for later use
        await file.seek(0)
        
        # Basic extension check
        if not file.filename.endswith(tuple(ALLOWED_EXTENSIONS)):
            logger.warning(f"{file.filename} has unsupported extension.")
            continue
        
        # Use python-magic to detect actual file type
        try:
            mime_type = magic.from_buffer(file_content, mime=True)
            logger.info(f"Detected MIME type for {file.filename}: {mime_type}")
            
            # Validate MIME type
            if mime_type not in ALLOWED_MIME_TYPES:
                logger.warning(f"{file.filename} has unsupported MIME type: {mime_type}")
                continue
            
            # Special handling for octet-stream (binary detection fallback)
            if mime_type == 'application/octet-stream':
                # Try to detect by content or use filename extension as fallback
                file_magic_desc = magic.from_buffer(file_content)
                if 'PDF' in file_magic_desc and file.filename.endswith('.pdf'):
                    logger.info(f"{file.filename} appears to be a PDF based on content analysis")
                elif file.filename.endswith('.txt'):
                    # Try to decode as text to verify it's actually text
                    try:
                        file_content.decode('utf-8')
                        logger.info(f"{file.filename} appears to be a text file")
                    except UnicodeDecodeError:
                        logger.warning(f"{file.filename} cannot be decoded as text")
                        continue
                else:
                    logger.warning(f"{file.filename} could not be validated as supported file type")
                    continue
            
            # Additional validation for PDF files
            if mime_type == 'application/pdf' or (mime_type == 'application/octet-stream' and file.filename.endswith('.pdf')):
                if not file_content.startswith(b'%PDF-'):
                    logger.warning(f"{file.filename} does not appear to be a valid PDF file")
                    continue
            
            file_list.append(file)
            
        except Exception as e:
            logger.error(f"Error validating file {file.filename}: {str(e)}")
            continue

    if len(file_list) == 0:
        logger.error("No file is able to use to create text embeddings.")
        raise HTTPException(
            status_code=400, detail="No file is able to use to create text embeddings.")

    if not os.path.isdir(DOCSTORE_DIR):
        os.makedirs(DOCSTORE_DIR, exist_ok=True)

    for file in file_list:
        # Reset file pointer before reading
        await file.seek(0)
        with open(f"{DOCSTORE_DIR}/{file.filename}", "wb") as f:
            processed_list.append(file.filename)
            f.write(await file.read())

    CHROMA_CLIENT.create_collection_data(
        processed_list, chunk_size, chunk_overlap
    )
    result = {"status": True, "data": processed_list}
    return JSONResponse(content=jsonable_encoder(result))


# Chat completions routes
@app.post("/v1/chat/completions", status_code=200)
async def chat_completion(request: Request, data: ICreateChatCompletions):
    global CHROMA_CLIENT

    def _streamer():
        for chunk in llm.iter_content(chunk_size=1024):
            yield (chunk)

    def _verify_embeddings_available():
        num_embeddings = CHROMA_CLIENT.get_num_embeddings()
        logger.info(f"Number of embeddings available: {num_embeddings}")
        if num_embeddings == 0:
            return False
        return True

    def _get_high_score_context(data, threshold):
        return [elem for elem in data if elem['score'] > threshold]

    def _formatting_rag_fusion_result(retrieval_list, query):
        context = ""
        for i, item in enumerate(retrieval_list):
            document = item['document']
            score = np.array(item['score']) * 100
            context += f"Context {i+1}: {document}.\nScore: {score:.2}."
            if i < len(retrieval_list) - 1:
                context += "\n\n"

        formatted_prompt = RAG_PROMPT.format(
            context=context,
            question=query
        )
        return formatted_prompt

    isRAG = False

    if request.headers.get("rag"):
        isRAG = True if request.headers.get("rag") == "ON" else False

    if isRAG:
        logger.info("RAG settings is enabled. Verifying embedding is available")
        isEmbeddings = _verify_embeddings_available()
        if isEmbeddings:
            last_user_message = data['messages'][-1]['content']
            logger.info("Setting the temperature to 0.01 for RAG")
            data['temperature'] = 0.01

            reranker_results = CHROMA_CLIENT.query_data(last_user_message)
            if len(reranker_results) == 0:
                logger.error(
                    "Failed to retrieve contexts for RAG. Default to use normal message without RAG")
            else:
                filtered_results = _get_high_score_context(reranker_results, 0)
                if len(filtered_results) > 0:
                    logger.info("Successfully retrieve contexts for RAG")
                    user_prompt = _formatting_rag_fusion_result(
                        filtered_results, last_user_message)
                else:
                    logger.info("Failed to retrieve contexts for RAG")
                    user_prompt = NO_CONTEXT_FOUND_PROMPT.format(
                        question=last_user_message)
                data['messages'][-1]['content'] = user_prompt

    endpoint = data.get(
        'endpoint', f"{OPENAI_BASE_URL}/chat/completions")

    if 'rag' in data:
        data.pop('rag')

    if 'max_tokens' in data:
        data['max_completion_tokens'] = data.pop('max_tokens')

    print(f"Data: {data}")
    try:
        llm = requests.post(
            endpoint,
            json=data,
            stream=True
        )
    except Exception as error:
        logger.error(
            f"Error while proxying to serving services. Error: {error}")
        raise HTTPException(
            status_code=400, detail="Error while proxying to serving services")

    return StreamingResponse(_streamer(), media_type="text/event-stream")


if __name__ == "__main__":
    multiprocessing.freeze_support()
    uvicorn.run(
        app,
        host=os.environ.get('SERVER_HOST', "0.0.0.0"),
        port=int(os.environ.get('SERVER_PORT', "8011"))
    )
