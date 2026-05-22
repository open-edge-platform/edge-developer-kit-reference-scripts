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

INFERENCE_ENDPOINT="http://127.0.0.1:8000/vlm_inference_v2"
TELEMETRY_LAST_ENDPOINT="http://127.0.0.1:8000/telemetry/last"

#video_frames in numpy array     
async def infer_video_frames(video_frames, system_prompt="", prompt=""):
   async def stream_data():
     # Yield json header
     max_num_frames = len(video_frames)
     dtype = str(video_frames[0].dtype)
     shape = video_frames[0].shape
     vframe_len = len(video_frames[0].tobytes())
     vframe_bytes = [v.tobytes() for v in video_frames]
     header=json.dumps(
          {
           "dtype": dtype,
           "shape": shape,
           "frame_size": vframe_len,
           "system_prompt": system_prompt, 
           "prompt": prompt           
          }
         
         ).encode("utf-8") + b"\n\n"
     yield header
   
     # then yeid the binary file in chunks
     for vb in vframe_bytes:
         yield vb
       
   async with httpx.AsyncClient() as client:
     async with client.stream(
           method="POST",
           url=INFERENCE_ENDPOINT,
           content=stream_data(),
           #timeout=10
           timeout=None #disable timeout
         ) as response:
         
       async for chunk in response.aiter_text():
         #print(chunk.strip())
         yield chunk
     

async def last_request_telemetry():
  async with httpx.AsyncClient() as client:
    r = await client.get(TELEMETRY_LAST_ENDPOINT, timeout=20)
    r.raise_for_status()
    return r.text
