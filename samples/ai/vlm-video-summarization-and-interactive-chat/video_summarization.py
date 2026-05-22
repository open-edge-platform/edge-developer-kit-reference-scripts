# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

import os
import cv2
import time
import base64
import chromadb
from pathlib import Path
from openai import OpenAI
from typing import List, Dict, Any
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core import VectorStoreIndex, StorageContext, Document

CHROMA_DATA_PATH = './chroma_db'
DATABASE_COLLECTION_NAME = ''
SYSTEM_PROMPT = ''

# extract frame data every 1 second
def extract_frames(video_path: str, save_frames: bool = False) -> List[Dict[str, Any]]:
    if not Path(video_path).exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Failed to open video file: {video_path}")

    try:
        video_fps = cap.get(cv2.CAP_PROP_FPS)
        
        frame_index = 0 
        frame_interval = video_fps
        frame_data = []
        
        while True:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ret, frame = cap.read()
            if not ret:
                break
            
            height, width = frame.shape[:2]
            target_width = 640
            target_height = int(height * (target_width / width))
            resized_frame = cv2.resize(frame, (target_width, target_height))
            
            data = {
                "timestamp": int(cap.get(cv2.CAP_PROP_POS_MSEC)) / 1e3, # in seconds
                "frame": resized_frame
            }
            
            if save_frames:
                os.makedirs("./frame", exist_ok=True)
                cv2.imwrite(f'./frame/frame_{data["timestamp"]}.jpg', resized_frame)
                
            frame_data.append(data)
            frame_index += frame_interval
        
        print(f'Extracted {len(frame_data)} frames from the video.')
        return frame_data
        
    finally:
        cap.release()


# convert frame from nparray to base64
def convert_frame_to_base64(frame) -> str:
    success, buffer = cv2.imencode('.jpg', frame)
    if not success:
        raise ValueError("Failed to encode frame to JPEG")
    return base64.b64encode(buffer).decode('utf-8')


# analyse the frame for description
def run_video_analytic(frame_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    client = OpenAI(
        api_key=os.getenv("OPENAI_API_KEY", "dummy"),
        base_url="http://127.0.0.1:5776/v1"
    )

    results = []
    
    for data in frame_data:
        try:
            start_time = time.time()
            base64_image = convert_frame_to_base64(data["frame"])
            
            completion = client.chat.completions.create(
                model="dummy",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url", 
                                "image_url": 
                                    {
                                        "url": f"data:image/jpeg;base64,{base64_image}"
                                    }
                            },
                            {
                                "type": "text", 
                                "text": SYSTEM_PROMPT
                            },
                        ],
                    },
                ],
            )

            output = completion.choices[0].message.content
            print(f'{data["timestamp"]}: {output}')
            print(f'Inference time: {time.time() - start_time} seconds')
            
            results.append(
                {
                    "description": output,
                    "metadata": {
                        "timestamp": data["timestamp"],
                    }
                }
            )
            
        except Exception as e:
            print(f"Failed to analyze frame at {data['timestamp']}s: {e}")
            results.append(
                {
                    "description": f"Analysis failed: {str(e)}",
                    "metadata": {
                        "timestamp": data["timestamp"],
                        "error": True,
                    }
                }
            )
    
    print(f"Completed analysis of {len(results)} frames")
    return results


def vector_storing(documents: List[Dict[str, Any]]) -> None:
    try:
        Path(CHROMA_DATA_PATH).mkdir(exist_ok=True)
        
        chroma_client = chromadb.PersistentClient(
            path=CHROMA_DATA_PATH, 
            settings=chromadb.config.Settings(anonymized_telemetry=False)
        )
        chroma_collection = chroma_client.get_or_create_collection(DATABASE_COLLECTION_NAME)
        embed_model = HuggingFaceEmbedding(model_name="BAAI/bge-small-en-v1.5")
        vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
        storage_context = StorageContext.from_defaults(vector_store=vector_store)
        
        for doc in documents:
            try:
                doc = Document(text=doc['description'], metadata=doc['metadata'])
                VectorStoreIndex.from_documents(
                    [doc], storage_context=storage_context, embed_model=embed_model
                )
            except Exception as e:
                print(f"Failed to store document: {str(e)}")
        
        print("Vector storing completed.")
                
    except Exception as e:
        print(f"Vector storing failed: {e}")
        raise


def start_video_analytics(video_path: str ="assets/traffic-intersection.mp4") -> Dict[str, Any]:
    Path(CHROMA_DATA_PATH).mkdir(exist_ok=True)
    
    chroma_client = chromadb.PersistentClient(
        path=CHROMA_DATA_PATH, 
        settings=chromadb.config.Settings(anonymized_telemetry=False)
    )
    
    try:
        chroma_collection = chroma_client.get_collection(DATABASE_COLLECTION_NAME)
        data = chroma_collection.get(include=['documents', 'metadatas'])
        
        if data["documents"]:
            print('Collection exists.')
            return data
        else:
            print('Collection exists but is empty, proceeding with video analysis')
    
    except Exception:
        print('Collection does not exist, creating new collection...')

    try:
        print('Start video analytics...')
        frame_data = extract_frames(video_path)
        res = run_video_analytic(frame_data)
        vector_storing(res)
        
        chroma_collection = chroma_client.get_or_create_collection(DATABASE_COLLECTION_NAME)
        return chroma_collection.get(include=['documents', 'metadatas'])
    
    except Exception as e:
        print(f"Video analytics failed: {str(e)}")
        raise


def delete_all_collections():
    try:
        chroma_client = chromadb.PersistentClient(
            path=CHROMA_DATA_PATH, 
            settings=chromadb.config.Settings(anonymized_telemetry=False)
        )
        
        all_collections = chroma_client.list_collections()
        
        for collection in all_collections:
            try:
                print(f"Deleting collection: {collection.name}")
                chroma_client.delete_collection(name=collection.name)
            except Exception as e:
                print(f"Failed to delete collection {collection.name}: {str(e)}")
        
        print("All collections deleted.")
        
    except Exception as e:
        print(f"Failed to delete collections: {str(e)}")
        raise


def update_collection(collection_name: str, system_prompt: str) -> None:
    global DATABASE_COLLECTION_NAME, SYSTEM_PROMPT
    
    DATABASE_COLLECTION_NAME = collection_name
    SYSTEM_PROMPT = system_prompt


def model_testing(image_path: str) -> None:
    if not Path(image_path).exists():
        raise FileNotFoundError(f"Image file not found: {image_path}")
    
    if not SYSTEM_PROMPT:
        raise ValueError("SYSTEM_PROMPT must be configured before testing model")
    
    try:
        frame = cv2.imread(image_path)
        if frame is None:
            raise ValueError(f"Failed to load image: {image_path}")
        
        frame_data = [{"frame": frame, "timestamp": 1234567890}]
        results = run_video_analytic(frame_data)
        print(f"Model testing completed: {results}")
        
    except Exception as e:
        print(f"Model testing failed: {str(e)}")
        raise
