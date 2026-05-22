# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os
import httpx
import json
import asyncio

# import tiktoken
import math
import io
import base64
import pandas as pd

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse, JSONResponse
from typing import AsyncGenerator, List, Union, Any
from pydantic import BaseModel
from PIL import Image

sys.path.append(os.path.dirname(__file__))

from modules.llamacpp.cli import LlamaManagerCLI
from modules.model_schema import TokenizeRequest
from .utils import model_name_parser


class ModelItem(BaseModel):
    id: str
    object: str
    owned_by: str


# encoding = tiktoken.get_encoding("cl100k_base")


def get_server_url(manager: LlamaManagerCLI, task: str) -> str:
    task = manager.get_server_url(task)
    if task is None:
        raise HTTPException(
            status_code=503, detail=f"Service unavailable: Server is not running."
        )
    return task


def _resize_and_encode(image_data: bytes, max_dimension: int = 640) -> str:
    try:
        image = Image.open(io.BytesIO(image_data))
        if image.mode in ("RGBA", "P"):
            image = image.convert("RGB")

        width, height = image.size

        if width <= max_dimension and height <= max_dimension:
            buffered = io.BytesIO()
            image.save(buffered, format="JPEG")
            b64_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            return f"data:image/jpeg;base64,{b64_str}"

        image.thumbnail((max_dimension, max_dimension))

        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=85)
        b64_encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return f"data:image/jpeg;base64,{b64_encoded}"

    except Exception as e:
        raise e


async def listen_for_disconnect(request: Request, response_task: asyncio.Task):
    try:
        while True:
            message = await request.receive()
            if message.get("type") == "http.disconnect":
                response_task.cancel()
                raise RuntimeError(
                    "Client disconnected, canceling upstream response task."
                )

            await asyncio.sleep(0)

    except asyncio.CancelledError:
        pass
    except RuntimeError:
        raise
    except Exception as e:
        print(f"Error in disconnect listener: {e}")
        if not response_task.done():
            response_task.cancel()


