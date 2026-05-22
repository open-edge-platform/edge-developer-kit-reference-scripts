# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from datetime import datetime
import sys
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from tzlocal import get_localzone
import traceback

import io
import json
import os
import asyncio
import queue
import numpy as np
import queue
import time
from decord import VideoReader, cpu
import torch
import argparse
import cv2
import datetime
import uuid

from embedding.generate_store_embeddings import setup_meanclip_model
from embedding.vector_stores import db

os.environ["no_proxy"] = "localhost,127.0.0.1"


#vlm latencies of last request
retriever_latencies = []

class VideoChunk(BaseModel):
    chunk_id: str
    chunk_path: str
    chunk_summary: str

class IngestTxtRequest(BaseModel):
    data: List[VideoChunk]


####################################################

app = FastAPI()

vs_host='localhost'
vs_port=55555
selected_db='vdms'

try:
    meanclip_cfg_json = json.load(open('embedding/meanclip_config/clip_meanAgg.json', 'r'))
    meanclip_cfg = argparse.Namespace(**meanclip_cfg_json)
    print(f"cfg: {meanclip_cfg}")
    model, _=setup_meanclip_model(meanclip_cfg, device="cpu")
    
    vs= db.VideoVS(vs_host, vs_port, selected_db, model)
    
    print("Connected to VDMS successfully.")

except Exception as e:
    exc_type, exc_value, exc_traceback = sys.exc_info()
    tb_list = traceback.extract_tb(exc_traceback)
    filename, lineno, _, _ = tb_list[-1]    
    print(f"Error connecting to FAISS DB: line: {lineno}, filename: {filename}, detail: {e}")
    traceback.print_exc()
    sys.exit(1)

@app.get("/")
def root():
    """
    Root path for the application
    """
    return {
        "message": "Hello from Retriever API Server."}


@app.get("/test_embed_txt_and_store")
async def test_embed_txt_and_store():
    try:
        video_url = './api/test_chunk.mp4'
        metadata = {}
        date_time = datetime.datetime.now()
        local_timezone=get_localzone()
        time_format = "%a %b %d %H:%M:%S %Y"
        if not isinstance(date_time, datetime.datetime):
           date_time = datetime.datetime.strptime(date_time, time_format)
        time_str = date_time.strftime('%H:%M:%S')
        hours, minutes, seconds = map(float, time_str.split(":"))
        date = date_time.strftime('%Y-%m-%d')
        year, month, day=map(int, date.split("-"))
        
        uuid_str = str(uuid.uuid4()).replace("-","")
        uuid_str = uuid_str[:15]+uuid_str[-15:]
        
        metadata.update({"chunk_id": uuid_str, "date": date, "year": year, "month": month, "day": day, "time": time_str, "hours": hours, "minutes": minutes, "seconds": seconds})
        current_time_local = date_time.replace(tzinfo=datetime.timezone.utc).astimezone(local_timezone)
        
        cap = cv2.VideoCapture(video_url)
        if int(cv2.__version__.split('.')[0]) < 3:
           fps = cap.get(cv2.cv.CV_CAP_PROP_FPS)
        else:
           fps = cap.get(cv2.CAP_PROP_FPS)
        
        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        
        iso_date_time = current_time_local.isoformat()
        metadata.update({"date_time": {"_date": str(iso_date_time)}, "clip_duration": total_frames/fps, "fps": fps, "total_frames": total_frames, "video_path": video_url})
        #TODO: add chunk_summary into metadata
        
        t1=time.time()
        vs.video_db.add_videos(paths=[video_url],
                        texts=['sample summary'],
                        metadatas=[metadata],
                        start_time=[0],
                        clip_duration=[metadata['clip_duration']])
        t2=time.time()
        print(f"elapsed time: {t2-t1}\n")

        return {"status": "success", "total_frames": int(metadata['total_frames'])}

    except Exception as e:
        exc_type, exc_value, exc_traceback = sys.exc_info()
        tb_list = traceback.extract_tb(exc_traceback)
        filename, lineno, _, _ = tb_list[-1]
        raise HTTPException(status_code=500, detail=f"line: {lineno}, filename: {filename}, detail: {e}")


@app.get("/test_query")
async def test_query():
   try:
       Q = 'Man snap photo with phone'
       #Q = 'Man holding red basket'
       print (f'Testing Query: {Q}')
       top_k = 3
       results = vs.MultiModalRetrieval(Q, top_k=top_k)

       print(f"top-{top_k} returned results:", results)
       
       return {"status": "success", "message": f"top-{top_k} returned results: {results}"}

   except Exception as e:
       exc_type, exc_value, exc_traceback = sys.exc_info()
       tb_list = traceback.extract_tb(exc_traceback)
       filename, lineno, _, _ = tb_list[-1]
       raise HTTPException(status_code=500, detail=f"line: {lineno}, filename: {filename}, detail: {e}")

