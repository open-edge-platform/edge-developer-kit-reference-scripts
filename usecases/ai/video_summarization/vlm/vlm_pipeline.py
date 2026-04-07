# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import openvino as ov
import openvino_genai as ov_genai
from openvino import Tensor
from typing import List, NamedTuple, Union, Any, Mapping, Optional
from pydantic import Field

#from langchain.prompts import PromptTemplate
from langchain_core.language_models.llms import LLM
import os
import queue
import time
import numpy as np
#from langchain import LLMChain

class StreamerWrapper():
    stat_latencies: list[float]
    token_queue: object
    
    def __init__(self):
       self.token_queue = queue.Queue()
    
    def start_stream(self):
       print("Streamer start stream")
       self.token_queue = queue.Queue()
       self.stat_latencies = [time.time()]

           
    def finish_stream(self):
      #with self.token_queue.mutex:
      print("streamer: finish_stream")
      self.token_queue = queue.Queue()
        
    def streamer(self, subword):
      print(subword, end='', flush=True)
      self.stat_latencies.append(time.time())
      #with self.token_queue.mutex:
      self.token_queue.put(subword)
        
    def calculate_latencies(self):  # return a list with time delta between generated tokens
      if not self.stat_latencies:
        return []
          
      #new_list = [self.stat_latencies[0]] # first item remain same
      #for i in range(1, len(self.stat_latencies)):
      #  new_list.append(self.stat_latencies[i] - self.stat_latencies[i-1])
      #return new_list
      
      a=self.stat_latencies
      b=a[1:]+[0]
      c=np.array(b)-np.array(a)
      
      return c.tolist()[:-1]    

    def get_token_queue(self):
      return self.token_queue    

class OVVideoLLM(LLM):
    model: Optional[object] = None
    device: Optional[str] = ""

    def __init__(self, model_path, device='GPU', **kwargs ):
      super().__init__(**kwargs)

      enable_compile_cache = dict()
      self.device = device
      #device = "GPU"
      
      if "GPU" in self.device:
         enable_compile_cache["CACHE_DIR"] = "./cache/vlm_cache"
  
      if not os.path.exists(model_path):
         #print("OV model not found")
         raise ValueError('Invalid model path')
  
      
      self.model = ov_genai.VLMPipeline(model_path, device, **enable_compile_cache)
      

    def _call(
            self, 
            video_frames,
            text_input,
            system_prompt,
            **kwargs
            
        ):
        
        params={}       
        for k,v in kwargs.items():
          params[k]=v
                     
        self.model.start_chat(system_prompt)        
        res = self.model.generate( 
            prompt=text_input,
            images=video_frames,            
            **params
        )
        self.model.finish_chat()        
        return res

    #@property
    #def _identifying_params(self) -> Mapping[str, Any]:
    #    return model_path # {"name_of_model": model_path}

    @property
    def _llm_type(self) -> str:
        return "custom"
