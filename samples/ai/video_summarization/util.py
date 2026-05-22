# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import ffmpeg
import asyncio
# subprocess module is needed and no other good alternative
import subprocess  #nosec
import io

class VLMRecord:
   id: str
   rawdata: str
    
   def __init__(self, id='0', rawdata=''):
      self.id = id
      self.rawdata = rawdata
        
   def decode(self):
      retval = {}
      # check for alert, and raise alert in notification area
      #try:
      anomaly_score = json_extract_value(self.rawdata , 'anomaly_score')
      f_anomaly_score = float(anomaly_score)
      camera_name = json_extract_value(self.rawdata , 'camera_name')
      timepoint = json_extract_value(self.rawdata , 'time_span')
      datetime = json_extract_value(self.rawdata , 'date')
      desc = json_extract_value(self.rawdata , 'description')
      alert = json_extract_value(self.rawdata , 'alert')
         
      retval = { 'id':self.id, 
                 'camera_name': camera_name,
                 'time_span': timepoint,
                 'datetime': datetime,
                 'description': desc,
                 'anomaly_score': f_anomaly_score,
                 'alert': alert
               }
      #except (json.JSONDecodeError, TypeError):
      #   #silently handle exceptions
      #   print("INFO: json_extract_value exception")      
      return retval
      
def json_extract_value(json_string, field):
    print("json extract")
    try:
       data=json.loads(json_string)
       value=data.get(field, None)
       print(f"INFO json: {field}: {value}")
       return value
    except (json.JSONDecodeError, TypeError):
       #silently handle exceptions
       print("INFO: json_extract_value exception")
       return None
      
def compute_time_differences(latency_list):
   if not latency_list:
      return []
      
   new_list = [latency_list[0]] # first item remain same
   for i in range(1, len(latency_list)):
      new_list.append(latency_list[i] - latency_list[i-1])
   return new_list


def encode_frame_PIL(frame):
    #return Image.fromarray(frame.astype('uint8'))
    #return Tensor(frame.astype('uint8'))
    return frame.astype('uint8') 

       
def get_fps(rtsp_url):
   #from ffmpeg.ffmpeg import FFmpeg
   probe = ffmpeg.probe(rtsp_url)
   #ffprobe = FFmpeg(executable='ffprobe').input(rtsp_url, print_format="json", show_streams=None)
   #media = json.loads(ffprobe.execute())
   #print(f"json: {media}")
   #video_stream = next((stream for stream in media['streams'] if stream['codec_type'] == 'video'), None)
   video_stream = next((stream for stream in probe['streams'] if stream['codec_type'] == 'video'), None)
   if video_stream and 'r_frame_rate' in video_stream:
       fps = eval(video_stream['r_frame_rate'])
       return fps
   else:
      return 0
      
#async def encode_from_stream(input_url, output_file):
#    ffmpeg = (
#        FFmpeg()
#        .input(input_url)
#        .output(output_file, vcodec='libx264', preset='veryslow', crf=24)
#    )
#    await ffmpeg.execute()
    
async def encode_vframes_to_file(byte_data, output_file, width, height, fps, format='bgr'):
    #from ffmpeg.ffmpeg import FFmpeg
    #from ffmpeg.progress import Progress
    process = (
                ffmpeg
                .input('pipe:', format='rawvideo', pix_fmt=format, s=f'{width}x{height}', r=f"{fps}")        # Input is from pipe
                .output(output_file, pix_fmt='yuv420p', vcodec='libx264', preset='veryslow', crf=23)       # Output is streamed as mp3
                .overwrite_output()
                .run_async(pipe_stdin=True, pipe_stdout=False, pipe_stderr=False) # use stdin for async
              )
    #ffmpeg_process = (
    #            FFmpeg()
    #            .option('y')
    #            .input('pipe:0', {'format': 'rawvideo', 'pix_fmt':f'{format}', 's':f'{width}x{height}', 'r':f'{fps}'})
    #            .output(output_file,{'pix_fmt':'yuv420p','vcodec':'libx264','preset':'veryslow','crf':'23'})
    #         )

    #@ffmpeg_process.on("progress")
    #def on_progress(progress: Progress):
    #   print(f"progress: {progress}")
    # Start the process
    
    process.stdin.write(byte_data)
    process.stdin.flush()
    #await process.stdin.flush()
    #await process.stdin.drain()
    
    # Closing the stdin to signal that there are no more input bytes to write
    process.stdin.close()
    
    # Reading the output from ffmpeg
    return await process.wait()
    #return await ffmpeg_process.execute(byte_data)
    
    #return output  # This will be the encoded data
    