@app.post("/embed_and_store")
async def embed_and_store(request: IngestTxtRequest):
    try:
        video_urls = []
        metadatas = []
        start_times = []
        clip_durations = []
        page_contents = []
        
        print(f"request: {request}")
        
        for item in request.data:
            #video_url = './api/test_chunk.mp4'
            metadata = {}
            date_time = datetime.datetime.now()
            local_timezone=get_localzone()
            time_format = "%a %b %d %H:%M:%S %Y"
            if not isinstance(date_time, datetime.datetime):
               date_time = datetime.datetime.strptime(date_time, time_format)
            time_str = date_time.strftime('%H:%M:%S')
            hours, minutes, seconds = map(float, time_str.split(":"))
            date = date_time.strftime('%Y-%m-%d')
            year, month, day=map(int, date.split("-"))
            
            uuid_str = str(uuid.uuid4()).replace("-","")
            uuid_str = uuid_str[:15]+uuid_str[-15:]
            
            metadata.update({"chunk_id": item.chunk_id, "date": date, "year": year, "month": month, "day": day, "time": time_str, "hours": hours, "minutes": minutes, "seconds": seconds})
            current_time_local = date_time.replace(tzinfo=datetime.timezone.utc).astimezone(local_timezone)
            
            cap = cv2.VideoCapture(item.chunk_path)
            if int(cv2.__version__.split('.')[0]) < 3:
               fps = cap.get(cv2.cv.CV_CAP_PROP_FPS)
            else:
               fps = cap.get(cv2.CAP_PROP_FPS)
            
            total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
            
            iso_date_time = current_time_local.isoformat()
            metadata.update({"date_time": {"_date": str(iso_date_time)}, "clip_duration": total_frames/fps, "fps": fps, "total_frames": total_frames, "video_path": item.chunk_path})
            
            metadatas.append(metadata)
            video_urls.append(item.chunk_path)
            start_times.append(0)
            clip_durations.append(metadata['clip_duration'])
            page_contents.append(item.chunk_summary)
            
        
        t1=time.time()
        vs.video_db.add_videos(paths=video_urls,
                        metadatas=metadatas,
                        start_time=start_times,
                        clip_duration=clip_durations,
                        texts=page_contents)
        t2=time.time()
        print(f"elapsed time: {t2-t1}\n")

        return {"status": "success", "num_of_records": len(video_urls) }

    except Exception as e:
        exc_type, exc_value, exc_traceback = sys.exc_info()
        tb_list = traceback.extract_tb(exc_traceback)
        filename, lineno, _, _ = tb_list[-1]
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"line: {lineno}, filename: {filename}, detail: {e}")



#@app.get("/query")
#async def query(expr: str, collection_name: str = "chunk_summaries"):
#    try:
#        collection = Collection(collection_name)
#        collection.load()

#        results = collection.query(expr, collection_name=collection_name,
#                                   output_fields=["chunk_id", "chunk_path", "start_time", "end_time"])
#        print(f"{len(results)} vectors returned for query: {expr}")

#        return {"status": "success", "chunks": results}

#    except Exception as e:
#        raise HTTPException(status_code=500, detail=str(e))


@app.get("/search_video")
async def search_video(query: str, top_k: int = 1):
    try:
       results = vs.MultiModalRetrieval(query, top_k=top_k)

       print(f"top-{top_k} returned results:", results)
       
       #for item in results:
       #   print(item[0])
       
       return {"status": "success", 
               "results": [
                     {
                         #"chunk_id": doc[0].metadata["chunk_id"],
                         "date": doc[0].metadata["date"],
                         "time": doc[0].metadata["time"],
                         "chunk_path": doc[0].metadata["video_path"],
                         "chunk_summary": doc[0].page_content,
                         "score": doc[1]
                         #"chunk_id": doc.metadata["chunk_id"],
                         #"date": doc.metadata["date"],
                         #"time": doc.metadata["time"],
                         #"chunk_path": doc.metadata["video_path"],
                         #"chunk_summary": doc.page_content,
                         #"score": 0.5                         
                     }
                     for doc in results
                  ],
              }
              
    except Exception as e:
       exc_type, exc_value, exc_traceback = sys.exc_info()
       tb_list = traceback.extract_tb(exc_traceback)
       filename, lineno, _, _ = tb_list[-1]
       raise HTTPException(status_code=500, detail=f"line: {lineno}, filename: {filename}, detail: {e}")


