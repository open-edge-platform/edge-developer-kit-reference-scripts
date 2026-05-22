# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from streamlit_webrtc import WebRtcMode, webrtc_streamer, VideoProcessorBase
import collections
from typing import List, NamedTuple, Union, Any, Mapping, Optional
import threading
from datetime import datetime
import av
import cv2
import os
import numpy as np
from aiortc.contrib.media import MediaPlayer
from util import encode_frame_PIL


MINICPM_MAX_FRAMES = 48
MINICPM_SAMPLING_INTERVAL = 4

class VideoProcessor(VideoProcessorBase):
   frame_lock: threading.Lock
   #in_image: Union[np.ndarray, None]
   #out_image: Union[np.ndarray, None]
   flip: bool
   fps: int
   #buffer: object
   cam_id: int
   counter: int
   event: threading.Event
   #event: asyncio.Event
   event_loop: object
   pause: bool
   width: int
   height: int
   annotate_time: bool
   save_into_db: bool
   summarizer_fps: int
   
   def __init__(self, cam_id, flip, fps) -> None:
      self.frame_lock = threading.Lock()
      self.in_image = None
      self.out_image = None
      self.flip = flip
      self.fps = fps
      self.cam_id = cam_id
      self.buffer = collections.deque(maxlen=MINICPM_MAX_FRAMES)
      self.counter = 0
      self.pause = 0
      #self.sample_interval = self.fps // 1.5
      self.sample_interval = self.fps // MINICPM_SAMPLING_INTERVAL
      self.event = None
      self.width = 0
      self.height = 0
      self.annotate_time = False
      self.save_into_db = False
      self.summarizer_fps = 6  # 6
      
   def recv(self, frame: av.VideoFrame) -> av.VideoFrame:
      self.counter = self.counter + 1
      #print(f"counter: {self.counter}")
      #in_image = frame.to_ndarray(format="rgb24")
      in_image = frame.to_ndarray(format="rgb24")
      
      #print(f"in_image shape: {in_image.shape}")
      out_image = in_image[:, ::-1, :] if self.flip else in_image
      now = datetime.now()
      current_time = now.strftime("%Y-%m-%d %H:%M:%S")
      
      # define postion and font for the overlay
      position = (10,50)
      font = cv2.FONT_HERSHEY_SIMPLEX
      font_scale = 2
      font_color = (255, 255, 255) # white
      thickness = 6
      
      # Add the date and time overlay to the frame
      cv_mat = cv2.cvtColor(out_image, cv2.COLOR_RGB2BGR)
      if self.annotate_time:
         cv2.putText(cv_mat, f"CAM_{self.cam_id}     " + current_time, position, font, font_scale, font_color, thickness, cv2.LINE_AA)
      
      height, width = cv_mat.shape[:2]
      cv_mat_resized = cv2.resize(cv_mat, None, fx=0.3, fy=0.3)
      
      if self.height==0 and self.width==0:
        resized_height, resized_width = cv_mat_resized.shape[:2]
        self.height = resized_height
        self.width = resized_width
      
      #bgr_data=np.array(cv_mat)
      bgr_data=np.array(cv_mat_resized)
      out_frame = av.VideoFrame.from_ndarray(bgr_data, format="bgr24")
      
      bgr_data_best=np.array(cv_mat)
      out_frame_best = av.VideoFrame.from_ndarray(bgr_data_best, format="bgr24")
      
            
      #fixed interval sampling
      #append_interval = self.fps // 1.5 # we set to add a frame into the circular buffer at the 1.5fps
      #append_interval = self.sample_interval
      append_interval = self.fps // self.summarizer_fps
      
      # feat: allow user to pause inference due to limited GPU resource
      
      if not self.pause:
          if self.counter % append_interval== 0:  # queue frame for inference call
             with self.frame_lock:
                self.buffer.append(encode_frame_PIL(bgr_data[:,:,::-1]))
                if len(self.buffer) == self.buffer.maxlen:
                   # circular buffer is full, process frames:
                   print(f"buffer full")
                   # set inference thread to ready state
                   self.event.set()          
      #return out_frame
      return out_frame_best
      

def create_rtsp_player(url):
    #return MediaPlayer(camera_lists[f"{st.session_state.cam_id}"], format="rtsp", options={"rtsp_transport":"tcp"})
    return MediaPlayer(url, format="rtsp", options={"rtsp_transport":"tcp"})      
