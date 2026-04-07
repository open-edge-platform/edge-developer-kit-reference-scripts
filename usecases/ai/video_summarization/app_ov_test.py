# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import logging
import queue
import threading
import collections
from pathlib import Path
from typing import List, NamedTuple, Union, Any, Mapping, Optional

import openvino as ov
import openvino_genai as ov_genai
from openvino import Tensor

import ast
import uuid
import os
import av
import cv2
import numpy as np
import streamlit as st
#from ultralytics import YOLO
from streamlit_webrtc import WebRtcMode, webrtc_streamer, VideoProcessorBase
from streamlit.runtime.scriptrunner import add_script_run_ctx, get_script_run_ctx

from datetime import datetime
import ffmpeg
import math
import time
import asyncio
import concurrent.futures
import re
import json
import traceback

import pandas as pd
from vlm.vlm_api import infer_video_frames, last_request_telemetry
from my_vlm_prompt import VLM_USER_PROMPT, VLM_SYSTEM_PROMPT

from concurrent.futures import ThreadPoolExecutor
from time import sleep
from util import json_extract_value, compute_time_differences, encode_frame_PIL, get_fps, encode_vframes_to_file, VLMRecord
from streamlit_webrtc_utils import VideoProcessor, create_rtsp_player, MINICPM_MAX_FRAMES, MINICPM_SAMPLING_INTERVAL
from retrieval.api import ingest_chunk, ingest_chunk_sync, search_in_db

#from streamlit_scrollable_textbox import st_scrollable_textbox

#from sample_utils.download import download_file
from langchain_core.language_models.llms import LLM
from PIL import Image
#from sample_utils.turn import get_ice_servers

HERE = Path(__file__).parent
ROOT = HERE
SAVED_MODEL_PATH = "./MiniCPM-V-2_6-ov/"
#SAVED_MODEL_PATH = "./MiniCPM_INT8/"
LVM_MODEL_PATH = "openbmb/MiniCPM-V-2_6"


RTSP_URL_CAM0 = "rtsp://localhost:8554/live"
RTSP_URL_CAM1 = "rtsp://localhost:8554/live1"
RTSP_URL_CAM2 = "rtsp://localhost:8554/live2"

#stat_latencies = []
#### DATA QUEUE OBJECTS

vlm_result_queue = []
vertex_result_queue = []
alert_queue = []
vlm_messages = []

#########################

camera_lists = {
  '0': RTSP_URL_CAM0,
  '1': RTSP_URL_CAM1,
  '2': RTSP_URL_CAM2,  
}

notification_icon_path='alert.png'

logger = logging.getLogger(__name__)
chat_messages = []

current_run_id=-1
vlm_thread_count=0

global_lock = threading.Lock()

st.set_page_config(initial_sidebar_state='collapsed', layout='wide')
  
# Initialize session state for the thread and event
if 'inference_thread_started' not in st.session_state:
    st.session_state['inference_thread_started'] = False
if 'lvm_thread' not in st.session_state:
    st.session_state['lvm_thread'] = None
if 'cam_id' not in st.session_state:
    st.session_state['cam_id'] = 0
if 'run_id' not in st.session_state:
    st.session_state['run_id'] = 0


class st_comp_app:
  vlm_summ_placeholder: object
  alert_placeholder: object
  perf_placeholder: object
  alert_history_placeholder: object
  vlm_chat_history_placeholder: object
  
  def __init__(self, vlm_summ_placeholder=None, alert_placeholder=None, alert_history_placeholder=None, perf_placeholder=None, chat_placeholder=None):
    self.vlm_summ_placeholder = vlm_summ_placeholder
    self.alert_placeholder = alert_placeholder
    self.perf_placeholder = perf_placeholder
    self.alert_history_placeholder = alert_history_placeholder
    self.vlm_chat_history_placeholder = chat_placeholder

