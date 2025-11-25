# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os
import httpx
import json
import asyncio
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse, JSONResponse
from typing import AsyncGenerator, List, Optional
from pydantic import BaseModel, ConfigDict, Field

sys.path.append(os.path.dirname(__file__))

from modules.ovms.cli import OVMSManagerCLI
from .utils import model_name_parser

class TokenizeRequest(BaseModel):
    repo_id: str
    content: str
    add_special: Optional[bool] = Field(False, example=True)
    return_len_only: Optional[bool] = Field(True, example=True)
 
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "repo_id": "OpenVINO/Phi-4-mini-instruct-int8-ov",
                "content": "this is a test message",
                "add_special": True,
                "return_len_only": True
            }
        }
    )

class ModelItem(BaseModel):
    id: str
    object: str
    owned_by: str

async def listen_for_disconnect(request: Request, response_task: asyncio.Task):
    try:
        while True:
            message = await request.receive()
            if message.get("type") == "http.disconnect":
                response_task.cancel()
                raise RuntimeError("Client disconnected, canceling upstream response task.")
            
            await asyncio.sleep(0) 

    except asyncio.CancelledError:
        pass
    except RuntimeError:
        raise 
    except Exception as e:
        print(f"Error in disconnect listener: {e}")
        if not response_task.done():
            response_task.cancel()