def create_llamacpp_openai_proxy_router(llmcpp_manager: LlamaManagerCLI) -> APIRouter:
    main_router = APIRouter()
    router = APIRouter(prefix="/v1")
    routerv2 = APIRouter(prefix="/v2")

    image_downloader_client = httpx.AsyncClient(timeout=None)
    httpx_client = httpx.AsyncClient(timeout=None)

    async def process_image_item(item: dict, max_dimension: int = 640):
        if item.get("type") != "image_url":
            return

        image_bytes = None
        image_url_obj = item.get("image_url", {})
        url_str = image_url_obj.get("url", "")
        if not url_str:
            return

        if url_str.startswith("http://") or url_str.startswith("https://"):
            try:
                resp = await image_downloader_client.get(url_str, timeout=60.0)
                resp.raise_for_status()
                image_bytes = resp.content
            except Exception as e:
                return

        elif url_str.startswith("data:image"):
            try:
                if "," in url_str:
                    _, encoded = url_str.split(",", 1)
                else:
                    encoded = url_str
                image_bytes = base64.b64decode(encoded)
            except Exception as e:
                return

        if image_bytes:
            try:
                loop = asyncio.get_running_loop()
                new_data_uri = await loop.run_in_executor(
                    None, _resize_and_encode, image_bytes, max_dimension
                )
                item["image_url"]["url"] = new_data_uri
            except Exception as e:
                return

    async def process_request_images(request_body: dict):
        messages = request_body.get("messages", [])
        if not messages:
            return

        tasks = []
        for message in messages:
            content = message.get("content")
            if isinstance(content, list):
                for item in content:
                    if item.get("type") == "image_url":
                        tasks.append(process_image_item(item))

        if tasks:
            await asyncio.gather(*tasks)

    async def tokenize(server_url, text):
        tokenizer_url = f"{server_url}/tokenize"
        try:
            tokenized_request_data = {"content": text, "add_special": True}
            tokenize_request = httpx_client.build_request(
                "POST", tokenizer_url, json=tokenized_request_data
            )
            response = await httpx_client.send(tokenize_request)
            response.raise_for_status()
            tokenized_tokens = response.json().get("tokens", [])
            return tokenized_tokens
        except:
            return []

    async def detokenize(server_url, tokens):
        detokenizer_url = f"{server_url}/detokenize"
        try:
            detokenized_request_data = {"tokens": tokens}
            detokenize_request = httpx_client.build_request(
                "POST", detokenizer_url, json=detokenized_request_data
            )
            response = await httpx_client.send(detokenize_request)
            response.raise_for_status()
            detokenized_str = response.json().get("content", "")
            return detokenized_str
        except:
            return ""

    async def truncate_to_fixed_len(server_url, strings, max_tokens_per_string):
        final_strings = []

        for s in strings:
            tokens = await tokenize(server_url, s)
            truncated_tokens = tokens[:max_tokens_per_string]
            final_strings.append(await detokenize(server_url, truncated_tokens))

        return final_strings

    async def input_truncation(
        task: str, input: Any, query: str = ""
    ) -> Union[List, str]:
        task_metadata = llmcpp_manager.get_task_metadata(task)
        batch_size = task_metadata.get("batch_size", 512)
        server_url = get_server_url(llmcpp_manager, task)

        query_tokenized_token = await tokenize(server_url, query)
        query_len = len(query_tokenized_token)
        query_len = max(max(query_len, 4), query_len)

        tokenized_tokens = []
        if isinstance(input, list):
            tokenized_tokens = await truncate_to_fixed_len(
                server_url, input, batch_size - query_len
            )

        elif isinstance(input, str):
            tokenized_tokens = await truncate_to_fixed_len(
                server_url, [input], batch_size - query_len
            )

        return tokenized_tokens

    async def input_chunking(
        task: str, input: Any, query: str = ""
    ) -> Union[List, str]:
        def chunk_with_tracking(token_ids, max_chunk_len):
            chunks = []
            source_indices = []

            for idx, row in enumerate(token_ids):
                for i in range(0, len(row), max_chunk_len):
                    chunk = row[i : i + max_chunk_len]
                    chunks.append(chunk)
                    source_indices.append(idx)

            return chunks, source_indices

        task_metadata = llmcpp_manager.get_task_metadata(task)
        batch_size = task_metadata.get("batch_size", 512)
        server_url = get_server_url(llmcpp_manager, task)

        query_tokenized_token = await tokenize(server_url, query)
        query_len = len(query_tokenized_token)

        tokenized_tokens = []
        detokenized_tokens = []

        if isinstance(input, list):
            for inp in input:
                tokens = await tokenize(server_url, inp)
                tokenized_tokens.append(tokens)

        elif isinstance(input, str):
            tokens = await tokenize(server_url, inp)
            tokenized_tokens.append(tokens)

        chunks, tracks = chunk_with_tracking(
            tokenized_tokens, batch_size - query_len - 4
        )
        for chunk in chunks:
            detokenized = await detokenize(server_url, chunk)
            detokenized_tokens.append(detokenized)

        return detokenized_tokens, tracks

    @router.post("/chat/completions", tags=["OpenAI Compliant API Proxy"])
    async def chat_completions_proxy(request: Request):
        try:
            request_body = await request.json()
            model_id = request_body.get("model")
            if not model_id:
                raise HTTPException(
                    status_code=400,
                    detail="Model ID ('model' field) is required in the request body.",
                )
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        headers = {"Content-Type": "application/json"}
        provider, repo_id = model_name_parser(model_id)
        if provider != None and repo_id != None:
            if provider == "llamacpp":
                try:
                    task = llmcpp_manager.get_model_task(repo_id)
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=f"{str(e)}")

                if task not in ["text_generation", "multimodal"]:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Model {repo_id} is not supported by the /chat/completions endpoint. Use the appropriate endpoint for this task.",
                    )

                try:
                    llmcpp_manager.is_active_model(task, repo_id)
                except (FileNotFoundError, ValueError, RuntimeError, TimeoutError) as e:
                    raise HTTPException(status_code=503, detail=f"{e}")

                server_url = get_server_url(llmcpp_manager, task)
                backend_url = f"{server_url}/v1/chat/completions"
                request_body["model"] = repo_id

            elif provider == "openai":
                cloud_api_url = os.environ.get(
                    "CLOUD_API_ENDPOINT"
                ) or request.headers.get("cloud_api_endpoint")
                cloud_api_key = os.environ.get("CLOUD_API_KEY") or request.headers.get(
                    "cloud_api_key"
                )

                backend_url = f"{cloud_api_url}/chat/completions"
                headers = {
                    "Authorization": f"Bearer {cloud_api_key}",
                    "Content-Type": "application/json",
                }
                request_body["model"] = repo_id

            else:
                raise HTTPException(status_code=400, detail="Invalid Model Id")

        else:
            raise HTTPException(status_code=400, detail="Invalid Model Id")

        if task == "multimodal":
            await process_request_images(request_body)

        is_streaming = request_body.get("stream", False)
        if is_streaming:

            async def streaming_content() -> AsyncGenerator[bytes, None]:
                try:
                    async with httpx_client.stream(
                        "POST", backend_url, json=request_body, headers=headers
                    ) as response:
                        response.raise_for_status()
                        async for chunk in response.aiter_bytes():
                            yield chunk
                        yield b"\n"
                except httpx.HTTPStatusError as e:
                    yield f'data: {json.dumps({"error": str(e) })}'
                except httpx.RequestError as e:
                    error_detail = f"Could not connect to llama.cpp server: {str(e)}"
                    yield f'data: {json.dumps({"error": error_detail})}'

            return StreamingResponse(
                streaming_content(), media_type="text/event-stream"
            )

        else:
            backend_request = httpx_client.build_request(
                "POST", backend_url, json=request_body, headers=headers
            )

            response_task = asyncio.create_task(httpx_client.send(backend_request))
            cancellation_task = asyncio.create_task(
                listen_for_disconnect(request, response_task)
            )

            done, pending = await asyncio.wait(
                [response_task, cancellation_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in pending:
                task.cancel()

            try:
                if response_task in done:
                    response = response_task.result()
                    response.raise_for_status()
                    return JSONResponse(
                        content=response.json(), status_code=response.status_code
                    )

                elif cancellation_task in done:
                    try:
                        cancellation_task.result()
                    except RuntimeError as e:
                        if "Client disconnected" in str(e):
                            return JSONResponse(
                                content={"detail": "Request canceled by client."},
                                status_code=499,
                            )
                        raise

                raise RuntimeError("Proxy logic failed to resolve completion status.")

            except httpx.HTTPStatusError as e:
                raise HTTPException(
                    status_code=e.response.status_code,
                    detail=f"Upstream Server Error: {e.response.text}",
                ) from e
            except Exception as e:
                raise HTTPException(
                    status_code=500, detail=f"An unexpected proxy error occurred: {e}"
                )

    @router.post("/embeddings", tags=["OpenAI Compliant API Proxy"])
    async def embeddings_proxy(request: Request):
        try:
            request_body = await request.json()
            model_id = request_body.get("model")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        headers = {"Content-Type": "application/json"}
        provider, repo_id = model_name_parser(model_id)

        if provider != None and repo_id != None:
            if provider == "llamacpp":
                try:
                    requested_task = llmcpp_manager.get_model_task(repo_id)
                    if requested_task != "embeddings":
                        raise HTTPException(
                            status_code=400,
                            detail=f"Model '{repo_id}' is for task '{requested_task}', but endpoint is for 'embeddings'.",
                        )
                    llmcpp_manager.is_active_model("embeddings", repo_id)
                except (FileNotFoundError, ValueError, RuntimeError, TimeoutError) as e:
                    raise HTTPException(status_code=503, detail=f"{e}")

                truncated_content = await input_truncation(
                    "embeddings", request_body.get("input"), ""
                )
                request_body["input"] = truncated_content

                server_url = get_server_url(llmcpp_manager, "embeddings")
                backend_url = f"{server_url}/v1/embeddings"
                request_body["model"] = repo_id

            elif provider == "openai":
                cloud_api_url = os.environ.get(
                    "CLOUD_API_ENDPOINT"
                ) or request.headers.get("cloud_api_endpoint")
                cloud_api_key = os.environ.get("CLOUD_API_KEY") or request.headers.get(
                    "cloud_api_key"
                )

                backend_url = f"{cloud_api_url}/embeddings"
                headers = {
                    "Authorization": f"Bearer {cloud_api_key}",
                    "Content-Type": "application/json",
                }
                request_body["model"] = repo_id

            else:
                raise HTTPException(status_code=400, detail="Invalid Model Id")

        else:
            raise HTTPException(status_code=400, detail="Invalid Model Id")

        try:
            backend_request = httpx_client.build_request(
                "POST", backend_url, json=request_body, headers=headers
            )
            response = await httpx_client.send(backend_request)
            response.raise_for_status()

            return Response(
                content=response.content,
                status_code=response.status_code,
                media_type=response.headers.get("content-type", "application/json"),
            )

        except httpx.HTTPStatusError as e:
            error_content = e.response.read().decode()
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Backend error: {error_content}",
            )
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Proxy error communicating with llama-server: {e}",
            )

    @router.get(
        "/models", response_model=List[ModelItem], tags=["OpenAI Compliant API Proxy"]
    )
    async def list_models_proxy():
        model_list = []

        for model in llmcpp_manager.list_models():
            for quant in model.get("downloaded", []):
                repo_id = model["repo_id"]
                model_list.append(
                    {
                        "id": f"{repo_id}:{quant}",
                        "object": model["task_type"],
                        "owned_by": "llamacpp",
                    }
                )

        return model_list

    @router.post("/rerank", tags=["LlamaCPP API Proxy"])
    @routerv2.post("/rerank", tags=["Cohere API Proxy"])
    async def reranker_jina_proxy(request: Request):
        try:
            request_body = await request.json()
            model_id = request_body.get("model")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        task = "rerank"
        provider, repo_id = model_name_parser(model_id)
        if provider != None and repo_id != None:
            if provider == "llamacpp":
                try:
                    requested_task = llmcpp_manager.get_model_task(repo_id)
                    if requested_task != "rerank":
                        raise HTTPException(
                            status_code=400,
                            detail=f"Model '{repo_id}' is for task '{requested_task}', but endpoint is for 'rerank'.",
                        )

                    llmcpp_manager.is_active_model(task, repo_id)

                except (FileNotFoundError, ValueError, RuntimeError, TimeoutError) as e:
                    raise HTTPException(
                        status_code=503,
                        detail=f"Failed to start/swap model '{repo_id}': {e}",
                    )
            else:
                raise HTTPException(f"Model '{repo_id}' is not a vaild model.")

        server_url = get_server_url(llmcpp_manager, task)
        backend_url = f"{server_url}/v1/rerank"

        truncated_content, trackers = await input_chunking(
            "rerank", request_body.get("documents"), request_body.get("query")
        )
        request_body["documents"] = truncated_content

        user_request_top_n = request_body.get(
            "top_n", len(request_body.get("documents"))
        )
        request_body["top_n"] = len(truncated_content)

        try:
            backend_request = httpx_client.build_request(
                "POST", backend_url, json=request_body
            )
            response = await httpx_client.send(backend_request)
            response.raise_for_status()
            content = json.loads(response.content)
            results = content.get("results", [])

            processed_results = []
            for result in results:
                idx = result["index"]
                x = result["relevance_score"]
                normalized_score = 1 / (1 + math.exp(-x))

                processed_results.append(
                    {"index": trackers[idx], "relevance_score": normalized_score}
                )

            df = pd.DataFrame(processed_results)
            result_df = df.groupby("index", as_index=False)["relevance_score"].mean()
            result_df["relevance_score"] = result_df["relevance_score"].apply(
                lambda x: round(x, 16)
            )
            result_list = result_df.to_dict(orient="records")
            result_list.sort(key=lambda x: x["relevance_score"], reverse=True)

            content["results"] = result_list[:user_request_top_n]
            content = json.dumps(content)

            return Response(
                content=content,
                status_code=response.status_code,
                media_type=response.headers.get("content-type", "application/json"),
            )

        except httpx.HTTPStatusError as e:
            error_content = e.response.read().decode()
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Backend error: {error_content}",
            )
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Proxy error communicating with llama-server: {e}",
            )

    @router.post("/tokenize", tags=["LlamaCPP API Proxy"])
    async def tokenize_proxy(tokenize_request: TokenizeRequest):
        try:
            request_body = tokenize_request.model_dump()
            model_id = request_body.get("repo_id")
            if not model_id:
                raise HTTPException(
                    status_code=400,
                    detail="Repo ID ('repo_id' field) is required in the request body.",
                )
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        task = ""
        provider, repo_id = model_name_parser(model_id)
        if provider != None and repo_id != None:
            if provider == "llamacpp":
                try:
                    task = llmcpp_manager.get_model_task(repo_id)
                    if task not in [
                        "text_generation",
                        "multimodal",
                        "embeddings",
                        "rerank",
                    ]:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Model '{repo_id}' is for task '{task}', but endpoint is for 'tokenize'.",
                        )

                    llmcpp_manager.is_active_model(task, repo_id)

                except (FileNotFoundError, ValueError, RuntimeError, TimeoutError) as e:
                    raise HTTPException(
                        status_code=503,
                        detail=f"Failed to start/swap model '{repo_id}': {e}",
                    )
            else:
                raise HTTPException(f"Model '{repo_id}' is not a vaild model.")

        try:
            server_url = get_server_url(llmcpp_manager, task)
        except HTTPException as e:
            raise e

        backend_url = f"{server_url}/tokenize"
        request_data = tokenize_request.model_dump(by_alias=True)
        return_len_only = request_data.get("return_len_only", True)

        try:
            backend_request = httpx_client.build_request(
                "POST", backend_url, json=request_data
            )
            response = await httpx_client.send(backend_request)
            response.raise_for_status()

            response_content = response.json()
            if "tokens" in response_content.keys() and isinstance(
                response_content["tokens"], list
            ):
                token_length = len(response_content["tokens"])
                response_content["n_tokens"] = token_length

                if return_len_only:
                    del response_content["tokens"]

            return Response(
                content=json.dumps(response_content),
                status_code=response.status_code,
                media_type=response.headers.get("content-type", "application/json"),
            )

        except httpx.HTTPStatusError as e:
            error_content = e.response.read().decode()
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Backend error: {error_content}",
            )
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Proxy error communicating with llama-server: {e}",
            )

    main_router.include_router(router)
    main_router.include_router(routerv2)

    return main_router