class vlm_inference_ctx:
  #input
  system_prompt: str
  user_prompt: str
  #output
  stream_result_queue: list
  latency_queue: list
  st_placeholder: object
  run_id: int
  thread_event: threading.Event
  
  def __init__(self, system_prompt="", user_prompt="describe the video", st_placeholder=None, run_id=0, thread_event=None):
    self.stream_result_queue = []
    self.latency_queue = []
    self.system_prompt = system_prompt
    self.user_prompt = user_prompt
    self.st_placeholder = st_placeholder
    self.run_id = run_id
    self.thread_event=thread_event

#@st.fragment
def render_vlm_records(container):
   if container is None:
     return
   with container:
      #new_spacer_col, new_left_col = st.columns([0.05, 0.95])  # Adjust ratio as needed
      #with new_left_col:
           #print('refresh')
        with st.container(height=300):
           #st.markdown("###### test")
           global vlm_messages
           #st.button('refresh table')
           history_table = None
           #st.write('test')
           #st.balloons()
           with st.expander('See previous chunk summaries'):
              #is_first = True
              
              vlm_messages_dict=[record.decode() for record in reversed(vlm_messages)]
              df=pd.DataFrame.from_records(vlm_messages_dict, index='id') 
              
              #record.decode(), columns=('id','camera_name', 'time_span', 'datetime', 'description', 'anomaly_score', 'alert'))
              #if is_first:
              #  history_table=st.table(df)
              #  is_first = False
              #else:
              #  history_table.add_rows(df)
              if df is not None:
                history_table=st.table(df)
              else:
                st.markdown('##### no records')
                print(f"no records")
              #if history_table is not None:
              #  st.markdown(history_table)
              #else:
              

def ShowMessage(msg):
   message = st.toast(msg, icon=":material/dangerous:")

def ParsedMessageForAlerts(message, vlm_ctx):
   global alert_queue
   # check for alert, and raise alert in notification area
   
   try:
     decoded_message = message.decode()
     #anomaly_score = json_extract_value(output, 'anomaly_score')
     #f_anomaly_score = float(anomaly_score)
     if decoded_message['anomaly_score'] >= 0.7:
        alert_queue.append({'datetime': decoded_message['time_span'], 'cam_id': decoded_message['camera_name'], 'details': f":red[Red] alert (score: {decoded_message['anomaly_score']})"})
     elif decoded_message['anomaly_score'] >= 0.5:
        alert_queue.append({'datetime': decoded_message['time_span'], 'cam_id': decoded_message['camera_name'], 'details': f":orange[Orange] alert (score: {decoded_message['anomaly_score']})"})
    
     if vlm_ctx.st_placeholder is not None:
        if vlm_ctx.st_placeholder.alert_placeholder is not None:
           with vlm_ctx.st_placeholder.alert_placeholder:
              if decoded_message['anomaly_score'] >= 0.7:
                 ShowMessage(f"**{decoded_message['camera_name']}** :blue[{decoded_message['time_span']}] :red[Red] alert (score: {decoded_message['anomaly_score']}) detected.")                  
              elif decoded_message['anomaly_score'] >= 0.5:
                 ShowMessage(f"**{decoded_message['camera_name']}** :blue[{decoded_message['time_span']}] :orange[Orange] alert (score: {decoded_message['anomaly_score']}) detected.")
                
     # refresh alert/notifications      
     alerts_md = ''
     if len(alert_queue) > 0:
        #df = pd.DataFrame({}, ['datetime', 'cam_id', 'events'])
        # Accessing elements from right to left 
        #for i in range(-1, -len(list(st.session_state.alerts)) - 1, -1):
        i = 0
        for record_dict in reversed(alert_queue):        
          #df.append(record_dict)
          if i < 10:
            alerts_md += f"**{record_dict['datetime']}** - *{record_dict['cam_id']}*, {record_dict['details']} <br> "
          else:
            break
          #print(f"{alerts_html}")
     else:
       alerts_md = '*no alerts*'
      
     print(f"alert text: {alerts_md}")
      
     if vlm_ctx.st_placeholder is not None:
       if vlm_ctx.st_placeholder.alert_history_placeholder is not None:
          with vlm_ctx.st_placeholder.alert_history_placeholder:
            #update_alerts(alerts_md)
             st.markdown(alerts_md, unsafe_allow_html=True)
                                        
   except (json.JSONDecodeError, TypeError):
      #silently handle exceptions
      print("INFO: json_extract_value exception")