def create_ovms_openai_proxy_router(ovms_manager: OVMSManagerCLI) -> APIRouter:
    router = APIRouter(prefix="/v1")

    httpx_client = httpx.AsyncClient(timeout=600.0)
    
    @router.post("/chat/completions", tags=["OpenAI Style API Proxy"])
    async def chat_completions_proxy(request: Request):
        try:
            request_body = await request.json()
            model_id = request_body.get('model')
            if not model_id:
                raise HTTPException(status_code=400, detail="Model ID ('model' field) is required in the request body.")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        headers = { "Content-Type": "application/json" }
        provider, repo_id = model_name_parser(model_id)
        if provider != None and repo_id != None:
            if provider == "openvino":
                server_url = ovms_manager.get_server_url()
                backend_url = f"{server_url}/v3/chat/completions"
                request_body["model"] = repo_id

            elif provider == "openai":
                cloud_api_url = os.environ.get("CLOUD_API_ENDPOINT") or request.headers.get("cloud_api_endpoint")
                cloud_api_key = os.environ.get("CLOUD_API_KEY") or request.headers.get("cloud_api_key")

                if cloud_api_url == None:
                    raise HTTPException(status_code=400, detail="Invalid Cloud Endpoint")
                
                if cloud_api_key == None:
                    raise HTTPException(status_code=400, detail="Invalid Cloud API Key")

                backend_url = f"{cloud_api_url}/chat/completions"
                headers = { "Authorization": f"Bearer {cloud_api_key}", "Content-Type": "application/json" }
                request_body["model"] = repo_id

            else:
                raise HTTPException(status_code=400, detail="Invalid Model Id")
            
        else:
            raise HTTPException(status_code=400, detail="Invalid Model Id") 

        is_streaming = request_body.get('stream', False)     
        if is_streaming:
            async def streaming_content() -> AsyncGenerator[bytes, None]:
                try:
                    async with httpx_client.stream(
                        "POST",
                        backend_url,
                        json=request_body,
                        headers=headers
                    ) as response:
                        response.raise_for_status()
                        async for chunk in response.aiter_bytes():
                            yield chunk
                        yield b"\n"
                except httpx.HTTPStatusError as e:
                    error_detail = f"Upstream Server Error ({e.response.status_code}): {e.response.text}"
                    yield f'data: {json.dumps({"error": error_detail})}'
                except httpx.RequestError as e:
                    error_detail = f"Could not connect to llama.cpp server: {e}"
                    yield f'data: {json.dumps({"error": error_detail})}'

            return StreamingResponse(
                streaming_content(),
                media_type="text/event-stream"
            )
        
        else:
            backend_request = httpx_client.build_request(
                "POST", 
                backend_url, 
                json=request_body,
                headers=headers
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
                    return JSONResponse(content=response.json(), status_code=response.status_code)

                elif cancellation_task in done:
                    try:
                        cancellation_task.result()
                    except RuntimeError as e:
                        if "Client disconnected" in str(e):
                            return JSONResponse(content={"detail": "Request canceled by client."}, status_code=499)
                        raise

                raise RuntimeError("Proxy logic failed to resolve completion status.")

            except httpx.HTTPStatusError as e:
                raise HTTPException(status_code=e.response.status_code, detail=f"Upstream Server Error: {e.response.text}") from e
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"An unexpected proxy error occurred: {e}")

    @router.post("/embeddings", tags=["OpenAI Style API Proxy"])
    async def embeddings_proxy(request: Request):
        try:
            request_body = await request.json()
            model_id = request_body.get('model')
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        headers = { "Content-Type": "application/json" }
        provider, repo_id = model_name_parser(model_id)
        if provider != None and repo_id != None:
            if provider == "openvino":
                server_url = ovms_manager.get_server_url()
                backend_url = f"{server_url}/v3/embeddings"
                request_body["model"] = repo_id
            
            elif provider == "openai":
                cloud_api_url = os.environ.get("CLOUD_API_ENDPOINT") or request.headers.get("cloud_api_endpoint")
                cloud_api_key = os.environ.get("CLOUD_API_KEY") or request.headers.get("cloud_api_key")

                backend_url = f"{cloud_api_url}/embeddings"
                headers = { "Authorization": f"Bearer {cloud_api_key}", "Content-Type": "application/json" }
                request_body["model"] = repo_id
            else:
                raise HTTPException(status_code=400, detail="Invalid Model Id")
        
        else:
            raise HTTPException(status_code=400, detail="Invalid Model Id")

        try:
            backend_request = httpx_client.build_request("POST", backend_url, json=request_body, headers=headers)
            response = await httpx_client.send(backend_request) 
            response.raise_for_status()

            return Response(
                content=response.content,
                status_code=response.status_code,
                media_type=response.headers.get("content-type", "application/json")
            )

        except httpx.HTTPStatusError as e:
             error_content = e.response.read().decode()
             raise HTTPException(status_code=e.response.status_code, detail=f"Backend error: {error_content}")
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Proxy error communicating with llama-server: {e}")

    @router.get("/models", response_model=List[ModelItem], tags=["OpenAI Style API Proxy"])
    async def list_models_proxy():
        model_list = []

        for model in ovms_manager.list_models():
            for quant in model.get("downloaded", []):
                repo_id = model['repo_id']
                model_list.append({
                    "id": f"{repo_id}",
                    "object": model['task_type'],
                    "owned_by": "openvino"
                })

        return model_list

    @router.post("/rerank", tags=["ThirdParty API Proxy"])
    async def reranker_jina_proxy(request: Request):
        try:
            request_body = await request.json()
            model_id = request_body.get('model')
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        task = 'rerank'
        
        server_url = ovms_manager.get_server_url()
        backend_url = f"{server_url}/v3/rerank"

        try:
            backend_request = httpx_client.build_request("POST", backend_url, json=request_body)
            response = await httpx_client.send(backend_request)
            response.raise_for_status()
            
            return Response(
                content=response.content,
                status_code=response.status_code,
                media_type=response.headers.get("content-type", "application/json")
            )

        except httpx.HTTPStatusError as e:
             error_content = e.response.read().decode()
             raise HTTPException(status_code=e.response.status_code, detail=f"Backend error: {error_content}")
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Proxy error communicating with llama-server: {e}")
    
    @router.post("/tokenize", tags=["ThirdParty API Proxy"])
    async def tokenize_proxy(tokenize_request: TokenizeRequest):
        try:
            request_body = tokenize_request.model_dump()
            model_id = request_body.get('repo_id')
            if not model_id:
                raise HTTPException(status_code=400, detail="Repo ID ('repo_id' field) is required in the request body.")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON body")

        try:
            ovms_manager.is_active_model(model_id)
        except (FileNotFoundError, ValueError, RuntimeError, TimeoutError) as e:
            raise HTTPException(status_code=503, detail=f"{e}")

        request_data = tokenize_request.model_dump(by_alias=True)
        return_len_only = request_data.get("return_len_only", True)

        try:
            tokenized_inputs = ovms_manager.get_tokenized_inputs(model_name=model_id, **request_data)
            response_content = tokenized_inputs
            if return_len_only:
                response_content = { "n_tokens" : tokenized_inputs["n_tokens"] }
            
            return Response(
                content=json.dumps(response_content),
                media_type="application/json"
            )

        except httpx.HTTPStatusError as e:
            error_content = e.response.read().decode()
            raise HTTPException(status_code=e.response.status_code, detail=f"Backend error: {error_content}")
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Proxy error communicating with llama-server: {e}")
        
    return router