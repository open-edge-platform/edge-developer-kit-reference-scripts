# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import cv2
from moviepy.editor import VideoFileClip


class VideoProcessor:
    def retrieve_with_video_timestamp(video_file: str, target_time_ms: float, output_file: str = "./data/temp.mp4"):
        # Define the interval based on the target time
        interval_ms = 5000
        start_time_ms = max(0, target_time_ms - interval_ms / 2)
        end_time_ms = target_time_ms + interval_ms / 2

        # Load the existing video

        video = VideoFileClip(video_file)

        # Define start and end times in seconds (with milliseconds)
        start_time = start_time_ms/ 1000 
        end_time = end_time_ms / 1000
        # Create a subclip
        new_video = video.subclip(start_time, end_time)

        # Save the new video
        new_video.write_videofile(output_file, codec="libx264",verbose=False,logger=None)
        # Check if the output file was created
        if not os.path.exists(output_file):
            print("Error: Output video file was not created.")
            return None

        return output_file

    def extract_video_frames(video_path: str):
        frame_data = []

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print("Error: Could not open video.")
            return []

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_interval = int(fps)
        frame_index = 0
        
        while True:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ret, frame = cap.read()
            if frame is not None:
                frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                data = {
                    "video_path": video_path,
                    "timestamp": cap.get(cv2.CAP_PROP_POS_MSEC),
                    "video_frame": frame
                }
                frame_data.append(data)
                frame_index += frame_interval
            if not ret:
                break

        return frame_data
