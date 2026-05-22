# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from datetime import datetime
import sys
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
#from pymilvus.orm import utility
#from pymilvus import db
from langchain_community.embeddings.openvino import OpenVINOEmbeddings
#from langchain_milvus import Milvus
from langchain_core.documents import Document
#from pymilvus import Collection, connections

from vlm.vlm_pipeline import OVVideoLLM, StreamerWrapper

import io
import json
import os
import asyncio
import queue
import numpy as np
import queue
import time
from decord import VideoReader, cpu
import openvino_genai as ov_genai
from openvino import Tensor
from api.dummy import dummy_resp

os.environ["no_proxy"] = "localhost,127.0.0.1"
xpu = os.environ.get("DEVICE")
isfake = os.environ.get("FAKE_VLM")
if xpu == "" or xpu is None:
  xpu="CPU"
  
if isfake == "" or isfake is None:
  isfake = 0
  
isfake = int(isfake)
  
print(f"XPU device: {xpu}, isfake: {isfake}")

# Resolve model path from this file location, not process CWD.
APP_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SAVED_MODEL_PATH = os.environ.get(
  "VLM_MODEL_PATH",
  os.path.join(APP_ROOT, "MiniCPM_INT8"),
)
print(f"VLM model path: {SAVED_MODEL_PATH}, exists: {os.path.exists(SAVED_MODEL_PATH)}")

#vlm latencies of last request
vlm_latencies = []

class VideoChunk(BaseModel):
    chunk_id: str
    chunk_path: str
    chunk_summary: str
    start_time: str
    end_time: str

class IngestTxtRequest(BaseModel):
    data: List[VideoChunk]  

class OVVlmRequest(BaseModel):
    system_prompt: str
    prompt: str
    images: list
    

def encode_video(video_path: str,
                 max_num_frames: int = 64,
                 resolution: list = []) -> list:
    def uniform_sample(l: list, n: int) -> list:
        gap = len(l) / n
        idxs = [int(i * gap + gap / 2) for i in range(n)]
        return [l[i] for i in idxs]

    if len(resolution) != 0:
        vr = VideoReader(video_path, width=resolution[0],
                         height=resolution[1], ctx=cpu(0))
    else:
        vr = VideoReader(video_path, ctx=cpu(0))

    frame_idx = [i for i in range(0, len(vr), max(1, int(len(vr) / max_num_frames)))]
    if len(frame_idx) > max_num_frames:
        frame_idx = uniform_sample(frame_idx, max_num_frames)
    frames = vr.get_batch(frame_idx).asnumpy()

    frames = [Tensor(v.astype('uint8')) for v in frames]
    print('Num frames sampled:', len(frames))
    return frames

def vlm_infer_dummy(
    frames,
    system_prompt="You are a curious and observant AI assistant specializes in monitoring and analyzing video feed.",
    user_prompt=""):

   global vlm_latencies
   vlm_latencies=[]
   is_first_token = True
   for c in dummy_resp:
      if is_first_token:
         time.sleep(4)
         vlm_latencies.append(4)
         is_first_token = False
      else:
         time.sleep(1/50)
         vlm_latencies.append(1/50)
      yield f"{c}"
   
def vlm_infer(
    frames,
    system_prompt="You are a curious and observant AI assistant specializes in monitoring and analyzing video feed.",
    user_prompt=""):

  global vlm_latencies
  
  if user_prompt=='':
    user_prompt = "describe the video"
  
  ov_streamer_wrapper = StreamerWrapper()
  ov_streamer_wrapper.start_stream()

  full_response=''
  
  config = ov_genai.GenerationConfig()
  config.max_new_tokens = 256
  
  #frames=encode_video('chunk_1.mp4', max_num_frames=64, resolution=[480, 270])
  
  generator=ov_micpm_vlm._call( frames, 
                                user_prompt,
                                system_prompt,
                                generation_config=config,
                                streamer=ov_streamer_wrapper.streamer
                              )
                                        
  token_queue = ov_streamer_wrapper.get_token_queue()
  
  while not token_queue.empty():
    try:
      token = token_queue.get(timeout=0.1)
      #full_response += token
      #placeholder.markdown(full_response)
      yield f"{token}"
    except queue.Empty:
      continue

  ov_streamer_wrapper.finish_stream()
  vlm_latencies=ov_streamer_wrapper.calculate_latencies()