def run_vlm_inference(vlm_ctx, event_loop, webrtc_ctx):

  global vlm_thread_count
  #loop = asyncio.new_event_loop()
  #asyncio.set_event_loop(loop)
  asyncio.set_event_loop(event_loop)
    
  def run_in_thread(vlm_ctx, event_loop, webrtc_ctx):
    global current_run_id
    async def vlm_infer_async_ops(vframes, vlm_ctx):
      output=''
      async for chunk in infer_video_frames(vframes, system_prompt=vlm_ctx.system_prompt, prompt=vlm_ctx.user_prompt):
        print(f"{chunk}", end='', flush=True)
        output += f"{chunk}"
        
        #vlm_summ_placeholder=None, alert_placeholder=None, perf_placeholder=None
        
        if vlm_ctx.st_placeholder is not None:
          if vlm_ctx.st_placeholder.vlm_summ_placeholder is not None:
            with vlm_ctx.st_placeholder.vlm_summ_placeholder:
              with st.chat_message('AI'):
                with st.empty():
                  st.markdown(output)

      return output
      
    async def vlm_get_last_perf_result_ops():
      result = await last_request_telemetry()
      print(f"perf stats: {result}")
      perf_message = ''
      try:
        decoded_json = ast.literal_eval(result)
        lantencies = decoded_json['latencies']
        perf_message = f'\n\n:rocket: **inference executed in** {math.fsum(lantencies):.4f} s, **TTFT:** {(lantencies[0]):.4f} s, **token/s:** {len(lantencies[1:])/(math.fsum(lantencies[1:]))}'
        print(f"token length: {len(lantencies)}")
      except Exception as e:
        print(f"INFO: get_last_perf decode error, {e}")
      
      print(f"perf: {perf_message}")
      if vlm_ctx.st_placeholder is not None:
        if vlm_ctx.st_placeholder.perf_placeholder is not None:
          with vlm_ctx.st_placeholder.perf_placeholder:
            st.markdown(perf_message)

    
    #while current_run_id==vlm_ctx.run_id:       # stop the thread spawned by previous run
    while True:
      #print(f"T: {current_run_id}: {vlm_ctx.run_id}")
      vlm_ctx.thread_event.wait()
      try:
         if webrtc_ctx.state.playing:
           #print(f"vframes_queue: {len(webrtc_ctx.video_processor.buffer)}")
           if webrtc_ctx.video_processor is not None and (len(webrtc_ctx.video_processor.buffer) == webrtc_ctx.video_processor.buffer.maxlen):
             print('run inference')
             
             with webrtc_ctx.video_processor.frame_lock:
               vframes=list(webrtc_ctx.video_processor.buffer)
               webrtc_ctx.video_processor.buffer.clear()
               vheight = webrtc_ctx.video_processor.height
               vwidth = webrtc_ctx.video_processor.width
               vfps = webrtc_ctx.video_processor.summarizer_fps
               
             #asyncio.run(vlm_infer_async_ops(vframes, vlm_ctx))
             start_time=time.time()
             vlm_output=event_loop.run_until_complete(vlm_infer_async_ops(vframes, vlm_ctx))
             
             uuid_str = str(uuid.uuid4()).replace("-","")
             uuid_str = uuid_str[:15]+uuid_str[-15:]
             video_filename = f'chunk_{uuid_str}'
             vlm_out_obj = VLMRecord(id=uuid_str, rawdata=vlm_output)
             vlm_messages.append(vlm_out_obj)
             
             video_chunk_path = './chunks'
             full_path = os.path.join(video_chunk_path, video_filename + ".mp4")
             end_time=time.time()
             
             ParsedMessageForAlerts(vlm_out_obj, vlm_ctx)
             
             print(f"vlm inference processing time: {end_time-start_time}")
             event_loop.run_until_complete(vlm_get_last_perf_result_ops())
             
             render_vlm_records(vlm_ctx.st_placeholder.vlm_chat_history_placeholder)
             
             #encode video chunk to mp4
             #(byte_data, output_file, width, height, fps, format='bgr')
             vframe_bytes = []
             for v in vframes:
               vframe_bytes.append(v.tobytes())
             
             b_vframe = b''.join(vframe_bytes)
               
             print(f"encode_vframes_to_file, fn:{full_path}, w:{vwidth}, h:{vheight}, fps:{vfps}, len: {len(b_vframe)}")
             try:
                event_loop.run_until_complete(encode_vframes_to_file(b_vframe, full_path, vwidth, vheight, int(vfps), 'rgb24'))     
             except Exception as e:
                pass
                
             if webrtc_ctx.video_processor.save_into_db:   
                print(f"push detection into vector db")
                event_loop.run_until_complete(ingest_chunk(uuid_str, full_path, vlm_output))
             
           else:
             time.sleep(0.1) 
         else:
           time.sleep(0.1)
      except Exception as e:
        print(f"Exception: {e}\nTraceback: {traceback.format_exc()}") 

    print("run_vlm_inference thread ended")

  with global_lock:
    print(f"vlm_thread_count == {vlm_thread_count}")
    if vlm_thread_count > 1:      
      return  
    with ThreadPoolExecutor(max_workers=1) as exe:
      future = exe.submit(run_in_thread, vlm_ctx, event_loop, webrtc_ctx)
      for thread in exe._threads:
        add_script_run_ctx(thread)      
      #print(f"no of threads: {len(exe._threads)}")
      vlm_thread_count += 1
      print(f"run_vlm_inference thread started - {future}, c: {vlm_thread_count}")

      future.result()
      #return exe.submit(run_in_thread, vlm_ctx, event_loop, webrtc_ctx).result()
    

