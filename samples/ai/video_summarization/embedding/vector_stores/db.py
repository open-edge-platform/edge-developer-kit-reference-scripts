# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

#from langchain_community.vectorstores import VDMS
from langchain_vdms import VDMS
from langchain_community.vectorstores.vdms import VDMS_Client
#from langchain.pydantic_v1 import BaseModel, root_validator
from pydantic import BaseModel, root_validator
from langchain_core.embeddings import Embeddings
from decord import VideoReader, cpu
import numpy as np
from typing import List, Optional, Iterable, Dict, Any
from langchain_core.runnables import ConfigurableField
from dateparser.search import search_dates
import datetime
from tzlocal import get_localzone
from embedding.meanclip_modeling.simple_tokenizer import SimpleTokenizer
from embedding.meanclip_datasets.preprocess import get_transforms
from einops import rearrange
from PIL import Image
import torch
import uuid
import os
import time
import torchvision.transforms as T
toPIL = T.ToPILImage()

# 'similarity', 'similarity_score_threshold' (needs threshold), 'mmr'

class MeanCLIPEmbeddings(BaseModel, Embeddings):
    """MeanCLIP Embeddings model."""

    model: Any = None
    preprocess: Any = None
    tokenizer: Any = None
    # Select model: https://github.com/mlfoundations/open_clip
    model_name: str = "ViT-H-14"
    checkpoint: str = "laion2b_s32b_b79k"

    @root_validator(allow_reuse=True, skip_on_failure=True)
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that open_clip and torch libraries are installed."""
        try:
            # Use the provided model if present
            if "model" not in values:
                raise ValueError("Model must be provided during initialization.")
            values["preprocess"] = get_transforms
            values["tokenizer"] = SimpleTokenizer()

        except ImportError:
            raise ImportError(
                "Please ensure CLIP model is loaded"
            )
        return values

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        model_device = next(self.model.clip.parameters()).device
        text_features = []
        for text in texts:
            # Tokenize the text
            if isinstance(text, str):
                text = [text]

            sot_token = self.tokenizer.encoder["<|startoftext|>"]
            eot_token = self.tokenizer.encoder["<|endoftext|>"]
            tokens = [[sot_token] + self.tokenizer.encode(text) + [eot_token] for text in texts]
            tokenized_text = torch.zeros((len(tokens), 64), dtype=torch.int64)
            for i in range(len(tokens)):
                if len(tokens[i]) > 64:
                    tokens[i] = tokens[i][:64-1] + tokens[i][-1:]
                tokenized_text[i, :len(tokens[i])] = torch.tensor(tokens[i])
            #print("text:", text[i])
            #print("tokenized_text:", tokenized_text[i,:10])
            text_embd, word_embd = self.model.get_text_output(tokenized_text.unsqueeze(0).to(model_device), return_hidden=False)

            # Normalize the embeddings
            #print(" --->>>> text_embd.shape:", text_embd.shape)
            text_embd = rearrange(text_embd, "b n d -> (b n) d")
            text_embd = text_embd / text_embd.norm(dim=-1, keepdim=True)

            # Convert normalized tensor to list and add to the text_features list
            embeddings_list = text_embd.squeeze(0).tolist()
            #print("text embedding:", text_embd.flatten()[:10])
            text_features.append(embeddings_list)

        return text_features


    def embed_query(self, text: str) -> List[float]:
        return self.embed_documents([text])[0]


    def embed_video(self, paths: List[str], **kwargs: Any) -> List[List[float]]:
        # Open images directly as PIL images

        video_features = []
        for vid_path in sorted(paths):
            # Encode the video to get the embeddings
            model_device = next(self.model.parameters()).device
            # Preprocess the video for the model
            videos_tensor= self.load_video_for_meanclip(vid_path, num_frm=self.model.num_frm,
                                                                              max_img_size=224,
                                                                              start_time=kwargs.get("start_time", None),
                                                                              clip_duration=kwargs.get("clip_duration", None)
                                                                              )
            embeddings_tensor = self.model.get_video_embeddings(videos_tensor.unsqueeze(0).to(model_device))

            # Convert tensor to list and add to the video_features list
            embeddings_list = embeddings_tensor.squeeze(0).tolist()

            video_features.append(embeddings_list)

        return video_features


    def load_video_for_meanclip(self, vis_path, num_frm=64, max_img_size=224, **kwargs):
        # Load video with VideoReader
        vr = VideoReader(vis_path, ctx=cpu(0))
        fps = vr.get_avg_fps()
        num_frames = len(vr)
        start_idx = int(fps*kwargs.get("start_time", [0])[0])
        end_idx = start_idx+int(fps*kwargs.get("clip_duration", [num_frames])[0])

        frame_idx = np.linspace(start_idx, end_idx, num=num_frm, endpoint=False, dtype=int) # Uniform sampling
        clip_images = []

        # preprocess images
        clip_preprocess = get_transforms("clip", max_img_size)
        temp_frms = vr.get_batch(frame_idx.astype(int).tolist()).asnumpy()
        
        #print(f"frame_id: {frame_idx.astype(int).tolist()}")
        #print(f"temp_frms: {temp_frms}")
        for idx in range(temp_frms.shape[0]):
            im = temp_frms[idx] # H W C
            #print(f"im: {temp_frms.shape}")
            #clip_images.append(clip_preprocess(toPIL(im.transpose(2,0,1)))) # 3, 224, 224  as input to append
            clip_images.append(clip_preprocess(toPIL(im)))
        clip_images_tensor = torch.zeros((num_frm,) + clip_images[0].shape)
        clip_images_tensor[:num_frm] = torch.stack(clip_images)

        return clip_images_tensor


class VideoVS:
    def __init__(self, host, port, selected_db, video_retriever_model, chosen_video_search_type="similarity"):
        self.host = host
        self.port = port
        self.selected_db = selected_db
        #self.chosen_video_search_type = chosen_video_search_type
        self.constraints = None
        self.video_collection = 'video-test'
        self.video_embedder = MeanCLIPEmbeddings(model=video_retriever_model)
        self.chosen_video_search_type = chosen_video_search_type

        # initialize_db
        self.get_db_client()
        self.init_db()


    def get_db_client(self):

        if self.selected_db == 'vdms':
            print ('Connecting to VDMS db server . . .')
            self.client = VDMS_Client(host=self.host, port=self.port)

    def init_db(self):
        print ('Loading db instances')
        if self.selected_db == 'vdms':
            self.video_db = VDMS(
                client=self.client,
                embedding=self.video_embedder,
                collection_name=self.video_collection,
                engine="FaissFlat",
                distance_strategy="IP"
            )


    def update_db(self, prompt, n_images):
        #print ('Update DB')

        base_date = datetime.datetime.today()
        today_date= base_date.date()
        dates_found =search_dates(prompt, settings={'PREFER_DATES_FROM': 'past', 'RELATIVE_BASE': base_date})
        # if no date is detected dates_found should return None
        if dates_found != None:
            # Print the identified dates
            print("dates_found:",dates_found)
            for date_tuple in dates_found:
                date_string, parsed_date = date_tuple
                #print(f"Found date: {date_string} -> Parsed as: {parsed_date}")
                date_out = str(parsed_date.date())
                time_out = str(parsed_date.time())
                hours, minutes, seconds = map(float, time_out.split(":"))
                year, month, day_out = map(int, date_out.split("-"))

            # print("today's date", base_date)
            rounded_seconds = min(round(parsed_date.second + 0.5),59)
            parsed_date = parsed_date.replace(second=rounded_seconds, microsecond=0)

            # Convert the localized time to ISO format
            iso_date_time = parsed_date.isoformat()
            iso_date_time = str(iso_date_time)

            if self.selected_db == 'vdms':
                if date_string == 'today':
                    self.constraints = {"date": [ "==", date_out]}
                    self.update_image_retriever = self.video_db.as_retriever(search_type=self.chosen_video_search_type, search_kwargs={'k':n_images, "filter":self.constraints})
                elif date_out != str(today_date) and time_out =='00:00:00': ## exact day (example last firday)
                    self.constraints = {"date": [ "==", date_out]}
                    self.update_image_retriever = self.video_db.as_retriever(search_type=self.chosen_video_search_type, search_kwargs={'k':n_images, "filter":self.constraints})

                elif date_out == str(today_date) and time_out =='00:00:00': ## when search_date interprates words as dates output is todays date + time 00:00:00
                    self.update_image_retriever = self.video_db.as_retriever(search_type=self.chosen_video_search_type, search_kwargs={'k':n_images})
                else: ## Interval  of time:last 48 hours, last 2 days,..
                    self.constraints = {"date_time": [ ">=", {"_date":iso_date_time}]}
                    self.update_image_retriever = self.video_db.as_retriever(search_type=self.chosen_video_search_type, search_kwargs={'k':n_images, "filter":self.constraints})

        else:
            self.constraints = None
            self.update_image_retriever = self.video_db.as_retriever(search_type=self.chosen_video_search_type, search_kwargs={'k':n_images})
    
    def MultiModalRetrieval(self, query: str, top_k: int = 3):
        self.update_db(query, top_k)
        #video_results = self.video_retriever.invoke(query)
        print(f"filter: {self.constraints}")
        video_results = self.video_db.similarity_search_with_score(query=query, k=top_k, filter=self.constraints, fetch_k=30)
        #retriever = self.video_db.as_retriever(search_type=self.chosen_video_search_type, search_kwargs={'k':top_k, "filter":self.constraints, "score_threshold": 0.5})
        #video_results = retriever.invoke(query)
        #for r, score in video_results:
        #    print("videos:", r.metadata['video_path'], '\t', r.metadata['date'], '\t', r.metadata['time'], r.metadata['timestamp'], f"score: {score}", r, '\n')

        return video_results