app = FastAPI()

if isfake==0:
   print("loading ov model")
   ov_micpm_vlm = OVVideoLLM(model_path=SAVED_MODEL_PATH, device=xpu)
else:
   print("starting in test mode")
   ov_micpm_vlm = None


@app.get("/")
def root():
    """
    Root path for the application
    """
    return {
        "message": "Hello from App."}

@app.post("/vlm_inference_test")
async def vlm_inference_v2(request: Request):
  stream = request.stream()
  header_bytes=b""
  max_header_size=4096 # max 4KB JSON header
  received_bytes = b''
  async for chunk in stream:
     header_bytes += chunk
     try:
       sep = header_bytes.index(b'\n\n') # seperator between JSON and file content
       json_part = header_bytes[:sep]
       body_remainder = header_bytes[sep + 2:]
       metadata = json.loads(json_part.decode('utf-8'))
       system_prompt = metadata["system_prompt"]
       prompt = metadata["prompt"]
       break
     except ValueError:
       if len(header_bytes) > max_header_size:
         return JSONResponse({"error": "Header too large"}, status_code=400)        

  received_bytes += body_remainder
  async for chunk in stream:
    received_bytes += chunk
    
  return JSONResponse({
    "status": "success",
    "system_prompt": system_prompt,
    "prompt": prompt,
    "total_bytes": len(received_bytes)
  })
  
@app.post("/vlm_inference_v2")
async def vlm_inference_v2(request: Request):
  stream = request.stream()
  header_bytes=b""
  max_header_size=4096 # max 4KB JSON header
  received_bytes = b''
  received_len = 0
  
  video_frames = []
  
  async for chunk in stream:
     header_bytes += chunk
     try:
       sep = header_bytes.index(b'\n\n') # seperator between JSON and file content
       json_part = header_bytes[:sep]
       body_remainder = header_bytes[sep + 2:]
       metadata = json.loads(json_part.decode('utf-8'))

       break
     except ValueError:
       if len(header_bytes) > max_header_size:
         return JSONResponse({"error": "Header too large"}, status_code=400)        

  system_prompt = metadata["system_prompt"]
  prompt = metadata["prompt"]
  dtype = np.dtype(metadata["dtype"])
  shape = tuple(metadata["shape"])
  size = int(metadata["frame_size"])
   
  buffer = io.BytesIO()
  buffer.write(body_remainder)

  received_bytes += body_remainder
  received_len += len(body_remainder)
  
  async for chunk in stream:
    buffer.write(chunk)
    received_len += len(chunk)
    #print(f"chunk_len: {len(chunk)}")

  num_of_frames = received_len // size
  buffer.seek(0)
  video_frame_tensors=[ Tensor(np.frombuffer(buffer.read(size), dtype=dtype).reshape(shape)) for x in range(0, num_of_frames)]
  
  #np_array = np.frombuffer(buffer.read(), dtype=dtype).reshape(shape)
  #print(f"np_array shape: {np_array.shape}")
  
  #video_frames.append(
    
  #return JSONResponse({
  #  "status": "success",
  #  "system_prompt": system_prompt,
  #  "prompt": prompt,
  #  "total_bytes": received_len,
  #  "total_frames": num_of_frames
  #})
  
  if isfake==1:
     return StreamingResponse(vlm_infer_dummy(video_frame_tensors, system_prompt, prompt), media_type="text/plain")
  else:
     return StreamingResponse(vlm_infer(video_frame_tensors, system_prompt, prompt), media_type="text/plain")

#@app.get("/vlm_stream")
#async def stream_response():
#  async def event_stream():
#    for i in range(10):
#      yield f"data: {i}\n\n"
#      await asyncio.sleep(1)
#  return StreamingResponse(event_stream(), media_type="text/event-stream")
      

@app.get("/vlm_inference")
async def vlm_stream_response():
  return StreamingResponse(vlm_infer(), media_type="text/plain")

@app.get("/telemetry/{id}")
def get_telemetry(id: str):
  if id=='last':
    return { "latencies": vlm_latencies }
  else:
    return { "error": "not found" }