#test fragment        
#if 'fragment_counter' not in st.session_state:
#   st.session_state['fragment_counter'] = 0
        
#@st.fragment(run_every=1)
def update_alerts(alerts_md):
    #st.session_state.fragment_counter += 1    
    #st.markdown(f"fragment_counter: {st.session_state.fragment_counter} <br>")
    st.markdown(
        alerts_md
    )


         
      
###### Main ###############        
        
def main():

  global current_run_id
  global alert_queue

  logo_path = 'intel-logo-0.png'
  st.logo(logo_path)
  
  st.title("Loss Prevention Video Summarization")
  footer = """<style>.footer {position: fixed; left: 0; bottom: 0; width: 100%;background-color:#000000;color: white;text-align: center;}</style><div class='footer'><p>Powered by Intel Core&trade; Ultra Processor and Intel&copy; Arc&trade; B-series GPU.</p></div>"""
  
  st.markdown(footer, unsafe_allow_html=True)
    
  #st.sidebar.button('Clear Chat History', on_click=clear_chat_history)
  
  #event = asyncio.Event()
  loop = asyncio.new_event_loop()
  event = threading.Event()
  
  #increment run_id for every re-run
  previous_run_id = st.session_state.run_id
  st.session_state.run_id += 1
  current_run_id = st.session_state.run_id
    
  with st.sidebar:
     selected_camera_id = st.sidebar.selectbox(
        "Camera Selection", list("Camera " + id for id in camera_lists.keys()),
     ) 
     #pause = st.checkbox('Pause Inference')
     annotate_time = st.checkbox('add timestamp')
     save_vector_db = st.checkbox('save into vector DB')
     summarizer_fps = st.slider("summarizer fps", 1, 15, 4)
     
     st.markdown(f"""
     *chunk's length:* {48 / summarizer_fps} s
     """)
     
     vlm_sys_prompt=st.text_area("system_prompt", VLM_SYSTEM_PROMPT)
     vlm_prompt=st.text_area("user_prompt", VLM_USER_PROMPT)
  
  cam_id = selected_camera_id.split()[-1]
  st.session_state.cam_id = int(cam_id)
  print(f"cam_id: {st.session_state.cam_id}")
  flip = False
  
  rtsp_url = camera_lists[f"{st.session_state.cam_id}"]
  fps=get_fps(rtsp_url)
  print(f"fps of cam {cam_id}: {fps}, url: {rtsp_url}")
  
  spacer_col, left_col, right_col = st.columns([0.05, 0.75, 0.2])  # Adjust ratio as needed
  
  with left_col:
    #webrtc_placeholder = st.empty()  
    with st.empty():
      with st.container(height=600):
        with st.empty():
          webrtc_spacer, webrtc_left_col, webrtc_right_col = st.columns([0.05, 0.9, 0.05])
          with webrtc_left_col: 
            ctx = webrtc_streamer(
                    key="rtsp", 
                    mode=WebRtcMode.RECVONLY, 
                    video_processor_factory=lambda: VideoProcessor(0, flip, fps), 
                    player_factory=lambda: create_rtsp_player(rtsp_url),
                    media_stream_constraints={"video": True, "audio": False},
                  )
              
            #FIXME: streamlit-webrtc UI ghost/shadow fix
            for i in range(0, 10):
              st.empty()

  
  with right_col:
    with st.container(height=600):  
      st.markdown("#### :material/notification_important: Notifications")
    #message_container = st.container()
    #with message_container:
  
      message_area = st.empty()
    
      events_placeholder = st.empty()

  with st.empty():
    new_spacer_col, new_left_col = st.columns([0.05, 0.95])  # Adjust ratio as needed
  
    with new_left_col:
      st.markdown("##### VLM output (Edge): ")
      with st.empty():
        with st.container(height=150):
           #with st.empty():
           perf_output = st.empty()
           lvm_output = st.empty()
           chat_history_output = st.empty()
           
    with new_left_col:
       st.markdown("##### VLM chat records: ")
       histories_placeholder=st.empty()
            
  #render_vlm_records(histories_placeholder)
  
  st_widgets_placeholder = st_comp_app( vlm_summ_placeholder=lvm_output, 
                                        alert_placeholder=message_area,
                                        alert_history_placeholder=events_placeholder, 
                                        perf_placeholder=perf_output,
                                        chat_placeholder=histories_placeholder
                                      )   
  vlm_ctx = vlm_inference_ctx(system_prompt=vlm_sys_prompt, user_prompt=vlm_prompt, st_placeholder=st_widgets_placeholder, run_id=current_run_id, thread_event=event)      

  if ctx.state.playing:
    if ctx.video_processor:
        ctx.video_processor.event = event
        ctx.video_processor.event_loop = loop
        #ctx.video_processor.pause = pause
        ctx.video_processor.annotate_time = annotate_time
        ctx.video_processor.cam_id = st.session_state.cam_id
        ctx.video_processor.save_into_db = save_vector_db
        ctx.video_processor.summarizer_fps = summarizer_fps
 

  # Note: Streamlit generates a new script_run_context after each re-run, and we have to start a new inference thread when that occur.
  #if current_run_id==1 or (current_run_id > 1 and (current_run_id != previous_run_id)):
  print(f"script re-run occur, {current_run_id} != {previous_run_id}")
  run_vlm_inference(vlm_ctx, loop, ctx)
    

if __name__ == "__main__":
    main()

