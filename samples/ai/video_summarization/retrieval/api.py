# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import requests
from concurrent.futures import ThreadPoolExecutor
import httpx
import json
import os
import asyncio

import queue
import time

INGEST_ENDPOINT="http://127.0.0.1:8001/embed_and_store"
QUERY_ENDPOINT="http://127.0.0.1:8001/search_video"

async def ingest_chunk(id, chunk_path, chunk_summary):
  request={"data": [{"chunk_id": id, "chunk_path": chunk_path, "chunk_summary": chunk_summary},]}
  
  async with httpx.AsyncClient() as client:
    r = await client.post(INGEST_ENDPOINT, json=request, timeout=20)
    print(f"resp: {r}")
    #r.raise_for_status()
    return r.text
    
def ingest_chunk_sync(id, chunk_path, chunk_summary):
   request={"data": [{"chunk_id": id, "chunk_path": chunk_path, "chunk_summary": chunk_summary},]}
   
   with ThreadPoolExecutor() as pool:
      try:
         response = requests.post(url=INGEST_ENDPOINT, json=request)
         if response.status_code != 200:
            print(f"Error ingesting data into vector store: code: {response.status_code}, body: {response.content}")
            
         print(f"success. response: {response.json()}")
      except requests.exceptions.RequestException as e:
         print(f"Request failed: {e}")
    
    
def search_in_db(query_txt, top_k=1):
   with ThreadPoolExecutor() as pool:
      try:
         response = requests.get(url=QUERY_ENDPOINT, params={"query": query_txt, "top_k": top_k})
         if response.status_code != 200:
            err_msg = {"error": f"Error in search_in_db function, HTTP {response.status_code}: {response.content.decode('utf-8')}"}
            print("Error message in search db function: ", err_msg)
            return err_msg
            
         return {"result": response.content.decode("utf-8")}
      except requests.exceptions.RequestException as e:
         print(f"search_in_db: Request failed: {e}")
         return {"Error": str(e)}
